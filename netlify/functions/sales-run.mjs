// Manual, on-demand run of the SAME job the nightly sales email uses — so an
// admin can test it without waiting for 9 PM. It reads recipients the exact way
// the scheduled job does (from settings.salesEmailTo in the BACKUP_WS
// workspace, plus the optional SALES_EMAIL_TO env), then sends and reports what
// it found. GET or POST /api/sales/run.
import { getStore } from "@netlify/blobs";
import { fullDigest, renderDigestHTML, sendDigestEmail } from "./lib/salesdigest.mjs";
import { env as sqEnv, todayInTz, json } from "./lib/square.mjs";

async function recipientsFor(wsCodes) {
  const set = new Set(), byLoc = {};
  (process.env.SALES_EMAIL_TO || "").split(",").map((s) => s.trim()).filter(Boolean).forEach((e) => set.add(e));
  let wsHadSettings = false;
  if (wsCodes.length) {
    const store = getStore({ name: "ttb-data", consistency: "strong" });
    for (const code of wsCodes) {
      try {
        const data = await store.get(`ws_${code}`, { type: "json" });
        const s = (data && data.settings) || {};
        if (data && data.settings) wsHadSettings = true;
        String(s.salesEmailTo || "").split(",").map((x) => x.trim()).filter(Boolean).forEach((e) => set.add(e));
        if (s.salesEmailByLoc && typeof s.salesEmailByLoc === "object") {
          for (const k of Object.keys(s.salesEmailByLoc)) { const v = String(s.salesEmailByLoc[k] || "").trim(); if (v) byLoc[k] = byLoc[k] ? byLoc[k] + "," + v : v; }
        }
      } catch (e) { /* skip */ }
    }
  }
  return { list: [...set], byLoc, wsHadSettings };
}
function locMatch(a, b) { a = String(a || "").trim().toLowerCase(); b = String(b || "").trim().toLowerCase(); if (!a || !b) return false; return a === b || a.startsWith(b) || b.startsWith(a) || a.indexOf(b) >= 0 || b.indexOf(a) >= 0; }
function emailsList(v) { return String(v || "").split(",").map((s) => s.trim()).filter(Boolean); }

export default async () => {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const from = (process.env.SALES_FROM || process.env.BACKUP_FROM || "onboarding@resend.dev").trim();
  const wsCodes = (process.env.BACKUP_WS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const backupWsSet = wsCodes.length > 0;
  if (!apiKey) return json({ ok: false, error: "no_api_key", detail: "RESEND_API_KEY is not set in Netlify.", backupWsSet }, 200);

  const { list: to, byLoc, wsHadSettings } = await recipientsFor(wsCodes);
  if (!to.length && !Object.keys(byLoc).length) {
    return json({
      ok: false,
      error: "no_recipients",
      backupWsSet,
      wsFound: wsHadSettings,
      detail: backupWsSet
        ? (wsHadSettings
            ? "BACKUP_WS points to a workspace, but it has no recipients saved (owners list or per-location). Save recipients in the app, then run again."
            : "BACKUP_WS is set, but no workspace data was found for that code — it's likely pointing at the wrong/old workspace code. Update BACKUP_WS to your current sync code.")
        : "BACKUP_WS is not set in Netlify, so the nightly job has no recipient list. Set BACKUP_WS to your workspace code.",
    }, 200);
  }

  const tz = sqEnv().tz;
  const ymd = todayInTz(tz);
  let rows = [];
  try { const dig = await fullDigest(ymd, ymd); rows = dig.rows || []; }
  catch (e) { return json({ ok: false, error: "square_failed", detail: String((e && e.message) || e) }, 200); }
  const dateLbl = new Date(ymd + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const dollars = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const sentTo = [];
  try {
    if (to.length) { const total = rows.reduce((s, r) => s + r.sales, 0); await sendDigestEmail({ to, from, apiKey, subject: `Daily Sales — ${dateLbl} — ${dollars(total)}`, html: renderDigestHTML(rows, ymd, tz) }); to.forEach((e) => sentTo.push(e)); }
    for (const loc of Object.keys(byLoc)) {
      const recips = emailsList(byLoc[loc]); if (!recips.length) continue;
      const locRows = rows.filter((r) => locMatch(r.location, loc)); const total = locRows.reduce((s, r) => s + r.sales, 0);
      const label = (locRows[0] && locRows[0].location) || loc;
      await sendDigestEmail({ to: recips, from, apiKey, subject: `Daily Sales — ${label} — ${dateLbl} — ${dollars(total)}`, html: renderDigestHTML(locRows, ymd, tz) });
      recips.forEach((e) => sentTo.push(e + " (" + label + ")"));
    }
  } catch (e) { return json({ ok: false, error: "send_failed", detail: String((e && e.message) || e) }, 200); }
  return json({ ok: true, sentTo, locations: rows.length }, 200);
};
export const config = { path: "/api/sales/run" };
