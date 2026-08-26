// Google Business Profile (Google reviews) OAuth2 + API helpers — server-side only.
// Mirrors the QuickBooks lib: tokens live in a Netlify Blob store and auto-refresh.
//
// Google split the old "My Business" API into several services. We use:
//   • Account mgmt : https://mybusinessaccountmanagement.googleapis.com/v1/accounts
//   • Locations    : https://mybusinessbusinessinformation.googleapis.com/v1/accounts/{acc}/locations
//   • Reviews (v4) : https://mybusiness.googleapis.com/v4/accounts/{acc}/locations/{loc}/reviews
// The v4 reviews endpoints require your Google Cloud project to be granted access
// to the Business Profile APIs (an approval Google grants per project).
import { getStore } from "@netlify/blobs";

const OAUTH_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/business.manage";

export function env() {
  return {
    clientId: Netlify.env.get("GOOGLE_CLIENT_ID") || "",
    clientSecret: Netlify.env.get("GOOGLE_CLIENT_SECRET") || "",
    businessName: Netlify.env.get("GBP_BUSINESS_NAME") || "Louisville Rickhouse",
    // Optional pins — if you manage several locations, set these to the numeric IDs.
    accountId: Netlify.env.get("GBP_ACCOUNT_ID") || "",
    locationId: Netlify.env.get("GBP_LOCATION_ID") || "",
    anthropicKey: Netlify.env.get("ANTHROPIC_API_KEY") || "",
  };
}
export function store() { return getStore({ name: "gbp-tokens", consistency: "strong" }); }
export function dataStore() { return getStore({ name: "gbp-data", consistency: "strong" }); }
export function redirectUri(req) { return new URL(req.url).origin + "/api/google/callback"; }

export class GBPError extends Error {
  constructor(code, status, detail) { super(code); this.code = code; this.status = status; this.detail = detail; }
}

export async function saveTokens(tok) { await store().setJSON("tokens", { ...tok, savedAt: Date.now() }); }
export async function loadTokens() { return await store().get("tokens", { type: "json" }); }
export async function clearTokens() { try { await store().delete("tokens"); } catch (e) {} }

// Settings (auto-post threshold etc.) and the review log both live in the data store.
const DEFAULT_SETTINGS = { autopostMinStars: 4, holdAtOrBelow: 3, signature: "" };
export async function getSettings() {
  const s = await dataStore().get("settings", { type: "json" });
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}
export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...(patch || {}) };
  await dataStore().setJSON("settings", next);
  return next;
}
// Review log: { [reviewId]: { status:'posted'|'held'|'skipped', rating, reviewer, comment, draft, postedAt, updatedAt } }
export async function getLog() { return (await dataStore().get("log", { type: "json" })) || {}; }
export async function saveLog(log) { await dataStore().setJSON("log", log || {}); }

export function authUrl(req, statePayload) {
  const { clientId } = env();
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state: statePayload || "",
  });
  return OAUTH_AUTH + "?" + p.toString();
}
export async function exchangeCode(req, code) {
  const { clientId, clientSecret } = env();
  const r = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri(req), grant_type: "authorization_code" }),
  });
  const t = await r.json().catch(() => null);
  if (!r.ok || !t || !t.access_token) throw new GBPError("token_exchange_failed", r.status, t);
  await saveTokens(t);
  return t;
}

// Valid access token, refreshing when close to expiry. null if not connected.
export async function getAccess() {
  const { clientId, clientSecret } = env();
  let tok = await loadTokens();
  if (!tok || !tok.refresh_token && !tok.access_token) return null;
  const expiresAt = (tok.savedAt || 0) + ((tok.expires_in || 3600) * 1000);
  if (tok.access_token && Date.now() < expiresAt - 300000) return tok.access_token;
  if (!tok.refresh_token) return tok.access_token || null;
  const r = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: tok.refresh_token, grant_type: "refresh_token" }),
  });
  const nt = await r.json().catch(() => null);
  if (!r.ok || !nt || !nt.access_token) throw new GBPError("refresh_failed", r.status, nt);
  tok = { ...tok, ...nt, savedAt: Date.now() };
  await saveTokens(tok);
  return tok.access_token;
}

async function gapi(url, opts = {}) {
  const token = await getAccess();
  if (!token) throw new GBPError("not_connected", 401, "Google Business Profile is not connected.");
  const r = await fetch(url, { ...opts, headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json", ...(opts.headers || {}) } });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) {}
  if (!r.ok) throw new GBPError("google_api_error", r.status, (json && (json.error || json)) || text);
  return json;
}

// Resolve the account + location numeric IDs — from env pins, or discovered and cached.
// All locations this login manages (all three of your listings). Cached after the
// first discovery. If GBP_ACCOUNT_ID/GBP_LOCATION_ID are pinned, only that one is used.
export async function resolveTargets() {
  const e = env();
  if (e.accountId && e.locationId) return [{ accountId: e.accountId, locationId: e.locationId, title: e.businessName }];
  const cached = await dataStore().get("targets", { type: "json" });
  if (Array.isArray(cached) && cached.length) return cached;
  const accs = await gapi("https://mybusinessaccountmanagement.googleapis.com/v1/accounts");
  const out = [];
  for (const acc of (accs.accounts || [])) {
    const accountId = String(acc.name || "").split("/").pop();
    let pageToken = "", guard = 0;
    do {
      const url = `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${accountId}/locations?readMask=name,title&pageSize=100` + (pageToken ? `&pageToken=${pageToken}` : "");
      let locs; try { locs = await gapi(url); } catch (e2) { break; }
      (locs.locations || []).forEach((loc) => out.push({ accountId, locationId: String(loc.name || "").split("/").pop(), title: loc.title || "" }));
      pageToken = locs.nextPageToken || ""; guard++;
    } while (pageToken && guard < 10);
  }
  if (!out.length) throw new GBPError("no_location", 404, "No locations found on this Google login.");
  await dataStore().setJSON("targets", out);
  return out;
}

const STAR = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
export function starNum(r) { return STAR[r && r.starRating] || 0; }

// Reviews across ALL managed locations, each tagged with its location.
export async function listAllReviews(perLocation = 50) {
  const targets = await resolveTargets();
  const all = [];
  for (const t of targets) {
    const url = `https://mybusiness.googleapis.com/v4/accounts/${t.accountId}/locations/${t.locationId}/reviews?pageSize=${Math.min(50, perLocation)}&orderBy=updateTime desc`;
    let j; try { j = await gapi(url); } catch (e) { continue; } // skip a location that errors, keep the rest
    (j.reviews || []).forEach((rv) => { rv.__accountId = t.accountId; rv.__locationId = t.locationId; rv.__locationName = t.title; all.push(rv); });
  }
  return { targets, reviews: all };
}

export async function replyToReview(accountId, locationId, reviewId, comment) {
  const url = `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews/${encodeURIComponent(reviewId)}/reply`;
  return await gapi(url, { method: "PUT", body: JSON.stringify({ comment: String(comment || "").slice(0, 4096) }) });
}

// ---- Reply drafting -------------------------------------------------------
function firstName(reviewer) {
  const n = (reviewer && reviewer.displayName || "").trim();
  return n ? n.split(/\s+/)[0] : "";
}
function pick(arr, seed) { let h = 0; for (const c of String(seed || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0; return arr[h % arr.length]; }

// Template drafter — always available. If ANTHROPIC_API_KEY is set, draftReply()
// upgrades to an LLM-written reply and falls back to this on any error.
export function templateReply(review, businessName) {
  const stars = starNum(review);
  const name = firstName(review.reviewer);
  const hi = name ? `Hi ${name}, ` : "Hi, ";
  const sign = `\n\n— The team at ${businessName}`;
  if (stars >= 4) {
    const body = pick([
      "thank you so much for the kind words and the five stars — it truly makes our day. We can't wait to welcome you back.",
      "we really appreciate you taking the time to share this. Reviews like yours mean the world to our team. See you again soon!",
      "thank you for visiting and for the wonderful review. We're so glad you enjoyed it — come see us again anytime.",
    ], review.reviewId || review.name);
    return hi + body + sign;
  }
  // 3 stars and below — service recovery, held for a human to approve.
  const body = pick([
    "thank you for the honest feedback — we're sorry your visit didn't fully live up to what we aim for. We'd love the chance to make it right; please reach out to us directly so we can help.",
    "we appreciate you letting us know, and we're sorry we missed the mark. Your experience matters to us — please contact us directly so we can look into it and make things right.",
  ], review.reviewId || review.name);
  return hi + body + sign;
}
export async function draftReply(review) {
  const { anthropicKey } = env();
  const businessName = review.__locationName || env().businessName; // sign with THIS listing's name
  if (!anthropicKey) return templateReply(review, businessName);
  try {
    const stars = starNum(review);
    const prompt = `You write short, warm, professional replies to Google reviews on behalf of "${businessName}", a Kentucky distillery & tasting room.\n` +
      `Reply to this ${stars}-star review. 2-3 sentences, no hashtags, no emojis, address the reviewer by first name if given, sign as "The team at ${businessName}". ` +
      `For 4-5 stars: warm thanks + invite back. For 1-3 stars: sincere, non-defensive, apologize and invite them to reach out directly.\n\n` +
      `Reviewer: ${(review.reviewer && review.reviewer.displayName) || "Guest"}\nStars: ${stars}\nReview: ${review.comment || "(no text)"}\n\nReply:`;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-3-5-haiku-latest", max_tokens: 300, messages: [{ role: "user", content: prompt }] }),
    });
    const j = await r.json().catch(() => null);
    const txt = j && j.content && j.content[0] && j.content[0].text;
    if (!r.ok || !txt) return templateReply(review, businessName);
    return txt.trim();
  } catch (e) { return templateReply(review, businessName); }
}

// ---- The weekly job -------------------------------------------------------
// Reads recent reviews, drafts replies, auto-posts high-star ones, and holds
// low-star ones for approval. Idempotent: a review already handled is skipped.
export async function runWeeklyReviews() {
  const settings = await getSettings();
  const { reviews, targets } = await listAllReviews(50);
  const log = await getLog();
  let posted = 0, held = 0, skipped = 0;
  for (const rv of reviews) {
    const id = rv.reviewId || (rv.name || "").split("/").pop();
    if (!id) continue;
    const already = log[id];
    // Skip if the merchant already replied (in Google) or we've already handled it.
    if (rv.reviewReply || (already && (already.status === "posted"))) { skipped++; continue; }
    if (already && already.status === "held") { skipped++; continue; } // waiting on human
    const stars = starNum(rv);
    const draft = await draftReply(rv);
    const base = { rating: stars, reviewer: (rv.reviewer && rv.reviewer.displayName) || "Guest", comment: rv.comment || "", draft, location: rv.__locationName || "", accountId: rv.__accountId, locationId: rv.__locationId, updatedAt: Date.now() };
    if (stars >= (settings.autopostMinStars || 4)) {
      try { await replyToReview(rv.__accountId, rv.__locationId, id, draft); log[id] = { ...base, status: "posted", reply: draft, postedAt: Date.now() }; posted++; }
      catch (e) { log[id] = { ...base, status: "held", error: String((e && e.detail) || e.message || e).slice(0, 300) }; held++; }
    } else {
      log[id] = { ...base, status: "held" }; held++; // low star — needs approval
    }
  }
  await saveLog(log);
  return { ok: true, posted, held, skipped, total: reviews.length, locations: targets.length };
}

export function json(o, status = 200) { return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }
