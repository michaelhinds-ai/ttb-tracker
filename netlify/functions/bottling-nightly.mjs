// End-of-day Bottling Log email. Production logs bottling runs (with a photo of a finished bottle) on
// the Bottling Log tab; a manager approves them in Bottling. Every evening this emails the day's
// entries for each company — numbers, who logged it, approval status and the bottle photo.
// Recipients: settings.bottleEmailTo in each company workspace (falls back to the root workspace's
// bottleEmailTo, then salesEmailTo). Env: RESEND_API_KEY, optional BOTTLING_FROM / SALES_FROM / BACKUP_FROM.
import { getStore } from "@netlify/blobs";
import { ROOT_WS, COMPANY_WS } from "./lib/companies.mjs";

const COS = [
  { ws: ROOT_WS, name: "Louisville Rickhouse Whiskey Co" },
  { ws: COMPANY_WS.nbc, name: "Nashville Barrel Co" },
];
const emails = (v) => String(v || "").split(/[,;\s]+/).map((s) => s.trim()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const n = (v, d = 0) => (+v || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
function ymdIn(tz, d = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); }

export default async (req) => {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const from = (process.env.BOTTLING_FROM || process.env.SALES_FROM || process.env.BACKUP_FROM || "onboarding@resend.dev").trim();
  const site = (process.env.URL || "https://lrwc-ttb-tracker.netlify.app").replace(/\/$/, "");
  if (!apiKey) { console.error("bottling-nightly: RESEND_API_KEY missing"); return new Response("no api key", { status: 200 }); }
  const store = getStore({ name: "ttb-data", consistency: "strong" });
  const root = (await store.get(`ws_${ROOT_WS}`, { type: "json" }).catch(() => null)) || {};
  const rs = root.settings || {};
  const tz = "America/New_York";
  const today = ymdIn(tz);
  const dayAgo = Date.now() - 26 * 3600 * 1000;
  let sent = 0;
  for (const co of COS) {
    const data = co.ws === ROOT_WS ? root : ((await store.get(`ws_${co.ws}`, { type: "json" }).catch(() => null)) || {});
    const s = data.settings || {};
    const to = emails(s.bottleEmailTo).length ? emails(s.bottleEmailTo) : (emails(rs.bottleEmailTo).length ? emails(rs.bottleEmailTo) : emails(rs.salesEmailTo));
    if (!to.length) continue;
    const subs = (data.bottleSubs || []).filter((x) => x && !x._del && ((+x.ts || 0) >= dayAgo || ymdIn(tz, new Date(+x.ts || 0)) === today || ((+x.approvedAt || 0) >= dayAgo)));
    if (!subs.length) continue;
    subs.sort((a, b) => (+a.ts || 0) - (+b.ts || 0));
    const coName = s.name || co.name;
    const tb = subs.reduce((t, x) => t + (+x.bottles || 0), 0), tpg = subs.reduce((t, x) => t + (+x.pg || 0), 0);
    const pend = subs.filter((x) => x.status === "pending").length;
    const pill = (x) => x.status === "approved" ? `<span style="background:#e6f2e6;color:#2f7a3f;padding:2px 8px;border-radius:99px;font-size:12px">approved${x.approvedBy ? " by " + esc(x.approvedBy) : ""}</span>` : x.status === "rejected" ? `<span style="background:#fbe3dc;color:#b3261e;padding:2px 8px;border-radius:99px;font-size:12px">rejected${x.rejectReason ? " — " + esc(x.rejectReason) : ""}</span>` : `<span style="background:#fdf0dc;color:#9a5b12;padding:2px 8px;border-radius:99px;font-size:12px">waiting for approval</span>`;
    const rows = subs.map((x) => {
      const img = x.photoId ? `${site}/api/docs?ws=${encodeURIComponent(co.ws)}&id=${encodeURIComponent(x.photoId)}` : "";
      return `<tr><td style="padding:10px;border-bottom:1px solid #eee;vertical-align:top;width:96px">${img ? `<a href="${img}"><img src="${img}" width="86" style="border-radius:6px;display:block"></a>` : '<div style="color:#999;font-size:12px">no photo</div>'}</td>
        <td style="padding:10px;border-bottom:1px solid #eee;vertical-align:top;font-size:14px"><b>${n(x.bottles)} bottles</b> · ${n(x.proof, 1)} proof · ${n(x.qty)} barrel${+x.qty === 1 ? "" : "s"} · ${n(x.pg, 1)} PG<br>
        ${esc(x.spirit || "")}${x.barrelNo ? " · #" + esc(x.barrelNo) : ""}${x.distillDate ? " · distilled " + esc(x.distillDate) : ""}<br>
        <span style="color:#777;font-size:12px">Bottled ${esc(x.date || "")} · logged by ${esc(x.by || "—")}</span> ${pill(x)}
        ${x.customer ? `<div style="font-size:13px;margin-top:4px">Customer: <b>${esc(x.customer)}</b></div>` : ""}${x.notes ? `<div style="font-size:13px;color:#5a4a36;margin-top:4px">“${esc(x.notes)}”</div>` : ""}</td></tr>`;
    }).join("");
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:680px;margin:auto;color:#231a12">
      <h2 style="margin:0 0 4px">Bottling Log — ${esc(coName)}</h2>
      <div style="color:#6b543c;margin-bottom:14px">${esc(today)} · ${subs.length} entr${subs.length === 1 ? "y" : "ies"} · ${n(tb)} bottles · ${n(tpg, 1)} PG${pend ? ` · <b style="color:#9a5b12">${pend} waiting for approval</b>` : ""}</div>
      <table style="width:100%;border-collapse:collapse">${rows}</table>
      <p style="font-size:12px;color:#8a7a66;margin-top:16px">Approve or reject entries in Mikey Systems → Bottling. Only approved entries are official (removed from inventory).</p></div>`;
    try {
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ from, to, subject: `Bottling Log — ${coName} — ${today} — ${n(tb)} bottles${pend ? ` (${pend} to approve)` : ""}`, html }) });
      if (!r.ok) throw new Error("resend " + r.status + ": " + (await r.text()).slice(0, 200));
      sent++;
    } catch (e) { console.error("bottling-nightly send failed for", coName, e && e.message); }
  }
  console.log("bottling-nightly sent", sent);
  return new Response("sent " + sent, { status: 200 });
};
export const config = { schedule: "0 1 * * *" };
