// Xola sales-tax pull for the Kentucky Sales & Use return (Louisville Rickhouse, KY).
// Sums the "Kentucky Sales Tax" collected on Xola experience/merch sales for a month,
// net of refunds, so it can be added to the Square figure on the KY tab.
//
// Confirmed from live data: each PURCHASE transaction has items[] with a numeric `taxFee`
// (and a fees[] entry named "Kentucky Sales Tax"); amounts are in DOLLARS.
//
// POST { year, month }   -> monthly tax total (net of refunds)
// POST { probe:true } or GET ?probe=1  -> a couple transactions' MONEY fields only (no PII)
//
// Env (Netlify): XOLA_API_KEY (required), XOLA_SELLER_ID (default = the LRWC seller),
//                XOLA_API_BASE (default https://xola.com).
import { env as sqEnv, monthRange, json } from "./lib/square.mjs";

const BASE = () => (Netlify.env.get("XOLA_API_BASE") || "https://xola.com").replace(/\/+$/, "");
const SELLER = () => Netlify.env.get("XOLA_SELLER_ID") || "69c2f539f783c835670bcee4";

export default async (req) => {
  const url = new URL(req.url);
  const key = Netlify.env.get("XOLA_API_KEY") || "";
  if (!key) return json({ configured: false, error: "not_configured", detail: "Set XOLA_API_KEY in Netlify." }, 200);
  const tz = sqEnv().tz; // same month boundaries as the Square KY report so the combined total lines up

  let p;
  if (req.method === "GET") p = { probe: url.searchParams.get("probe") != null };
  else if (req.method === "POST") { try { p = await req.json(); } catch { p = {}; } }
  else return json({ error: "method_not_allowed" }, 405);

  try {
    if (p.probe) {
      const txns = await fetchTransactions(key, { type: "purchase", limit: 5 });
      return json({ configured: true, probe: true, seller: SELLER(), count: txns.length, sample: txns.slice(0, 5).map(moneyOnly) });
    }

    const year = +p.year, month = +p.month;
    if (!(year > 2000) || !(month >= 1 && month <= 12)) return json({ error: "bad_month" }, 400);
    const { startISO, endISO } = monthRange(year, month, tz);
    // "collected" (default): count tax by when the booking was PAID (createdAt), net refunds.
    // "realized": count tax by when the EXPERIENCE happened (items.realizedAt); cancellations never count.
    const basis = p.basis === "realized" ? "realized" : "collected";
    const dateField = basis === "realized" ? "items_realizedAt" : "createdAt";

    const purchases = await fetchTransactions(key, { type: "purchase", startISO, endISO, dateField });
    const refunds = await fetchTransactions(key, { type: "refund", startISO, endISO, dateField });

    let taxCollected = 0, grossSales = 0;
    for (const t of purchases) { taxCollected += txnTax(t); grossSales += txnGross(t); }
    let taxRefunded = 0;
    for (const t of refunds) taxRefunded += Math.abs(txnTax(t));

    return json({
      configured: true, year, month, tz, startISO, endISO, seller: SELLER(), basis,
      purchaseCount: purchases.length, refundCount: refunds.length,
      taxCollected: round2(taxCollected),
      taxRefunded: round2(taxRefunded),
      taxNet: round2(taxCollected - taxRefunded),
      grossSales: round2(grossSales),
    });
  } catch (e) {
    return json({ error: "xola_error", status: (e && e.status) || null, detail: safe(e && (e.detail || e.message)) || "unknown error" }, 502);
  }
};

// Tax on one transaction = sum of item.taxFee (fallback to fees[] entries named like a tax).
function txnTax(t) {
  let s = 0;
  for (const it of (t.items || [])) {
    if (isNum(it.taxFee)) { s += it.taxFee; continue; }
    for (const f of (it.fees || [])) if (f && /tax/i.test(f.name || "") && isNum(f.amount)) s += f.amount;
  }
  return s;
}
function txnGross(t) { let s = 0; for (const it of (t.items || [])) if (isNum(it.gross)) s += it.gross; return s; }

async function fetchTransactions(key, { type, startISO, endISO, limit = 100, dateField = "createdAt" } = {}) {
  const out = []; let cursor = null;
  for (let page = 0; page < 300; page++) {
    const qs = new URLSearchParams();
    qs.set("seller", SELLER());
    if (type) qs.set("type", type);
    if (startISO) qs.set(`${dateField}[gte]`, startISO);
    if (endISO) qs.set(`${dateField}[lte]`, endISO);
    qs.set("limit", String(limit));
    if (cursor) qs.set("cursor", cursor);
    const r = await fetch(`${BASE()}/api/transactions?${qs.toString()}`, { headers: { "X-API-KEY": key, "Accept": "application/json" } });
    const text = await r.text();
    let body = null; try { body = text ? JSON.parse(text) : null; } catch { /* keep */ }
    if (!r.ok) { const err = new Error("xola_http_" + r.status); err.status = r.status; err.detail = (body && (body.message || body.error)) || text; throw err; }
    const batch = Array.isArray(body) ? body : (body && body.data) || [];
    for (const t of batch) out.push(t);
    const next = body && body.paging && body.paging.next;
    cursor = next ? extractCursor(next) : null;
    if (!cursor || batch.length === 0) break;
    if (limit === 5) break; // probe
  }
  return out;
}

function extractCursor(next) { const m = /[?&]cursor=([^&]+)/.exec(next || ""); return m ? decodeURIComponent(m[1]) : null; }

// Strip everything but money fields for the probe (no customer PII).
function moneyOnly(t) {
  return {
    id: t.id, type: t.type, createdAt: t.createdAt, amount: t.amount, currency: t.currency,
    items: (t.items || []).map((it) => ({ gross: it.gross, net: it.net, taxFee: it.taxFee, fees: it.fees, commission: it.commission })),
  };
}

function isNum(v) { return typeof v === "number" && isFinite(v); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function safe(d) { try { return typeof d === "string" ? d.slice(0, 400) : JSON.stringify(d).slice(0, 400); } catch { return ""; } }
export const config = { path: "/api/xola/salestax" };
