// Today's (or any range's) Shopify sales, for the Mikey OS home screen.
// Auth reuses the client-credentials grant (Client ID + Secret) — same as the email
// sync — so no static token is needed. POST or GET; body/query: startDate, endDate
// (YYYY-MM-DD, default = today). Returns net (subtotal) + gross + order count.
const g = (k) => (typeof Netlify !== "undefined" ? Netlify.env.get(k) : process.env[k]) || "";
function cfg() {
  const store = g("SHOPIFY_STORE").replace(/^https?:\/\//, "").replace(/\/+$/, "");
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
function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } }); }

export default async (req) => {
  const c = cfg();
  if (!c.store) return json({ ok: false, error: "not_configured", detail: "Set SHOPIFY_STORE." });
  let body = {}; try { body = await req.json(); } catch { /* GET */ }
  const url = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const startDate = body.startDate || url.searchParams.get("startDate") || today;
  const endDate = body.endDate || url.searchParams.get("endDate") || startDate;
  // Optional exact upper bound (ISO datetime) so "today so far" compares fairly to
  // "same day last year, up to the same time."
  const endCapISO = body.endCapISO || url.searchParams.get("endCapISO") || "";

  let tok; try { tok = await token(); } catch (e) { return json({ ok: false, error: "auth_error", detail: "Shopify auth failed (" + (e.status || "") + ")" }); }
  if (!tok) return json({ ok: false, error: "not_configured", detail: "Set SHOPIFY_CLIENT_ID/SECRET or SHOPIFY_ADMIN_TOKEN." });

  const upper = endCapISO || endDate;
  const q = `created_at:>=${startDate} created_at:<=${upper}`;
  const query = `query($cursor: String) {
    orders(first: 250, after: $cursor, query: ${JSON.stringify(q)}) {
      edges { node { subtotalPriceSet { shopMoney { amount } } currentTotalPriceSet { shopMoney { amount currencyCode } } } }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  let net = 0, gross = 0, orders = 0, currency = "USD", cursor = null, pages = 0;
  try {
    do {
      const r = await fetch(`https://${c.store}/admin/api/${c.ver}/graphql.json`, {
        method: "POST", headers: { "X-Shopify-Access-Token": tok, "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ query, variables: { cursor } }),
      });
      const b = await r.json().catch(() => null);
      if (!r.ok || (b && b.errors)) return json({ ok: false, error: "query_error", detail: JSON.stringify((b && b.errors) || ("http_" + r.status)).slice(0, 300) });
      const conn = (b && b.data && b.data.orders) || {};
      for (const e of (conn.edges || [])) {
        const n = e.node || {}; orders++;
        net += +(n.subtotalPriceSet && n.subtotalPriceSet.shopMoney && n.subtotalPriceSet.shopMoney.amount || 0);
        const gm = n.currentTotalPriceSet && n.currentTotalPriceSet.shopMoney;
        if (gm) { gross += +(gm.amount || 0); currency = gm.currencyCode || currency; }
      }
      cursor = (conn.pageInfo && conn.pageInfo.hasNextPage) ? conn.pageInfo.endCursor : null; pages++;
    } while (cursor && pages < 40);
  } catch (e) { return json({ ok: false, error: "network", detail: String((e && e.message) || e) }); }

  return json({ ok: true, startDate, endDate, orders, net: Math.round(net * 100) / 100, gross: Math.round(gross * 100) / 100, currency });
};

export const config = { path: "/api/shopify/summary" };
