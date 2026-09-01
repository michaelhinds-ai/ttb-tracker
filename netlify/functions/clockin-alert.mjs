// Every 15 minutes: if someone with a Square scheduled shift hasn't clocked in
// within the grace window (default 15 min) after their start, email the people
// listed in the app (settings.lateEmailTo) — each missed shift only once a day.
//
// Env: RESEND_API_KEY, BACKUP_WS (workspace code[s]), optional LATE_FROM /
// BACKUP_FROM, optional LATE_EMAIL_TO fallback, plus SQUARE_* vars.
import { getStore } from "@netlify/blobs";
import { allLate, lateEmailHTML, allClockStatus, overstayEmailHTML, lateArrivalEmailHTML } from "./lib/lateness.mjs";
import { env as sqEnv, dayRange, todayInTz } from "./lib/square.mjs";
import { sendDigestEmail } from "./lib/salesdigest.mjs";

async function settingsFor(wsCodes) {
  let to = new Set(), byLoc = {}, threshold = 15, on = true;
  (process.env.LATE_EMAIL_TO || "").split(",").map((s) => s.trim()).filter(Boolean).forEach((e) => to.add(e));
  if (wsCodes.length) {
    const store = getStore({ name: "ttb-data", consistency: "strong" });
    for (const code of wsCodes) {
      try {
        const d = await store.get(`ws_${code}`, { type: "json" });
        const s = (d && d.settings) || {};
        String(s.lateEmailTo || "").split(",").map((x) => x.trim()).filter(Boolean).forEach((e) => to.add(e));
        if (s.lateEmailByLoc && typeof s.lateEmailByLoc === "object") {
          for (const k of Object.keys(s.lateEmailByLoc)) {
            const v = String(s.lateEmailByLoc[k] || "").trim();
            if (v) byLoc[k] = byLoc[k] ? byLoc[k] + "," + v : v;
          }
        }
        if (s.lateThresholdMin) threshold = Math.max(1, +s.lateThresholdMin || 15);
        if (s.lateAlertOn === false) on = false;
      } catch {}
    }
  }
  return { to: [...to], byLoc, threshold, on };
}
// Recipients for a missed shift at `locName`: the catch-all list PLUS anyone
// mapped to that location (name-tolerant so "Church S" matches "Church Street").
function recipientsForLoc(locName, globalTo, byLoc) {
  const set = new Set(globalTo);
  const nz = (x) => String(x || "").trim().toLowerCase();
  const target = nz(locName);
  for (const k of Object.keys(byLoc)) {
    const kk = nz(k);
    if (kk && target && (kk === target || kk.startsWith(target) || target.startsWith(kk) || kk.indexOf(target) >= 0 || target.indexOf(kk) >= 0)) {
      String(byLoc[k]).split(",").map((x) => x.trim()).filter(Boolean).forEach((e) => set.add(e));
    }
  }
  return [...set];
}

export default async (req) => {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const from = (process.env.LATE_FROM || process.env.BACKUP_FROM || "onboarding@resend.dev").trim();
  const wsCodes = (process.env.BACKUP_WS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!apiKey) return new Response("no api key", { status: 200 });

  const { to, byLoc, threshold, on } = await settingsFor(wsCodes);
  if (!on) return new Response("disabled", { status: 200 });
  if (!to.length && !Object.keys(byLoc).length) return new Response("no recipients", { status: 200 });

  const tz = sqEnv().tz;
  // Quiet hours: don't check overnight.
  const hour = +new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date());
  if (hour < 5 || hour >= 23) return new Response("quiet hours", { status: 200 });

  const ymd = todayInTz(tz);
  const { startISO, endISO } = dayRange(ymd, tz);

  // De-dup store: only email a given shift/event once per day.
  const store = getStore({ name: "late-alerts", consistency: "strong" });
  const key = `notified_${ymd}`;
  let notified = [];
  try { notified = (await store.get(key, { type: "json" })) || []; } catch {}
  const sentIds = [];

  // Group `rows` by location and email each store's own recipients (plus the
  // catch-all). Rows already emailed today are skipped. Returns groups sent.
  async function emailGroups(rows, mkHtml, subjPrefix) {
    const fresh = rows.filter((r) => !notified.includes(r.id));
    if (!fresh.length) return 0;
    const groups = {};
    for (const r of fresh) { const k = r.location || ""; (groups[k] = groups[k] || []).push(r); }
    let sent = 0;
    for (const loc of Object.keys(groups)) {
      const rowsL = groups[loc];
      const recips = recipientsForLoc(loc, to, byLoc);
      if (!recips.length) continue; // nobody configured for this store — leave it for once it is
      const html = mkHtml(rowsL);
      const names = rowsL.map((r) => r.name).join(", ");
      const subject = `${subjPrefix}${loc ? " — " + loc : ""}: ${names}`;
      try { await sendDigestEmail({ to: recips, from, apiKey, subject, html }); sentIds.push(...rowsL.map((r) => r.id)); sent++; }
      catch (e) { console.error("clockin-alert send failed for", loc, e && e.message); }
    }
    return sent;
  }

  // 1) Missed clock-ins (scheduled but not clocked in within the grace window).
  let lateRows = [];
  try { const r = await allLate(startISO, endISO, threshold); lateRows = r.rows || []; if (r.errors && r.errors.length) console.warn("clockin-alert late errors:", r.errors.join(" | ")); }
  catch (e) { console.error("allLate failed", e && e.message); }
  const g1 = await emailGroups(lateRows, (rowsL) => lateEmailHTML(rowsL, threshold, tz), "⏰ Missed clock-in");

  // Pull enriched clock status once — drives both overstay and late-arrival alerts.
  let statusRows = [];
  try { const r = await allClockStatus(startISO, endISO); statusRows = r.rows || []; if (r.errors && r.errors.length) console.warn("clockin-alert status errors:", r.errors.join(" | ")); }
  catch (e) { console.error("allClockStatus failed", e && e.message); }

  // 2) Overstays — still clocked in `threshold`+ minutes past their scheduled end.
  const overRows = statusRows.filter((x) => x.open && x.overMin != null && x.overMin >= threshold).map((x) => ({ ...x, id: "over_" + x.id }));
  const g2 = await emailGroups(overRows, (rowsL) => overstayEmailHTML(rowsL, threshold, tz), "🕒 Still clocked in past end");

  // 3) Late arrivals — clocked in, but `threshold`+ minutes after their scheduled start.
  const lateInRows = statusRows.filter((x) => x.lateInMin != null && x.lateInMin >= threshold).map((x) => ({ ...x, id: "latein_" + x.id }));
  const g3 = await emailGroups(lateInRows, (rowsL) => lateArrivalEmailHTML(rowsL, threshold, tz), "⏰ Clocked in late");

  if (sentIds.length) { try { await store.setJSON(key, notified.concat(sentIds)); } catch {} }
  return new Response(`missed ${g1}, overstay ${g2}, late-in ${g3} group(s), ${sentIds.length} notified`, { status: 200 });
};

export const config = { schedule: "*/15 * * * *" };
