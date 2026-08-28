import { replyToReview, getLog, saveLog, GBPError, json } from "./lib/gbp.mjs";
export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let b = {}; try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const reviewId = (b.reviewId || "").trim(); const comment = (b.comment || "").trim();
  if (!reviewId || !comment) return json({ error: "missing", detail: "reviewId and comment required" }, 400);
  let accountId = b.accountId, locationId = b.locationId;
  const log = await getLog();
  if (!accountId || !locationId) { const rec = log[reviewId]; if (rec) { accountId = rec.accountId; locationId = rec.locationId; } }
  if (!accountId || !locationId) return json({ error: "missing_location", detail: "Could not determine which listing this review belongs to." }, 400);
  try {
    await replyToReview(accountId, locationId, reviewId, comment);
    log[reviewId] = { ...(log[reviewId] || {}), status: "posted", reply: comment, accountId, locationId, postedAt: Date.now(), updatedAt: Date.now() };
    await saveLog(log);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof GBPError && e.code === "not_connected") return json({ ok: false, error: "not_connected" }, 409);
    return json({ ok: false, error: (e && e.code) || "error", detail: String((e && e.detail) || (e && e.message) || e).slice(0, 400) }, 502);
  }
};
export const config = { path: "/api/reviews/reply" };
