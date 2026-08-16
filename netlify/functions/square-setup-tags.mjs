// Tag bottle items with "TTB Bottle Size (mL)" — driven by Square CATEGORIES, not
// item names (name-guessing mis-tags whiskey-themed merch like jerky/cigars/stones).
//
// POST {}                                  -> PREVIEW: list each account's categories (with counts + samples).
// POST { commit:true, selections:{a1:[catId...], a2:[catId...]} } -> tag items in those categories.
// POST { acct:"a1"|"a2", ... }             -> limit to one account.
//
// Runs across EVERY connected Square account (each has its own catalog). Idempotent.
import { accounts, sqFor, json, SqError } from "./lib/square.mjs";
import { randomUUID } from "node:crypto";

const DEF_NAME = "TTB Bottle Size (mL)";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const accts = accounts();
  if (!accts.length) return json({ configured: false, error: "not_configured" }, 200);
  let p; try { p = await req.json(); } catch { p = {}; }
  const targets = p && p.acct ? accts.filter((a) => a.key === p.acct) : accts;
  if (!targets.length) return json({ error: "no_such_account" }, 400);

  const commit = !!(p && p.commit);
  const selections = (p && p.selections) || {};
  const results = [];
  for (const acct of targets) {
    try {
      const r = commit ? await commitAccount(acct, selections[acct.key] || []) : await previewAccount(acct);
      results.push({ key: acct.key, label: acct.label || null, ok: true, ...r });
    } catch (e) {
      const status = (e instanceof SqError) ? e.status : null;
      results.push({
        key: acct.key, label: acct.label || null, ok: false,
        error: status === 401 ? "unauthorized" : status === 403 ? "insufficient_scope" : "square_error",
        detail: status === 403
          ? "This account's Square token needs Items (read & write). Regenerate it with those scopes."
          : safe(e && (e.detail || e.message)) || "unknown error",
      });
    }
  }
  return json({ configured: true, [commit ? "committed" : "preview"]: true, accounts: results });
};

// ----- preview: enumerate categories with item counts + sample names -----
async function previewAccount(acct) {
  const catNames = await allCategories(acct);
  const items = await allItems(acct);
  const byCat = {}; let uncategorized = 0;
  const ensure = (id) => byCat[id] || (byCat[id] = { id, name: catNames[id] || "(unnamed category)", count: 0, samples: [] });
  for (const o of items) {
    const name = (o.item_data && o.item_data.name) || "";
    const ids = itemCats(o);
    if (!ids.length) { uncategorized++; continue; }
    for (const id of ids) { const c = ensure(id); c.count++; if (c.samples.length < 8) c.samples.push(name); }
  }
  const def = await findDef(acct);
  return {
    itemCount: items.length,
    uncategorized,
    definitionExists: !!def,
    categories: Object.values(byCat).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

// ----- commit: tag every item whose category is selected -----
async function commitAccount(acct, catIds) {
  const set = new Set(catIds || []);
  if (!set.size) return { definitionCreated: false, tagged: [], skipped: [], failed: [], totalBottles: 0, note: "no categories selected" };
  const { defId, key, created } = await findOrCreateDef(acct);
  const items = await allItems(acct);
  const tagged = [], skipped = [], failed = [];
  for (const o of items) {
    if (!itemCats(o).some((id) => set.has(id))) continue;
    const name = (o.item_data && o.item_data.name) || "";
    const size = /375/.test(name) ? 375 : 750;
    let cur = null;
    const cav = o.custom_attribute_values || {};
    for (const k of Object.keys(cav)) { const v = cav[k]; if (v && v.custom_attribute_definition_id === defId && v.number_value != null) cur = parseInt(v.number_value, 10); }
    if (cur === size) { skipped.push({ name, size }); continue; }
    try {
      const got = await sqFor(acct, `/v2/catalog/object/${o.id}`);
      const obj = got && got.object;
      if (!obj) { failed.push({ name, size, error: "catalog object not returned" }); continue; }
      obj.custom_attribute_values = obj.custom_attribute_values || {};
      obj.custom_attribute_values[key] = { custom_attribute_definition_id: defId, key, type: "NUMBER", number_value: String(size) };
      await sqFor(acct, "/v2/catalog/object", { method: "POST", body: { idempotency_key: randomUUID(), object: obj } });
      tagged.push({ name, size });
    } catch (ie) {
      failed.push({ name, size, error: safe(ie && (ie.detail || ie.message)) });
    }
  }
  return { definitionCreated: created, tagged, skipped, failed, totalBottles: tagged.length + skipped.length + failed.length };
}

// An item can carry a category via the legacy single field, the newer array, or a reporting category.
function itemCats(o) {
  const d = o.item_data || {}; const set = new Set();
  if (d.category_id) set.add(d.category_id);
  for (const c of (d.categories || [])) if (c && c.id) set.add(c.id);
  if (d.reporting_category && d.reporting_category.id) set.add(d.reporting_category.id);
  return [...set];
}

async function allCategories(acct) {
  const map = {}; let cursor;
  do {
    const q = "/v2/catalog/list?types=CATEGORY" + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const r = await sqFor(acct, q);
    for (const o of (r.objects || [])) { if (o.type === "CATEGORY") map[o.id] = (o.category_data && o.category_data.name) || o.id; }
    cursor = r.cursor;
  } while (cursor);
  return map;
}

async function allItems(acct) {
  const out = []; let cursor;
  do {
    const body = { object_types: ["ITEM"], limit: 200 };
    if (cursor) body.cursor = cursor;
    const r = await sqFor(acct, "/v2/catalog/search", { method: "POST", body });
    for (const o of (r.objects || [])) out.push(o);
    cursor = r.cursor;
  } while (cursor);
  return out;
}

async function findDef(acct) {
  let cursor;
  do {
    const q = "/v2/catalog/list?types=CUSTOM_ATTRIBUTE_DEFINITION" + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const r = await sqFor(acct, q);
    for (const o of (r.objects || [])) {
      const d = o.custom_attribute_definition_data;
      if (o.type === "CUSTOM_ATTRIBUTE_DEFINITION" && d && d.name === DEF_NAME) return { defId: o.id, key: d.key };
    }
    cursor = r.cursor;
  } while (cursor);
  return null;
}
async function findOrCreateDef(acct) {
  const existing = await findDef(acct);
  if (existing) return { ...existing, created: false };
  const body = {
    idempotency_key: randomUUID(),
    object: {
      type: "CUSTOM_ATTRIBUTE_DEFINITION", id: "#ttb_bottle_size",
      custom_attribute_definition_data: {
        type: "NUMBER", name: DEF_NAME, key: "ttb_bottle_size",
        description: "Bottle volume in mL for Kentucky Form 73A525 monthly reporting. Set 750 or 375 on each reportable distilled-spirits bottle; leave blank on non-bottles.",
        allowed_object_types: ["ITEM"],
        seller_visibility: "SELLER_VISIBILITY_READ_WRITE_VALUES",
        app_visibility: "APP_VISIBILITY_READ_WRITE_VALUES",
        number_config: { precision: 0 },
      },
    },
  };
  const r = await sqFor(acct, "/v2/catalog/object", { method: "POST", body });
  const o = r && r.object;
  if (!o) throw new SqError("square_error", 502, "Could not create the size attribute (no object returned).");
  return { defId: o.id, key: o.custom_attribute_definition_data.key, created: true };
}

function safe(d) { try { return typeof d === "string" ? d.slice(0, 400) : JSON.stringify(d).slice(0, 400); } catch { return ""; } }
export const config = { path: "/api/square/setup-tags" };
