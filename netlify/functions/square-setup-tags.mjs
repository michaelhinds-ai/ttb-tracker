// One-time: create the "TTB Bottle Size (mL)" catalog attribute and tag bottle items.
// POST (no body needed). Idempotent — safe to run again; only sets values that are missing/changed.
import { env, sq, json, SqError } from "./lib/square.mjs";
import { randomUUID } from "node:crypto";

const DEF_NAME = "TTB Bottle Size (mL)";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const { token } = env();
  if (!token) return json({ configured: false, error: "not_configured" }, 200);
  try {
    const { defId, key, created } = await findOrCreateDef();
    // list all items
    const items = await allItems();
    const tagged = [], skipped = [];
    for (const o of items) {
      const name = (o.item_data && o.item_data.name) || "";
      const size = bottleSize(name);
      if (!size) continue;
      // already set correctly?
      const cav = o.custom_attribute_values || {};
      let cur = null;
      for (const k of Object.keys(cav)) { const v = cav[k]; if (v && v.custom_attribute_definition_id === defId && v.number_value != null) cur = parseInt(v.number_value, 10); }
      if (cur === size) { skipped.push({ name, size }); continue; }
      // retrieve fresh, set value, upsert whole object
      const got = await sq(`/v2/catalog/object/${o.id}`);
      const obj = got.object;
      obj.custom_attribute_values = obj.custom_attribute_values || {};
      obj.custom_attribute_values[key] = { custom_attribute_definition_id: defId, key, type: "NUMBER", number_value: String(size) };
      await sq("/v2/catalog/object", { method: "POST", body: { idempotency_key: randomUUID(), object: obj } });
      tagged.push({ name, size });
    }
    return json({ configured: true, ok: true, definitionCreated: created, definitionId: defId, tagged, skipped, totalBottles: tagged.length + skipped.length });
  } catch (e) {
    if (e instanceof SqError && e.status === 401) return json({ configured: false, error: "not_configured" }, 200);
    if (e instanceof SqError && e.status === 403) return json({ error: "insufficient_scope", detail: "The Square token needs Items (read & write). Regenerate it with those scopes." }, 403);
    console.error("square-setup error", e && e.status, e && e.detail);
    return json({ error: "square_error", status: e && e.status, detail: safe(e && e.detail) }, 502);
  }
};

async function findOrCreateDef() {
  let cursor;
  do {
    const q = "/v2/catalog/list?types=CUSTOM_ATTRIBUTE_DEFINITION" + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const r = await sq(q);
    for (const o of (r.objects || [])) {
      const d = o.custom_attribute_definition_data;
      if (o.type === "CUSTOM_ATTRIBUTE_DEFINITION" && d && d.name === DEF_NAME) return { defId: o.id, key: d.key, created: false };
    }
    cursor = r.cursor;
  } while (cursor);
  // create it
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
  const r = await sq("/v2/catalog/object", { method: "POST", body });
  const o = r.object;
  return { defId: o.id, key: o.custom_attribute_definition_data.key, created: true };
}

async function allItems() {
  const out = []; let cursor;
  do {
    const body = { object_types: ["ITEM"], limit: 200 };
    if (cursor) body.cursor = cursor;
    const r = await sq("/v2/catalog/search", { method: "POST", body });
    for (const o of (r.objects || [])) out.push(o);
    cursor = r.cursor;
  } while (cursor);
  return out;
}

// Name-based bottle classification (matches the 73A525 handoff). Returns 750/375, or null if not a bottle.
function bottleSize(name) {
  const n = (name || "").trim();
  if (!n) return null;
  if (/toy/i.test(n)) return null; // dog-toy "bottle" items
  const isBottle = /^(LR |NBC |NT )/i.test(n) ||
    /nashtucky|louisville rickhouse|nashville barrel|stella'?s stash|tenquilla/i.test(n) ||
    n.toLowerCase() === "fill your own bottle";
  if (!isBottle) return null;
  return /375/.test(n) ? 375 : 750;
}
function safe(d) { try { return typeof d === "string" ? d.slice(0, 400) : JSON.stringify(d).slice(0, 400); } catch { return ""; } }
export const config = { path: "/api/square/setup-tags" };
