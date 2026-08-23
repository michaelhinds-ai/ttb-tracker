/**
 * POST /api/notify/restock   — Shopify webhook receiver
 *
 * ACCEPTS TWO TOPICS, because Shopify's admin UI exposes only a subset of the
 * documented webhook list:
 *
 *   variants/in_stock   Ideal. Fires on the zero-crossing only, payload is a
 *                       single ProductVariant. Often NOT available in the admin
 *                       dropdown — it usually has to be created via the Admin
 *                       API, and an API-created webhook is signed with the
 *                       creating app's client secret rather than the store
 *                       signing key.
 *
 *   products/update     Available in the admin dropdown. Noisier — fires on any
 *                       product edit — but that costs nothing here: we only act
 *                       when a variant is BOTH in stock AND has people waiting,
 *                       and the waiting list is cleared on send, so repeat
 *                       fires cannot double-email.
 *
 * The payload shape is detected rather than assumed, and logged, so the first
 * test tells you plainly which topic arrived and whether it carried usable
 * inventory data.
 *
 * SIGNING SECRET: set SHOPIFY_WEBHOOK_SECRET to whichever applies —
 *   admin-created  -> the store signing key shown on the Webhooks page
 *   API-created    -> the creating app's client secret (SHOPIFY_CLIENT_SECRET)
 *
 * DELIVERY: Mailchimp Transactional (Mandrill), not a Customer Journey.
 * Mailchimp does not allow non-subscribed contacts into marketing automations,
 * and most restock signups are deliberately non-subscribed. See lib/notify-mail.mjs.
 */

import crypto from 'node:crypto';
import { takeInterest, peekInterest, getMember, SUPPRESSED_STATUSES } from './lib/notify-core.mjs';
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

/**
 * Normalise either payload shape into a list of candidate variants.
 *
 * `inStock` is deliberately conservative. For variants/in_stock the topic
 * itself is the signal, so it is true by definition. For products/update we
 * require a positive inventory_quantity — and if that field is missing
 * entirely we return null rather than guessing, so the caller can say so out
 * loud instead of failing silently.
 */
function extractVariants(payload, topicHint) {
  // products/update — a Product with a variants array
  if (payload && Array.isArray(payload.variants)) {
    return {
      shape: 'product',
      variants: payload.variants.map((v) => ({
        id: v.id,
        inStock:
          typeof v.inventory_quantity === 'number' ? v.inventory_quantity > 0 : null,
        qty: v.inventory_quantity
      }))
    };
  }

  // variants/in_stock — a single ProductVariant
  if (payload && payload.id && (payload.product_id !== undefined || payload.sku !== undefined)) {
    return {
      shape: 'variant',
      variants: [
        {
          id: payload.id,
          // The topic is the signal. Trust it over the quantity field, which
          // can lag on the zero-crossing.
          inStock: topicHint === 'variants/out_of_stock' ? false : true,
          qty: payload.inventory_quantity
        }
      ]
    };
  }

  return { shape: 'unknown', variants: [] };
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const raw = await req.text();
  const topic = req.headers.get('x-shopify-topic') || 'unknown';

  if (!verify(raw, req.headers.get('x-shopify-hmac-sha256'))) {
    console.warn(`[restock] rejected webhook (topic=${topic}) with bad or missing HMAC`);
    return new Response('unauthorized', { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response('bad json', { status: 400 });
  }

  const { shape, variants } = extractVariants(payload, topic);

  if (shape === 'unknown' || !variants.length) {
    console.warn(`[restock] topic=${topic} — unrecognised payload shape, nothing to do`);
    return new Response('ok', { status: 200 });
  }

  if (shape === 'product' && variants.every((v) => v.inStock === null)) {
    console.error(
      `[restock] topic=${topic} carried NO inventory_quantity on any variant. ` +
        'This topic cannot drive restock alerts on its own — switch to ' +
        'variants/in_stock (Admin API) or add an inventory lookup.'
    );
    return new Response('ok', { status: 200 });
  }

  let totalSent = 0;
  let totalSuppressed = 0;
  let totalFailed = 0;
  let touched = 0;

  for (const v of variants) {
    if (v.inStock !== true) continue;

    // Cheap check first: most product edits concern bottles nobody is waiting on.
    const waiting = await peekInterest(v.id);
    if (!waiting.length) continue;

    touched += 1;

    // Claim and clear, so a Shopify redelivery cannot email anyone twice.
    const people = await takeInterest(v.id);
    if (!people.length) continue;

    const first = people[0];
    const productTitle =
      first.productTitle || payload.title || payload.name || 'a bottle you wanted';
    const productUrl = first.productHandle
      ? `${STORE}/products/${first.productHandle}`
      : payload.handle
        ? `${STORE}/products/${payload.handle}`
        : STORE;
    const productImage = people.find((p) => p.productImage)?.productImage || null;
    const subject = `Back in stock: ${productTitle}`;

    // Sequential: volumes are dozens, and it keeps the log readable.
    for (const person of people) {
      try {
        // Mandrill ignores Mailchimp's unsubscribe state, so check it ourselves.
        // Without this, opted-out people still get mail. Do not remove.
        const member = await getMember(person.email);
        if (member && SUPPRESSED_STATUSES.has(member.status)) {
          totalSuppressed += 1;
          console.log(`[restock] suppressed ${person.email} (status=${member.status})`);
          continue;
        }

        const { html, text } = buildRestockEmail({
          productTitle,
          productUrl,
          productImage,
          firstName: member?.firstName || ''
        });

        await sendMandrill({ to: person.email, subject, html, text, tags: ['restock-alert'] });
        totalSent += 1;
      } catch (err) {
        totalFailed += 1;
        console.error(`[restock] failed for ${person.email}: ${err?.message || err}`);
      }
    }

    console.log(`[restock] variant ${v.id} (${productTitle}) — ${people.length} waiting`);
  }

  console.log(
    `[restock] topic=${topic} shape=${shape} variants=${variants.length} ` +
      `withWaitlist=${touched} sent=${totalSent} suppressed=${totalSuppressed} failed=${totalFailed}`
  );

  // Always 200. A non-2xx makes Shopify redeliver, and the lists are already
  // cleared, so a retry would notify nobody while looking like a failure.
  return new Response(
    JSON.stringify({ ok: true, shape, sent: totalSent, suppressed: totalSuppressed, failed: totalFailed }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};

export const config = { path: '/api/notify/restock' };
