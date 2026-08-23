/**
 * POST /api/notify/restock   — Shopify webhook receiver
 *
 * Subscribe this to the `variants/in_stock` topic. That topic is the right one:
 * it fires on the zero-crossing rather than on every quantity change, and its
 * payload is a full variant object. The obvious alternative,
 * `inventory_levels/update`, fires on every decrement, is per-location, and
 * carries no product id or previous value — you would have to rebuild all of
 * that yourself.
 *
 * Register it once (Notifications -> Webhooks in admin, or the Admin API) at:
 *   https://lrwc-ttb-tracker.netlify.app/api/notify/restock
 * and put the signing secret in SHOPIFY_WEBHOOK_SECRET.
 */

import crypto from 'node:crypto';
import { takeInterest, setMergeFields, triggerJourney } from './lib/notify-core.mjs';

const STORE_URL = (process.env.NOTIFY_STORE_URL || 'https://buyspiritsdirect.myshopify.com')
  .replace(/\/+$/, '');

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
  const productUrl = first.productHandle
    ? `${STORE_URL}/products/${first.productHandle}`
    : STORE_URL;

  let sent = 0;
  const failed = [];

  // Sequential on purpose. Each send is "write the merge fields, then trigger",
  // and those two calls must not interleave across contacts or one person can
  // receive another person's barrel in the copy.
  for (const person of people) {
    try {
      await setMergeFields(person.email, {
        RESTOCKNAM: productTitle.slice(0, 100), // Mailchimp merge tags cap at 10 chars
        RESTOCKURL: productUrl
      });
      await triggerJourney(person.email);
      sent += 1;
    } catch (err) {
      failed.push({ email: person.email, error: err?.message || String(err) });
      console.error(`[restock] failed for ${person.email}: ${err?.message || err}`);
    }
  }

  console.log(
    `[restock] variant ${variantId} (${productTitle}) — notified ${sent}/${people.length}` +
      (failed.length ? `, ${failed.length} failed` : '')
  );

  // Always 200. A non-2xx makes Shopify redeliver, and the list is already
  // cleared, so a retry would notify nobody while looking like a failure.
  return new Response(JSON.stringify({ ok: true, notified: sent, failed: failed.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};

export const config = { path: '/api/notify/restock' };
