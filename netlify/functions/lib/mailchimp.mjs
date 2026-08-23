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
//   Shopify auth — use EITHER of these:
//     (A) SHOPIFY_ADMIN_TOKEN   a static Admin API token (older custom apps), OR
//     (B) SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET   from a Dev Dashboard app in the
//         SAME org as the store. The sync exchanges these for a 24h token on each run
//         (client-credentials grant) — no static token / OAuth redirect needed.
//     The app needs read_customers + protected customer data access (approved at install).
//   SHOPIFY_API_VERSION   default 2026-07
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
  const clientId = g("SHOPIFY_CLIENT_ID");
  const clientSecret = g("SHOPIFY_CLIENT_SECRET");
  const ver = g("SHOPIFY_API_VERSION") || "2026-07";
  return { store, token, clientId, clientSecret, ver, ok: !!(store && (token || (clientId && clientSecret))) };
}

// Resolve a usable Shopify Admin API token. A static SHOPIFY_ADMIN_TOKEN wins if set;
// otherwise use the client-credentials grant (Client ID + Secret, app + store same org).
// The granted token is valid ~24h; we cache it in-process and refresh before expiry.
let _shopTok = { v: "", exp: 0 };
async function shopifyToken() {
  const cfg = shopifyConfig();
  if (cfg.token) return cfg.token;
  if (!(cfg.store && cfg.clientId && cfg.clientSecret)) return "";
  const now = Date.now();
  if (_shopTok.v && now < _shopTok.exp) return _shopTok.v;
  const r = await fetch(`https://${cfg.store}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "client_credentials" }),
  });
  const text = await r.text(); let b = null; try { b = text ? JSON.parse(text) : null; } catch { /* keep */ }
  if (!r.ok || !(b && b.access_token)) {
    const e = new Error("shopify_auth_" + r.status); e.status = r.status;
    e.detail = safe((b && (b.error_description || b.error)) || text); throw e;
  }
  _shopTok = { v: b.access_token, exp: now + Math.max(0, ((Number(b.expires_in) || 86399) - 120) * 1000) };
  return b.access_token;
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

// Shopify customers via the GraphQL Admin API, cursor-paginated. (REST customer
// endpoints are being retired; GraphQL is the durable path.) Everyone WITH an email
// is included except those who unsubscribed or whose data was redacted.
export async function shopifyCustomers({ sinceISO } = {}) {
  const cfg = shopifyConfig(); if (!cfg.ok) return [];
  const token = await shopifyToken(); if (!token) return [];
  const endpoint = `https://${cfg.store}/admin/api/${cfg.ver}/graphql.json`;
  const search = sinceISO ? `updated_at:>='${sinceISO}'` : "";
  const query = `query($cursor: String) {
    customers(first: 250, after: $cursor${search ? `, query: ${JSON.stringify(search)}` : ""}) {
      edges { node { email firstName lastName emailMarketingConsent { marketingState } } }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  const out = []; let cursor = null, pages = 0;
  do {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ query, variables: { cursor } }),
    });
    const text = await r.text(); let b = null; try { b = text ? JSON.parse(text) : null; } catch { /* keep */ }
    if (!r.ok) { const e = new Error("shopify_" + r.status); e.status = r.status; e.detail = safe(text); throw e; }
    if (b && b.errors) { const e = new Error("shopify_gql"); e.status = 400; e.detail = safe(b.errors); throw e; }
    const conn = (b && b.data && b.data.customers) || {};
    for (const edge of (conn.edges || [])) {
      const c = (edge && edge.node) || {};
      const email = (c.email || "").trim(); if (!email) continue;
      const st = c.emailMarketingConsent && c.emailMarketingConsent.marketingState;
      if (st === "UNSUBSCRIBED" || st === "REDACTED") continue;
      out.push({ email, fname: c.firstName || "", lname: c.lastName || "", source: "shopify" });
    }
    cursor = (conn.pageInfo && conn.pageInfo.hasNextPage) ? conn.pageInfo.endCursor : null;
    pages++;
  } while (cursor && pages < 200);
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
