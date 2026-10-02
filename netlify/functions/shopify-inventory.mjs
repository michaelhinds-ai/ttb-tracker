// Shopify store inventory for the Mikey Systems "Shopify" dashboard card.
// GET  /api/shopify/inventory            -> { ok, locations:[{id,name}], items:[{variantId,product,variant,sku,itemId,tracked,levels:{locId:{available,on_hand}}}] }
// POST /api/shopify/inventory  { itemId, locationId, quantity, from }  -> sets AVAILABLE qty (compare-and-swap on `from`)
// Needs the Shopify app scopes read_products, read_inventory, read_locations, write_inventory.
import { shopifyGraphQL } from "./lib/shopify.mjs";
import { authOn, verify, tokenFromReq, isRetailRole } from "./lib/authtoken.mjs";

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const scopeHint = (m) => /access denied|scope|ACCESS_DENIED/i.test(m) ? " — the Shopify app needs the read_products, read_inventory, read_locations and write_inventory scopes (Shopify admin → Settings → Apps → develop apps → your app → Configuration), then reinstall/release it." : "";

const Q = `query Inv($cursor: String) { locations(first: 20) { nodes { id name isActive } }
  productVariants(first: 100, after: $cursor, query: "product_status:active") { pageInfo { hasNextPage endCursor }
    nodes { id title sku product { id title status } inventoryItem { id tracked
      inventoryLevels(first: 5) { nodes { location { id name } quantities(names: ["available", "on_hand"]) { name quantity } } } } } } }`;
const M = `mutation Set($input: InventorySetQuantitiesInput!) { inventorySetQuantities(input: $input) {
  inventoryAdjustmentGroup { changes { name delta quantityAfterChange } } userErrors { field message code } } }`;

export default async (req) => {
  if (authOn()) { const tok = verify(tokenFromReq(req)); if (!tok) return json({ ok: false, error: "auth_required" }, 401); if (isRetailRole(tok.role) || (req.method === "POST" && tok.va)) return json({ ok: false, error: "not_allowed" }, 403); }
  try {
    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const qty = Math.round(+b.quantity);
      if (!b.itemId || !b.locationId || !isFinite(qty) || qty < 0) return json({ ok: false, error: "bad_input" }, 400);
      const d = await shopifyGraphQL(M, { input: { name: "available", reason: "correction", referenceDocumentUri: "gid://mikey-systems/InventoryCount/" + Date.now(),
        quantities: [{ inventoryItemId: b.itemId, locationId: b.locationId, quantity: qty, changeFromQuantity: (b.from === null || b.from === undefined || b.from === "") ? null : Math.round(+b.from) }] } });
      const r = d.inventorySetQuantities; const errs = (r && r.userErrors) || [];
      if (errs.length) return json({ ok: false, error: errs.map((e) => e.message).join("; "), code: errs[0].code });
      return json({ ok: true, quantity: qty });
    }
    let cursor = null, locations = [], items = [];
    for (let page = 0; page < 15; page++) {
      const d = await shopifyGraphQL(Q, { cursor });
      if (!locations.length) locations = (d.locations.nodes || []).filter((l) => l.isActive !== false).map((l) => ({ id: l.id, name: l.name }));
      for (const v of d.productVariants.nodes) {
        if (!v.product || v.product.status !== "ACTIVE") continue;
        const levels = {};
        for (const lv of (v.inventoryItem?.inventoryLevels?.nodes || [])) { const q = {}; for (const x of lv.quantities) q[x.name] = x.quantity; levels[lv.location.id] = q; }
        items.push({ variantId: v.id, product: v.product.title, variant: v.title === "Default Title" ? "" : v.title, sku: v.sku || "", itemId: v.inventoryItem?.id || null, tracked: !!v.inventoryItem?.tracked, levels });
      }
      if (!d.productVariants.pageInfo.hasNextPage) break;
      cursor = d.productVariants.pageInfo.endCursor;
    }
    items.sort((a, b) => (a.product + a.variant).localeCompare(b.product + b.variant, "en", { sensitivity: "base", numeric: true }));
    return json({ ok: true, locations, items });
  } catch (e) {
    const m = String((e && e.message) || e);
    return json({ ok: false, error: m.slice(0, 400) + scopeHint(m) });
  }
};
export const config = { path: "/api/shopify/inventory" };
