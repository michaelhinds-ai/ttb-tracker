// Server-side auth for Mikey Systems — issues/verifies HMAC session tokens and filters the
// workspace data by role, so a retail login's device never even RECEIVES the financials.
// Enforcement is OPT-IN: it only activates when AUTH_SECRET is set AND the workspace has login
// enabled. With AUTH_SECRET unset, everything behaves exactly as before (legacy mode).
import crypto from "node:crypto";

export function secret() { return (process.env.AUTH_SECRET || "").trim(); }
export function authOn() { return !!secret(); }

export function sha256hex(str) { return crypto.createHash("sha256").update(String(str)).digest("hex"); }
// Same hashing the client uses for PINs: SHA-256 of "ttbsalt:" + pin, hex.
export function hashPin(pin) { return sha256hex("ttbsalt:" + String(pin == null ? "" : pin)); }

export function sign(payload) {
  const s = secret(); if (!s) return null;
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", s).update(p).digest("base64url");
  return p + "." + sig;
}
export function verify(token) {
  const s = secret(); if (!s || !token) return null;
  const parts = String(token).split("."); if (parts.length !== 2) return null;
  const expect = crypto.createHmac("sha256", s).update(parts[0]).digest("base64url");
  // constant-time compare
  const a = Buffer.from(parts[1]); const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const o = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); if (o.exp && Date.now() > o.exp) return null; return o; } catch { return null; }
}
export function tokenFromReq(req) {
  try { const h = (req.headers && req.headers.get && req.headers.get("authorization")) || ""; const m = /^Bearer\s+(.+)$/i.exec(h); if (m) return m[1].trim(); } catch {}
  try { const u = new URL(req.url); return (u.searchParams.get("t") || "").trim(); } catch {}
  return "";
}

export function isRetailRole(r) { return r === "retail" || r === "retailemp"; }

// What a retail login may READ (everything else in the blob is withheld).
export const RETAIL_READ_KEYS = ["invCats", "invItems", "invCounts", "invSubs", "invLocs", "duties", "dutyChecks", "skus", "trustedDevices"];
// What a retail login may WRITE (server ignores every other key from a retail POST, so a retail
// device can never wipe or alter financial data it doesn't even have).
export const RETAIL_WRITE_KEYS = ["invCounts", "invSubs", "dutyChecks", "invCats", "invItems", "invLocs", "duties", "tasks", "attention"];

// Fields on settings that carry money/rates/recipient lists — stripped for retail.
const SETTINGS_STRIP = ["kyExcise", "kyWholesale", "kyCase", "bottlingLossPct", "wages", "salesEmailTo", "lateEmailTo", "lateEmailByLoc", "invEmailTo", "invEmailByLoc"];
export function sanitizeSettings(s, full) {
  const o = { ...(s || {}) };
  if (!full) for (const k of SETTINGS_STRIP) delete o[k];
  return o;
}
export function sanitizeUsers(users) {
  return (Array.isArray(users) ? users : []).map((u) => ({
    id: u.id, name: u.name, username: u.username || "", role: u.role,
    viewOnly: !!u.viewOnly, invAdmin: !!u.invAdmin, seesSales: !!u.seesSales, deviceLock: !!u.deviceLock,
    locations: u.locations || [], location: u.location || "", stok: u.stok || null,
  })); // note: NO pinHash, NO email
}
// The role-appropriate view of the blob a client receives after logging in.
export function filterForRetail(blob) {
  const out = {
    _savedAt: blob && blob._savedAt,
    auth: { enabled: !!(blob && blob.auth && blob.auth.enabled), users: sanitizeUsers(blob && blob.auth && blob.auth.users) },
    settings: sanitizeSettings(blob && blob.settings, false),
    brandLogos: (blob && blob.brandLogos) || {},
  };
  for (const k of RETAIL_READ_KEYS) out[k] = Array.isArray(blob && blob[k]) ? blob[k] : [];
  return out;
}
// The pre-login view (no token): only what the sign-in screen needs. No pinHash, no data.
export function bootstrap(blob) {
  return {
    _bootstrap: true, _savedAt: blob && blob._savedAt,
    auth: { enabled: !!(blob && blob.auth && blob.auth.enabled), users: sanitizeUsers(blob && blob.auth && blob.auth.users) },
    settings: { name: (blob && blob.settings && blob.settings.name) || "", permit: (blob && blob.settings && blob.settings.permit) || "", loginShowList: !!(blob && blob.settings && blob.settings.loginShowList), roleViews: (blob && blob.settings && blob.settings.roleViews) || {} },
    brandLogos: (blob && blob.brandLogos) || {},
    trustedDevices: Array.isArray(blob && blob.trustedDevices) ? blob.trustedDevices : [],
  };
}
