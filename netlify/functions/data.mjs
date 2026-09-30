import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
// Companies (keep in sync with lib/companies.mjs — inlined so this function has no cross-file import)
const ROOT_WS = "7d72874cf4714c4e9242a22c39c42a65";
const COMPANY_WS = { nbc: "d7ee258b1c714b6fab306c4a9396825d" };
function isLinkedWs(ws) { return Object.values(COMPANY_WS).includes(String(ws || "")); }

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
  "duties", "dutyChecks", "trustedDevices", "insurance", "sellSheets",
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
const ALWAYS_MERGE_KEYS = ["invCounts", "invSubs", "dutyChecks", "duties", "invItems", "invCats"];
// The store LIST collections carry soft-delete tombstones ({id,_del:1,_upd}) so that, under the
// always-merge rule above, a real deletion still propagates (a merge can't drop a record, so a
// delete has to travel as a tombstone). Purge tombstones older than 60 days when saving.
const TOMBSTONE_KEYS = ["duties", "invItems", "invCats"];
function purgeTombstones(obj) {
  const now = Date.now(), TTL = 60 * 86400000;
  for (const k of TOMBSTONE_KEYS) {
    if (Array.isArray(obj[k])) obj[k] = obj[k].filter((r) => !(r && r._del && (now - (Number(r._upd) || 0)) > TTL));
  }
  return obj;
}
const RETAIL_READ_KEYS = ["invCats", "invItems", "invCounts", "invSubs", "invLocs", "duties", "dutyChecks", "skus", "trustedDevices"];
const RETAIL_WRITE_KEYS = ["invCounts", "invSubs", "dutyChecks", "invCats", "invItems", "invLocs", "duties", "tasks", "attention"];
// invEmailTo / invEmailByLoc are NOT stripped: store staff need the reorder address so their weekly
// count actually gets emailed, and Inventory-admin (invAdmin) retail users manage those recipients.
const SETTINGS_STRIP = ["kyExcise", "kyWholesale", "kyCase", "bottlingLossPct", "wages", "salesEmailTo", "lateEmailTo", "lateEmailByLoc"];
// Settings an Inventory-admin retail login may change (newest _updAt wins).
const RETAIL_INVADMIN_SETTINGS = ["invEmailTo", "invEmailByLoc", "invRollupTo"];
function sanitizeSettings(s) { const o = { ...(s || {}) }; for (const k of SETTINGS_STRIP) delete o[k]; return o; }
function sanitizeUsers(users) {
  return (Array.isArray(users) ? users : []).map((u) => ({
    id: u.id, name: u.name, username: u.username || "", role: u.role,
    viewOnly: !!u.viewOnly, invAdmin: !!u.invAdmin, seesSales: !!u.seesSales, deviceLock: !!u.deviceLock,
    locations: u.locations || [], location: u.location || "", stok: u.stok || null,
  }));
}
function filterForRetail(blob, tok) {
  const out = {
    _savedAt: blob && blob._savedAt,
    auth: { enabled: !!(blob.auth && blob.auth.enabled), users: sanitizeUsers(blob.auth && blob.auth.users) },
    settings: sanitizeSettings(blob.settings), brandLogos: blob.brandLogos || {},
  };
  for (const k of RETAIL_READ_KEYS) out[k] = Array.isArray(blob[k]) ? blob[k] : [];
  // Their own tasks only (assigned to them, or ones they sent) — never the whole team's list or cash tips.
  const uid = tok && tok.uid;
  // Retail Managers also get store notes (from opening/closing) for the stores they cover.
  const me = uid ? ((blob && blob.auth && Array.isArray(blob.auth.users)) ? blob.auth.users : []).find((u) => u && u.id === uid) : null;
  const myLocs = me ? (Array.isArray(me.locations) && me.locations.length ? me.locations : (me.location ? [me.location] : [])) : [];
  const ln = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const locOk = (l) => !myLocs.length || myLocs.some((m) => { const a = ln(m), b = ln(l); return a && b && (a === b || a.startsWith(b) || b.startsWith(a)); });
  const isMgr = tok && tok.role === "retail";
  out.tasks = (Array.isArray(blob && blob.tasks) ? blob.tasks : []).filter((t) => t && !t.tip && uid && (t.forId === uid || t.byId === uid || (t.dutyNote && isMgr && locOk(t.byLoc))));
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

const STICKY_SETTINGS = ["salesEmailTo", "lateEmailTo", "lateEmailByLoc", "lateThresholdMin", "invEmailTo", "invEmailByLoc", "invRollupTo"];
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
  // A linked company (e.g. Nashville Barrel Co) keeps its own data but uses the ROOT workspace's
  // logins: auth is read from the root blob, injected into what the client receives, and never
  // stored in the company blob. Retail logins can't open a linked company at all.
  const linked = isLinkedWs(ws);
  const rootBlob = linked ? ((await store.get(`ws_${ROOT_WS}`, { type: "json" })) || {}) : null;
  const authOf = (d) => (linked ? rootBlob.auth : (d && d.auth));
  const withAuth = (d) => {
    if (!linked) return d;
    const rs = rootBlob.settings || {};
    const o = { ...(d || {}), auth: rootBlob.auth, trustedDevices: rootBlob.trustedDevices || [] };
    o.settings = { ...((d && d.settings) || {}), roleViews: rs.roleViews || {}, loginShowList: !!rs.loginShowList };
    return o;
  };

  try {
    if (req.method === "GET" && url.searchParams.get("acts")) {
      // Team activity log (who did what, from every device). Back-office logins only.
      const data = await store.get(key, { type: "json" });
      const au = authOf(data);
      if (authOn() && au && au.enabled) {
        const tok = verifyToken(tokenFromReq(req));
        if (!tok || isRetailRole(tok.role)) return json({ ok: false, error: "not_allowed" }, 403);
      }
      const log = (await store.get(`acts_${ws}`, { type: "json" })) || [];
      return json({ ok: true, rows: log.slice(-3000).reverse() });
    }
    if (req.method === "GET") {
      const data0 = await store.get(key, { type: "json" });
      if (!data0 && !linked) return json(null);
      const data = withAuth(data0);
      const au = authOf(data0);
      const enforce = authOn() && au && au.enabled;
      if (!enforce) return json(data);
      const tok = verifyToken(tokenFromReq(req));
      if (!tok) return json(bootstrap(data));               // not signed in → login-screen data only
      if (isRetailRole(tok.role)) return json(linked ? { error: "not_allowed" } : filterForRetail(data, tok), linked ? 403 : 200); // employee → no financials
      return json(data);                                     // back office → full
    }

    if (req.method === "POST" || req.method === "PUT") {
      const body = await req.json();
      if (!body || typeof body !== "object") return json({ error: "bad_body" }, 400);
      const base = body._baseSavedAt;
      if ("_baseSavedAt" in body) delete body._baseSavedAt;
      // Refuse saves from outdated app builds (a tab left open for days) so old code can't write
      // stale data over everyone else's. Newer builds reload themselves when they see this.
      // Raise MIN_CLIENT_BUILD (or set the env var) when a change must reach every device.
      const MIN_CLIENT_BUILD = (process.env.MIN_CLIENT_BUILD || "v20260929b").trim();
      const cv = String(body._v || "");
      if ("_v" in body) delete body._v;
      if (!cv || cv < MIN_CLIENT_BUILD) return json({ ok: false, error: "stale_client", latest: MIN_CLIENT_BUILD, detail: "This screen is running an old version of Mikey Systems. Refresh the page to update." }, 409);
      const acts = Array.isArray(body._acts) ? body._acts.slice(0, 60) : [];
      if ("_acts" in body) delete body._acts;
      let actTok = null; try { actTok = verifyToken(tokenFromReq(req)); } catch (e) { actTok = null; }
      const logActs = async () => { // append this save's actions to the shared activity log (never blocks the save)
        if (!acts.length) return;
        try {
          const lk = `acts_${ws}`; const log = (await store.get(lk, { type: "json" })) || [];
          for (const a of acts) log.push({ ts: +a.ts || Date.now(), by: String(a.by || "").slice(0, 80), role: (actTok && actTok.role) || String(a.role || "").slice(0, 20), label: String(a.label || "").slice(0, 300), dev: String(a.dev || "").slice(0, 60), v: String(a.v || "").slice(0, 30) });
          await store.setJSON(lk, log.slice(-5000));
        } catch (e) { /* logging must never break saving */ }
      };

      const current = await store.get(key, { type: "json" });
      if (linked) { delete body.auth; delete body.trustedDevices; if (body.settings && typeof body.settings === "object") { delete body.settings.roleViews; delete body.settings.loginShowList; } }
      const au = authOf(current);
      const enforce = authOn() && au && au.enabled;

      if (enforce) {
        const tok = verifyToken(tokenFromReq(req));
        if (!tok) return json({ error: "auth_required" }, 401);
        if (linked && isRetailRole(tok.role)) return json({ error: "not_allowed" }, 403);
        if (isRetailRole(tok.role)) {
          const out = { ...current };
          for (const k of RETAIL_WRITE_KEYS) out[k] = mergeById(current[k], body[k]);
          // Inventory-admin retail users (e.g. a store manager) can save the reorder recipients.
          // Previously ignored here, so the save "worked" on screen and then vanished on the next sync.
          if (tok.ia && !tok.va && body.settings && typeof body.settings === "object") {
            const cs = current.settings || {}, is = body.settings;
            if ((+is._updAt || 0) > (+cs._updAt || 0)) {
              const ns = { ...cs };
              for (const k of RETAIL_INVADMIN_SETTINGS) if (k in is) ns[k] = is[k];
              ns._updAt = +is._updAt;
              out.settings = ns;
            }
          }
          const savedAt = new Date().toISOString();
          await store.setJSON(key, purgeTombstones({ ...out, _savedAt: savedAt }));
          await logActs();
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
      if (linked) { delete toSave.auth; delete toSave.trustedDevices; }
      const saved = purgeTombstones({ ...toSave, _savedAt: savedAt });
      await store.setJSON(key, saved);
      await logActs();
      return json(merged ? { ok: true, savedAt, merged: true, state: withAuth(saved) } : { ok: true, savedAt });
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
