import { getStore } from "@netlify/blobs";

// Daily emailed backup of the Mikey Systems workspace(s).
// Runs on a schedule (see config.schedule below) AND can be triggered manually
// by visiting /.netlify/functions/backup-email to test.
//
// Required Netlify environment variables:
//   BACKUP_EMAIL_TO   the destination inbox, e.g. michael.hinds@gmail.com
//   BACKUP_WS         your workspace code(s) from Setup & Sync (comma-separated for more than one)
//   RESEND_API_KEY    a Resend API key (re_...) — never put this in the repo or chat
// Optional:
//   BACKUP_FROM       from-address (default onboarding@resend.dev; works when you signed up to Resend with BACKUP_EMAIL_TO)

export default async (req) => {
  const to = (process.env.BACKUP_EMAIL_TO || "").trim();
  const wsCodes = (process.env.BACKUP_WS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const from = (process.env.BACKUP_FROM || "onboarding@resend.dev").trim();

  if (!to || !wsCodes.length || !apiKey) {
    const missing = [!to && "BACKUP_EMAIL_TO", !wsCodes.length && "BACKUP_WS", !apiKey && "RESEND_API_KEY"].filter(Boolean).join(", ");
    console.log("backup-email not configured — missing:", missing);
    return new Response("not_configured: " + missing, { status: 200 });
  }

  const date = new Date().toISOString().slice(0, 10);
  const store = getStore({ name: "ttb-data", consistency: "strong" });

  const items = [];
  for (const code of wsCodes) {
    let data = null;
    try { data = await store.get(`ws_${code}`, { type: "json" }); } catch (e) { console.error("blob read failed for", code, e && e.message); }
    items.push({ code, data });
  }

  const { subject, html, attachments } = buildEmail(items, date);

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, attachments }),
  });
  if (!r.ok) {
    const t = await r.text();
    console.error("resend error", r.status, t.slice(0, 400));
    return new Response("email_failed: " + r.status, { status: 500 });
  }
  return new Response("sent " + attachments.length + " attachment(s) to " + to, { status: 200 });
};

// Pure builder — no network/blobs — so it can be unit-tested.
export function buildEmail(items, date) {
  const attachments = [];
  const lines = [];
  for (const { code, data } of items) {
    if (!data) { lines.push(`${code}: (no data found)`); continue; }
    const name = (data.settings && data.settings.name) || code;
    const json = JSON.stringify(data);
    const content = Buffer.from(json, "utf8").toString("base64");
    attachments.push({ filename: `mikey-backup-${slug(name)}-${date}.json`, content });
    lines.push(`${name} — ${counts(data)}`);
  }
  const subject = `Mikey Systems backup — ${date}`;
  const html =
    `<div style="font-family:-apple-system,Segoe UI,sans-serif;color:#241812">` +
    `<h2 style="margin:0 0 8px">Mikey Systems — daily backup</h2>` +
    `<p style="margin:0 0 12px;color:#6b543c">${date}</p>` +
    `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` +
    `<p style="color:#6b543c">The attached <b>.json</b> is a full restore point. To restore it, open the app → <b>Setup &amp; Sync</b> → <b>Restore from Backup</b> and choose the file.</p>` +
    `</div>`;
  return { subject, html, attachments };
}

function counts(d) {
  const n = (a) => (Array.isArray(d[a]) ? d[a].length : 0);
  return `${n("barrels")} barrels, ${n("bottlings")} bottlings, ${n("orders")} orders, ${n("entries")} ledger entries`;
}
function slug(s) { return String(s || "ws").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "ws"; }
function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

// Daily at 11:00 UTC (~6am Central). Change the cron to adjust; weekly would be "0 11 * * 1".
export const config = { schedule: "0 11 * * *" };
