// Shared logic for syncing customer emails into a Mailchimp audience from both
// Square (all configured accounts) and Shopify. Only contacts WITH an email that
// are NOT unsubscribed are included. Upserts are idempotent (keyed by email), so
// re-running never creates duplicates and never resubscribes anyone.
//
// ENV (Netlify):
//   MAILCHIMP_API_KEY     e.g. "abc123...-us21"  (the "-usXX" suffix is the data center)
//   MAILCHIMP_LIST_ID     the audience id to add contacts to
//   MAILCHIMP_STATUS      status for NEW contacts (default "subscribed"; "transactional" to avoid marketing)
//   SHOPIFY_STORE         your-store.myshopify.com   (optional — omit to skip Shopify)
//   SHOPIFY_ADMIN_TOKEN   Admin API access token with read_customers (+ protected customer data access)
//   SHOPIFY_API_VERSION   default 2025-01
//   (Square uses the same SQUARE_ACCESS_TOKEN / _2 the rest of the app already uses.)
import { accounts as squareAccounts, sqFor } from "./square.mjs";
import { createHash } from "node:crypto";

const g = (k) => (typeof Netlify !== "undefined" ? Netlify.env.get(k) : process.env[k]) || "";

export function mcConfig() {
  const key = g("MAILCHIMP_API_KEY");
  const list = g("MAILCHIMP_LIST_ID");
  const dc = (key.split("-").pop() || "").trim();
  const status = g("MAILCHIMP_STATUS") || "subscribed";
  return { key, list, dc, status, ok: !!(key && list && dc) };
}
export function shopifyConfig() {
  const store = g("SHOPIFY_STORE").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const token = g("SHOPIFY_ADMIN_TOKEN");
  const ver = g("SHOPIFY_API_VERSION") || "2025-01";
  return { store, token, ver, ok: !!(store && token) };
}

async function mcFetch(path, { method = "GET", body } = {}) {
  const { key, dc } = mcConfig();
  const auth = "Basic " + Buffer.from("apikey:" + key).toString("base64");
  const r = await fetch(`https://${dc}.api.mailchimp.com/3.0${path}`, {
    method, headers: { Authorization: auth, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text(); let b = null; try { b = text ? JSON.parse(text) : null; } catch { /* keep */ }
  if (!r.ok) { const e = new Error("mailchimp_" + r.status); e.status = r.status; e.detail = (b && (b.detail || b.title)) || text; throw e; }
  return b;
}
function md5(s) { return createHash("md5").update(String(s).trim().toLowerCase()).digest("hex"); }

// Upsert a set of contacts via Mailchimp batch operations (async server-side).
// Chunked so a very large seed doesn't build one enormous request.
export async function mcUpsert(members) {
  const { list, status } = mcConfig();
  if (!members.length) return { submitted: 0, batches: [] };
  const batches = [];
  for (let i = 0; i < members.length; i += 500) {
    const chunk = members.slice(i, i + 500);
    const operations = chunk.map((m) => ({
      method: "PUT",
      path: `/lists/${list}/members/${md5(m.email)}`,
      body: JSON.stringify({ email_address: m.email, status_if_new: status, merge_fields: { FNAME: m.fname || "", LNAME: m.lname || "" } }),
    }));
    const r = await mcFetch("/batches", { method: "POST", body: { operations } });
    batches.push(r && r.id);
  }
  return { submitted: members.length, batches };
}

// Square customers across every configured account.
export async function squareCustomers({ sinceISO } = {}) {
  const out = []; const accts = squareAccounts();
  for (const a of accts) {
    let cursor = null, pages = 0;
    do {
      const body = { limit: 100 };
      if (cursor) body.cursor = cursor;
      if (sinceISO) body.query = { filter: { updated_at: { start_at: sinceISO } } };
      const r = await sqFor(a, "/v2/customers/search", { method: "POST", body });
      for (const c of (r.customers || [])) {
        const email = (c.email_address || "").trim();
        if (!email) continue;
        if (c.preferences && c.preferences.email_unsubscribed) continue;
        out.push({ email, fname: c.given_name || "", lname: c.family_name || "", source: "square:" + (a.label || a.key) });
      }
      cursor = r.cursor; pages++;
    } while (cursor && pages < 200);
  }
  return out;
}

// Shopify customers (REST Admin API), paginated via the Link header.
export async function shopifyCustomers({ sinceISO } = {}) {
  const cfg = shopifyConfig(); if (!cfg.ok) return [];
  const out = [];
  let url = `https://${cfg.store}/admin/api/${cfg.ver}/customers.json?limit=250&fields=id,email,first_name,last_name,email_marketing_consent,updated_at`
    + (sinceISO ? `&updated_at_min=${encodeURIComponent(sinceISO)}` : "");
  let pages = 0;
  while (url && pages < 200) {
    const r = await fetch(url, { headers: { "X-Shopify-Access-Token": cfg.token, "Accept": "application/json" } });
    const text = await r.text(); let b = null; try { b = text ? JSON.parse(text) : null; } catch { /* keep */ }
    if (!r.ok) { const e = new Error("shopify_" + r.status); e.status = r.status; e.detail = safe(b && b.errors) || text; throw e; }
    for (const c of ((b && b.customers) || [])) {
      const email = (c.email || "").trim(); if (!email) continue;
      const st = c.email_marketing_consent && c.email_marketing_consent.state;
      if (st === "unsubscribed" || st === "redacted") continue;
      out.push({ email, fname: c.first_name || "", lname: c.last_name || "", source: "shopify" });
    }
    const link = r.headers.get("link") || r.headers.get("Link") || "";
    const m = /<([^>]+)>;\s*rel="next"/.exec(link); url = m ? m[1] : null;
    pages++;
  }
  return out;
}

export function dedupe(list) {
  const seen = new Set(); const out = [];
  for (const c of list) { const k = c.email.toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push(c); }
  return out;
}

// Full run: gather from all sources, dedupe, and (unless dry) upsert into Mailchimp.
export async function runSync({ full = false, dry = false, sinceDays = 8 } = {}) {
  const sinceISO = full ? null : new Date(Date.now() - sinceDays * 86400000).toISOString();
  let square = [], sqErr = null, shop = [], shopErr = null;
  try { square = await squareCustomers({ sinceISO }); } catch (e) { sqErr = safe(e && (e.detail || e.message)); }
  try { shop = await shopifyCustomers({ sinceISO }); } catch (e) { shopErr = safe(e && (e.detail || e.message)); }
  const merged = dedupe([...square, ...shop]);
  const base = { full, dry, sinceISO, squareCount: square.length, shopifyCount: shop.length, unique: merged.length,
    squareError: sqErr || undefined, shopifyError: shopErr || undefined };
  if (dry) return base;
  const up = await mcUpsert(merged);
  return { ...base, submitted: up.submitted, batches: up.batches };
}

function safe(d) { try { return typeof d === "string" ? d.slice(0, 400) : JSON.stringify(d).slice(0, 400); } catch { return ""; } }
