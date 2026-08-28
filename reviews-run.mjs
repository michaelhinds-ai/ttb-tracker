import { runWeeklyReviews, GBPError, json } from "./lib/gbp.mjs";
export default async () => {
  try { return json(await runWeeklyReviews()); }
  catch (e) {
    if (e instanceof GBPError && e.code === "not_connected") return json({ ok: false, error: "not_connected" }, 409);
    return json({ ok: false, error: (e && e.code) || "error", detail: String((e && e.detail) || (e && e.message) || e).slice(0, 400) }, 502);
  }
};
export const config = { path: "/api/reviews/run" };
