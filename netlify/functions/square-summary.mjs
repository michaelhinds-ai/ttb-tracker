// Daily retail sales summary, broken out by LOCATION, across every configured
// Square account.
// POST { date: "YYYY-MM-DD" }  (or { startISO, endISO } for a custom window)
// Each active location gets its own figures and its own top-item list; those
// roll up to per-account totals and one grand combined total.
// Money is returned in dollars.
import { accounts, sqFor, dayRange, todayInTz, json } from "./lib/square.mjs";

const DEF_NAME = "TTB Bottle Size (mL)";
const TOP_N_LOCATION = 10;
const TOP_N_ROLLUP = 15;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const accts = accounts();
  if (!accts.length) return json({ configured: false, error: "not_configured" }, 200);

  let p; try { p = await req.json(); } catch { p = {}; }
  const ymd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  const customWindow = p.startISO && p.endISO ? { startISO: p.startISO, endISO: p.endISO } : null;
  const range = ymd(p.startDate) && ymd(p.endDate) ? { startDate: p.startDate, endDate: p.endDate } : null;
  const date = ymd(p.date) ? p.date : todayInTz(accts[0].tz);

  // Accounts run independently — one failing account must not blank the page.
  const results = await Promise.all(accts.map(async (a) => {
    const win = customWindow
      || (range ? { startISO: dayRange(range.startDate, a.tz).startISO, endISO: dayRange(range.endDate, a.tz).endISO } : dayRange(date, a.tz));
    const head = { key: a.key, label: a.label || null, tz: a.tz, startISO: win.startISO, endISO: win.endISO };
    try {
      const data = await accountSummary(a, win.startISO, win.endISO);
      return { ...head, ok: true, ...data };
    } catch (e) {
      const status = (e && e.status) || null;
      return {
        ...head, ok: false, locations: [], totals: zero(),
        error: status === 401 ? "unauthorized" : "square_error",
        detail: safe(e && (e.detail || e.message)) || "unknown error",
      };
    }
  }));

  const good = results.filter((r) => r.ok);
  const combined = rollup(good.map((r) => r.totals));
  combined.accounts = good.length;
  combined.locations = good.reduce((s, r) => s + r.locations.length, 0);
  combined.topItems = mergeItems(good.flatMap((r) => r.totals.topItems || []), TOP_N_ROLLUP);

  return json({
    configured: true,
    date: range ? range.startDate : date,
    startDate: range ? range.startDate : date,
    endDate: range ? range.endDate : date,
    custom: !!customWindow,
    accounts: results,
    combined,
    partial: results.some((r) => !r.ok),
  });
};

async function accountSummary(acct, startISO, endISO) {
  // Bottle tagging is optional per account — best effort, never fatal.
  const bottlePromise = bottleVariations(acct).catch(() => null);

  const locs = ((await sqFor(acct, "/v2/locations")).locations || []).filter((l) => l.status === "ACTIVE");
  const merchant = (locs[0] && locs[0].business_name) || null;
  const locIds = locs.map((l) => l.id);
  if (!locIds.length) {
    await bottlePromise;
    return { merchant, locations: [], totals: zero() };
  }

  const [orders, refunds, bottleVars] = await Promise.all([
    allOrders(acct, locIds, startISO, endISO),
    allRefunds(acct, startISO, endISO),
    bottlePromise,
  ]);

  // Seed a bucket for every active location so quiet ones still show up as zero
  // rather than silently vanishing from the day.
  const buckets = {};
  for (const l of locs) buckets[l.id] = bucket(l.id, l.name || l.id);
  const bucketFor = (id) => buckets[id] || (buckets[id || "?"] = bucket(id || "?", "Unassigned"));

  for (const o of orders) {
    const b = bucketFor(o.location_id);
    const tax = money(o.total_tax_money);
    const tip = money(o.total_tip_money);
    const svc = money(o.total_service_charge_money);
    const disc = money(o.total_discount_money);
    const total = money(o.total_money);
    // Gross = merchandise before discounts, tax, tips and service charges.
    const gross = total - tax - tip - svc + disc;

    b.orderCount++;
    b.grossC += gross; b.discountC += disc; b.taxC += tax;
    b.tipC += tip; b.svcC += svc; b.collectedC += total;

    for (const li of (o.line_items || [])) {
      const qty = parseFloat(li.quantity || "0") || 0;
      const net = money(li.gross_sales_money) - money(li.total_discount_money);
      b.units += qty;
      if (bottleVars && bottleVars.var2ml[li.catalog_object_id]) b.bottles += qty;
      const name = li.name || li.variation_name || "Item";
      const key = name + (li.variation_name && li.variation_name !== name ? ` — ${li.variation_name}` : "");
      const it = b.items[key] || (b.items[key] = { name: key, qty: 0, netC: 0 });
      it.qty += qty; it.netC += net;
    }
  }

  // Refunds recorded during the window, attributed to the location that issued
  // them, with the tax portion apportioned out using the original order's
  // tax-to-total ratio.
  const orderIds = [...new Set(refunds.map((r) => r.order_id).filter(Boolean))];
  const ordMap = await orderTaxMap(acct, orderIds);
  for (const rf of refunds) {
    const amt = money(rf.amount_money); if (amt <= 0) continue;
    const b = bucketFor(rf.location_id);
    const om = ordMap[rf.order_id];
    const taxPortion = om && om.total > 0 ? amt * (om.tax / om.total) : 0;
    b.refundCount++; b.refundedC += amt; b.refundedTaxC += taxPortion;
  }

  const tagged = !!bottleVars;
  const locations = Object.values(buckets)
    .map((b) => finalize(b, tagged))
    .sort((a, b) => b.netSales - a.netSales || a.name.localeCompare(b.name));

  const totals = rollup(locations);
  totals.topItems = mergeItems(locations.flatMap((l) => l.topItems), TOP_N_ROLLUP);
  totals.bottlesTagged = tagged;
  if (!tagged) totals.bottles = null;

  return { merchant, locations, totals };
}

function bucket(id, name) {
  return {
    id, name, orderCount: 0, refundCount: 0,
    grossC: 0, discountC: 0, taxC: 0, tipC: 0, svcC: 0, collectedC: 0,
    refundedC: 0, refundedTaxC: 0, units: 0, bottles: 0, items: {},
  };
}

function finalize(b, tagged) {
  const netC = b.grossC - b.discountC;
  return {
    id: b.id,
    name: b.name,
    orderCount: b.orderCount,
    refundCount: b.refundCount,
    grossSales: c2(b.grossC),
    discounts: c2(b.discountC),
    netSales: c2(netC),
    tax: c2(b.taxC),
    tips: c2(b.tipC),
    serviceCharges: c2(b.svcC),
    collected: c2(b.collectedC),
    refunded: c2(b.refundedC),
    refundedTax: c2(b.refundedTaxC),
    netSalesAfterRefunds: c2(netC - (b.refundedC - b.refundedTaxC)),
    netTax: c2(b.taxC - b.refundedTaxC),
    avgTicket: b.orderCount ? c2(netC / b.orderCount) : 0,
    tipPct: netC > 0 ? r2((b.tipC / netC) * 100) : 0,
    units: r2(b.units),
    bottles: tagged ? r2(b.bottles) : null,
    topItems: Object.values(b.items)
      .map((i) => ({ name: i.name, qty: r2(i.qty), net: c2(i.netC) }))
      .sort((a, b2) => b2.net - a.net || b2.qty - a.qty)
      .slice(0, TOP_N_LOCATION),
  };
}

const SUM_FIELDS = [
  "grossSales", "discounts", "netSales", "tax", "tips", "serviceCharges",
  "collected", "refunded", "refundedTax", "netSalesAfterRefunds", "netTax", "units",
];

function zero() {
  const t = { orderCount: 0, refundCount: 0, bottles: 0, avgTicket: 0, tipPct: 0, topItems: [] };
  for (const f of SUM_FIELDS) t[f] = 0;
  return t;
}

// Sum a set of location (or account) rows into one total.
function rollup(rows) {
  const t = zero();
  let anyBottles = false;
  for (const r of rows) {
    if (!r) continue;
    t.orderCount += r.orderCount || 0;
    t.refundCount += r.refundCount || 0;
    for (const f of SUM_FIELDS) t[f] = r2((t[f] || 0) + (r[f] || 0));
    if (r.bottles != null) { t.bottles += r.bottles; anyBottles = true; }
  }
  t.bottles = anyBottles ? r2(t.bottles) : null;
  t.units = r2(t.units);
  t.avgTicket = t.orderCount ? r2(t.netSales / t.orderCount) : 0;
  t.tipPct = t.netSales > 0 ? r2((t.tips / t.netSales) * 100) : 0;
  return t;
}

function mergeItems(items, limit) {
  const m = {};
  for (const it of items) {
    const e = m[it.name] || (m[it.name] = { name: it.name, qty: 0, net: 0 });
    e.qty += it.qty; e.net += it.net;
  }
  return Object.values(m)
    .map((e) => ({ name: e.name, qty: r2(e.qty), net: r2(e.net) }))
    .sort((a, b) => b.net - a.net || b.qty - a.qty)
    .slice(0, limit);
}

// variation id -> bottle size (mL), for the "units vs bottles" split
async function bottleVariations(acct) {
  let defId = null, cursor;
  do {
    const q = "/v2/catalog/list?types=CUSTOM_ATTRIBUTE_DEFINITION" + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const r = await sqFor(acct, q);
    for (const o of (r.objects || [])) {
      const d = o.custom_attribute_definition_data;
      if (d && d.name === DEF_NAME) { defId = o.id; break; }
    }
    cursor = r.cursor;
  } while (cursor && !defId);
  if (!defId) return null;

  const var2ml = {}; let cur;
  do {
    const body = { object_types: ["ITEM"], limit: 200 }; if (cur) body.cursor = cur;
    const r = await sqFor(acct, "/v2/catalog/search", { method: "POST", body });
    for (const o of (r.objects || [])) {
      const cav = o.custom_attribute_values || {};
      let ml = null;
      for (const k of Object.keys(cav)) {
        const v = cav[k];
        if (v && v.custom_attribute_definition_id === defId && v.number_value != null) { ml = parseInt(v.number_value, 10); break; }
      }
      if (!ml) continue;
      for (const vv of ((o.item_data && o.item_data.variations) || [])) var2ml[vv.id] = ml;
    }
    cur = r.cursor;
  } while (cur);
  return { defId, var2ml };
}

async function allOrders(acct, locIds, startISO, endISO) {
  const out = []; let cursor;
  do {
    const body = {
      location_ids: locIds,
      query: {
        filter: { state_filter: { states: ["COMPLETED"] }, date_time_filter: { created_at: { start_at: startISO, end_at: endISO } } },
        sort: { sort_field: "CREATED_AT", sort_order: "ASC" },
      },
      limit: 500,
    };
    if (cursor) body.cursor = cursor;
    const r = await sqFor(acct, "/v2/orders/search", { method: "POST", body });
    for (const o of (r.orders || [])) out.push(o);
    cursor = r.cursor;
  } while (cursor);
  return out;
}

async function allRefunds(acct, startISO, endISO) {
  const out = []; let cursor;
  do {
    const q = `/v2/refunds?begin_time=${encodeURIComponent(startISO)}&end_time=${encodeURIComponent(endISO)}&sort_order=ASC&status=COMPLETED`
      + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const r = await sqFor(acct, q);
    for (const rf of (r.refunds || [])) out.push(rf);
    cursor = r.cursor;
  } while (cursor);
  return out;
}

async function orderTaxMap(acct, orderIds) {
  const map = {};
  for (let i = 0; i < orderIds.length; i += 100) {
    const chunk = orderIds.slice(i, i + 100);
    const r = await sqFor(acct, "/v2/orders/batch-retrieve", { method: "POST", body: { order_ids: chunk } });
    for (const o of (r.orders || [])) map[o.id] = { tax: money(o.total_tax_money), total: money(o.total_money) };
  }
  return map;
}

function money(m) { return (m && +m.amount) || 0; }
function c2(cents) { return Math.round(Number(cents) || 0) / 100; }
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function safe(d) { try { return typeof d === "string" ? d.slice(0, 400) : JSON.stringify(d).slice(0, 400); } catch { return ""; } }

export const config = { path: "/api/square/summary" };
