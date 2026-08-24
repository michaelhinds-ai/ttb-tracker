/**
 * notify-core.mjs — shared helpers for the back-in-stock ("notify me") flow.
 *
 * Deliberately self-contained: this file does NOT import from lib/mailchimp.mjs,
 * lib/xola.mjs or lib/square.mjs. The weekly audience sync and this alert flow
 * are separate concerns that happen to write to the same Mailchimp audience, and
 * keeping them decoupled means neither can break the other.
 *
 * Reuses existing Netlify env vars: MAILCHIMP_API_KEY, MAILCHIMP_LIST_ID.
 */

import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

/* ------------------------------------------------------------------ *
 * Mailchimp
 * ------------------------------------------------------------------ */

const MC_KEY = process.env.MAILCHIMP_API_KEY;
const MC_LIST = process.env.MAILCHIMP_LIST_ID;

/** Mailchimp keys look like "abc123...-us21"; the suffix is the data centre. */
function mcDatacenter() {
  const dc = (MC_KEY || '').split('-')[1];
  if (!dc) throw new Error('MAILCHIMP_API_KEY is missing or malformed (no -dcNN suffix)');
  return dc;
}

export function subscriberHash(email) {
  return crypto.createHash('md5').update(String(email).trim().toLowerCase()).digest('hex');
}

async function mc(path, { method = 'GET', body } = {}) {
  const url = `https://${mcDatacenter()}.api.mailchimp.com/3.0${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`anystring:${MC_KEY}`).toString('base64')}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }

  if (!res.ok) {
    const detail = json?.detail || text || res.statusText;
    const err = new Error(`Mailchimp ${method} ${path} -> ${res.status}: ${detail}`);
    err.status = res.status;
    err.detail = detail;
    err.body = json;
    throw err;
  }
  return json;
}

/**
 * Work out what a Mailchimp failure actually means, because the caller's
 * response to each is different:
 *
 *   'address'     Mailchimp will not accept this address, ever. Known-fake
 *                 domains (example.com), addresses it considers abusive, or
 *                 ones that have joined too many lists too fast. The person
 *                 needs to fix it, so this must surface as a 400 with a useful
 *                 message — not a 500 that blames the store.
 *   'merge'       A merge field is missing or the wrong shape. That is a
 *                 configuration mistake on our side and must never cost a
 *                 customer their place on the list.
 *   'transient'   Mailchimp is down, rate-limiting, or unreachable. Keep the
 *                 signup and move on.
 *   'other'       Anything else — treated as transient, logged loudly.
 */
export function classifyMailchimpError(err) {
  const status = err?.status;
  const detail = String(err?.detail || err?.message || '');

  if (Array.isArray(err?.body?.errors) && err.body.errors.length) return 'merge';
  if (status === 429 || (status >= 500 && status <= 599)) return 'transient';
  if (!status) return 'transient'; // network / DNS / timeout

  if (status === 400) {
    if (/merge field|merge_fields/i.test(detail)) return 'merge';
    if (/fake or invalid|invalid email|not a valid email|signed up to a lot of lists|looks fake/i.test(detail)) {
      return 'address';
    }
    return 'other';
  }
  if (status === 403) return 'address'; // compliance state
  return 'other';
}

/**
 * Upsert a contact.
 *
 * Consent model, and the reason it matters:
 *   - A back-in-stock alert is a notification the person explicitly asked for,
 *     so it does not require marketing consent. Those contacts go in as
 *     "transactional": reachable by the alert, absent from marketing sends.
 *   - Ticking the marketing box is a separate act, and only that sets
 *     "subscribed".
 *
 * status_if_new is used everywhere so an existing unsubscribe is never
 * overwritten. Mailchimp will not resurrect someone who opted out.
 *
 * Returns { hash, mergeFieldsDropped } so the caller can log a configuration
 * problem without failing the request.
 */
export async function upsertContact({ email, marketingOptIn, mergeFields = {}, tags = [] }) {
  const hash = subscriberHash(email);

  const put = (fields) =>
    mc(`/lists/${MC_LIST}/members/${hash}`, {
      method: 'PUT',
      body: {
        email_address: email,
        status_if_new: marketingOptIn ? 'subscribed' : 'transactional',
        ...(fields && Object.keys(fields).length ? { merge_fields: fields } : {})
      }
    });

  let mergeFieldsDropped = false;
  try {
    await put(mergeFields);
  } catch (err) {
    if (classifyMailchimpError(err) === 'merge') {
      // Retry once with no merge fields. A missing field in the audience is our
      // mistake to fix; it is not a reason to turn a customer away.
      console.error(`[notify] merge fields rejected, retrying without them: ${err.detail}`);
      await put(null);
      mergeFieldsDropped = true;
    } else {
      throw err;
    }
  }

  // If they opted in and were previously transactional, promote them.
  // This never touches anyone whose status is 'unsubscribed' or 'cleaned'.
  if (marketingOptIn) {
    try {
      const current = await mc(`/lists/${MC_LIST}/members/${hash}`);
      if (current?.status === 'transactional') {
        await mc(`/lists/${MC_LIST}/members/${hash}`, {
          method: 'PATCH',
          body: { status: 'subscribed' }
        });
      }
    } catch (err) {
      if (err.status !== 404) throw err;
    }
  }

  if (tags.length) {
    await mc(`/lists/${MC_LIST}/members/${hash}/tags`, {
      method: 'POST',
      body: { tags: tags.map((name) => ({ name, status: 'active' })) }
    });
  }

  return { hash, mergeFieldsDropped };
}

/**
 * Push a contact into a Mailchimp Automation flow that starts with the
 * "Customer Journeys API" condition.
 *
 * Chosen over add-a-tag because a tag-triggered journey has a re-entry floor,
 * which makes it unreliable when one person is waiting on several barrels.
 * Set MAILCHIMP_JOURNEY_ID / MAILCHIMP_JOURNEY_STEP_ID from the URL Mailchimp
 * shows you when you add that starting point.
 */
export async function triggerJourney(email) {
  const journeyId = process.env.MAILCHIMP_JOURNEY_ID;
  const stepId = process.env.MAILCHIMP_JOURNEY_STEP_ID;
  if (!journeyId || !stepId) return { skipped: 'journey env vars not set' };

  await mc(`/customer-journeys/journeys/${journeyId}/steps/${stepId}/actions/trigger`, {
    method: 'POST',
    body: { email_address: email }
  });
  return { triggered: true };
}

export async function setMergeFields(email, mergeFields) {
  return mc(`/lists/${MC_LIST}/members/${subscriberHash(email)}`, {
    method: 'PATCH',
    body: { merge_fields: mergeFields }
  });
}

/**
 * Look up a contact's audience status and first name.
 *
 * This exists because Mandrill does NOT respect Mailchimp audience
 * unsubscribes — it will happily deliver to someone who opted out of your
 * list. Every transactional send must therefore check first. Returns
 * { status, firstName } or null if the contact is not in the audience.
 */
export async function getMember(email) {
  try {
    const m = await mc(`/lists/${MC_LIST}/members/${subscriberHash(email)}`);
    return { status: m?.status || null, firstName: m?.merge_fields?.FNAME || '' };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/** Statuses that must never receive a send, transactional or otherwise. */
export const SUPPRESSED_STATUSES = new Set(['unsubscribed', 'cleaned']);

/**
 * Everyone eligible for the weekly new-bottles email:
 * subscribed AND (tagged `drops-optin` OR SOURCE = online).
 *
 * Filtering happens here rather than via a Mailchimp segment so the rule lives
 * in one readable place, and so an accidental segment edit in the Mailchimp UI
 * cannot silently widen who gets marketing.
 *
 * `status=subscribed` is applied server-side, so unsubscribes and cleaned
 * addresses never enter the list at all.
 */
export async function listDropsAudience({ maxPages = 40 } = {}) {
  const perPage = 1000;
  const out = [];
  let offset = 0;
  let total = Infinity;
  let pages = 0;
  let scanned = 0;

  while (offset < total && pages < maxPages) {
    const res = await mc(
      `/lists/${MC_LIST}/members?status=subscribed&count=${perPage}&offset=${offset}` +
        `&fields=total_items,members.email_address,members.merge_fields,members.tags`
    );

    total = res?.total_items ?? 0;
    const batch = res?.members || [];
    if (!batch.length) break;

    for (const m of batch) {
      scanned += 1;
      const tags = (m.tags || []).map((t) => String(t.name).toLowerCase());
      const source = String(m.merge_fields?.SOURCE || '').toLowerCase();
      if (tags.includes('drops-optin') || source === 'online') {
        out.push({ email: m.email_address, firstName: m.merge_fields?.FNAME || '' });
      }
    }

    offset += batch.length;
    pages += 1;
  }

  if (pages >= maxPages) {
    console.warn(`[drops] audience paging hit the ${maxPages}-page cap — list may be truncated`);
  }
  return { recipients: out, scanned, total };
}

/* ------------------------------------------------------------------ *
 * Unsubscribe tokens
 * ------------------------------------------------------------------ *
 * The weekly drops email is marketing, not a requested one-off, so it needs a
 * working opt-out. Mandrill does not honour Mailchimp's audience unsubscribes,
 * so we cannot lean on Mailchimp's own link — we mint a signed token per
 * recipient and handle the opt-out ourselves, writing the result back to
 * Mailchimp so both systems agree.
 *
 * Signed rather than a bare email so nobody can unsubscribe someone else by
 * guessing URLs.
 */
function unsubSecret() {
  const s = process.env.NOTIFY_UNSUB_SECRET || process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!s) throw new Error('NOTIFY_UNSUB_SECRET (or SHOPIFY_WEBHOOK_SECRET) must be set');
  return s;
}

export function unsubToken(email) {
  return crypto
    .createHmac('sha256', unsubSecret())
    .update(String(email).trim().toLowerCase())
    .digest('base64url')
    .slice(0, 32);
}

export function verifyUnsubToken(email, token) {
  if (!email || !token) return false;
  const expected = Buffer.from(unsubToken(email));
  const given = Buffer.from(String(token));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** Set a contact to unsubscribed. Idempotent; a 404 is treated as success. */
export async function unsubscribeMember(email) {
  try {
    await mc(`/lists/${MC_LIST}/members/${subscriberHash(email)}`, {
      method: 'PATCH',
      body: { status: 'unsubscribed' }
    });
    return true;
  } catch (err) {
    if (err.status === 404) return true;
    throw err;
  }
}

/* ------------------------------------------------------------------ *
 * Product index + job state
 * ------------------------------------------------------------------ *
 * Populated by the products/update webhook rather than polled from the Shopify
 * Admin API, which avoids needing a read_products scope the app may not have.
 * The webhook already carries everything the email needs.
 */

function metaStore() {
  return getStore({ name: 'notify-meta', consistency: 'strong' });
}

const PRODUCT_INDEX_KEY = 'products/index';
const INDEX_WINDOW_DAYS = 30;

export async function recordProduct(p) {
  if (!p?.id || !p.publishedAt) return { recorded: false, reason: 'missing id or publishedAt' };

  const ageDays = (Date.now() - Date.parse(p.publishedAt)) / 86400000;
  if (!Number.isFinite(ageDays) || ageDays > INDEX_WINDOW_DAYS || ageDays < -1) {
    // Older than the window: not a new bottle. Skipping these is what stops
    // the first run announcing the entire back catalogue.
    return { recorded: false, reason: 'outside index window' };
  }

  const s = metaStore();
  const index = (await s.get(PRODUCT_INDEX_KEY, { type: 'json' })) || {};
  const id = String(p.id);
  const existing = index[id];

  index[id] = {
    ...existing,
    id,
    title: p.title,
    handle: p.handle,
    image: p.image || existing?.image || null,
    inStock: p.inStock,
    tags: p.tags || [],
    collectionIds: p.collectionIds || existing?.collectionIds || [],
    publishedAt: p.publishedAt,
    firstSeen: existing?.firstSeen || new Date().toISOString(),
    announcedAt: existing?.announcedAt || null
  };

  // Bound the blob: drop anything that has aged out of the window.
  for (const [key, val] of Object.entries(index)) {
    const age = (Date.now() - Date.parse(val.publishedAt)) / 86400000;
    if (!Number.isFinite(age) || age > INDEX_WINDOW_DAYS) delete index[key];
  }

  await s.setJSON(PRODUCT_INDEX_KEY, index);
  return { recorded: true, isNew: !existing };
}

export async function listIndexedProducts() {
  const index = (await metaStore().get(PRODUCT_INDEX_KEY, { type: 'json' })) || {};
  return Object.values(index);
}

export async function markProductsAnnounced(ids) {
  const s = metaStore();
  const index = (await s.get(PRODUCT_INDEX_KEY, { type: 'json' })) || {};
  const stamp = new Date().toISOString();
  for (const id of ids) if (index[String(id)]) index[String(id)].announcedAt = stamp;
  await s.setJSON(PRODUCT_INDEX_KEY, index);
}

/* ------------------------------------------------------------------ *
 * Product image cache
 * ------------------------------------------------------------------ *
 * Checkout webhooks carry line items with title, price and product_id but NO
 * image field, and looking each one up live would need a read_products scope
 * the app may not have. The products/update webhook already delivers images,
 * so we keep a small id -> image map and read from it when building recovery
 * emails. A miss just means that line renders without a photo.
 */
const IMAGE_CACHE_KEY = 'products/images';
const IMAGE_CACHE_MAX = 400;

export async function cacheProductImage(productId, imageUrl) {
  if (!productId || !imageUrl) return;
  const s = metaStore();
  const cache = (await s.get(IMAGE_CACHE_KEY, { type: 'json' })) || {};
  cache[String(productId)] = { url: imageUrl, at: Date.now() };

  // Bound it: drop the oldest entries rather than growing without limit.
  const keys = Object.keys(cache);
  if (keys.length > IMAGE_CACHE_MAX) {
    keys
      .sort((a, b) => (cache[a].at || 0) - (cache[b].at || 0))
      .slice(0, keys.length - IMAGE_CACHE_MAX)
      .forEach((k) => delete cache[k]);
  }
  await s.setJSON(IMAGE_CACHE_KEY, cache);
}

export async function getProductImages(productIds) {
  const cache = (await metaStore().get(IMAGE_CACHE_KEY, { type: 'json' })) || {};
  const out = {};
  for (const id of productIds) {
    const hit = cache[String(id)];
    if (hit) out[String(id)] = hit.url;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Abandoned checkouts
 * ------------------------------------------------------------------ *
 * Keyed by the checkout `token`. NOT by `id` — Shopify removed `id` from
 * checkouts/* webhooks in API 2026-04, and removed `checkout_id` from orders/*
 * at the same time. `token` on the checkout matches `checkout_token` on
 * orders/create, and that pairing is how we know to stop emailing.
 *
 * One blob per checkout rather than a single index: checkouts/update fires
 * often and unpredictably (Shopify documents no frequency at all), so
 * per-record writes avoid two updates clobbering each other.
 */
function checkoutStore() {
  return getStore({ name: 'notify-checkouts', consistency: 'strong' });
}

const CHECKOUT_PREFIX = 'checkout/';

export async function upsertCheckout(record) {
  if (!record?.token) return { ok: false, reason: 'no token' };
  const s = checkoutStore();
  const key = CHECKOUT_PREFIX + record.token;
  const existing = (await s.get(key, { type: 'json' })) || {};

  await s.setJSON(key, {
    ...existing,
    ...record,
    // Never let a later webhook undo progress already made.
    sent: existing.sent || {},
    firstSeen: existing.firstSeen || new Date().toISOString()
  });
  return { ok: true, isNew: !existing.token };
}

export async function markCheckoutRecovered(token, how) {
  if (!token) return;
  const s = checkoutStore();
  const key = CHECKOUT_PREFIX + token;
  const existing = await s.get(key, { type: 'json' });
  if (!existing) return;
  await s.setJSON(key, { ...existing, recoveredAt: new Date().toISOString(), recoveredHow: how });
}

export async function deleteCheckout(token) {
  if (!token) return;
  await checkoutStore().delete(CHECKOUT_PREFIX + token);
}

/** Find a checkout by cart_token — checkouts/delete carries no `token`. */
export async function findCheckoutByCartToken(cartToken) {
  if (!cartToken) return null;
  const s = checkoutStore();
  const { blobs } = await s.list({ prefix: CHECKOUT_PREFIX });
  for (const b of blobs) {
    const rec = await s.get(b.key, { type: 'json' });
    if (rec?.cartToken === cartToken) return rec;
  }
  return null;
}

export async function listOpenCheckouts({ maxAgeDays = 7 } = {}) {
  const s = checkoutStore();
  const { blobs } = await s.list({ prefix: CHECKOUT_PREFIX });
  const out = [];
  const expired = [];

  for (const b of blobs) {
    const rec = await s.get(b.key, { type: 'json' });
    if (!rec) continue;
    const ageDays = (Date.now() - Date.parse(rec.firstSeen || rec.createdAt)) / 86400000;
    if (!Number.isFinite(ageDays) || ageDays > maxAgeDays) { expired.push(b.key); continue; }
    out.push(rec);
  }

  // Housekeeping, so the store does not grow without bound.
  for (const key of expired) await s.delete(key);

  return out;
}

export async function recordCheckoutSend(token, step) {
  const s = checkoutStore();
  const key = CHECKOUT_PREFIX + token;
  const rec = await s.get(key, { type: 'json' });
  if (!rec) return;
  rec.sent = { ...(rec.sent || {}), [step]: new Date().toISOString() };
  await s.setJSON(key, rec);
}

export async function getJobState(key) {
  return (await metaStore().get(`state/${key}`, { type: 'json' })) || null;
}

export async function setJobState(key, value) {
  await metaStore().setJSON(`state/${key}`, value);
}

/* ------------------------------------------------------------------ *
 * Interest storage (Netlify Blobs)
 * ------------------------------------------------------------------ *
 * One blob per variant, holding the people waiting on it. Mailchimp is a poor
 * place to keep this: a contact is one row, so "waiting on five barrels" would
 * mean five tags and no clean way to clear them.
 */

function store() {
  return getStore({ name: 'notify-interest', consistency: 'strong' });
}

const keyFor = (variantId) => `variant:${variantId}`;

export async function addInterest(variantId, record) {
  const s = store();
  const key = keyFor(variantId);
  const existing = (await s.get(key, { type: 'json' })) || { variantId, people: [] };

  const email = record.email.toLowerCase();
  if (existing.people.some((p) => p.email.toLowerCase() === email)) {
    return { added: false, total: existing.people.length };
  }

  existing.people.push(record);
  existing.updatedAt = new Date().toISOString();
  await s.setJSON(key, existing);
  return { added: true, total: existing.people.length };
}

export async function takeInterest(variantId) {
  const s = store();
  const key = keyFor(variantId);
  const existing = await s.get(key, { type: 'json' });
  if (!existing?.people?.length) return [];

  // Clear before notifying so a webhook redelivery cannot double-send.
  await s.delete(key);
  return existing.people;
}

export async function peekInterest(variantId) {
  const existing = await store().get(keyFor(variantId), { type: 'json' });
  return existing?.people || [];
}

/** Drop specific addresses from a variant's list. Used to clear test records. */
export async function removeInterest(variantId, emails) {
  const s = store();
  const key = keyFor(variantId);
  const existing = await s.get(key, { type: 'json' });
  if (!existing?.people?.length) return { removed: 0, remaining: 0 };

  const drop = new Set(emails.map((e) => String(e).toLowerCase()));
  const before = existing.people.length;
  existing.people = existing.people.filter((p) => !drop.has(String(p.email).toLowerCase()));

  if (existing.people.length === 0) await s.delete(key);
  else await s.setJSON(key, existing);

  return { removed: before - existing.people.length, remaining: existing.people.length };
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export function validEmail(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v.length < 6 || v.length > 254) return false;
  const at = v.indexOf('@');
  return at > 0 && v.indexOf('.', at) > at + 1 && !/\s/.test(v);
}

/**
 * Normalise and vet a product image URL before it can reach an email.
 *
 * SECURITY: /api/notify/subscribe is a public, unauthenticated endpoint, and
 * whatever it stores gets embedded in mail sent from your own domain. Without a
 * whitelist, anyone could POST an arbitrary URL and have your sending
 * reputation serve their image — a tracking pixel, or worse. Only Shopify's CDN
 * and your own storefront are accepted.
 *
 * Also fixes the protocol: Shopify's image_url filter emits a
 * protocol-relative "//cdn.shopify.com/..." URL, which resolves fine in a
 * browser and not at all in an email client.
 *
 * Returns a clean https URL, or null.
 */
export function safeProductImage(value) {
  if (typeof value !== 'string') return null;

  let raw = value.trim();
  if (!raw) return null;
  if (raw.startsWith('//')) raw = 'https:' + raw;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase();
  const okHost = imageHostAllowlist().some((a) => host === a || host.endsWith('.' + a));
  if (!okHost) return null;

  if (url.pathname.length > 512) return null;
  return url.toString();
}

/**
 * Hosts an image may be served from.
 *
 * NOTE, because this was wrong the first time and cost a debugging cycle:
 * Shopify's image_url filter does NOT return cdn.shopify.com. It returns the
 * STORE'S OWN domain with a /cdn/shop/... path — e.g.
 * //buyspiritsdirect.myshopify.com/cdn/shop/files/656.jpg?v=...
 * Whitelisting only cdn.shopify.com silently rejected every real product
 * image, and the restock email shipped with no photo and no error.
 *
 * The list is derived from configuration rather than hardcoded so that adding
 * a branded domain later does not silently break images again. Deliberately
 * NOT a blanket *.myshopify.com: that would let anyone point the public
 * endpoint at any Shopify store's assets.
 */
function imageHostAllowlist() {
  const hosts = ['cdn.shopify.com', 'cdn.shopifycdn.net'];

  const addFromUrl = (value) => {
    if (!value) return;
    try {
      hosts.push(new URL(value.trim()).hostname.toLowerCase());
    } catch {
      const bare = value.trim().replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
      if (bare) hosts.push(bare);
    }
  };

  addFromUrl(process.env.NOTIFY_STORE_URL || 'https://buyspiritsdirect.myshopify.com');
  (process.env.NOTIFY_ALLOWED_ORIGINS ||
    'https://buyspiritsdirect.myshopify.com,https://nashvillebarrelco.myshopify.com')
    .split(',')
    .forEach(addFromUrl);
  (process.env.NOTIFY_IMAGE_HOSTS || '').split(',').forEach(addFromUrl);

  return [...new Set(hosts.filter(Boolean))];
}

/**
 * Age from an ISO yyyy-mm-dd string, or null if unparseable.
 * The gate validates client-side; this is the server-side check, because
 * anything a browser sends can be forged.
 */
export function ageFromISO(iso) {
  if (typeof iso !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;

  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() + 1 !== mo || probe.getUTCDate() !== d) {
    return null;
  }

  const now = new Date();
  let age = now.getUTCFullYear() - y;
  const beforeBirthday =
    now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;

  return age >= 0 && age <= 130 ? age : null;
}

/* ------------------------------------------------------------------ *
 * HTTP helpers
 * ------------------------------------------------------------------ */

const ALLOWED_ORIGINS = (process.env.NOTIFY_ALLOWED_ORIGINS ||
  'https://buyspiritsdirect.myshopify.com,https://nashvillebarrelco.myshopify.com')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

export function json(body, { status = 200, origin = '' } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
  });
}
