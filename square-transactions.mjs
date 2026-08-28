// Individual retail transactions for ONE location on ONE day, for the location
// drill-down on the Retail Sales tab.
// POST { acct: "a1"|"a2", locationId, date: "YYYY-MM-DD" }  (or startISO/endISO)
// Money is returned in dollars.
import { accounts, sqFor, dayRange, todayInTz, json } from "./lib/square.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const accts = accounts();
  if (!accts.length) return json({ configured: false, error: "not_configured" }, 200);

  let p; try { p = await req.json(); } catch { p = {}; }
  const acct = accts.find((a) => a.key === p.acct) || accts[0];
  const locationId = (p.locationId || "").trim();
  if (!locationId) return json({ error: "missing_location" }, 400);
  const ymd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  const range = ymd(p.startDate) && ymd(p.endDate) ? { startDate: p.startDate, endDate: p.endDate } : null;
  const date = ymd(p.date) ? p.date : todayInTz(acct.tz);
  const base = (p.startISO && p.endISO) ? { startISO: p.startISO, endISO: p.endISO }
    : range ? { startISO: dayRange(range.startDate, acct.tz).startISO, endISO: dayRange(range.endDate, acct.tz).endISO }
    : dayRange(date, acct.tz);
  const win = { startISO: base.startISO, endISO: base.endISO };
  const cap = typeof p.endCapISO === "string" && p.endCapISO ? p.endCapISO : null;
  if (cap && cap > win.startISO && cap < win.endISO) win.endISO = cap;

  try {
    let locName = p.name || locationId;
    try { const lr = await sqFor(acct, `/v2/locations/${locationId}`); if (lr && lr.location) locName = lr.location.name || locName; } catch { /* keep fallback */ }

    const orders = await locationOrders(acct, locationId, win.startISO, win.endISO);
    const refunds = await locationRefunds(acct, locationId, win.startISO, win.endISO);

    const txns = orders.map((o) => {
      const tax = money(o.total_tax_money), tip = money(o.total_tip_money);
      const svc = money(o.total_service_charge_money), disc = money(o.total_discount_money);
      const total = money(o.total_money);
      const gross = total - tax - tip - svc + disc;
      const items = (o.line_items || []).map((li) => {
        const qty = parseFloat(li.quantity || "0") || 0;
        const net = money(li.gross_sales_money) - money(li.total_discount_money);
        const nm = li.name || li.variation_name || "Item";
        return { name: nm + (li.variation_name && li.variation_name !== nm ? ` — ${li.variation_name}` : ""), qty: r2(qty), net: c2(net) };
      });
      const tenders = [...new Set((o.tenders || []).map((t) => t.type).filter(Boolean))].map(prettyTender);
      return {
        id: o.id,
        ref: shortRef(o),
        timeISO: o.created_at || null,
        items,
        gross: c2(gross), discounts: c2(disc), net: c2(gross - disc),
        tax: c2(tax), tips: c2(tip), serviceCharges: c2(svc), total: c2(total),
        tenders,
      };
    });

    const refundRows = refunds.map((rf) => ({
      id: rf.id, orderId: rf.order_id || null, timeISO: rf.created_at || null,
      amount: c2(money(rf.amount_money)), reason: rf.reason || "",
    }));

    const totals = {
      orderCount: txns.length,
      net: r2(txns.reduce((s, t) => s + t.net, 0)),
      tax: r2(txns.reduce((s, t) => s + t.tax, 0)),
      tips: r2(txns.reduce((s, t) => s + t.tips, 0)),
      total: r2(txns.reduce((s, t) => s + t.total, 0)),
      refundCount: refundRows.length,
      refunded: r2(refundRows.reduce((s, r) => s + r.amount, 0)),
    };

    return json({ ok: true, account: { key: acct.key, label: acct.label || null }, location: { id: locationId, name: locName }, date: range ? range.startDate : date, startDate: range ? range.startDate : date, endDate: range ? range.endDate : date, tz: acct.tz, orders: txns, refunds: refundRows, totals });
  } catch (e) {
    const status = (e && e.status) || null;
    if (status === 401) return json({ configured: false, error: "unauthorized" }, 200);
    console.error("square-transactions error", status, e && e.detail);
    return json({ error: "square_error", status, detail: safe(e && (e.detail || e.message)) || "unknown error" }, 502);
  }
};

async function locationOrders(acct, locationId, startISO, endISO) {
  const out = []; let cursor;
  do {
    const body = {
      location_ids: [locationId],
      query: { filter: { state_filter: { states: ["COMPLETED"] }, date_time_filter: { created_at: { start_at: startISO, end_at: endISO } } }, sort: { sort_field: "CREATED_AT", sort_order: "ASC" } },
      limit: 500,
    };
    if (cursor) body.cursor = cursor;
    const r = await sqFor(acct, "/v2/orders/search", { method: "POST", body });
    for (const o of (r.orders || [])) out.push(o);
    cursor = r.cursor;
  } while (cursor);
  return out;
}

async function locationRefunds(acct, locationId, startISO, endISO) {
  const out = []; let cursor;
  do {
    const q = `/v2/refunds?begin_time=${encodeURIComponent(startISO)}&end_time=${encodeURIComponent(endISO)}&sort_order=ASC&status=COMPLETED&location_id=${encodeURIComponent(locationId)}`
      + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const r = await sqFor(acct, q);
    for (const rf of (r.refunds || [])) out.push(rf);
    cursor = r.cursor;
  } while (cursor);
  return out;
}

function shortRef(o) {
  if (o.reference_id) return o.reference_id;
  const src = o.source && o.source.name;
  return (src ? src + " · " : "") + (o.id ? o.id.slice(-6).toUpperCase() : "");
}
function prettyTender(t) {
  return ({ CARD: "Card", CASH: "Cash", SQUARE_GIFT_CARD: "Gift card", WALLET: "Wallet", BANK_ACCOUNT: "Bank", BUY_NOW_PAY_LATER: "BNPL", EXTERNAL: "External", OTHER: "Other" }[t] || t);
}
function money(m) { return (m && +m.amount) || 0; }
function c2(cents) { return Math.round(Number(cents) || 0) / 100; }
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function safe(d) { try { return typeof d === "string" ? d.slice(0, 400) : JSON.stringify(d).slice(0, 400); } catch { return ""; } }

export const config = { path: "/api/square/transactions" };
