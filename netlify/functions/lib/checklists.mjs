// Checklist e-mails (completions + weekly recap) — read straight from the ROOT workspace blob,
// so nothing depends on which device / app build an employee used.
//   • Store Inventory, Supplies Checklist, Joy Ride        → Jennifer (every location)
//   • Opening, Closing, Daily Task, Bathrooms, Slushie     → Jennifer for HQ / Church St, Adam for Louisville
//   • Weekly recap (Sun–Sat, sent Sunday)                  → BACKUP_EMAIL_TO (Mike) + Jennifer
// Recipients are the app users whose name matches (their e-mail on file), overridable with env
// CHECKLIST_EMAIL_JH / CHECKLIST_EMAIL_LOU / CHECKLIST_RECAP_TO (comma lists).
import { getStore } from "@netlify/blobs";
import { ROOT_WS } from "./companies.mjs";

export const KINDS = [
  { k: "open", label: "Opening" }, { k: "close", label: "Closing" }, { k: "clean", label: "Daily Task" },
  { k: "bath", label: "Bathrooms" }, { k: "slush", label: "Slushie Machine" },
];
export const BATH_DAY = 7;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function locSame(a, b) { a = norm(a); b = norm(b); return !!a && !!b && (a === b || a.includes(b) || b.includes(a)); }
export const isLouisville = (loc) => /louisville|rickhouse|lrwc|\bky\b/i.test(String(loc || ""));
export const tzFor = (loc) => (isLouisville(loc) ? "America/New_York" : "America/Chicago");
export function dowOf(dstr) { const p = String(dstr).split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay(); }
export function fmtDay(dstr) { const p = String(dstr).split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }); }
export function fmtTime(ts, loc) { if (!ts) return ""; return new Date(+ts).toLocaleTimeString("en-US", { timeZone: tzFor(loc), hour: "numeric", minute: "2-digit" }); }
export function todayIn(tz) { const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); return p; }
export function addDays(dstr, n) { const p = String(dstr).split("-"); const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)); return d.toISOString().slice(0, 10); }

export async function loadRoot() {
  const code = String(process.env.BACKUP_WS || "").split(",").map((s) => s.trim()).filter(Boolean)[0] || ROOT_WS;
  const store = getStore({ name: "ttb-data", consistency: "strong" });
  return (await store.get(`ws_${code}`, { type: "json" })) || {};
}

const okEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || "").trim());
const listEnv = (k) => String(process.env[k] || "").split(",").map((s) => s.trim()).filter(okEmail);
function userEmail(d, re) { const u = ((d.auth && d.auth.users) || []).find((x) => x && !x._del && re.test(String(x.name || "")) && okEmail(x.email)); return u ? String(u.email).trim() : ""; }
export function recipients(d) {
  const jh = listEnv("CHECKLIST_EMAIL_JH"); if (!jh.length) { const e = userEmail(d, /\bjen(nifer)?\b/i); if (e) jh.push(e); }
  const lou = listEnv("CHECKLIST_EMAIL_LOU"); if (!lou.length) { const e = userEmail(d, /\badam\b/i); if (e) lou.push(e); }
  const recap = listEnv("CHECKLIST_RECAP_TO"); if (!recap.length) { listEnv("BACKUP_EMAIL_TO").forEach((e) => recap.push(e)); jh.forEach((e) => recap.includes(e) || recap.push(e)); }
  /* Store-specific weekly recaps: Nashville stores (HQ + Church St) → Kelly, Louisville → Adam (11/9, Jennifer's request). */
  const kelly = listEnv("CHECKLIST_RECAP_NBC"); if (!kelly.length) { const e = userEmail(d, /\bkelly\b/i); if (e) kelly.push(e); }
  const louRecap = listEnv("CHECKLIST_RECAP_LOU"); if (!louRecap.length) lou.forEach((e) => louRecap.push(e));
  return { jh, lou, recap, recapNbc: kelly, recapLou: louRecap, forLoc: (loc) => (isLouisville(loc) ? lou : jh) };
}

// Checklist items for a store/kind/date (Daily Task = that weekday's items; Bathrooms = day 7).
export function itemsFor(d, loc, kind, dstr) {
  const all = (d.duties || []).filter((x) => x && !x._del && locSame(x.loc, loc));
  if (kind === "clean") return all.filter((x) => x.kind === "clean" && (x.day == null ? 0 : +x.day) === dowOf(dstr));
  if (kind === "bath") return all.filter((x) => x.kind === "clean" && +x.day === BATH_DAY);
  return all.filter((x) => x.kind === kind);
}
export function checksFor(d, loc, kind, dstr) {
  const k = kind === "bath" ? "clean" : kind;
  return (d.dutyChecks || []).filter((c) => c && c.kind === k && c.date === dstr && locSame(c.loc, loc));
}
// {total, done, complete, by:[names], last:ts, rows:[{text,by,ts}]}
export function status(d, loc, kind, dstr) {
  if (kind === "slush") { const cs = checksFor(d, loc, "slush", dstr); return { total: 1, done: cs.length ? 1 : 0, complete: cs.length > 0, by: [...new Set(cs.map((c) => c.by).filter(Boolean))], last: Math.max(0, ...cs.map((c) => +c.ts || 0)), rows: cs.map((c) => ({ text: "Slushie machine cleaned", by: c.by, ts: c.ts })) }; }
  const items = itemsFor(d, loc, kind, dstr); const cs = checksFor(d, loc, kind, dstr); const byItem = {};
  cs.forEach((c) => { byItem[c.itemId] = c; });
  const rows = items.sort((a, b) => (a.ord || 0) - (b.ord || 0)).map((it) => ({ text: it.text, by: byItem[it.id] && byItem[it.id].by, ts: byItem[it.id] && byItem[it.id].ts }));
  const doneRows = rows.filter((r) => r.ts);
  return { total: items.length, done: doneRows.length, complete: items.length > 0 && doneRows.length === items.length, by: [...new Set(doneRows.map((r) => r.by).filter(Boolean))], last: Math.max(0, ...doneRows.map((r) => +r.ts || 0)), rows };
}
// Stores that have duty checklists (from the duties themselves, collapsed by name).
export function dutyStores(d) {
  const out = []; for (const x of d.duties || []) { if (!x || x._del || !x.loc) continue; if (!out.some((l) => locSame(l, x.loc))) out.push(x.loc); }
  for (const c of d.dutyChecks || []) { if (c && c.kind === "slush" && c.loc && !out.some((l) => locSame(l, c.loc))) out.push(c.loc); }
  return out;
}
export const hasSlush = (loc) => !/warehouse/i.test(loc) && (/church/i.test(loc) || /\bhq\b|headquarter|fessler|nashville barrel/i.test(loc));

export async function sendMail(to, subject, html) {
  to = (to || []).filter(okEmail); if (!to.length) return { skipped: "no_recipient" };
  const key = (process.env.RESEND_API_KEY || "").trim(); if (!key) return { skipped: "no_resend_key" };
  const from = (process.env.CHECKLIST_FROM || process.env.TASK_FROM || process.env.SALES_FROM || "Mikey Systems <sales@nashvillebarrelco.com>").trim();
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to, subject, html }) });
  return r.ok ? { ok: true } : { ok: false, status: r.status, detail: (await r.text()).slice(0, 200) };
}
export function wrap(title, inner, foot) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f3ede2;padding:14px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#231a12">
<div style="max-width:640px;width:100%;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(60,40,15,.08)">
<div style="background:#231a12;color:#f3ede2;padding:15px 18px;font-weight:700;font-size:17px">${esc(title)}</div>
<div style="padding:16px 18px">${inner}</div>
<div style="padding:12px 18px;background:#faf6ee;color:#8a7a63;font-size:12px">${foot || "Sent automatically by Mikey Systems."}</div></div></body></html>`;
}
export const DAYNAMES = DAYS;
