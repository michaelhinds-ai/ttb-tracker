// Every 15 minutes: if someone with a Square scheduled shift hasn't clocked in
// within the grace window (default 15 min) after their start, email the people
// listed in the app (settings.lateEmailTo) — each missed shift only once a day.
//
// Env: RESEND_API_KEY, BACKUP_WS (workspace code[s]), optional LATE_FROM /
// BACKUP_FROM, optional LATE_EMAIL_TO fallback, plus SQUARE_* vars.
import { getStore } from "@netlify/blobs";
import { allLate, lateEmailHTML } from "./lib/lateness.mjs";
import { env as sqEnv, dayRange, todayInTz } from "./lib/square.mjs";
import { sendDigestEmail } from "./lib/salesdigest.mjs";

async function settingsFor(wsCodes) {
  let to = new Set(), threshold = 15, on = true;
  (process.env.LATE_EMAIL_TO || "").split(",").map((s) => s.trim()).filter(Boolean).forEach((e) => to.add(e));
  if (wsCodes.length) {
    const store = getStore({ name: "ttb-data", consistency: "strong" });
    for (const code of wsCodes) {
      try {
        const d = await store.get(`ws_${code}`, { type: "json" });
        const s = (d && d.settings) || {};
        String(s.lateEmailTo || "").split(",").map((x) => x.trim()).filter(Boolean).forEach((e) => to.add(e));
        if (s.lateThresholdMin) threshold = Math.max(1, +s.lateThresholdMin || 15);
        if (s.lateAlertOn === false) on = false;
      } catch {}
    }
  }
  return { to: [...to], threshold, on };
}

export default async (req) => {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const from = (process.env.LATE_FROM || process.env.BACKUP_FROM || "onboarding@resend.dev").trim();
  const wsCodes = (process.env.BACKUP_WS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!apiKey) return new Response("no api key", { status: 200 });

  const { to, threshold, on } = await settingsFor(wsCodes);
  if (!on || !to.length) return new Response("disabled or no recipients", { status: 200 });

  const tz = sqEnv().tz;
  // Quiet hours: don't check overnight.
  const hour = +new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date());
  if (hour < 5 || hour >= 23) return new Response("quiet hours", { status: 200 });

  const ymd = todayInTz(tz);
  const { startISO, endISO } = dayRange(ymd, tz);
  let result;
  try { result = await allLate(startISO, endISO, threshold); }
  catch (e) { console.error("clockin-alert failed", e && e.message); return new Response("check failed", { status: 200 }); }
  const rows = result.rows || [];
  if (result.errors && result.errors.length) console.warn("clockin-alert account errors:", result.errors.join(" | "));
  if (!rows.length) return new Response("nobody late", { status: 200 });

  // De-dup: only email a given scheduled shift once per day.
  const store = getStore({ name: "late-alerts", consistency: "strong" });
  const key = `notified_${ymd}`;
  let notified = [];
  try { notified = (await store.get(key, { type: "json" })) || []; } catch {}
  const fresh = rows.filter((r) => !notified.includes(r.id));
  if (!fresh.length) return new Response("already notified", { status: 200 });

  const html = lateEmailHTML(fresh, threshold, tz);
  const names = fresh.map((r) => r.name).join(", ");
  try { await sendDigestEmail({ to, from, apiKey, subject: `⏰ Missed clock-in: ${names}`, html }); }
  catch (e) { console.error("clockin-alert send failed", e && e.message); return new Response("send failed", { status: 200 }); }
  try { await store.setJSON(key, notified.concat(fresh.map((r) => r.id))); } catch {}
  return new Response("alerted " + fresh.length, { status: 200 });
};

export const config = { schedule: "*/15 * * * *" };
