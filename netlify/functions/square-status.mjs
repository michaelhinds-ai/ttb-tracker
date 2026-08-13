// Square connection status for the app.
import { env, sq, json, SqError } from "./lib/square.mjs";

const DEF_NAME = "TTB Bottle Size (mL)";

export default async () => {
  const { token, environment, locationId } = env();
  if (!token) return json({ configured: false });
  try {
    const loc = await sq(`/v2/locations/${encodeURIComponent(locationId)}`);
    const location = loc && loc.location;
    // is the size attribute set up + how many tagged?
    let attribute = false, tagged = 0, defId = null;
    try {
      let cursor;
      do {
        const q = "/v2/catalog/list?types=CUSTOM_ATTRIBUTE_DEFINITION" + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
        const r = await sq(q);
        for (const o of (r.objects || [])) { const d = o.custom_attribute_definition_data; if (d && d.name === DEF_NAME) { attribute = true; defId = o.id; } }
        cursor = r.cursor;
      } while (cursor && !attribute);
      if (defId) {
        let cur;
        do {
          const body = { object_types: ["ITEM"], limit: 200 }; if (cur) body.cursor = cur;
          const rr = await sq("/v2/catalog/search", { method: "POST", body });
          for (const o of (rr.objects || [])) { const cav = o.custom_attribute_values || {}; for (const k of Object.keys(cav)) { const v = cav[k]; if (v && v.custom_attribute_definition_id === defId && v.number_value != null) tagged++; } }
          cur = rr.cursor;
        } while (cur);
      }
    } catch { /* attribute check best-effort */ }
    return json({
      configured: true, connected: true, environment,
      merchant: location && location.business_name || null,
      locationName: location && location.name || null,
      locationId, attribute, taggedBottles: tagged,
    });
  } catch (e) {
    if (e instanceof SqError && e.status === 401) return json({ configured: false });
    return json({ configured: true, connected: false, environment, error: (e && e.status) || "error" });
  }
};
export const config = { path: "/api/square/status" };
