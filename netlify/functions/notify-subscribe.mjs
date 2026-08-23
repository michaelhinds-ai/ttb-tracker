/**
 * POST /api/notify/subscribe
 *
 * Called by snippets/notify-me.liquid when someone asks to be told a sold-out
 * barrel is back.
 *
 * The consent split is the important part. Asking to hear when one bottle
 * returns is not consent to a newsletter. Contacts who did not tick the box go
 * in as "transactional": they get the alert, they are not in marketing sends.
 *
 * ORDER OF OPERATIONS (this matters, and the first version got it wrong):
 * Mailchimp is called BEFORE the interest record is stored. Mailchimp is the
 * only step that can reject an address, so validating there first means a
 * refused signup leaves nothing behind. Storing first produced orphan records
 * for addresses that were never actually added.
 *
 * The one exception is a Mailchimp outage. If Mailchimp is unreachable or
 * throwing 5xx, we still keep the interest record rather than lose a customer
 * to someone else's downtime — they simply are not in the audience yet.
 */

import {
  addInterest,
  upsertContact,
  classifyMailchimpError,
  validEmail,
  ageFromISO,
  safeProductImage,
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
    product_image: productImageRaw,
    variant_id: variantId,
    variant_title: variantTitle,
    source = 'product_page_notify',
    page_url: pageUrl
  } = payload || {};

  // Vetted against a host whitelist — this ends up in an email we send.
  const productImage = safeProductImage(productImageRaw);

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

  /* --- 1. Mailchimp first ------------------------------------------------ */

  const mergeFields = { SOURCE: 'online' };
  if (ageAffirmed) {
    mergeFields.DOB = dob;                                  // yyyy-mm-dd, full affirmed date
    mergeFields.BIRTHDAY = dob.slice(5).replace('-', '/');  // MM/DD for Mailchimp's birthday field
  }

  const tags = ['barrel-alert'];
  if (allowMarketing) tags.push('drops-optin');

  let mailchimpOk = false;
  let mergeFieldsDropped = false;

  try {
    const result = await upsertContact({
      email: cleanEmail,
      marketingOptIn: allowMarketing,
      mergeFields,
      tags
    });
    mailchimpOk = true;
    mergeFieldsDropped = result.mergeFieldsDropped;

    if (mergeFieldsDropped) {
      console.error(
        '[notify] CONFIG: merge fields were rejected and dropped. Check DOB / BIRTHDAY / ' +
          'SOURCE exist in the audience with those exact merge tags.'
      );
    }
  } catch (err) {
    const kind = classifyMailchimpError(err);

    if (kind === 'address') {
      // Mailchimp will not take this address. Tell the person plainly rather
      // than returning a 500 that reads as "our fault, try later" — they need
      // to change something, and a vague error means they just give up.
      console.warn(`[notify] address rejected by Mailchimp: ${cleanEmail} — ${err.detail}`);
      return json({ error: 'email_rejected' }, { status: 400, origin });
    }

    // Transient or unexpected: fall through and still record the interest.
    console.error(`[notify] Mailchimp failed (${kind}), keeping interest record: ${err.message}`);
  }

  /* --- 2. Then store the interest ---------------------------------------- */

  try {
    const interest = await addInterest(variantId, {
      email: cleanEmail,
      dob: ageAffirmed ? dob : null,
      marketingOptIn: allowMarketing,
      productId,
      productTitle,
      productHandle,
      productImage,
      variantTitle,
      requestedAt: nowIso,
      mailchimpSynced: mailchimpOk
    });

    if (interest.total > MAX_WAITING_PER_VARIANT) {
      console.warn(`[notify] variant ${variantId} waitlist above cap (${interest.total})`);
    }

    console.log(
      `[notify] ${cleanEmail} -> variant ${variantId} (${productTitle || 'unknown'}) ` +
        `marketing=${allowMarketing} ageAffirmed=${ageAffirmed} new=${interest.added} ` +
        `waiting=${interest.total} mc=${mailchimpOk} src=${source} ${pageUrl || ''}`
    );

    return json(
      { ok: true, waiting: interest.total, marketing: allowMarketing },
      { origin }
    );
  } catch (err) {
    // Storage failed. If Mailchimp took them we have not lost the person, only
    // the per-variant alert. Say so honestly rather than claiming success.
    console.error(`[notify] interest storage failed for ${cleanEmail}: ${err?.message || err}`);

    if (mailchimpOk) {
      return json({ ok: true, waiting: null, marketing: allowMarketing, degraded: true }, { origin });
    }
    return json({ error: 'server_error' }, { status: 500, origin });
  }
};

export const config = { path: '/api/notify/subscribe' };
