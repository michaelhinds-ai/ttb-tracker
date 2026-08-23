/**
 * POST /api/notify/subscribe
 *
 * Called by snippets/notify-me.liquid when someone asks to be told a sold-out
 * barrel is back. Does three things:
 *
 *   1. Records the interest against the variant (Netlify Blobs).
 *   2. Upserts the contact into the Mailchimp audience with the date of birth
 *      affirmed at the age gate.
 *   3. Honours the marketing opt-in as a SEPARATE decision from the alert.
 *
 * The consent split is the important part. Asking to hear when one bottle
 * returns is not consent to a newsletter. Contacts who did not tick the box go
 * in as "transactional": they get the alert, they are not in marketing sends.
 */

import {
  addInterest,
  upsertContact,
  validEmail,
  ageFromISO,
  json,
  corsHeaders
} from './lib/notify-core.mjs';

const MIN_AGE = 21;
const MAX_WAITING_PER_VARIANT = 5000;

export default async (req) => {
  const origin = req.headers.get('origin') || '';

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, { status: 405, origin });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, { status: 400, origin });
  }

  const {
    email,
    dob,
    marketing_opt_in: marketingOptIn = false,
    product_id: productId,
    product_title: productTitle,
    product_handle: productHandle,
    variant_id: variantId,
    variant_title: variantTitle,
    source = 'product_page_notify',
    page_url: pageUrl
  } = payload || {};

  if (!validEmail(email)) {
    return json({ error: 'invalid_email' }, { status: 400, origin });
  }
  if (!variantId) {
    return json({ error: 'missing_variant' }, { status: 400, origin });
  }

  /* --- Age ---------------------------------------------------------------
   * The gate runs site-wide, so a DOB should almost always be present. When it
   * is not (cleared storage, a direct link, a forged request) we still honour
   * the restock alert — the person asked for it and it is transactional — but
   * we refuse to add them to marketing. DISCUS 2D.B.6 restricts data collection
   * for marketing to those of legal purchase age, and an unaffirmed visitor is
   * not that. An affirmed DOB below 21 is refused outright.
   */
  const age = ageFromISO(dob);
  if (age !== null && age < MIN_AGE) {
    return json({ error: 'underage' }, { status: 403, origin });
  }
  const ageAffirmed = age !== null;
  const allowMarketing = Boolean(marketingOptIn) && ageAffirmed;

  const cleanEmail = String(email).trim();
  const nowIso = new Date().toISOString();

  try {
    const interest = await addInterest(variantId, {
      email: cleanEmail,
      dob: ageAffirmed ? dob : null,
      marketingOptIn: allowMarketing,
      productId,
      productTitle,
      productHandle,
      variantTitle,
      requestedAt: nowIso
    });

    if (interest.total > MAX_WAITING_PER_VARIANT) {
      console.warn(`[notify] variant ${variantId} waitlist above cap (${interest.total})`);
    }

    const mergeFields = {};
    if (ageAffirmed) {
      mergeFields.DOB = dob;                        // yyyy-mm-dd, full affirmed date
      mergeFields.BIRTHDAY = dob.slice(5).replace('-', '/'); // MM/DD for Mailchimp's birthday field
    }
    // Only stamp SOURCE for genuinely new online contacts. The weekly sync owns
    // this field and uses in-store > tour > online precedence; writing 'online'
    // over someone's 'tour' stamp would quietly downgrade them.
    mergeFields.SOURCE = 'online';

    const tags = ['barrel-alert'];
    if (allowMarketing) tags.push('drops-optin');

    await upsertContact({
      email: cleanEmail,
      marketingOptIn: allowMarketing,
      mergeFields,
      tags
    });

    console.log(
      `[notify] ${cleanEmail} -> variant ${variantId} (${productTitle || 'unknown'}) ` +
        `marketing=${allowMarketing} ageAffirmed=${ageAffirmed} new=${interest.added} ` +
        `waiting=${interest.total} src=${source} ${pageUrl || ''}`
    );

    return json(
      { ok: true, waiting: interest.total, marketing: allowMarketing },
      { origin }
    );
  } catch (err) {
    console.error('[notify] subscribe failed:', err?.message || err);
    return json({ error: 'server_error' }, { status: 500, origin });
  }
};

export const config = { path: '/api/notify/subscribe' };
