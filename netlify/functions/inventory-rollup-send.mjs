// "Send rollup now" button → POST /api/inventory-rollup-send { ws }
// Emails the all-stores rollup to settings.invRollupTo right away. Signed-in back-office or
// Inventory-admin users only (when login enforcement is on).
import { getStore } from "@netlify/blobs";
import { authOn, verify, tokenFromReq, isRetailRole } from "./lib/authtoken.mjs";
import { sendRollup } from "./lib/invrollup.mjs";

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  let b = {}; try { b = await req.json(); } catch {}
  const ws = String(b.ws || "").trim();
  if (!ws || ws.length < 8) return json({ ok: false, error: "missing_workspace" }, 400);
  const store = getStore({ name: "ttb-data", consistency: "strong" });
  const data = await store.get(`ws_${ws}`, { type: "json" });
  if (!data) return json({ ok: false, error: "workspace_not_found" }, 404);
  if (authOn() && data.auth && data.auth.enabled) {
    const tok = verify(tokenFromReq(req));
    if (!tok) return json({ ok: false, error: "auth_required" }, 401);
    if (tok.va || (isRetailRole(tok.role) && !tok.ia)) return json({ ok: false, error: "not_allowed" }, 403);
  }
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) return json({ ok: false, error: "RESEND_API_KEY not set" });
  const from = (process.env.INV_FROM || process.env.SALES_FROM || "Mikey Systems <sales@nashvillebarrelco.com>").trim();
  try {
    const r = await sendRollup(data, { apiKey, from });
    delete r.rollup;
    return json(r);
  } catch (e) { return json({ ok: false, error: String((e && e.message) || e) }); }
};

export const config = { path: "/api/inventory-rollup-send" };
