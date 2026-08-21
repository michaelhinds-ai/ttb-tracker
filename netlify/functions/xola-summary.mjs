// Xola experience revenue for the Retail Sales tab, recognized on the day the
// experience was REDEEMED (items.realizedAt) — not the day it was booked.
// So a tour paid last week but run today shows as today's revenue.
//
// POST { startDate, endDate, endCapISO? }   (YYYY-MM-DD day or range)
// GET  ?probe=1                              (a couple realized items, money only)
//
// Env: XOLA_API_KEY (required), XOLA_SELLER_ID (default LRWC), XOLA_API_BASE.
import { env as sqEnv, dayRange, todayInTz, json } from "./lib/square.mjs";

const BASE = () => (Netlify.env.get("XOLA_API_BASE") || "https://xola.com").replace(/\/+$/, "");
const SELLER = () => Netlify.env.get("XOLA_SELLER_ID") || "69c2f539f783c835670bcee4";

export default async (req) => {
  const url = new URL(req.url);
  const key = Netlify.env.get("XOLA_API_KEY") || "";
  if (!key) return json({ configured: false, error: "not_configured" }, 200);
  const tz = sqEnv().tz;
  let p;
  if (req.method === "GET") p = { probe: url.searchParams.get("probe") != null };
  else if (req.method === "POST") { try { p = await req.json(); } catch { p = {}; } }
  else return json({ error: "method_not_allowed" }, 405);

  try {
    const ymd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
    const from = ymd(p.startDate) ? p.startDate : (ymd(p.date) ? p.date : todayInTz(tz));
    const to = ymd(p.endDate) ? p.endDate : from;
    let startISO = dayRange(from, tz).startISO, endISO = dayRange(to, tz).endISO;
    if (typeof p.endCapISO === "string" && p.endCapISO && p.endCapISO > startISO && p.endCapISO < endISO) endISO = p.endCapISO;

    // Purchases with an item REALIZED in the window (context=report expands purchase items for quantity/guests).
    const txns = await fetchTransactions(key, { type: "purchase", dateField: "items_realizedAt", startISO, endISO, report: true, limit: p.probe ? 5 : 100 });

    let orderCount = 0, guests = 0, net = 0, tax = 0, collected = 0;
    const exp = {}; const sample = [];
    for (const t of txns) {
      const pMap = {}; for (const pi of ((t.purchase && t.purchase.items) || [])) pMap[pi.id] = pi;
      let counted = false;
      for (const it of (t.items || [])) {
        const rz = it.realizedAt; if (!rz || !(rz >= startISO && rz < endISO)) continue;
        const g = num(it.gross), tf = num(it.taxFee); const pretax = g - tf;
        const q = num((pMap[it.orderItem && it.orderItem.id] || {}).quantity) || 0;
        net += pretax; tax += tf; collected += g; guests += q; counted = true;
        const nm = (pMap[it.orderItem && it.orderItem.id] || {}).name || it.name || "Experience";
        const e = exp[nm] || (exp[nm] = { name: nm, guests: 0, net: 0 });
        e.guests += q; e.net += pretax;
        if (p.probe && sample.length < 6) sample.push({ name: nm, realizedAt: rz, gross: g, taxFee: tf, pretax: r2(pretax), quantity: q });
      }
      if (counted) orderCount++;
    }
    if (p.probe) return json({ configured: true, probe: true, seller: SELLER(), realizedItems: sample.length, sample });

    const experiences = Object.values(exp).map((e) => ({ name: e.name, guests: r2(e.guests), net: r2(e.net) }))
      .sort((a, b) => b.net - a.net).slice(0, 10);
    return json({
      configured: true, startDate: from, endDate: to, tz, startISO, endISO,
      orderCount, guests: r2(guests), netSales: r2(net), tax: r2(tax), collected: r2(collected), grossSales: r2(net),
      avgTicket: orderCount ? r2(net / orderCount) : 0, experiences,
    });
  } catch (e) {
    return json({ error: "xola_error", status: (e && e.status) || null, detail: safe(e && (e.detail || e.message)) || "unknown error" }, 502);
  }
};

async function fetchTransactions(key, { type, startISO, endISO, dateField = "createdAt", report, limit = 100 } = {}) {
  const out = []; let cursor = null;
  for (let page = 0; page < 300; page++) {
    const qs = new URLSearchParams();
    qs.set("seller", SELLER());
    if (type) qs.set("type", type);
    if (startISO) qs.set(`${dateField}[gte]`, startISO);
    if (endISO) qs.set(`${dateField}[lte]`, endISO);
    if (report) qs.set("context", "report");
    qs.set("limit", String(limit));
    if (cursor) qs.set("cursor", cursor);
    const r = await fetch(`${BASE()}/api/transactions?${qs.toString()}`, { headers: { "X-API-KEY": key, "Accept": "application/json" } });
    const text = await r.text();
    let body = null; try { body = text ? JSON.parse(text) : null; } catch { /* keep */ }
    if (!r.ok) { const err = new Error("xola_http_" + r.status); err.status = r.status; err.detail = (body && (body.message || body.error)) || text; throw err; }
    const batch = Array.isArray(body) ? body : (body && body.data) || [];
    for (const t of batch) out.push(t);
    const next = body && body.paging && body.paging.next;
    cursor = next ? (/[?&]cursor=([^&]+)/.exec(next) || [])[1] : null;
    if (cursor) cursor = decodeURIComponent(cursor);
    if (!cursor || batch.length === 0 || limit === 5) break;
  }
  return out;
}

function num(v) { const n = +v; return isFinite(n) ? n : 0; }
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function safe(d) { try { return typeof d === "string" ? d.slice(0, 400) : JSON.stringify(d).slice(0, 400); } catch { return ""; } }
export const config = { path: "/api/xola/summary" };
