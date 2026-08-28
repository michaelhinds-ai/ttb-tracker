// KY Form 73A525 monthly report, computed from Square sales.
// POST { year, month, rate?, fobPct?, wholesalePct?, caseMl? }
import { env, sq, monthRange, json, SqError } from "./lib/square.mjs";

const DEF_NAME = "TTB Bottle Size (mL)";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const { token, locationId, tz } = env();
  if (!token) return json({ configured: false, error: "not_configured" }, 200);
  let p; try { p = await req.json(); } catch { p = {}; }
  const year = +p.year, month = +p.month;
  if (!(year > 2000) || !(month >= 1 && month <= 12)) return json({ error: "bad_month" }, 400);
  const rate = num(p.rate, 4.57), fobPct = num(p.fobPct, 0.40), wholesalePct = num(p.wholesalePct, 0.11), caseMl = num(p.caseMl, 9000);

  try {
    // 1) find the TTB size custom-attribute definition id
    const defId = await findDefId();
    if (!defId) return json({ error: "no_attribute", detail: "The TTB Bottle Size attribute is not set up yet. Use 'Set up bottle tags' first." }, 409);

    // 2) build variation -> {itemId, size} and item label, from tagged items
    const { var2item, itemSize, itemName } = await bottleMap(defId);
    if (!Object.keys(itemSize).length) return json({ error: "no_bottles", detail: "No items are tagged with a bottle size yet. Use 'Set up bottle tags' first." }, 409);

    // 3) pull the month's COMPLETED orders
    const { startISO, endISO } = monthRange(year, month, tz);
    const orders = await allOrders(locationId, startISO, endISO);

    // 4) aggregate bottle line items by catalog item
    const agg = {}; // itemId -> {sold,samp,retail}
    let excludedNames = {};
    for (const o of orders) {
      for (const li of (o.line_items || [])) {
        const itemId = var2item[li.catalog_object_id];
        if (!itemId) { excludedNames[li.name || "?"] = (excludedNames[li.name || "?"] || 0) + 1; continue; }
        const qty = parseInt(li.quantity || "0", 10) || 0;
        const base = money(li.base_price_money) / 100; // Square amounts are in cents
        const net = money(li.gross_sales_money) - money(li.total_discount_money);
        const a = agg[itemId] || (agg[itemId] = { sold: 0, samp: 0, retail: 0 });
        a.retail = Math.max(a.retail, base);
        if (net > 0) a.sold += qty; else if (net === 0) a.samp += qty; else a.sold += qty;
      }
    }

    // 5) products + totals
    const products = Object.keys(agg).map((id) => {
      const a = agg[id], ml = itemSize[id];
      return {
        name: itemName[id] || id, ml, retail: r2(a.retail), sold: a.sold, samp: a.samp,
        total: a.sold + a.samp,
        fobPerBottle: r2(a.retail * fobPct),
        wholesaleBase: r2((a.sold + a.samp) * a.retail * fobPct),
        sold9L: (a.sold * ml) / caseMl, samp9L: (a.samp * ml) / caseMl,
      };
    }).filter((x) => x.total > 0).sort((a, b) => b.wholesaleBase - a.wholesaleBase);

    const soldCases = products.reduce((s, x) => s + x.sold9L, 0);
    const sampCases = products.reduce((s, x) => s + x.samp9L, 0);
    const line1 = r2(soldCases), line2 = r2(sampCases);
    const line4 = r2(line1 + line2), line6 = line4;
    const line8 = r2(line6 * rate), line11 = line8;
    const line12 = r2(products.reduce((s, x) => s + (x.sold + x.samp) * x.retail * fobPct, 0));
    const line13 = r2(line12 * wholesalePct), line15 = line13;
    const line16 = r2(line11 + line15);

    return json({
      configured: true, year, month, tz, startISO, endISO, orderCount: orders.length,
      inputs: { rate, fobPct, wholesalePct, caseMl },
      bottlesSold: products.reduce((s, x) => s + x.sold, 0),
      bottlesSampled: products.reduce((s, x) => s + x.samp, 0),
      products,
      form: { line1, line2, line3: 0, line4, line5: 0, line6, line7rate: rate, line8, line9: line8, line10: 0, line11, line12, line13, line14: 0, line15, line16 },
      excludedCount: Object.keys(excludedNames).length,
    });
  } catch (e) {
    if (e instanceof SqError && e.status === 401) return json({ configured: false, error: "not_configured" }, 200);
    console.error("square-report error", e && e.status, e && e.detail);
    return json({ error: "square_error", status: (e && e.status) || null, detail: safe(e && (e.detail || e.message)) || "unknown error" }, 502);
  }
};

async function findDefId() {
  let cursor;
  do {
    const q = "/v2/catalog/list?types=CUSTOM_ATTRIBUTE_DEFINITION" + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const r = await sq(q);
    for (const o of (r.objects || [])) {
      if (o.type === "CUSTOM_ATTRIBUTE_DEFINITION" && o.custom_attribute_definition_data && o.custom_attribute_definition_data.name === DEF_NAME) return o.id;
    }
    cursor = r.cursor;
  } while (cursor);
  return null;
}

async function bottleMap(defId) {
  const var2item = {}, itemSize = {}, itemName = {};
  let cursor;
  do {
    const body = { object_types: ["ITEM"], limit: 200 };
    if (cursor) body.cursor = cursor;
    const r = await sq("/v2/catalog/search", { method: "POST", body });
    for (const o of (r.objects || [])) {
      const cav = o.custom_attribute_values || {};
      let size = null;
      for (const k of Object.keys(cav)) {
        const v = cav[k];
        if (v && v.custom_attribute_definition_id === defId && v.number_value != null) { size = parseInt(v.number_value, 10); break; }
      }
      if (!size) continue;
      itemSize[o.id] = size;
      itemName[o.id] = (o.item_data && o.item_data.name) || o.id;
      for (const vv of ((o.item_data && o.item_data.variations) || [])) var2item[vv.id] = o.id;
    }
    cursor = r.cursor;
  } while (cursor);
  return { var2item, itemSize, itemName };
}

async function allOrders(locationId, startISO, endISO) {
  const out = []; let cursor;
  do {
    const body = {
      location_ids: [locationId],
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
function num(v, d) { const n = Number(v); return isFinite(n) && n > 0 ? n : d; }
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function safe(d) { try { return typeof d === "string" ? d.slice(0, 400) : JSON.stringify(d).slice(0, 400); } catch { return ""; } }
export const config = { path: "/api/square/report" };
