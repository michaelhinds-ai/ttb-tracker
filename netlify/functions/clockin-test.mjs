// On-demand check for the app's "Test clock-in alert" button. Runs the same
// detection now (ignoring the once-a-day de-dup) and reports what it found; if
// `to` is given it also emails the result so you can confirm delivery.
// POST { to?, threshold? }
import { allLate, lateEmailHTML } from "./lib/lateness.mjs";
import { sendDigestEmail } from "./lib/salesdigest.mjs";
import { env as sqEnv, dayRange, todayInTz, json } from "./lib/square.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let p = {}; try { p = await req.json(); } catch {}
  const threshold = Math.max(1, +p.threshold || 15);
  const tz = sqEnv().tz;
  const ymd = todayInTz(tz);
  const { startISO, endISO } = dayRange(ymd, tz);

  let result;
  try { result = await allLate(startISO, endISO, threshold); }
  catch (e) { return json({ ok: false, error: "check_failed", detail: String((e && e.message) || e) }, 200); }
  const rows = result.rows || [];
  const schedulingError = (result.errors || []).find((e) => /scheduled-shifts|404|403|BAD_REQUEST|not.*found/i.test(e));

  const to = String(p.to || "").split(",").map((s) => s.trim()).filter(Boolean);
  let emailed = false, emailErr = null;
  if (to.length) {
    const apiKey = (process.env.RESEND_API_KEY || "").trim();
    const from = (process.env.LATE_FROM || process.env.BACKUP_FROM || "onboarding@resend.dev").trim();
    if (!apiKey) emailErr = "RESEND_API_KEY not set in Netlify.";
    else {
      const html = rows.length
        ? lateEmailHTML(rows, threshold, tz)
        : `<div style="font-family:sans-serif;padding:16px">✅ Clock-in alert test — everyone with a scheduled shift so far has clocked in (checked ${new Date().toLocaleString("en-US", { timeZone: tz })}).</div>`;
      try { await sendDigestEmail({ to, from, apiKey, subject: rows.length ? `⏰ Missed clock-in (test): ${rows.map((r) => r.name).join(", ")}` : "Clock-in alert test — all clear", html }); emailed = true; }
      catch (e) { emailErr = String((e && e.message) || e); }
    }
  }
  return json({ ok: true, date: ymd, threshold, lateCount: rows.length, late: rows.map((r) => ({ name: r.name, location: r.location, minutesLate: r.minutesLate })), emailed, emailError: emailErr, schedulingError: schedulingError || null, errors: result.errors || [] }, 200);
};
export const config = { path: "/api/clockin/test" };
