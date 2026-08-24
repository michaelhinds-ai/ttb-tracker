/**
 * POST /api/notify/checkout   — Shopify webhook receiver for cart recovery
 *
 * Subscribe FOUR topics to this one URL (all four are in the admin dropdown):
 *   Checkout creation   checkouts/create
 *   Checkout update     checkouts/update
 *   Checkout deletion   checkouts/delete
 *   Order creation      orders/create
 *
 * This handler only ever writes to storage. It never sends email, because
 * Shopify enforces a FIVE SECOND total timeout on webhook delivery and kills
 * subscriptions that repeatedly fail — a send inline would eventually delete
 * the webhook. notify-recover (scheduled) does the sending.
 *
 * KEYS, and why they are not the obvious ones:
 *   Shopify REMOVED `id` from checkouts/* webhooks in API 2026-04, and removed
 *   `checkout_id` from every orders/* webhook at the same time. The pairing
 *   that still works is checkout `token` <-> order `checkout_token`.
 *   checkouts/delete carries NO token at all, only `cart_token`, so deletes
 *   are resolved through that instead.
 */

import crypto from 'node:crypto';
import {
  upsertCheckout,
  markCheckoutRecovered,
  deleteCheckout,
  findCheckoutByCartToken,
  enqueueVip,
  markVipMember,
  getVipMembers,
  safeProductImage
} from './lib/notify-core.mjs';

/** The subscription, so we can tell members from prospects. */
const VIP_VARIANT_ID = process.env.NOTIFY_VIP_VARIANT_ID || '42045781410050';
const VIP_DELAY_HOURS = Number(process.env.NOTIFY_VIP_DELAY_H ?? 24);

function orderContainsSubscription(order) {
  return (order.line_items || []).some(
    (li) =>
      String(li.variant_id) === VIP_VARIANT_ID ||
      /subscription/i.test(li.title || '')
  );
}

function verify(rawBody, header) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  const a = Buffer.from(digest);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const raw = await req.text();
  const topic = req.headers.get('x-shopify-topic') || 'unknown';

  // HMAC must be checked against the RAW body, before any parsing.
  if (!verify(raw, req.headers.get('x-shopify-hmac-sha256'))) {
    console.warn(`[checkout] rejected ${topic} with bad or missing HMAC`);
    return new Response('unauthorized', { status: 401 });
  }

  let p;
  try { p = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }

  try {
    /* ---- an order landed: stop emailing that checkout ---- */
    if (topic === 'orders/create') {
      const token = p.checkout_token || null;
      if (token) {
        await markCheckoutRecovered(token, 'order');
        console.log(`[checkout] order ${p.name || ''} recovered checkout ${token}`);
      } else if (p.cart_token) {
        const rec = await findCheckoutByCartToken(p.cart_token);
        if (rec) {
          await markCheckoutRecovered(rec.token, 'order-by-cart');
          console.log(`[checkout] order matched via cart_token -> ${rec.token}`);
        }
      }

      /* ---- VIP invite on the second order ---- */
      try {
        const email = (p.email || p.customer?.email || '').trim();
        if (email) {
          if (orderContainsSubscription(p)) {
            // They just joined. Record it so they never get invited to
            // something they are already in.
            await markVipMember(email);
            console.log(`[vip] ${email} is now a member — invite suppressed`);
          } else {
            const count = p.customer?.orders_count;
            const members = await getVipMembers();

            if (count === 2 && !members[email.toLowerCase()]) {
              // Delayed so it does not land alongside the order confirmation.
              const sendAfter = new Date(Date.now() + VIP_DELAY_HOURS * 3600000).toISOString();
              const q = await enqueueVip({
                email,
                firstName: p.customer?.first_name || '',
                source: 'second-order',
                sendAfter
              });
              console.log(
                `[vip] second order from ${email} — ${q.queued ? 'queued' : 'skipped: ' + q.reason}`
              );
            } else if (count === undefined) {
              // orders_count is not guaranteed present; protected customer
              // data rules can redact it. Say so rather than failing quietly.
              console.warn('[vip] orders_count absent on orders/create — live trigger inactive');
            }
          }
        }
      } catch (err) {
        console.error(`[vip] second-order check failed: ${err?.message || err}`);
      }

      return new Response('ok', { status: 200 });
    }

    /* ---- checkout deleted ---- */
    if (topic === 'checkouts/delete') {
      // No `token` on this payload — only cart_token.
      const rec = await findCheckoutByCartToken(p.cart_token);
      if (rec) {
        await deleteCheckout(rec.token);
        console.log(`[checkout] deleted ${rec.token}`);
      }
      return new Response('ok', { status: 200 });
    }

    /* ---- created / updated ---- */
    const token = p.token;
    if (!token) {
      console.warn(`[checkout] ${topic} arrived with no token — ignoring`);
      return new Response('ok', { status: 200 });
    }

    if (p.completed_at) {
      await markCheckoutRecovered(token, 'completed_at');
      return new Response('ok', { status: 200 });
    }

    const email = (p.email || p.customer?.email || '').trim();

    // Shopify itself only calls a checkout "abandoned" once contact info
    // exists, and the email field is commonly empty on the first event. Store
    // the record either way — a later checkouts/update fills it in — but
    // notify-recover will not send until there is an address.
    const record = {
      token,
      cartToken: p.cart_token || null,
      email: email || null,
      firstName: p.customer?.first_name || p.billing_address?.first_name || '',
      recoverUrl: p.abandoned_checkout_url || null,
      currency: p.presentment_currency || p.currency || 'USD',
      totalPrice: p.total_price || null,   // string, not a number
      createdAt: p.created_at || new Date().toISOString(),
      updatedAt: p.updated_at || new Date().toISOString(),
      items: (p.line_items || []).slice(0, 12).map((li) => ({
        title: li.title || li.presentment_title || 'A bottle',
        quantity: li.quantity || 1,
        productId: li.product_id ? String(li.product_id) : null,
        variantId: li.variant_id ? String(li.variant_id) : null,
        // line_items carry no image field at all — filled in at send time
        // from the product image cache.
        image: safeProductImage(li.image || null)
      }))
    };

    const res = await upsertCheckout(record);
    console.log(
      `[checkout] ${topic} ${token} — email=${email ? 'y' : 'n'} ` +
        `items=${record.items.length} url=${record.recoverUrl ? 'y' : 'n'} new=${res.isNew}`
    );
  } catch (err) {
    // Always 200 below: a non-2xx makes Shopify retry, and eight consecutive
    // failures DELETE the webhook subscription outright.
    console.error(`[checkout] ${topic} handler error: ${err?.message || err}`);
  }

  return new Response('ok', { status: 200 });
};

export const config = { path: '/api/notify/checkout' };
