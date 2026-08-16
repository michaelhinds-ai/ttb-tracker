// Create the "TTB Bottle Size (mL)" catalog attribute and tag bottle items — for
// EVERY connected Square account (each account has its own catalog).
// POST { acct?: "a1"|"a2" }  — omit to tag all accounts. Idempotent; only sets values that are missing/changed.
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

  const preview = !!(p && p.preview);
  const results = [];
  for (const acct of targets) {
    try {
      const r = await tagAccount(acct, preview);
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
  return json({ configured: true, preview, accounts: results });
};

async function tagAccount(acct, preview) {
  // In preview we DON'T create the definition or write anything — just classify.
  let defId = null, key = null, created = false;
  if (!preview) { const d = await findOrCreateDef(acct); defId = d.defId; key = d.key; created = d.created; }
  else { const d = await findDef(acct); if (d) { defId = d.defId; key = d.key; } }

  const items = await allItems(acct);
  const tagged = [], skipped = [], failed = [], would = [], unmatched = [];
  for (const o of items) {
    const name = (o.item_data && o.item_data.name) || "";
    const size = bottleSize(name);
    if (!size) { if (unmatched.length < 80) unmatched.push(name); continue; }
    // already set correctly? (only knowable if the definition exists)
    let cur = null;
    if (defId) { const cav = o.custom_attribute_values || {}; for (const k of Object.keys(cav)) { const v = cav[k]; if (v && v.custom_attribute_definition_id === defId && v.number_value != null) cur = parseInt(v.number_value, 10); } }
    if (cur === size) { skipped.push({ name, size }); continue; }
    if (preview) { would.push({ name, size }); continue; }
    try {
      const got = await sqFor(acct, `/v2/catalog/object/${o.id}`);
      const obj = got.object;
      obj.custom_attribute_values = obj.custom_attribute_values || {};
      obj.custom_attribute_values[key] = { custom_attribute_definition_id: defId, key, type: "NUMBER", number_value: String(size) };
      await sqFor(acct, "/v2/catalog/object", { method: "POST", body: { idempotency_key: randomUUID(), object: obj } });
      tagged.push({ name, size });
    } catch (ie) {
      failed.push({ name, size, error: safe(ie && (ie.detail || ie.message)) });
    }
  }
  return preview
    ? { willTag: would.length, alreadyTagged: skipped.length, would, unmatched, itemCount: items.length }
    : { definitionCreated: created, tagged, skipped, failed, totalBottles: tagged.length + skipped.length + failed.length };
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
  const o = r.object;
  return { defId: o.id, key: o.custom_attribute_definition_data.key, created: true };
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

// Name-based bottle classification. Returns 750/375, or null if not a bottle.
// Covers both Louisville Rickhouse and Nashville Barrel Co product naming.
function bottleSize(name) {
  const n = (name || "").trim();
  if (!n) return null;
  if (/toy/i.test(n)) return null; // dog-toy "bottle" items
  const isBottle =
    /^(LR |NBC |NT )/i.test(n) ||
    /nashtucky|louisville rickhouse|nashville barrel|stella'?s stash|tenquilla|single barrel|small batch|barrel proof|cask strength|bourbon|\brye\b|whiskey|whisky/i.test(n) ||
    n.toLowerCase() === "fill your own bottle";
  if (!isBottle) return null;
  if (/\b(flight|pour|glass|tasting|sample|cocktail|shot|merch|shirt|hat|glassware|gift ?card)\b/i.test(n)) return null;
  return /375/.test(n) ? 375 : 750;
}
function safe(d) { try { return typeof d === "string" ? d.slice(0, 400) : JSON.stringify(d).slice(0, 400); } catch { return ""; } }
export const config = { path: "/api/square/setup-tags" };
