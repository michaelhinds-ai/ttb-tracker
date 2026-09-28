// Review / fix which Square items count as BOTTLES (the "TTB Bottle Size (mL)" item tag).
// Every bottle number in the app (Retail by-employee, Live Retail Sales, KY 73A525) reads this tag.
//
// POST {}                                   -> list every item on every connected Square account:
//                                              { accounts:[{ key,label, items:[{ id,name,cats,ml }] }] }
//                                              ml: >0 = bottle size, 0 = explicitly NOT a bottle, null = untagged
// POST { acct, changes:[{ id, ml }] }       -> set the tag (ml > 0), or mark "not a bottle" (ml 0).
//
// Admin only when login enforcement is on (it edits the Square catalog).
import { accounts, sqFor, json, SqError } from "./lib/square.mjs";
import { authOn, verify, tokenFromReq } from "./lib/authtoken.mjs";
import { randomUUID } from "node:crypto";

const DEF_NAME = "TTB Bottle Size (mL)";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (authOn()) {
    const tok = verify(tokenFromReq(req));
    if (!tok) return json({ error: "auth_required" }, 401);
    if (tok.va || !(tok.role === "admin" || tok.role === "admin2")) return json({ error: "not_allowed", detail: "Only an Admin can change bottle tags." }, 403);
  }
  const accts = accounts();
  if (!accts.length) return json({ configured: false, error: "not_configured" }, 200);
  let p; try { p = await req.json(); } catch { p = {}; }

  // ---- save changes ----
  if (p && p.acct && Array.isArray(p.changes)) {
    const acct = accts.find((a) => a.key === p.acct);
    if (!acct) return json({ error: "no_such_account" }, 400);
    try {
      const { defId, key } = await findOrCreateDef(acct);
      const done = [], failed = [];
      for (const ch of p.changes.slice(0, 300)) {
        const ml = Math.max(0, parseInt(ch && ch.ml, 10) || 0);
        try {
          const got = await sqFor(acct, `/v2/catalog/object/${encodeURIComponent(ch.id)}`);
          const obj = got && got.object; if (!obj || obj.type !== "ITEM") { failed.push({ id: ch.id, error: "item not found" }); continue; }
          obj.custom_attribute_values = obj.custom_attribute_values || {};
          obj.custom_attribute_values[key] = { custom_attribute_definition_id: defId, key, type: "NUMBER", number_value: String(ml) };
          await sqFor(acct, "/v2/catalog/object", { method: "POST", body: { idempotency_key: randomUUID(), object: obj } });
          done.push({ id: ch.id, ml });
        } catch (e) { failed.push({ id: ch.id, error: safe(e && (e.detail || e.message)) }); }
      }
      return json({ ok: true, saved: done.length, failed });
    } catch (e) { return json({ ok: false, error: errCode(e), detail: errDetail(e) }, 200); }
  }

  // ---- list ----
  const out = [];
  for (const acct of accts) {
    try {
      const [cats, def, items] = await Promise.all([allCategories(acct), findDef(acct), allItems(acct)]);
      out.push({
        key: acct.key, label: acct.label || null, ok: true,
        items: items.map((o) => {
          let ml = null;
          if (def) { const cav = o.custom_attribute_values || {}; for (const k of Object.keys(cav)) { const v = cav[k]; if (v && v.custom_attribute_definition_id === def.defId && v.number_value != null) { ml = parseInt(v.number_value, 10) || 0; break; } } }
          return { id: o.id, name: (o.item_data && o.item_data.name) || o.id, cats: itemCats(o).map((id) => cats[id]).filter(Boolean), ml };
        }).sort((a, b) => a.name.localeCompare(b.name)),
      });
    } catch (e) { out.push({ key: acct.key, label: acct.label || null, ok: false, error: errCode(e), detail: errDetail(e) }); }
  }
  return json({ ok: true, accounts: out });
};

function errCode(e) { const s = (e instanceof SqError) ? e.status : null; return s === 401 ? "unauthorized" : s === 403 ? "insufficient_scope" : "square_error"; }
function errDetail(e) { const s = (e instanceof SqError) ? e.status : null; return s === 403 ? "This account's Square token needs Items (read & write)." : safe(e && (e.detail || e.message)) || "unknown error"; }
function safe(s) { return String(s || "").slice(0, 300); }
function itemCats(o) {
  const d = o.item_data || {}; const set = new Set();
  if (d.category_id) set.add(d.category_id);
  for (const c of (d.categories || [])) if (c && c.id) set.add(c.id);
  if (d.reporting_category && d.reporting_category.id) set.add(d.reporting_category.id);
  return [...set];
}
async function allCategories(acct) {
  const map = {}; let cursor;
  do { const r = await sqFor(acct, "/v2/catalog/list?types=CATEGORY" + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""));
    for (const o of (r.objects || [])) if (o.type === "CATEGORY") map[o.id] = (o.category_data && o.category_data.name) || o.id;
    cursor = r.cursor; } while (cursor);
  return map;
}
async function allItems(acct) {
  const out = []; let cursor;
  do { const body = { object_types: ["ITEM"], limit: 200 }; if (cursor) body.cursor = cursor;
    const r = await sqFor(acct, "/v2/catalog/search", { method: "POST", body });
    for (const o of (r.objects || [])) if (!o.is_deleted) out.push(o);
    cursor = r.cursor; } while (cursor);
  return out;
}
async function findDef(acct) {
  let cursor;
  do { const r = await sqFor(acct, "/v2/catalog/list?types=CUSTOM_ATTRIBUTE_DEFINITION" + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""));
    for (const o of (r.objects || [])) { const d = o.custom_attribute_definition_data; if (o.type === "CUSTOM_ATTRIBUTE_DEFINITION" && d && d.name === DEF_NAME) return { defId: o.id, key: d.key }; }
    cursor = r.cursor; } while (cursor);
  return null;
}
async function findOrCreateDef(acct) {
  const f = await findDef(acct); if (f) return f;
  const r = await sqFor(acct, "/v2/catalog/object", { method: "POST", body: { idempotency_key: randomUUID(), object: {
    type: "CUSTOM_ATTRIBUTE_DEFINITION", id: "#ttb_bottle_size",
    custom_attribute_definition_data: { type: "NUMBER", name: DEF_NAME, key: "ttb_bottle_size",
      description: "Bottle volume in mL for Kentucky Form 73A525 monthly reporting. Set 750 or 375 on each reportable distilled-spirits bottle; 0 = not a bottle.",
      allowed_object_types: ["ITEM"], seller_visibility: "SELLER_VISIBILITY_READ_WRITE_VALUES", app_visibility: "APP_VISIBILITY_READ_WRITE_VALUES", number_config: { precision: 0 } } } } });
  const o = r && (r.catalog_object || r.object); const d = o && o.custom_attribute_definition_data;
  return { defId: o && o.id, key: (d && d.key) || "ttb_bottle_size" };
}

export const config = { path: "/api/square/bottle-tags" };
