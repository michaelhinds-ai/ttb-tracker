// Daily retail sales summary across ALL configured Square accounts.
// POST { date: "YYYY-MM-DD" }  (or { startISO, endISO } for a custom window)
// Returns per-account figures plus a combined total. Money is returned in dollars.
import { accounts, sqFor, dayRange, todayInTz, json } from "./lib/square.mjs";

const DEF_NAME = "TTB Bottle Size (mL)";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const accts = accounts();
  if (!accts.length) return json({ configured: false, error: "not_configured" }, 200);

  let p; try { p = await req.json(); } catch { p = {}; }
  const customWindow = p.startISO && p.endISO ? { startISO: p.startISO, endISO: p.endISO } : null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(p.date || "") ? p.date : todayInTz(accts[0].tz);

  // Each account runs independently — one failing account must not blank the page.
  const results = await Promise.all(accts.map(async (a) => {
    const win = customWindow || dayRange(date, a.tz);
    try {
      const data = await accountSummary(a, win.startISO, win.endISO);
      return { key: a.key, label: a.label, tz: a.tz, ok: true, startISO: win.startISO, endISO: win.endISO, ...data };
    } catch (e) {
      const status = (e && e.status) || null;
      return {
        key: a.key, label: a.label, tz: a.tz, ok: false,
        startISO: win.startISO, endISO: win.endISO,
        error: status === 401 ? "unauthorized" : "square_error",
        detail: safe(e && (e.detail || e.message)) || "unknown error",
      };
    }
  }));

  const good = results.filter((r) => r.ok);
  const sum = (f) => r2(good.reduce((s, r) => s + (f(r) || 0), 0));
  const combined = {
    accounts: good.length,
    orderCount: good.reduce((s, r) => s + r.orderCount, 0),
    refundCount: good.reduce((s, r) => s + r.refundCount, 0),
    grossSales: sum((r) => r.grossSales),
    discounts: sum((r) => r.discounts),
    netSales: sum((r) => r.netSales),
    tax: sum((r) => r.tax),
    tips: sum((r) => r.tips),
    serviceCharges: sum((r) => r.serviceCharges),
    collected: sum((r) => r.collected),
    refunded: sum((r) => r.refunded),
    refundedTax: sum((r) => r.refundedTax),
    netSalesAfterRefunds: sum((r) => r.netSalesAfterRefunds),
    netTax: sum((r) => r.netTax),
    units: good.reduce((s, r) => s + r.units, 0),
    bottles: good.reduce((s, r) => s + (r.bottles || 0), 0),
    avgOrder: 0,
    topItems: mergeTopItems(good),
  };
  combined.avgOrder = combined.orderCount ? r2(combined.netSales / combined.orderCount) : 0;

  return json({
    configured: true,
    date,
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
  const locName = {}; locs.forEach((l) => { locName[l.id] = l.name || l.id; });
  const locIds = locs.map((l) => l.id);
  if (!locIds.length) return emptyAccount(locs);

  const [orders, refunds, bottleVars] = await Promise.all([
    allOrders(acct, locIds, startISO, endISO),
    allRefunds(acct, startISO, endISO),
    bottlePromise,
  ]);

  let grossC = 0, discountC = 0, taxC = 0, tipC = 0, svcC = 0, collectedC = 0;
  let units = 0, bottles = 0;
  const byLoc = {}, items = {};

  for (const o of orders) {
    const tax = money(o.total_tax_money);
    const tip = money(o.total_tip_money);
    const svc = money(o.total_service_charge_money);
    const disc = money(o.total_discount_money);
    const total = money(o.total_money);
    // Gross = merchandise before discounts, tax, tips and service charges.
    const gross = total - tax - tip - svc + disc;

    grossC += gross; discountC += disc; taxC += tax; tipC += tip; svcC += svc; collectedC += total;

    const L = o.location_id || "?";
    const b = byLoc[L] || (byLoc[L] = { name: locName[L] || L, orders: 0, net: 0, tax: 0, units: 0 });
    b.orders++; b.net += gross - disc; b.tax += tax;

    for (const li of (o.line_items || [])) {
      const qty = parseFloat(li.quantity || "0") || 0;
      const net = money(li.gross_sales_money) - money(li.total_discount_money);
      units += qty; b.units += qty;
      if (bottleVars && bottleVars.var2ml[li.catalog_object_id]) bottles += qty;
      const name = li.name || (li.variation_name ? li.variation_name : "Item");
      const key = name + (li.variation_name && li.variation_name !== name ? ` — ${li.variation_name}` : "");
      const it = items[key] || (items[key] = { name: key, qty: 0, net: 0 });
      it.qty += qty; it.net += net;
    }
  }

  // Refunds recorded during the window, with the tax portion apportioned out of
  // each refund using its original order's tax-to-total ratio.
  let refundedC = 0, refundedTaxC = 0, refundCount = 0;
  const orderIds = [...new Set(refunds.map((r) => r.order_id).filter(Boolean))];
  const ordMap = await orderTaxMap(acct, orderIds);
  for (const rf of refunds) {
    const amt = money(rf.amount_money); if (amt <= 0) continue;
    refundCount++;
    const om = ordMap[rf.order_id];
    const taxPortion = om && om.total > 0 ? amt * (om.tax / om.total) : 0;
    refundedC += amt; refundedTaxC += taxPortion;
  }

  const netC = grossC - discountC;
  const topItems = Object.values(items)
    .map((i) => ({ name: i.name, qty: r2(i.qty), net: c2(i.net) }))
    .sort((a, b) => b.net - a.net || b.qty - a.qty)
    .slice(0, 15);

  return {
    merchant: (locs[0] && locs[0].business_name) || null,
    locations: locs.length,
    orderCount: orders.length,
    refundCount,
    grossSales: c2(grossC),
    discounts: c2(discountC),
    netSales: c2(netC),
    tax: c2(taxC),
    tips: c2(tipC),
    serviceCharges: c2(svcC),
    collected: c2(collectedC),
    refunded: c2(refundedC),
    refundedTax: c2(refundedTaxC),
    netSalesAfterRefunds: c2(netC - (refundedC - refundedTaxC)),
    netTax: c2(taxC - refundedTaxC),
    avgOrder: orders.length ? c2(netC / orders.length) : 0,
    units: r2(units),
    bottles: bottleVars ? r2(bottles) : null,
    bottlesTagged: !!bottleVars,
    byLocation: Object.values(byLoc)
      .map((b) => ({ name: b.name, orders: b.orders, net: c2(b.net), tax: c2(b.tax), units: r2(b.units) }))
      .sort((a, b) => b.net - a.net),
    topItems,
  };
}

function emptyAccount(locs) {
  return {
    merchant: null, locations: (locs || []).length, orderCount: 0, refundCount: 0,
    grossSales: 0, discounts: 0, netSales: 0, tax: 0, tips: 0, serviceCharges: 0,
    collected: 0, refunded: 0, refundedTax: 0, netSalesAfterRefunds: 0, netTax: 0,
    avgOrder: 0, units: 0, bottles: null, bottlesTagged: false, byLocation: [], topItems: [],
  };
}

function mergeTopItems(rows) {
  const m = {};
  for (const r of rows) for (const it of (r.topItems || [])) {
    const e = m[it.name] || (m[it.name] = { name: it.name, qty: 0, net: 0 });
    e.qty += it.qty; e.net += it.net;
  }
  return Object.values(m)
    .map((e) => ({ name: e.name, qty: r2(e.qty), net: r2(e.net) }))
    .sort((a, b) => b.net - a.net || b.qty - a.qty)
    .slice(0, 15);
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
