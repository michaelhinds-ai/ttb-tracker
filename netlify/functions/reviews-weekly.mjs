// Scheduled weekly job — Mondays 14:00 UTC (~8-9am Central). Runs the same
// logic as the "Run now" button: auto-post 4-5 star replies, hold the rest.
import { runWeeklyReviews } from "./lib/gbp.mjs";
export default async () => {
  // Scheduled functions get ~30s: keep calling the time-budgeted run until the backlog is clear.
  try { const t0 = Date.now(); let r, tot = { posted: 0, held: 0 };
    do { r = await runWeeklyReviews({ budgetMs: 4500 }); tot.posted += r.posted; tot.held += r.held; } while (r.partial && Date.now() - t0 < 18000);
    console.log("[reviews-weekly]", JSON.stringify({ ...r, ...tot })); }
  catch (e) { console.error("[reviews-weekly] failed", e && (e.detail || e.message || e)); }
  return new Response("ok");
};
export const config = { schedule: "0 14 * * 1" };
