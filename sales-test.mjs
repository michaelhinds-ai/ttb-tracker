// On-demand sales digest — lets the app's "Send test" button email the same
// report right now (today's numbers) so an admin can preview it.
// POST { to, date? }  ->  emails the digest to `to` for `date` (default today).
import { fullDigest, renderDigestHTML, sendDigestEmail } from "./lib/salesdigest.mjs";
import { env as sqEnv, todayInTz, json } from "./lib/square.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const from = (process.env.SALES_FROM || process.env.BACKUP_FROM || "onboarding@resend.dev").trim();
  if (!apiKey) return json({ ok: false, error: "no_api_key", detail: "RESEND_API_KEY is not set in Netlify." }, 200);

  let p = {}; try { p = await req.json(); } catch { p = {}; }
  const to = String(p.to || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!to.length) return json({ ok: false, error: "no_recipient", detail: "Enter at least one email address." }, 200);

  const tz = sqEnv().tz;
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(p.date || "") ? p.date : todayInTz(tz);
  let rows = [];
  try { const dig = await fullDigest(ymd, ymd); rows = dig.rows || []; }
  catch (e) { return json({ ok: false, error: "square_failed", detail: String((e && e.message) || e) }, 200); }
  const html = renderDigestHTML(rows, ymd, tz);
  const total = rows.reduce((s, r) => s + r.sales, 0);
  const subject = `Daily Sales (test) — ${new Date(ymd + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} — $${(total / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  try { await sendDigestEmail({ to, from, apiKey, subject, html }); }
  catch (e) { return json({ ok: false, error: "send_failed", detail: String((e && e.message) || e) }, 200); }
  return json({ ok: true, sentTo: to, date: ymd, locations: rows.length, totalCents: total }, 200);
};

export const config = { path: "/api/sales/test" };
