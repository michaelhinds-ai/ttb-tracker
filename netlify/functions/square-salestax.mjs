// Monthly retail sales tax collected via Square (for the KY Sales & Use Tax return).
// POST { year, month }
import { env, sq, monthRange, json, SqError } from "./lib/square.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const { token, tz } = env();
  if (!token) return json({ configured: false, error: "not_configured" }, 200);
  let p; try { p = await req.json(); } catch { p = {}; }
  const year = +p.year, month = +p.month;
  if (!(year > 2000) || !(month >= 1 && month <= 12)) return json({ error: "bad_month" }, 400);

  try {
    // all active locations (so no collected tax is missed)
    const loc = await sq("/v2/locations");
    const locs = (loc.locations || []).filter((l) => l.status === "ACTIVE");
    const locName = {}; locs.forEach((l) => { locName[l.id] = l.name || l.id; });
    const locIds = locs.map((l) => l.id);
    if (!locIds.length) return json({ configured: true, error: "no_locations" }, 200);

    const { startISO, endISO } = monthRange(year, month, tz);
    const orders = await allOrders(locIds, startISO, endISO);

    let taxTotal = 0, grossTotal = 0, orderCount = 0;
    const byLoc = {}, byTax = {};
    for (const o of orders) {
      const tax = money(o.total_tax_money);
      const total = money(o.total_money);
      const tips = money(o.total_tip_money);
      const gross = total - tax - tips; // sales before tax and tips
      taxTotal += tax; grossTotal += gross; orderCount++;
      const L = o.location_id || "?";
      const b = byLoc[L] || (byLoc[L] = { name: locName[L] || L, tax: 0, gross: 0, orders: 0 });
      b.tax += tax; b.gross += gross; b.orders++;
      for (const t of (o.taxes || [])) {
        const key = (t.name || "Tax") + (t.percentage ? ` (${t.percentage}%)` : "");
        byTax[key] = (byTax[key] || 0) + money(t.applied_money);
      }
    }
    const c2 = (cents) => Math.round(cents) / 100;
    return json({
      configured: true, year, month, tz, startISO, endISO, orderCount,
      grossSales: c2(grossTotal), taxCollected: c2(taxTotal),
      byLocation: Object.values(byLoc).map((b) => ({ name: b.name, orders: b.orders, gross: c2(b.gross), tax: c2(b.tax) })).sort((a, b) => b.tax - a.tax),
      byTax: Object.keys(byTax).map((k) => ({ name: k, tax: c2(byTax[k]) })).sort((a, b) => b.tax - a.tax),
    });
  } catch (e) {
    if (e instanceof SqError && e.status === 401) return json({ configured: false, error: "not_configured" }, 200);
    console.error("square-salestax error", e && e.status, e && e.detail);
    return json({ error: "square_error", status: (e && e.status) || null, detail: safe(e && (e.detail || e.message)) || "unknown error" }, 502);
  }
};

async function allOrders(locIds, startISO, endISO) {
  const out = []; let cursor;
  do {
    const body = {
      location_ids: locIds,
      query: { filter: { state_filter: { states: ["COMPLETED"] }, date_time_filter: { created_at: { start_at: startISO, end_at: endISO } } }, sort: { sort_field: "CREATED_AT", sort_order: "ASC" } },
      limit: 500,
    };
    if (cursor) body.cursor = cursor;
    const r = await sq("/v2/orders/search", { method: "POST", body });
    for (const o of (r.orders || [])) out.push(o);
    cursor = r.cursor;
  } while (cursor);
  return out;
}
function money(m) { return (m && +m.amount) || 0; }
function safe(d) { try { return typeof d === "string" ? d.slice(0, 400) : JSON.stringify(d).slice(0, 400); } catch { return ""; } }
export const config = { path: "/api/square/salestax" };
