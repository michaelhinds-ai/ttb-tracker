// Server-side login: verifies the PIN (and device restriction) against the stored workspace,
// then issues a signed session token. Only active when AUTH_SECRET is set and login is enabled;
// otherwise it tells the client to use its legacy client-side login (nothing changes).
import { getStore } from "@netlify/blobs";
import { authOn, hashPin, sign, sanitizeUsers, isRetailRole } from "./lib/authtoken.mjs";
import { ROOT_WS, isLinkedWs } from "./lib/companies.mjs";

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }
function norm(s) { return String(s == null ? "" : s).trim().toLowerCase(); }
function derived(name) { return norm(name).split(/\s+/)[0].replace(/[^a-z0-9]/g, ""); }
const TOKEN_TTL = 12 * 60 * 60 * 1000; // 12h

function findUser(users, login) {
  const n = norm(login); if (!n) return null;
  const pick = (arr) => (arr.length === 1 ? arr[0] : (arr.length > 1 ? "ambiguous" : null));
  let r = pick(users.filter((u) => u.username && norm(u.username) === n)); if (r) return r;
  r = pick(users.filter((u) => u.email && norm(u.email) === n)); if (r) return r;
  r = pick(users.filter((u) => derived(u.name) === n)); if (r) return r;
  return null;
}

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  let b = {}; try { b = await req.json(); } catch { b = {}; }
  const ws = String(b.ws || "").trim();
  if (!ws || ws.length < 8) return json({ ok: false, error: "ws" }, 400);

  // Not configured for server auth → tell the client to log in the old way.
  if (!authOn()) return json({ ok: true, legacy: true });

  const store = getStore({ name: "ttb-data", consistency: "strong" });
  const key = `ws_${isLinkedWs(ws) ? ROOT_WS : ws}`; // linked companies share the root workspace's logins
  const blob = (await store.get(key, { type: "json" })) || {};
  if (!(blob.auth && blob.auth.enabled)) return json({ ok: true, legacy: true }); // login turned off

  const users = (blob.auth && Array.isArray(blob.auth.users)) ? blob.auth.users : [];
  const found = findUser(users, b.login);
  if (found === "ambiguous") return json({ ok: false, error: "ambiguous" });
  if (!found) return json({ ok: false, error: "user" });

  if (hashPin(b.pin) !== found.pinHash) return json({ ok: false, error: "pin" });

  // Approve-this-device from the login screen: an Admin signs in with approveDevice:true and the
  // device id of the tablet they're standing at. No session is created — it only adds the device.
  if (b.approveDevice) {
    if (!(found.role === "admin" || found.role === "admin2")) return json({ ok: false, error: "not_admin" });
    const dev = String(b.deviceId || "").trim();
    if (!dev || dev.length < 8) return json({ ok: false, error: "no_device" });
    const list = Array.isArray(blob.trustedDevices) ? blob.trustedDevices : [];
    if (!list.some((x) => x && x.token === dev && !x._del)) {
      const now = Date.now();
      list.push({ id: "td" + now.toString(36) + Math.random().toString(36).slice(2, 6), token: dev, name: String(b.deviceName || "Approved at login").slice(0, 60), by: found.name || "", ts: now, _upd: now });
      blob.trustedDevices = list;
      try { await store.setJSON(key, { ...blob, _savedAt: new Date().toISOString() }); } catch { return json({ ok: false, error: "save" }); }
    }
    return json({ ok: true, approved: true });
  }

  // Device restriction (trusted-device lock) — enforced server-side too.
  if (found.deviceLock) {
    const dev = String(b.deviceId || "").trim();
    const trusted = (Array.isArray(blob.trustedDevices) ? blob.trustedDevices : []).some((d) => d && d.token === dev);
    if (!trusted) return json({ ok: false, error: "device" });
  }

  // Claim this device as the user's active session (single-session), persist the stok.
  const stok = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  found.stok = stok; found._upd = Date.now();
  const savedAt = new Date().toISOString();
  try { await store.setJSON(key, { ...blob, _savedAt: savedAt }); } catch {}

  const token = sign({
    uid: found.id, role: found.role, va: !!found.viewOnly, ia: !!found.invAdmin, se: !!found.seesSales,
    stok, iat: Date.now(), exp: Date.now() + TOKEN_TTL,
  });
  const pub = sanitizeUsers([found])[0];
  return json({ ok: true, token, retail: isRetailRole(found.role), user: pub });
};

export const config = { path: "/api/auth/login" };
