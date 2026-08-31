// Sales breakdown for the Reports hub — one Square Orders pull per account for a
// date range, aggregated four ways: by item, by category, by day-of-week, and by
// hour. Net = merchandise after discounts, before tax and tips (matches the
// other sales reports).
// POST { startDate, endDate }  ->  { ok, startDate, endDate, items:[], categories:[], byDow:[7], byHour:[24], totals, errors:[] }
import { accounts, sqFor, dayRange, env as sqEnv, json } from "./lib/square.mjs";

const isNum = (v) => typeof v === "number" && isFinite(v);
const m = (o) => (o && isNum(o.amount) ? o.amount : 0);

// Catalog maps for one account: item_variation_id -> {itemName, categoryName}.
async function catalogMap(acct) {
  const catName = {};          // category id -> name
  const varToItem = {};        // variation id -> { itemName, categoryId }
  let cursor = null;
  for (let page = 0; page < 30; page++) {
    const qs = new URLSearchParams({ types: "ITEM,CATEGORY", limit: "200" });
    if (cursor) qs.set("cursor", cursor);
    let r;
    try { r = await sqFor(acct, "/v2/catalog/list?" + qs.toString()); } catch (e) { break; }
    for (const o of (r && r.objects) || []) {
      if (o.type === "CATEGORY") catName[o.id] = (o.category_data && o.category_data.name) || o.id;
      else if (o.type === "ITEM") {
        const d = o.item_data || {};
        const itemName = d.name || "";
        const categoryId = d.category_id || (d.categories && d.categories[0] && d.categories[0].id) || "";
        for (const v of d.variations || []) varToItem[v.id] = { itemName, categoryId };
      }
    }
    cursor = r && r.cursor;
    if (!cursor) break;
  }
  const varInfo = (variationId) => {
    const vi = varToItem[variationId];
    if (!vi) return { itemName: "", categoryName: "Uncategorized" };
    return { itemName: vi.itemName, categoryName: catName[vi.categoryId] || "Uncategorized" };
  };
  return varInfo;
}

function tzParts(iso, tz) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", hour12: false }).formatToParts(new Date(iso));
    const wd = (parts.find((p) => p.type === "weekday") || {}).value || "";
    let hr = +(parts.find((p) => p.type === "hour") || {}).value; if (hr === 24) hr = 0;
    const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { dow: dowMap[wd] != null ? dowMap[wd] : 0, hour: isFinite(hr) ? hr : 0 };
  } catch { return { dow: 0, hour: 0 }; }
}

async function accountBreakdown(acct, startYmd, endYmd) {
  const tz = acct.tz || sqEnv().tz;
  const startISO = dayRange(startYmd, tz).startISO;
  const endISO = dayRange(endYmd || startYmd, tz).endISO;
  // Locations for this account.
  let locIds = [];
  try { const lr = await sqFor(acct, "/v2/locations"); locIds = ((lr && lr.locations) || []).map((l) => l.id); } catch {}
  const varInfo = await catalogMap(acct);

  const items = {}, cats = {};
  const byDow = Array.from({ length: 7 }, () => ({ net: 0, count: 0 }));
  const byHour = Array.from({ length: 24 }, () => ({ net: 0, count: 0 }));
  let totalNet = 0, orderCount = 0;

  let cursor = null;
  for (let page = 0; page < 40; page++) {
    const body = {
      location_ids: locIds.length ? locIds : undefined,
      query: { filter: { date_time_filter: { closed_at: { start_at: startISO, end_at: endISO } }, state_filter: { states: ["COMPLETED"] } }, sort: { sort_field: "CLOSED_AT", sort_order: "DESC" } },
      limit: 300,
    };
    if (cursor) body.cursor = cursor;
    let r;
    try { r = await sqFor(acct, "/v2/orders/search", { method: "POST", body }); } catch (e) { throw e; }
    const orders = (r && r.orders) || [];
    for (const o of orders) {
      orderCount++;
      const when = o.closed_at || o.created_at;
      const { dow, hour } = tzParts(when, tz);
      let orderNet = 0;
      for (const li of o.line_items || []) {
        const net = m(li.gross_sales_money) - m(li.total_discount_money); // merchandise after discount, pre-tax
        const qty = Math.round(+((li.quantity) || 0)) || (+(li.quantity) || 0);
        orderNet += net;
        const info = varInfo(li.catalog_object_id);
        const nm = li.name || info.itemName || "Item";
        const ikey = nm + (li.variation_name && li.variation_name !== "Regular" ? " — " + li.variation_name : "");
        const it = items[ikey] || (items[ikey] = { name: ikey, category: info.categoryName, qty: 0, net: 0 });
        it.qty += qty; it.net += net;
        const ck = info.categoryName || "Uncategorized";
        const c = cats[ck] || (cats[ck] = { name: ck, qty: 0, net: 0 });
        c.qty += qty; c.net += net;
      }
      totalNet += orderNet;
      byDow[dow].net += orderNet; byDow[dow].count++;
      byHour[hour].net += orderNet; byHour[hour].count++;
    }
    cursor = r && r.cursor;
    if (!cursor || !orders.length) break;
  }
  return {
    items: Object.values(items), categories: Object.values(cats),
    byDow, byHour, totalNet, orderCount,
  };
}

export default async (req) => {
  const accts = accounts();
  if (!accts.length) return json({ ok: false, error: "not_configured" }, 200);
  let p = {}; if (req.method === "POST") { try { p = await req.json(); } catch {} }
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  if (!ok(p.startDate)) return json({ ok: false, error: "bad_dates" }, 200);
  const startDate = p.startDate, endDate = ok(p.endDate) ? p.endDate : p.startDate;

  const results = await Promise.all(accts.map((a) => accountBreakdown(a, startDate, endDate).then((d) => ({ d })).catch((e) => ({ error: String((e && e.message) || e) }))));
  const errors = results.filter((r) => r.error).map((r) => r.error);

  // Merge across accounts.
  const itemMap = {}, catMap = {};
  const byDow = Array.from({ length: 7 }, () => ({ net: 0, count: 0 }));
  const byHour = Array.from({ length: 24 }, () => ({ net: 0, count: 0 }));
  let totalNet = 0, orderCount = 0;
  for (const { d } of results) {
    if (!d) continue;
    for (const it of d.items) { const k = it.name + "||" + it.category; const e = itemMap[k] || (itemMap[k] = { name: it.name, category: it.category, qty: 0, net: 0 }); e.qty += it.qty; e.net += it.net; }
    for (const c of d.categories) { const e = catMap[c.name] || (catMap[c.name] = { name: c.name, qty: 0, net: 0 }); e.qty += c.qty; e.net += c.net; }
    for (let i = 0; i < 7; i++) { byDow[i].net += d.byDow[i].net; byDow[i].count += d.byDow[i].count; }
    for (let i = 0; i < 24; i++) { byHour[i].net += d.byHour[i].net; byHour[i].count += d.byHour[i].count; }
    totalNet += d.totalNet; orderCount += d.orderCount;
  }
  const items = Object.values(itemMap).map((x) => ({ ...x, netCents: x.net })).sort((a, b) => b.qty - a.qty);
  const categories = Object.values(catMap).map((x) => ({ ...x, netCents: x.net })).sort((a, b) => b.net - a.net);
  return json({ ok: true, startDate, endDate, items, categories, byDow, byHour, totals: { netCents: totalNet, orderCount }, errors });
};
export const config = { path: "/api/sales/breakdown" };
