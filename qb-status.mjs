import { env, loadTokens, qbQuery } from "./lib/qb.mjs";

export default async (req) => {
  const { clientId, environment } = env();
  const configured = !!clientId;
  if (!configured) return json({ configured: false, connected: false });
  const tok = await loadTokens();
  if (!tok) return json({ configured: true, connected: false, environment });
  let company = null, ok = true, error = null, tid = null;
  try {
    const q = await qbQuery("select * from CompanyInfo");
    company = q?.QueryResponse?.CompanyInfo?.[0]?.CompanyName || null;
  } catch (e) { ok = false; error = e.code || "error"; tid = e.tid || null; }
  return json({ configured: true, connected: ok, company, realmId: tok.realmId, environment, error, tid });
};
function json(o) { return new Response(JSON.stringify(o), { headers: { "content-type": "application/json", "cache-control": "no-store" } }); }
export const config = { path: "/api/qb/status" };
