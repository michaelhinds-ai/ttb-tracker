// Manual trigger / preview for the checklist e-mails (back-office logins only).
//   GET /api/checklist-run?mode=weekly&dry=1   → recap HTML preview (nothing sent)
//   GET /api/checklist-run?mode=weekly         → send last week's recap now
//   GET /api/checklist-run?mode=notify&dry=1   → which completions would be e-mailed next run
import { authOn, verify, tokenFromReq, isRetailRole } from "./lib/authtoken.mjs";
import { runWeekly } from "./checklist-weekly.mjs";
import { runNotify } from "./checklist-notify.mjs";
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export default async (req) => {
  if (authOn()) { const t = verify(tokenFromReq(req)); if (!t || isRetailRole(t.role) || t.role === "labeler") return json({ ok: false, error: "not_allowed" }, 403); }
  const u = new URL(req.url); const dry = u.searchParams.get("dry") != null; const mode = u.searchParams.get("mode") || "weekly";
  try {
    if (mode === "notify") return json(await runNotify({ dry }));
    const r = await runWeekly({ dry, start: u.searchParams.get("start") || null });
    if (dry && u.searchParams.get("html") != null) return new Response(r.html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    if (dry) delete r.html;
    return json(r);
  } catch (e) { return json({ ok: false, error: String((e && e.message) || e) }, 500); }
};
export const config = { path: "/api/checklist-run" };
