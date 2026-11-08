// "Forgot PIN?" — emails a one-time 6-digit code to the user (their email on file, or for an admin
// with no email, BACKUP_EMAIL_TO), then lets them set a new PIN with that code.
// POST {ws, login, step:"send"}  → always {ok:true} (never reveals whether the user exists)
// POST {ws, login, step:"reset", code, newPin} → {ok:true} | {ok:false, error}
import { getStore } from "@netlify/blobs";
import { createHash, randomInt } from "node:crypto";
import { hashPin } from "./lib/authtoken.mjs";
import { ROOT_WS, isLinkedWs } from "./lib/companies.mjs";

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }
const norm = (s) => String(s == null ? "" : s).trim().toLowerCase();
const derived = (name) => norm(name).split(/\s+/)[0].replace(/[^a-z0-9]/g, "");
const okEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || "").trim());
const h = (s) => createHash("sha256").update("pinreset:" + s).digest("hex");
const TTL = 15 * 60 * 1000, MAX_TRIES = 5;

function findUser(users, login) {
  const n = norm(login); if (!n) return null;
  const pick = (a) => (a.length === 1 ? a[0] : null);
  return pick(users.filter((u) => u.username && norm(u.username) === n)) || pick(users.filter((u) => u.email && norm(u.email) === n)) || pick(users.filter((u) => derived(u.name) === n));
}
function recipientFor(u) {
  if (okEmail(u.email)) return [String(u.email).trim()];
  if (u.role === "admin") return String(process.env.BACKUP_EMAIL_TO || "").split(/[,;\s]+/).filter(okEmail).slice(0, 2);
  return [];
}
function mask(e) { const [a, d] = String(e).split("@"); return (a.slice(0, 2) + "•••@" + d); }

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  let b = {}; try { b = await req.json(); } catch {}
  const ws = String(b.ws || "").trim(); if (ws.length < 8) return json({ ok: false, error: "ws" }, 400);
  const store = getStore({ name: "ttb-data", consistency: "strong" });
  const key = `ws_${isLinkedWs(ws) ? ROOT_WS : ws}`;
  const blob = (await store.get(key, { type: "json" })) || {};
  const users = (blob.auth && Array.isArray(blob.auth.users)) ? blob.auth.users : [];
  const u = findUser(users, b.login);

  if (b.step === "send") {
    if (!u) return json({ ok: true, sent: false });
    const to = recipientFor(u); if (!to.length) return json({ ok: true, sent: false, noEmail: true });
    const rk = `pinreset_${u.id}`;
    const prev = (await store.get(rk, { type: "json" })) || null;
    if (prev && prev.sentAt && Date.now() - prev.sentAt < 60 * 1000) return json({ ok: true, sent: true, to: mask(to[0]) }); // throttle resends
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    await store.setJSON(rk, { codeHash: h(u.id + ":" + code), exp: Date.now() + TTL, tries: 0, sentAt: Date.now() });
    const key2 = (process.env.RESEND_API_KEY || "").trim();
    if (!key2) return json({ ok: false, error: "no_mail" });
    const from = (process.env.CHECKLIST_FROM || process.env.TASK_FROM || process.env.SALES_FROM || "Mikey Systems <sales@nashvillebarrelco.com>").trim();
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#231a12">
      <p>Someone asked to reset the Mikey Systems PIN for <b>${String(u.name || u.username || "").replace(/</g, "&lt;")}</b>.</p>
      <p style="font-size:30px;font-weight:800;letter-spacing:6px;margin:14px 0">${code}</p>
      <p>Enter this code on the sign-in screen within 15 minutes. If this wasn't you, ignore this email — your PIN stays the same.</p></div>`;
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key2}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to, subject: "Your Mikey Systems PIN reset code", html }) });
    if (!r.ok) return json({ ok: false, error: "mail_failed" });
    return json({ ok: true, sent: true, to: mask(to[0]) });
  }

  if (b.step === "reset") {
    if (!u) return json({ ok: false, error: "code" });
    const rk = `pinreset_${u.id}`;
    const rec = (await store.get(rk, { type: "json" })) || null;
    if (!rec || Date.now() > rec.exp) return json({ ok: false, error: "expired" });
    if (rec.tries >= MAX_TRIES) return json({ ok: false, error: "locked" });
    if (h(u.id + ":" + String(b.code || "").trim()) !== rec.codeHash) {
      rec.tries = (rec.tries || 0) + 1; await store.setJSON(rk, rec);
      return json({ ok: false, error: "code", left: MAX_TRIES - rec.tries });
    }
    const pin = String(b.newPin || "").trim();
    if (!/^\d{4,12}$/.test(pin)) return json({ ok: false, error: "pin_format" });
    const fresh = (await store.get(key, { type: "json" })) || {};
    const list = (fresh.auth && Array.isArray(fresh.auth.users)) ? fresh.auth.users : [];
    const me = list.find((x) => x && x.id === u.id); if (!me) return json({ ok: false, error: "code" });
    me.pinHash = hashPin(pin); me._upd = Date.now();
    await store.setJSON(key, { ...fresh, _savedAt: new Date().toISOString() });
    await store.delete(rk);
    return json({ ok: true });
  }
  return json({ ok: false, error: "step" }, 400);
};

export const config = { path: "/api/auth/forgot" };
