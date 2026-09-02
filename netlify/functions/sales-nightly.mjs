// Nightly Square sales email — per location, with each employee's transaction
// count and average ticket. Recipients come from the in-app admin fields for the
// workspace(s) in BACKUP_WS: settings.salesEmailTo (the "everyone/owners" list,
// who get the FULL report) and settings.salesEmailByLoc ({location: emails}, who
// get just that store's numbers). Optional SALES_EMAIL_TO env adds to the full
// list. Runs ~9 PM Eastern (01:00 UTC).
//
// Env: RESEND_API_KEY, BACKUP_WS (workspace code[s]), optional SALES_FROM /
// BACKUP_FROM (from-address), optional SALES_EMAIL_TO, plus the SQUARE_* vars.
import { getStore } from "@netlify/blobs";
import { fullDigest, renderDigestHTML, sendDigestEmail } from "./lib/salesdigest.mjs";
import { env as sqEnv, todayInTz } from "./lib/square.mjs";

async function recipientsFor(wsCodes) {
  const to = new Set(), byLoc = {};
  (process.env.SALES_EMAIL_TO || "").split(",").map((s) => s.trim()).filter(Boolean).forEach((e) => to.add(e));
  if (wsCodes.length) {
    const store = getStore({ name: "ttb-data", consistency: "strong" });
    for (const code of wsCodes) {
      try {
        const data = await store.get(`ws_${code}`, { type: "json" });
        const s = (data && data.settings) || {};
        String(s.salesEmailTo || "").split(",").map((x) => x.trim()).filter(Boolean).forEach((e) => to.add(e));
        if (s.salesEmailByLoc && typeof s.salesEmailByLoc === "object") {
          for (const k of Object.keys(s.salesEmailByLoc)) {
            const v = String(s.salesEmailByLoc[k] || "").trim();
            if (v) byLoc[k] = byLoc[k] ? byLoc[k] + "," + v : v;
          }
        }
      } catch (e) { /* skip a workspace we can't read */ }
    }
  }
  return { to: [...to], byLoc };
}
// Prefix-tolerant location match ("Church S" ~ "Church Street").
function locMatch(a, b) { a = String(a || "").trim().toLowerCase(); b = String(b || "").trim().toLowerCase(); if (!a || !b) return false; return a === b || a.startsWith(b) || b.startsWith(a) || a.indexOf(b) >= 0 || b.indexOf(a) >= 0; }
function emailsList(v) { return String(v || "").split(",").map((s) => s.trim()).filter(Boolean); }

export default async (req) => {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const from = (process.env.SALES_FROM || process.env.BACKUP_FROM || "onboarding@resend.dev").trim();
  const wsCodes = (process.env.BACKUP_WS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!apiKey) { console.error("sales-nightly: RESEND_API_KEY missing"); return new Response("no api key", { status: 200 }); }

  const { to, byLoc } = await recipientsFor(wsCodes);
  if (!to.length && !Object.keys(byLoc).length) { console.log("sales-nightly: no recipients (set salesEmailTo / salesEmailByLoc in the app or SALES_EMAIL_TO)"); return new Response("no recipients", { status: 200 }); }

  const tz = sqEnv().tz;
  const ymd = todayInTz(tz);
  let rows = [];
  try { const dig = await fullDigest(ymd, ymd); rows = dig.rows || []; if (dig.errors && dig.errors.length) console.warn("sales-nightly account errors:", dig.errors.join(" | ")); } catch (e) { console.error("sales-nightly digest failed", e && e.message); }
  const dateLbl = new Date(ymd + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const dollars = (cents) => "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  let sent = 0;

  // 1) Full report → the everyone/owners list.
  if (to.length) {
    const total = rows.reduce((s, r) => s + r.sales, 0);
    try { await sendDigestEmail({ to, from, apiKey, subject: `Daily Sales — ${dateLbl} — ${dollars(total)}`, html: renderDigestHTML(rows, ymd, tz) }); sent++; }
    catch (e) { console.error("sales-nightly full send failed", e && e.message); }
  }

  // 2) Per-location report → each store's own recipients.
  for (const loc of Object.keys(byLoc)) {
    const recips = emailsList(byLoc[loc]);
    if (!recips.length) continue;
    const locRows = rows.filter((r) => locMatch(r.location, loc));
    const total = locRows.reduce((s, r) => s + r.sales, 0);
    const label = (locRows[0] && locRows[0].location) || loc;
    try { await sendDigestEmail({ to: recips, from, apiKey, subject: `Daily Sales — ${label} — ${dateLbl} — ${dollars(total)}`, html: renderDigestHTML(locRows, ymd, tz) }); sent++; }
    catch (e) { console.error("sales-nightly loc send failed for", loc, e && e.message); }
  }

  console.log("sales-nightly sent", sent, "email(s)");
  return new Response("sent " + sent, { status: 200 });
};

export const config = { schedule: "0 1 * * *" };
