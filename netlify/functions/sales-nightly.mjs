// Nightly Square sales email — per location, with each employee's transaction
// count and average ticket. Recipients come from the in-app admin field
// (settings.salesEmailTo) for the workspace(s) in BACKUP_WS, with an optional
// SALES_EMAIL_TO env fallback. Runs ~9 PM Eastern (01:00 UTC).
//
// Env used: RESEND_API_KEY, BACKUP_WS (workspace code[s]), optional SALES_FROM
// / BACKUP_FROM (from-address), optional SALES_EMAIL_TO (extra recipients),
// plus the SQUARE_* vars the digest reads.
import { getStore } from "@netlify/blobs";
import { fullDigest, renderDigestHTML, sendDigestEmail } from "./lib/salesdigest.mjs";
import { env as sqEnv, todayInTz } from "./lib/square.mjs";

async function recipientsFor(wsCodes) {
  const set = new Set();
  const envTo = (process.env.SALES_EMAIL_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
  envTo.forEach((e) => set.add(e));
  if (wsCodes.length) {
    const store = getStore({ name: "ttb-data", consistency: "strong" });
    for (const code of wsCodes) {
      try {
        const data = await store.get(`ws_${code}`, { type: "json" });
        const to = (data && data.settings && data.settings.salesEmailTo) || "";
        String(to).split(",").map((s) => s.trim()).filter(Boolean).forEach((e) => set.add(e));
      } catch (e) { /* skip a workspace we can't read */ }
    }
  }
  return [...set];
}

export default async (req) => {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const from = (process.env.SALES_FROM || process.env.BACKUP_FROM || "onboarding@resend.dev").trim();
  const wsCodes = (process.env.BACKUP_WS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!apiKey) { console.error("sales-nightly: RESEND_API_KEY missing"); return new Response("no api key", { status: 200 }); }

  const to = await recipientsFor(wsCodes);
  if (!to.length) { console.log("sales-nightly: no recipients (set salesEmailTo in the app or SALES_EMAIL_TO)"); return new Response("no recipients", { status: 200 }); }

  const tz = sqEnv().tz;
  const ymd = todayInTz(tz);
  let rows = [];
  try { const dig = await fullDigest(ymd); rows = dig.rows || []; if (dig.errors && dig.errors.length) console.warn("sales-nightly account errors:", dig.errors.join(" | ")); } catch (e) { console.error("sales-nightly digest failed", e && e.message); }
  const html = renderDigestHTML(rows, ymd, tz);
  const total = rows.reduce((s, r) => s + r.sales, 0);
  const subject = `Daily Sales — ${new Date(ymd + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} — $${(total / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  try { await sendDigestEmail({ to, from, apiKey, subject, html }); }
  catch (e) { console.error("sales-nightly send failed", e && e.message); return new Response("send failed", { status: 200 }); }
  console.log("sales-nightly sent to", to.length, "recipient(s)");
  return new Response("ok", { status: 200 });
};

export const config = { schedule: "0 1 * * *" };
