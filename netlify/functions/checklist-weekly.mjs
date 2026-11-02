// Sunday morning: recap of last week's (Sun–Sat) store checklists — per store, which days each
// checklist was finished, partly done or missed, plus who left lists unfinished.
// Recipients: CHECKLIST_RECAP_TO, else BACKUP_EMAIL_TO + Jennifer (see lib/checklists.mjs).
import { KINDS, DAYNAMES, esc, todayIn, addDays, fmtDay, loadRoot, recipients, status, dutyStores, hasSlush, sendMail, wrap } from "./lib/checklists.mjs";

export function recapHTML(d, start) {
  const days = [...Array(7)].map((_, i) => addDays(start, i));
  const stores = dutyStores(d); const people = {}; const P = (n) => (people[n] = people[n] || { items: 0, done: [], partial: [] });
  let body = `<p style="margin:0 0 14px;font-size:15px">Week of <b>${esc(fmtDay(days[0]))} – ${esc(fmtDay(days[6]))}</b>. ✓ finished · <span style="color:#b26b00">n/N</span> partly done · <span style="color:#b3261e">✗</span> not started.</p>`;
  for (const loc of stores) {
    const missed = []; let rowsHtml = "";
    for (const K of KINDS.filter((k) => k.k !== "slush")) {
      let cells = ""; let any = false;
      for (const dstr of days) {
        const st = status(d, loc, K.k, dstr);
        st.rows.forEach((r) => { if (r.by) P(r.by).items++; });
        let c;
        if (!st.total) c = `<td style="text-align:center;color:#bbb">–</td>`;
        else { any = true;
          if (st.complete) { c = `<td style="text-align:center;color:#1b7a3a;font-weight:700" title="${esc(st.by.join(", "))}">✓</td>`; st.by.forEach((n) => P(n).done.push(`${K.label} ${DAYNAMES[new Date(dstr + "T12:00:00Z").getUTCDay()].slice(0, 3)}`)); }
          else if (st.done) { c = `<td style="text-align:center;color:#b26b00;font-weight:700">${st.done}/${st.total}</td>`; missed.push(`${K.label} ${fmtDay(dstr)} (${st.done}/${st.total})`); st.by.forEach((n) => P(n).partial.push(`${loc} · ${K.label} ${fmtDay(dstr)} (${st.done}/${st.total})`)); }
          else { c = `<td style="text-align:center;color:#b3261e;font-weight:700">✗</td>`; missed.push(`${K.label} ${fmtDay(dstr)}`); }
        }
        cells += c;
      }
      if (any) rowsHtml += `<tr><td style="padding:6px 8px;font-weight:600;white-space:nowrap">${esc(K.label)}</td>${cells}</tr>`;
    }
    let slush = "";
    if (hasSlush(loc)) { const hit = days.map((dstr) => ({ dstr, st: status(d, loc, "slush", dstr) })).filter((x) => x.st.complete);
      slush = hit.length ? `<p style="margin:8px 0 0;font-size:14px">🍧 Slushie machine cleaned: ${hit.map((x) => `${esc(fmtDay(x.dstr))}${x.st.by.length ? " (" + esc(x.st.by.join(", ")) + ")" : ""}`).join(", ")}</p>`
        : `<p style="margin:8px 0 0;font-size:14px;color:#b3261e;font-weight:700">🍧 Slushie machine: not marked cleaned this week</p>`;
      if (!hit.length) missed.push("Slushie machine (weekly)"); }
    if (!rowsHtml && !slush) continue;
    body += `<h3 style="margin:18px 0 6px;font-size:16px">${esc(loc)}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #eee"><tr style="background:#faf6ee"><th style="text-align:left;padding:6px 8px">Checklist</th>${days.map((x) => `<th style="padding:6px 4px;font-size:12px">${DAYNAMES[new Date(x + "T12:00:00Z").getUTCDay()].slice(0, 3)}<br><span style="font-weight:400;color:#8a7a63">${+x.slice(8)}</span></th>`).join("")}</tr>${rowsHtml}</table>${slush}
      ${missed.length ? `<p style="margin:8px 0 0;font-size:14px"><b style="color:#b3261e">Not finished (${missed.length}):</b> ${missed.map(esc).join(" · ")}</p>` : `<p style="margin:8px 0 0;font-size:14px;color:#1b7a3a;font-weight:700">Every checklist finished all week 👏</p>`}`;
  }
  const names = Object.keys(people).sort((a, b) => people[b].items - people[a].items);
  if (names.length) {
    body += `<h3 style="margin:22px 0 6px;font-size:16px">By employee</h3><table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #eee"><tr style="background:#faf6ee"><th style="text-align:left;padding:6px 8px">Name</th><th style="padding:6px 8px">Items checked</th><th style="padding:6px 8px">Lists finished</th><th style="text-align:left;padding:6px 8px">Left unfinished</th></tr>`
      + names.map((n) => { const p = people[n]; return `<tr><td style="padding:6px 8px;border-top:1px solid #eee;font-weight:600">${esc(n)}</td><td style="text-align:center;border-top:1px solid #eee">${p.items}</td><td style="text-align:center;border-top:1px solid #eee">${p.done.length}</td><td style="padding:6px 8px;border-top:1px solid #eee;font-size:13px;color:${p.partial.length ? "#b26b00" : "#8a7a63"}">${p.partial.length ? p.partial.map(esc).join("<br>") : "—"}</td></tr>`; }).join("") + `</table>
      <p style="margin:6px 0 0;font-size:12px;color:#8a7a63">“Left unfinished” = they checked items on a list that was never completed that day. A ✗ (nothing checked) can't be tied to a person — compare it with who was scheduled.</p>`;
  } else body += `<p style="color:#b3261e;font-weight:700">No checklist items were checked off at any store last week.</p>`;
  return { html: wrap("Weekly checklist recap", body), start: days[0], end: days[6] };
}

export async function runWeekly({ dry = false, start = null } = {}) {
  const d = await loadRoot();
  const today = todayIn("America/Chicago");
  const dow = new Date(today + "T12:00:00Z").getUTCDay();
  const s = start || addDays(today, -dow - 7); // the Sunday that began last week
  const r = recapHTML(d, s); const to = recipients(d).recap;
  if (dry) return { ok: true, dry: true, to: to.length, start: r.start, end: r.end, html: r.html };
  const res = await sendMail(to, `📋 Weekly checklist recap — ${fmtDay(r.start)} – ${fmtDay(r.end)}`, r.html);
  return { ok: true, start: r.start, end: r.end, ...res };
}

export default async () => { const r = await runWeekly(); console.log(JSON.stringify(r).slice(0, 1000)); return new Response("ok"); };
export const config = { schedule: "0 14 * * 0" }; // Sundays 8 AM CST / 9 AM CDT
