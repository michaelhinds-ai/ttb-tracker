import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

// Synced key-value store for the TTB tracker — one JSON blob per workspace code.
// Conflict-safe: each save carries the _savedAt it was based on. If the cloud has
// advanced since (another device saved in between), we MERGE record collections by
// id instead of letting the stale save overwrite — so no order/entry/customer is ever
// lost when two devices are open at once.
//
// Role-based access (server-side data isolation) is OPT-IN: it only activates when the
// AUTH_SECRET env var is set AND the workspace has login enabled. With AUTH_SECRET unset,
// this behaves exactly as before (full data to everyone), so nothing changes until you set it.
const ARR_KEYS = [
  "entries", "orders", "customers", "finishedGoods", "barrels", "bottlings",
  "skus", "tibouts", "tibins", "tasks", "docs", "assets", "barrelsProc", "dailyBackups",
  "expenses", "salaried", "attention", "samples", "upcs", "labelTemplates",
  "invCats", "invItems", "invCounts", "invSubs",
  "duties", "dutyChecks", "trustedDevices",
];

/* ---- inlined auth helpers (self-contained so there's no cross-file import to break) ---- */
function AUTH_SECRET() { return (process.env.AUTH_SECRET || "").trim(); }
function authOn() { return !!AUTH_SECRET(); }
function verifyToken(token) {
  const s = AUTH_SECRET(); if (!s || !token) return null;
  const parts = String(token).split("."); if (parts.length !== 2) return null;
  const expect = crypto.createHmac("sha256", s).update(parts[0]).digest("base64url");
  const a = Buffer.from(parts[1]); const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const o = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); if (o.exp && Date.now() > o.exp) return null; return o; } catch { return null; }
}
function tokenFromReq(req) {
  try { const h = (req.headers && req.headers.get && req.headers.get("authorization")) || ""; const m = /^Bearer\s+(.+)$/i.exec(h); if (m) return m[1].trim(); } catch {}
  try { const u = new URL(req.url); return (u.searchParams.get("t") || "").trim(); } catch {}
  return "";
}
function isRetailRole(r) { return r === "retail" || r === "retailemp"; }
// Additive / value collections that no one "deletes" in bulk — daily inventory counts, the
// submission log, and duty/supply check-offs. These are ALWAYS merged record-by-record (newest
// _upd wins, nothing dropped) even on a full-writer save, so a back-office device holding a stale
// copy can never wipe the store staff's daily work. (Deletes here are rare toggles and low-stakes.)
const ALWAYS_MERGE_KEYS = ["invCounts", "invSubs", "dutyChecks"];
const RETAIL_READ_KEYS = ["invCats", "invItems", "invCounts", "invSubs", "invLocs", "duties", "dutyChecks", "skus", "trustedDevices"];
const RETAIL_WRITE_KEYS = ["invCounts", "invSubs", "dutyChecks", "invCats", "invItems", "invLocs", "duties", "tasks", "attention"];
const SETTINGS_STRIP = ["kyExcise", "kyWholesale", "kyCase", "bottlingLossPct", "wages", "salesEmailTo", "lateEmailTo", "lateEmailByLoc", "invEmailTo", "invEmailByLoc"];
function sanitizeSettings(s) { const o = { ...(s || {}) }; for (const k of SETTINGS_STRIP) delete o[k]; return o; }
function sanitizeUsers(users) {
  return (Array.isArray(users) ? users : []).map((u) => ({
    id: u.id, name: u.name, username: u.username || "", role: u.role,
    viewOnly: !!u.viewOnly, invAdmin: !!u.invAdmin, seesSales: !!u.seesSales, deviceLock: !!u.deviceLock,
    locations: u.locations || [], location: u.location || "", stok: u.stok || null,
  }));
}
function filterForRetail(blob) {
  const out = {
    _savedAt: blob && blob._savedAt,
    auth: { enabled: !!(blob.auth && blob.auth.enabled), users: sanitizeUsers(blob.auth && blob.auth.users) },
    settings: sanitizeSettings(blob.settings), brandLogos: blob.brandLogos || {},
  };
  for (const k of RETAIL_READ_KEYS) out[k] = Array.isArray(blob[k]) ? blob[k] : [];
  return out;
}
function bootstrap(blob) {
  return {
    _bootstrap: true, _savedAt: blob && blob._savedAt,
    auth: { enabled: !!(blob && blob.auth && blob.auth.enabled), users: sanitizeUsers(blob && blob.auth && blob.auth.users) },
    settings: { name: (blob && blob.settings && blob.settings.name) || "", permit: (blob && blob.settings && blob.settings.permit) || "", loginShowList: !!(blob && blob.settings && blob.settings.loginShowList), roleViews: (blob && blob.settings && blob.settings.roleViews) || {} },
    brandLogos: (blob && blob.brandLogos) || {},
    trustedDevices: Array.isArray(blob && blob.trustedDevices) ? blob.trustedDevices : [],
  };
}
/* -------------------------------------------------------------------------------------- */

function mergeById(cloudArr, incArr) {
  const a = Array.isArray(cloudArr) ? cloudArr : [];
  const b = Array.isArray(incArr) ? incArr : [];
  const cloudById = new Map();
  for (const it of a) { if (it && it.id != null) cloudById.set(it.id, it); }
  const winner = (inc) => { const ex = cloudById.get(inc.id); if (ex && (Number(ex._upd) || 0) > (Number(inc._upd) || 0)) return ex; return inc; };
  const seen = new Set();
  const out = [];
  for (const it of b) { if (it && it.id != null) { seen.add(it.id); out.push(winner(it)); } else if (it) out.push(it); }
  for (const it of a) { if (it && it.id != null && !seen.has(it.id)) out.push(it); }
  return out;
}

const STICKY_SETTINGS = ["salesEmailTo", "lateEmailTo", "lateEmailByLoc", "lateThresholdMin", "invEmailTo", "invEmailByLoc"];
function isEmptyVal(v) {
  if (v == null || v === "") return true;
  if (typeof v === "object" && !Array.isArray(v)) return Object.keys(v).length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}
function mergeStates(cloud, inc) {
  const out = { ...inc };
  for (const k of ARR_KEYS) out[k] = mergeById(cloud[k], inc[k]);
  if ((cloud.auth && Array.isArray(cloud.auth.users)) || (inc.auth && Array.isArray(inc.auth.users))) {
    out.auth = { ...(inc.auth || {}), users: mergeById(cloud.auth && cloud.auth.users, inc.auth && inc.auth.users) };
  }
  const cs = (cloud && cloud.settings) || {};
  const is = (inc && inc.settings) || {};
  const csNewer = (+cs._updAt || 0) > (+is._updAt || 0);
  const primary = csNewer ? cs : is, secondary = csNewer ? is : cs;
  const merged = { ...secondary, ...primary };
  for (const k of STICKY_SETTINGS) {
    if (isEmptyVal(merged[k])) { if (!isEmptyVal(cs[k])) merged[k] = cs[k]; else if (!isEmptyVal(is[k])) merged[k] = is[k]; }
  }
  out.settings = merged;
  return out;
}

export default async (req) => {
  const url = new URL(req.url);
  const ws = (url.searchParams.get("ws") || "").trim();
  if (!ws || ws.length < 8) return json({ error: "missing_or_short_workspace" }, 400);

  const store = getStore({ name: "ttb-data", consistency: "strong" });
  const key = `ws_${ws}`;

  try {
    if (req.method === "GET") {
      const data = await store.get(key, { type: "json" });
      if (!data) return json(null);
      const enforce = authOn() && data.auth && data.auth.enabled;
      if (!enforce) return json(data);
      const tok = verifyToken(tokenFromReq(req));
      if (!tok) return json(bootstrap(data));               // not signed in → login-screen data only
      if (isRetailRole(tok.role)) return json(filterForRetail(data)); // employee → no financials
      return json(data);                                     // back office → full
    }

    if (req.method === "POST" || req.method === "PUT") {
      const body = await req.json();
      if (!body || typeof body !== "object") return json({ error: "bad_body" }, 400);
      const base = body._baseSavedAt;
      if ("_baseSavedAt" in body) delete body._baseSavedAt;

      const current = await store.get(key, { type: "json" });
      const enforce = authOn() && current && current.auth && current.auth.enabled;

      if (enforce) {
        const tok = verifyToken(tokenFromReq(req));
        if (!tok) return json({ error: "auth_required" }, 401);
        if (isRetailRole(tok.role)) {
          const out = { ...current };
          for (const k of RETAIL_WRITE_KEYS) out[k] = mergeById(current[k], body[k]);
          const savedAt = new Date().toISOString();
          await store.setJSON(key, { ...out, _savedAt: savedAt });
          return json({ ok: true, savedAt });
        }
      }

      let toSave = body, merged = false;
      if (current && current._savedAt && base != null && String(current._savedAt) !== String(base)) {
        toSave = mergeStates(current, body);
        merged = true;
      }
      // Never let a save WIPE a whole collection just because the client (e.g. an older build)
      // didn't include it. If a key is entirely absent from the incoming save but present in the
      // stored blob, keep what's stored. (An intentional clear still works: the client sends [].)
      if (current) { for (const k of ARR_KEYS) { if (toSave[k] === undefined && current[k] !== undefined) toSave[k] = current[k]; } }
      // Daily staff-data collections are ALWAYS merged record-by-record, even when this full-write
      // device believes it's current — so a stale back-office tab can't drop a store's counts,
      // submissions or check-offs. (Runs after the merge above so it wins regardless of base state.)
      if (current) { for (const k of ALWAYS_MERGE_KEYS) toSave[k] = mergeById(current[k], body[k]); }
      const savedAt = new Date().toISOString();
      const saved = { ...toSave, _savedAt: savedAt };
      await store.setJSON(key, saved);
      return json(merged ? { ok: true, savedAt, merged: true, state: saved } : { ok: true, savedAt });
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (e) {
    return json({ error: "server_error", detail: String((e && e.message) || e) }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
export const config = { path: "/api/data" };
