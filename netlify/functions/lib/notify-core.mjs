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
    err.body = json;
    throw err;
  }
  return json;
}

/**
 * Upsert a contact.
 *
 * Consent model, and the reason it matters:
 *   - A back-in-stock alert is a notification the person explicitly asked for,
 *     so it does not require marketing consent. Those contacts go in as
 *     "transactional" — reachable by the alert, absent from marketing sends.
 *   - Ticking the marketing box is a separate act, and only that sets
 *     "subscribed".
 *
 * status_if_new is used everywhere so an existing unsubscribe is never
 * overwritten. Mailchimp will not resurrect someone who opted out.
 */
export async function upsertContact({ email, marketingOptIn, mergeFields = {}, tags = [] }) {
  const hash = subscriberHash(email);

  await mc(`/lists/${MC_LIST}/members/${hash}`, {
    method: 'PUT',
    body: {
      email_address: email,
      status_if_new: marketingOptIn ? 'subscribed' : 'transactional',
      merge_fields: mergeFields
    }
  });

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
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  }

  if (tags.length) {
    await mc(`/lists/${MC_LIST}/members/${hash}/tags`, {
      method: 'POST',
      body: { tags: tags.map((name) => ({ name, status: 'active' })) }
    });
  }

  return hash;
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
