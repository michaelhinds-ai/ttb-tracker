// PUBLIC, read-only Google reviews feed for the marketing sites.
//   GET /api/reviews/public?brand=lr   → Louisville Rickhouse
//   GET /api/reviews/public?brand=nbc  → Nashville Barrel Co (HQ + Downtown combined)
// Returns { rating, count, reviews:[{name,stars,text,date,location}], locations:[...], updatedAt }.
// Cached in the gbp-data blob store for 6 hours so the sites never hit Google directly
// and the 300 QPM quota is never touched by public traffic. No tokens or private data leave here.
import { gapi, resolveTargets, dataStore, starNum, json } from "./lib/gbp.mjs";

const BRANDS = {
  lr:  { match: /louisville\s*rickhouse/i, label: "Louisville Rickhouse" },
  nbc: { match: /nashville\s*barrel|tasting\s*room|nashtucky/i, label: "Nashville Barrel Co" },
};
const SKIP = /north\s*knox|siding|windows/i;
const TTL_MS = 6 * 60 * 60 * 1000;
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET", "cache-control": "public, max-age=3600" };

function initial(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Guest";
  if (parts.length === 1) return parts[0];
  return parts[0] + " " + parts[parts.length - 1][0].toUpperCase() + ".";
}
function clip(text, max = 280) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…");
}
// "Best" = 5 stars, enough words to say something, bonus for naming an experience or a guide,
// bonus for recency. Avoids one-liners like "Great!" and anything that reads like a complaint.
function score(rv) {
  const stars = starNum(rv); if (stars < 5) return -1;
  const text = String(rv.comment || "");
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 12) return -1;
  if (/translated by google/i.test(text)) return -1;
  let s = Math.min(words, 80);
  if (/tasting|flight|barrel|blend|tour|guide|bourbon|whiskey|rickhouse|pick/i.test(text)) s += 25;
  if (/\b[A-Z][a-z]+\b (was|is) (amazing|fantastic|great|awesome|incredible|knowledgeable)/.test(text)) s += 15; // names a person
  const ageDays = (Date.now() - new Date(rv.createTime || rv.updateTime || 0).getTime()) / 864e5;
  if (ageDays < 90) s += 20; else if (ageDays < 365) s += 10;
  return s;
}

export default async (req) => {
  const url = new URL(req.url);
  const brand = (url.searchParams.get("brand") || "").toLowerCase();
  const spec = BRANDS[brand];
  if (!spec) return new Response(JSON.stringify({ error: "brand must be lr or nbc" }), { status: 400, headers: { ...CORS, "content-type": "application/json" } });
  const key = "public-" + brand;
  const ds = dataStore();
  const force = url.searchParams.get("refresh") === "1";
  try {
    const cached = await ds.get(key, { type: "json" });
    if (cached && !force && Date.now() - (cached.updatedAt || 0) < TTL_MS) {
      return new Response(JSON.stringify(cached), { headers: { ...CORS, "content-type": "application/json" } });
    }
  } catch (e) {}

  try {
    const targets = (await resolveTargets()).filter((t) => spec.match.test(t.title || "") && !SKIP.test(t.title || ""));
    const perLoc = await Promise.all(targets.map(async (t) => {
      const u = `https://mybusiness.googleapis.com/v4/accounts/${t.accountId}/locations/${t.locationId}/reviews?pageSize=50&orderBy=updateTime desc`;
      try { const j = await gapi(u); return { t, j }; } catch (e) { return { t, j: null }; }
    }));
    let count = 0, weighted = 0, all = [], locations = [];
    for (const { t, j } of perLoc) {
      if (!j) continue;
      const c = Number(j.totalReviewCount || 0), r = Number(j.averageRating || 0);
      count += c; weighted += c * r;
      locations.push({ title: t.title, count: c, rating: r ? Math.round(r * 10) / 10 : null });
      (j.reviews || []).forEach((rv) => { rv.__loc = t.title; all.push(rv); });
    }
    const rating = count ? Math.round((weighted / count) * 10) / 10 : null;
    const best = all.map((rv) => ({ rv, s: score(rv) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 8)
      .map(({ rv }) => ({ name: initial(rv.reviewer && rv.reviewer.displayName), stars: starNum(rv), text: clip(rv.comment), date: (rv.createTime || rv.updateTime || "").slice(0, 10), location: rv.__loc || "" }));
    const out = { brand: spec.label, rating, count, reviews: best, locations, updatedAt: Date.now() };
    if (count > 0) { try { await ds.setJSON(key, out); } catch (e) {} }
    return new Response(JSON.stringify(out), { headers: { ...CORS, "content-type": "application/json" } });
  } catch (e) {
    // Serve stale cache rather than nothing if Google is unhappy.
    try { const cached = await ds.get(key, { type: "json" }); if (cached) return new Response(JSON.stringify(cached), { headers: { ...CORS, "content-type": "application/json" } }); } catch (e2) {}
    return json({ error: "unavailable", detail: String((e && e.message) || e).slice(0, 200) }, 503);
  }
};
export const config = { path: "/api/reviews/public" };
