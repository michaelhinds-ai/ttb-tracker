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
  safeProductImage
} from './lib/notify-core.mjs';

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
