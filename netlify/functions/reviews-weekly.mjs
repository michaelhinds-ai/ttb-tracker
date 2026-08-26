// Scheduled weekly job — Mondays 14:00 UTC (~8-9am Central). Runs the same
// logic as the "Run now" button: auto-post 4-5 star replies, hold the rest.
import { runWeeklyReviews } from "./lib/gbp.mjs";
export default async () => {
  try { const r = await runWeeklyReviews(); console.log("[reviews-weekly]", JSON.stringify(r)); }
  catch (e) { console.error("[reviews-weekly] failed", e && (e.detail || e.message || e)); }
  return new Response("ok");
};
export const config = { schedule: "0 14 * * 1" };
