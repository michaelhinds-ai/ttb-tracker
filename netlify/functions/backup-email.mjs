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
  // Mobile-friendly: viewport meta, fluid max-width container, readable font, list reflows.
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;background:#f3ede2;padding:14px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#241812;-webkit-text-size-adjust:100%">` +
    `<div style="max-width:600px;width:100%;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(60,40,15,.08)">` +
    `<div style="background:#231a12;color:#f3ede2;padding:15px 18px;font-weight:700;font-size:17px">Mikey Systems &middot; Daily backup</div>` +
    `<div style="padding:16px 18px">` +
    `<div style="color:#6b543c;font-size:14px;margin:0 0 12px">${esc(date)}</div>` +
    `<div style="font-size:15px;line-height:1.6">${lines.map((l) => `<div style="padding:7px 0;border-bottom:1px solid #eee">${esc(l)}</div>`).join("")}</div>` +
    `<p style="color:#6b543c;font-size:13px;line-height:1.6;margin:14px 0 0">The attached <b>.json</b> is a full restore point. To restore it, open the app &rarr; <b>Setup &amp; Sync</b> &rarr; <b>Restore from Backup</b> and choose the file.</p>` +
    `</div></div></body></html>`;
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
