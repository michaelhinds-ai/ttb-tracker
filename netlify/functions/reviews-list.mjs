import { listAllReviews, getLog, getSettings, starNum, loadTokens, GBPError, json } from "./lib/gbp.mjs";
export default async () => {
  const tok = await loadTokens();
  if (!tok || !(tok.access_token || tok.refresh_token)) return json({ connected: false });
  try {
    const [{ reviews, targets }, log, settings] = await Promise.all([listAllReviews(50), getLog(), getSettings()]);
    const out = reviews.map((rv) => {
      const id = rv.reviewId || (rv.name || "").split("/").pop();
      const rec = log[id] || {};
      let status = rec.status || "new";
      if (rv.reviewReply && status === "new") status = "replied";
      return {
        id, stars: starNum(rv), reviewer: (rv.reviewer && rv.reviewer.displayName) || "Guest",
        comment: rv.comment || "", createTime: rv.createTime || rv.updateTime || "",
        status, draft: rec.draft || "", reply: rec.reply || (rv.reviewReply && rv.reviewReply.comment) || "",
        location: rv.__locationName || "", accountId: rv.__accountId, locationId: rv.__locationId,
      };
    });
    return json({ connected: true, locations: targets, settings, reviews: out });
  } catch (e) {
    if (e instanceof GBPError && e.code === "not_connected") return json({ connected: false });
    return json({ connected: true, error: (e && e.code) || "error", detail: String((e && e.detail) || (e && e.message) || e).slice(0, 400) });
  }
};
export const config = { path: "/api/reviews/list" };
