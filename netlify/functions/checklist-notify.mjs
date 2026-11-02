// Every 10 minutes: e-mail each newly completed checklist (see lib/checklists.mjs for who gets what).
// Each completion is sent once (keys kept in Blobs store "checklist-notify"). The first run only
// records what already exists, so turning this on doesn't flood inboxes with history.
import { getStore } from "@netlify/blobs";
import { KINDS, esc, locSame, tzFor, todayIn, addDays, fmtDay, fmtTime, loadRoot, recipients, status, dutyStores, hasSlush, sendMail, wrap } from "./lib/checklists.mjs";

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
const recent = (iso, days) => { const t = typeof iso === "number" ? iso : Date.parse(iso || ""); return t && Date.now() - t < days * 86400000; };

export function collect(d) {
  const R = recipients(d); const ev = [];
  // Store Inventory + Supplies Checklist (both recorded in invSubs) → Jennifer
  for (const s of d.invSubs || []) {
    if (!s || s._del || !recent(s.at || s._upd, 3)) continue;
    const supply = s.kind === "supply";
    let inner;
    if (supply) {
      const li = (arr) => (arr || []).map((n) => `<li style="margin:2px 0">${esc(n)}</li>`).join("");
      inner = `<p style="margin:0 0 10px;font-size:15px"><b>${esc(s.by || "Someone")}</b> submitted the <b>Supplies Checklist</b> for <b>${esc(s.loc)}</b> · ${esc(fmtTime(Date.parse(s.at), s.loc))}</p>`
        + ((s.deliver || []).length ? `<div style="font-weight:700;margin-top:8px">Order &amp; deliver to ${esc(s.loc)} · ${(s.deliver || []).length}</div><ul style="margin:4px 0 0;padding-left:20px">${li(s.deliver)}</ul>` : "")
        + ((s.hq || []).length ? `<div style="font-weight:700;margin-top:8px">Pick up from HQ · ${(s.hq || []).length}</div><ul style="margin:4px 0 0;padding-left:20px">${li(s.hq)}</ul>` : "")
        + (!(s.deliver || []).length && !(s.hq || []).length ? `<p style="margin:0;color:#5a4a36">${+s.count || 0} item(s) marked.</p>` : "");
    } else {
      const lines = (s.lines || []).filter((l) => +l.qty || (l.sizes && Object.values(l.sizes).some((v) => +v)));
      const rows = lines.slice(0, 80).map((l) => { const q = +l.qty || Object.values(l.sizes || {}).reduce((a, v) => a + (+v || 0), 0); return `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:14px">${esc(l.item || l.desc || "")}${l.cat ? ` <span style="color:#8a7a63;font-size:12px">· ${esc(l.cat)}</span>` : ""}</td><td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:700">${q}</td></tr>`; }).join("");
      inner = `<p style="margin:0 0 10px;font-size:15px"><b>${esc(s.by || "Someone")}</b> submitted the <b>Store Inventory</b> count for <b>${esc(s.loc)}</b> (${esc(s.countDate || s.week || "")}) · ${esc(fmtTime(Date.parse(s.at), s.loc))}</p>
        <p style="margin:0 0 10px;color:#5a4a36">${(s.lines || []).length} items · ${+s.totalUnits || 0} units total${(s.pickup || []).length ? ` · pick-up list of ${(s.pickup || []).length}` : ""}</p>`
        + (rows ? `<table style="width:100%;border-collapse:collapse">${rows}</table>${lines.length > 80 ? `<p style="color:#8a7a63">…and ${lines.length - 80} more</p>` : ""}` : "");
    }
    const title = (supply ? "Supplies Checklist" : "Store Inventory") + " · " + s.loc;
    ev.push({ key: "inv:" + s.id, to: R.jh, subject: "✅ " + title + " submitted" + (s.by ? " by " + s.by : ""), html: wrap(title, inner) });
  }
  // Joy Ride → Jennifer, every entry
  for (const j of d.joyRides || []) {
    if (!j || j._del || !recent(j.ts || j._upd, 3)) continue;
    const inner = `<p style="margin:0 0 10px;font-size:15px">New Joy Ride entry at <b>${esc(j.byLoc || "Church St")}</b> — one $${+j.amount || 5} envelope given.</p>
      <table style="border-collapse:collapse;font-size:15px">
      <tr><td style="padding:4px 12px 4px 0;color:#8a7a63">Date</td><td><b>${esc(fmtDay(j.date))}</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#8a7a63">Driver</td><td><b>${esc(j.driver)}</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#8a7a63">Guests</td><td><b>${esc(j.guests)}</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#8a7a63">Entered by</td><td>${esc(j.byName || "")} · ${esc(fmtTime(j.ts, j.byLoc))}</td></tr></table>`;
    ev.push({ key: "jr:" + j.id, to: R.jh, subject: `🚐 Joy Ride — ${j.driver || "driver"} · ${j.guests || 0} guest${+j.guests === 1 ? "" : "s"}`, html: wrap("Joy Ride", inner) });
  }
  // Opening / Closing / Daily Task / Bathrooms / Slushie — each store, today + yesterday (store time)
  for (const loc of dutyStores(d)) {
    const today = todayIn(tzFor(loc));
    for (const dstr of [addDays(today, -1), today]) {
      for (const K of KINDS) {
        if (K.k === "slush" && !hasSlush(loc)) continue;
        const st = status(d, loc, K.k, dstr); if (!st.complete) continue;
        const rows = st.rows.map((r) => `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:14px">✓ ${esc(r.text)}</td><td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:13px;color:#5a4a36;white-space:nowrap">${esc(r.by || "")} ${esc(fmtTime(r.ts, loc))}</td></tr>`).join("");
        const inner = `<p style="margin:0 0 10px;font-size:15px"><b>${esc(K.label)}</b> checklist completed at <b>${esc(loc)}</b> — ${esc(fmtDay(dstr))}, finished ${esc(fmtTime(st.last, loc))} by ${esc(st.by.join(", ") || "—")}.</p><table style="width:100%;border-collapse:collapse">${rows}</table>`;
        ev.push({ key: `d:${norm(loc)}:${K.k}:${dstr}`, to: R.forLoc(loc), subject: `✅ ${K.label} done — ${loc} · ${fmtDay(dstr)}`, html: wrap(`${K.label} · ${loc}`, inner) });
      }
    }
  }
  return ev;
}

export async function runNotify({ dry = false } = {}) {
  const d = await loadRoot(); const ev = collect(d);
  const st = getStore({ name: "checklist-notify", consistency: "strong" });
  const sent = (await st.get("sent", { type: "json" })) || null;
  const map = (sent && sent.s) || {};
  const fresh = ev.filter((e) => !map[e.key]);
  if (dry) return { ok: true, dry: true, initialized: !!sent, pending: fresh.map((e) => ({ key: e.key, to: e.to.length })) };
  const now = Date.now(); const out = [];
  if (!sent) { ev.forEach((e) => { map[e.key] = now; }); out.push({ initialized: true, marked: ev.length }); }
  else {
    for (const e of fresh) {
      let r; try { r = await sendMail(e.to, e.subject, e.html); } catch (x) { r = { ok: false, detail: String(x) }; }
      if (r.ok || r.skipped) map[e.key] = now; // a failed send retries on the next run
      out.push({ key: e.key, ...r });
    }
  }
  for (const k of Object.keys(map)) if (now - map[k] > 21 * 86400000) delete map[k];
  await st.setJSON("sent", { s: map, at: new Date().toISOString() });
  return { ok: true, results: out };
}

export default async () => { const r = await runNotify(); console.log(JSON.stringify(r).slice(0, 2000)); return new Response("ok"); };
export const config = { schedule: "*/10 * * * *" };
