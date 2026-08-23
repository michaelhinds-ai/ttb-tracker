/**
 * POST /api/notify/restock   — Shopify webhook receiver
 *
 * Subscribe this to the `variants/in_stock` topic. That topic is the right one:
 * it fires on the zero-crossing rather than on every quantity change, and its
 * payload is a full variant object. The obvious alternative,
 * `inventory_levels/update`, fires on every decrement, is per-location, and
 * carries no product id or previous value.
 *
 * Register it once (Notifications -> Webhooks in admin, or the Admin API) at:
 *   https://lrwc-ttb-tracker.netlify.app/api/notify/restock
 * and put the signing secret in SHOPIFY_WEBHOOK_SECRET.
 *
 * DELIVERY: Mailchimp Transactional (Mandrill), not a Customer Journey.
 * Mailchimp does not allow non-subscribed contacts into marketing automations,
 * and most people who ask for a restock alert are deliberately non-subscribed —
 * asking about one bottle is not consent to a newsletter. A journey would have
 * delivered nothing to them, silently. See lib/notify-mail.mjs.
 */

import crypto from 'node:crypto';
import { takeInterest, getMember, SUPPRESSED_STATUSES } from './lib/notify-core.mjs';
import { buildRestockEmail, sendMandrill, STORE } from './lib/notify-mail.mjs';

/** Timing-safe HMAC check. An unverified webhook endpoint is an open relay. */
function verify(rawBody, header) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret || !header) return false;

  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  const a = Buffer.from(digest);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const raw = await req.text();

  if (!verify(raw, req.headers.get('x-shopify-hmac-sha256'))) {
    console.warn('[restock] rejected webhook with bad or missing HMAC');
    return new Response('unauthorized', { status: 401 });
  }

  let variant;
  try {
    variant = JSON.parse(raw);
  } catch {
    return new Response('bad json', { status: 400 });
  }

  const variantId = variant?.id;
  if (!variantId) return new Response('no variant id', { status: 400 });

  // Claim the waiting list up front. takeInterest deletes as it reads, so a
  // Shopify redelivery (they retry on non-2xx) cannot email anyone twice.
  const people = await takeInterest(variantId);

  if (!people.length) {
    console.log(`[restock] variant ${variantId} back in stock, nobody waiting`);
    return new Response('ok', { status: 200 });
  }

  const first = people[0];
  const productTitle = first.productTitle || variant.title || 'a bottle you wanted';
  const productUrl = first.productHandle ? `${STORE}/products/${first.productHandle}` : STORE;
  const subject = `Back in stock: ${productTitle}`;

  // Earliest record with an image wins. Signups made before image capture
  // existed simply have none, and the email drops the block rather than
  // rendering a broken one.
  const productImage = people.find((p) => p.productImage)?.productImage || null;

  let sent = 0;
  let suppressed = 0;
  const failed = [];

  // Sequential. Volumes here are dozens, not thousands, and serialising keeps
  // the Mandrill rate limit and the logs simple to read.
  for (const person of people) {
    try {
      // Mandrill ignores Mailchimp's unsubscribe state, so check it ourselves.
      // Skipping this would mean emailing people who explicitly opted out.
      const member = await getMember(person.email);
      if (member && SUPPRESSED_STATUSES.has(member.status)) {
        suppressed += 1;
        console.log(`[restock] suppressed ${person.email} (status=${member.status})`);
        continue;
      }

      const { html, text } = buildRestockEmail({
        productTitle,
        productUrl,
        productImage,
        firstName: member?.firstName || ''
      });

      await sendMandrill({
        to: person.email,
        subject,
        html,
        text,
        tags: ['restock-alert']
      });

      sent += 1;
    } catch (err) {
      failed.push({ email: person.email, error: err?.message || String(err) });
      console.error(`[restock] failed for ${person.email}: ${err?.message || err}`);
    }
  }

  console.log(
    `[restock] variant ${variantId} (${productTitle}) — sent ${sent}/${people.length}` +
      (suppressed ? `, ${suppressed} suppressed` : '') +
      (failed.length ? `, ${failed.length} failed` : '')
  );

  // Always 200. A non-2xx makes Shopify redeliver, and the list is already
  // cleared, so a retry would notify nobody while looking like a failure.
  return new Response(
    JSON.stringify({ ok: true, sent, suppressed, failed: failed.length }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};

export const config = { path: '/api/notify/restock' };
