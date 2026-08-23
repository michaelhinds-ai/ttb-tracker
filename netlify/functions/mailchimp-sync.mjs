// Weekly Square + Shopify -> Mailchimp email sync (incremental).
// Runs on a schedule (Mondays), pulling only contacts updated in the last ~8 days,
// so each run is small and finishes well inside the function time limit.
//
// Manual use (hit /.netlify/functions/mailchimp-sync):
//   ?dry=1        report counts, write nothing
//   ?days=14      widen the look-back window
//   ?full=1       import EVERYONE (small directories only — use the background
//                 function for the initial full seed of a large directory)
import { json } from "./lib/square.mjs";
import { mcConfig, shopifyConfig, runSync } from "./lib/mailchimp.mjs";

export default async (req) => {
  const cfg = mcConfig();
  if (!cfg.ok) return json({ configured: false, error: "not_configured", detail: "Set MAILCHIMP_API_KEY and MAILCHIMP_LIST_ID in Netlify." }, 200);
  let dry = false, full = false, days = 8;
  try { const url = new URL(req.url); dry = url.searchParams.get("dry") != null; full = url.searchParams.get("full") != null; days = +url.searchParams.get("days") || 8; } catch { /* scheduled: no query */ }
  try {
    const r = await runSync({ full, dry, sinceDays: days });
    return json({ ok: true, shopifyConfigured: shopifyConfig().ok, ...r });
  } catch (e) {
    return json({ error: "sync_error", status: (e && e.status) || null, detail: (e && (e.detail || e.message)) || "error" }, 502);
  }
};

// Mondays at 12:00 UTC (~7-8am Central). Change the cron to adjust.
export const config = { schedule: "0 12 * * 1" };
