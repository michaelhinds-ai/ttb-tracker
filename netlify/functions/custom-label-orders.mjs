// Custom Label Bottle orders — feeds the "Custom label orders" queue on the Label Printing
// page. Reads recent Shopify orders, keeps line items that came through the custom-label
// product template (they carry a `_Label Template` property plus Logo / Label Proof uploads),
// and merges a small done-state kept in Netlify Blobs (tag/notes on the order would need
// write_orders, which this app does not have).
//
//   GET  /api/custom-label/orders[?days=120&all=1]   -> { ok, items:[...], doneCount }
//   POST /api/custom-label/orders  { lineId, done:true|false, note }  -> { ok }
//
// Auth: when the workspace has server auth on (AUTH_SECRET set) a valid session token is
// required — these records carry customer names and uploaded artwork.
import { getStore } from "@netlify/blobs";
import { authOn, verify, tokenFromReq } from "./lib/authtoken.mjs";

const g = (k) => (typeof Netlify !== "undefined" ? Netlify.env.get(k) : process.env[k]) || "";
function cfg() {
  const store = g("SHOPIFY_STORE").replace(/^https?:\/\//, "").replace(/\/+$/, "") || "buyspiritsdirect.myshopify.com";
  return { store, token: g("SHOPIFY_ADMIN_TOKEN"), clientId: g("SHOPIFY_CLIENT_ID"), clientSecret: g("SHOPIFY_CLIENT_SECRET"), ver: g("SHOPIFY_API_VERSION") || "2026-07" };
}
let _tok = { v: "", exp: 0 };
async function token() {
  const c = cfg();
  if (c.token) return c.token;
  if (!(c.store && c.clientId && c.clientSecret)) return "";
  if (_tok.v && Date.now() < _tok.exp) return _tok.v;
  const r = await fetch(`https://${c.store}/admin/oauth/access_token`, {
    method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: "client_credentials" }),
  });
  const b = await r.json().catch(() => null);
  if (!r.ok || !(b && b.access_token)) { const e = new Error("auth_" + r.status); e.status = r.status; throw e; }
  _tok = { v: b.access_token, exp: Date.now() + ((Number(b.expires_in) || 86399) - 120) * 1000 };
  return b.access_token;
}
function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }

const PRODUCT_HANDLE = "custom-label-bottle";
const QUERY = `query($cursor: String, $q: String!) {
  orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT, reverse: true) {
    edges { node {
      id name createdAt cancelledAt displayFulfillmentStatus displayFinancialStatus note
      customer { displayName email }
      shippingAddress { name city provinceCode }
      lineItems(first: 50) { nodes {
        id title quantity sku
        product { handle }
        variant { title }
        customAttributes { key value }
      } }
    } }
    pageInfo { hasNextPage endCursor }
  }
}`;

async function gql(tok, query, variables) {
  const c = cfg();
  const r = await fetch(`https://${c.store}/admin/api/${c.ver}/graphql.json`, {
    method: "POST", headers: { "X-Shopify-Access-Token": tok, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const b = await r.json().catch(() => null);
  if (!r.ok || !b || b.errors) { const e = new Error("query_error"); e.detail = JSON.stringify((b && b.errors) || ("http_" + r.status)).slice(0, 400); throw e; }
  return b.data;
}

function isCustomLabel(li) {
  const h = li.product && li.product.handle;
  if (h === PRODUCT_HANDLE) return true;
  return (li.customAttributes || []).some((a) => a.key === "_Label Template");
}
function attrs(li) { const o = {}; (li.customAttributes || []).forEach((a) => { o[a.key] = a.value; }); return o; }

function doneStore() { return getStore({ name: "custom-label", consistency: "strong" }); }
async function readDone() { try { return (await doneStore().get("done", { type: "json" })) || {}; } catch { return {}; } }

export default async (req) => {
  if (authOn()) { const who = verify(tokenFromReq(req)); if (!who) return json({ ok: false, error: "unauthorized" }, 401); }

  if (req.method === "POST") {
    let b = {}; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
    const lineId = String(b.lineId || "").trim(); if (!lineId) return json({ ok: false, error: "lineId required" }, 400);
    const done = await readDone();
    if (b.done === false && !b.note) delete done[lineId];
    else done[lineId] = { done: b.done !== false, at: new Date().toISOString(), note: String(b.note || "").slice(0, 300) };
    try { await doneStore().setJSON("done", done); } catch (e) { return json({ ok: false, error: "store_error", detail: String(e && e.message).slice(0, 200) }); }
    return json({ ok: true, state: done[lineId] || null });
  }

  const url = new URL(req.url);
  const days = Math.max(1, Math.min(400, parseInt(url.searchParams.get("days") || "120", 10) || 120));
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  let tok; try { tok = await token(); } catch (e) { return json({ ok: false, error: "auth_error", detail: "Shopify auth failed (" + (e.status || "") + ")" }); }
  if (!tok) return json({ ok: false, error: "not_configured", detail: "Set SHOPIFY_CLIENT_ID/SECRET." });

  const items = []; let cursor = null, pages = 0;
  try {
    do {
      const data = await gql(tok, QUERY, { cursor, q: `created_at:>=${since}` });
      const conn = (data && data.orders) || {};
      for (const e of (conn.edges || [])) {
        const o = e.node; if (!o || o.cancelledAt) continue;
        for (const li of ((o.lineItems && o.lineItems.nodes) || [])) {
          if (!isCustomLabel(li)) continue;
          const a = attrs(li);
          let placement = null; try { placement = a["_Logo Placement"] ? JSON.parse(a["_Logo Placement"]) : null; } catch { placement = null; }
          items.push({
            lineId: li.id, orderId: o.id, orderName: o.name, createdAt: o.createdAt,
            orderUrl: `https://admin.shopify.com/store/${cfg().store.replace(".myshopify.com", "")}/orders/${String(o.id).split("/").pop()}`,
            fulfillment: o.displayFulfillmentStatus, financial: o.displayFinancialStatus,
            customer: (o.customer && o.customer.displayName) || (o.shippingAddress && o.shippingAddress.name) || "",
            email: (o.customer && o.customer.email) || "", shipTo: o.shippingAddress ? [o.shippingAddress.city, o.shippingAddress.provinceCode].filter(Boolean).join(", ") : "",
            qty: li.quantity, title: li.title, variant: (li.variant && li.variant.title) || "",
            text: a["Label Text"] || "", logoUrl: a["Logo"] || "", proofUrl: a["Label Proof"] || "", comment: a["Comment"] || a["Notes"] || "",
            template: a["_Label Template"] || "", placement, orderNote: o.note || "",
          });
        }
      }
      cursor = conn.pageInfo && conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
      pages++;
    } while (cursor && pages < 8);
  } catch (e) {
    const detail = e.detail || String(e && e.message);
    if (/ACCESS_DENIED|read_orders/i.test(detail)) return json({ ok: false, error: "scope", detail: "The Mikey Systems Shopify app needs the read_orders scope. Add it in the Shopify app settings (Dev Dashboard → API access) and try again." });
    return json({ ok: false, error: "query_error", detail: detail.slice(0, 400) });
  }

  const done = await readDone();
  items.forEach((it) => { const d = done[it.lineId]; it.done = !!(d && d.done); it.doneAt = d ? d.at : ""; it.doneNote = d ? d.note : ""; });
  const open = items.filter((i) => !i.done).length;
  return json({ ok: true, since, items, open, doneCount: items.length - open });
};
export const config = { path: "/api/custom-label/orders" };
