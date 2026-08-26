import { loadTokens, dataStore, env, json } from "./lib/gbp.mjs";
export default async () => {
  const tok = await loadTokens();
  if (!tok || !(tok.access_token || tok.refresh_token)) return json({ connected: false, configured: !!env().clientId });
  let targets = null; try { targets = await dataStore().get("targets", { type: "json" }); } catch (e) {}
  const names = Array.isArray(targets) ? targets.map((t) => t.title).filter(Boolean) : [];
  return json({ connected: true, configured: true, locations: names, locationCount: names.length });
};
export const config = { path: "/api/google/status" };
