// All-stores inventory rollup — one master item list, each item flagged with the stores that
// carry it (item.locs; empty = every store). Builds per-store and across-store totals from the
// live counts (state.invCounts = each store's most recent count) and reports which stores have
// / haven't submitted in the window. Used by the Monday rollup email and the "Send now" button.
// The in-app "All stores" screen mirrors this logic (index.html → invRollupData).
export const SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];
export const DEFAULT_LOCS = ["NBC HQ", "Church St", "Louisville Rickhouse"];

function norm(s) { return String(s || "").trim().toLowerCase().replace(/\b(hq|headquarters)\b/g, " ").replace(/\s+/g, " ").trim(); }
function acronym(s) { return norm(s).split(/[\s\-]+/).filter(Boolean).map((w) => w[0]).join(""); }
export function locMatch(a, b) {
  a = norm(a); b = norm(b); if (!a || !b) return false;
  if (a === b || a.startsWith(b) || b.startsWith(a) || a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return true;
  const ia = acronym(a), ib = acronym(b);
  return (ia.length > 1 && ia === b) || (ib.length > 1 && ib === a);
}
export function shortLoc(l) {
  const n = norm(l);
  if (/church/.test(n)) return "Church";
  if (/louisville|rickhouse|^lr$/.test(n)) return "LR";
  if (/nbc|nashville barrel/.test(n) || n === "") return "HQ";
  return String(l).length > 8 ? String(l).slice(0, 7) + "…" : String(l);
}
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

export function buildRollup(data, opts = {}) {
  const now = opts.now || Date.now();
  const windowDays = opts.windowDays || 7;
  const since = now - windowDays * 86400000;
  const locs = (Array.isArray(data.invLocs) && data.invLocs.filter(Boolean).length) ? data.invLocs.filter(Boolean) : DEFAULT_LOCS.slice();
  const canon = (l) => locs.find((x) => locMatch(x, l)) || l;
  const cats = (data.invCats || []).filter((c) => c && !c._del).sort((a, b) => String(a.name || "").trim().localeCompare(String(b.name || "").trim(), "en", { sensitivity: "base", numeric: true }));
  const items = (data.invItems || []).filter((it) => it && !it._del && it.active !== false);
  // count lookup: loc|itemId|size → qty
  // Last COUNTED value per store/item/size (newest ts wins). Deliberately ignores the app's
  // post-submit blank-sheet reset, so a submitted count stays in the totals until recounted.
  const qty = new Map();
  for (const r of data.invCounts || []) {
    if (!r || r._del || r.qty == null) continue;
    const k = canon(r.loc) + "|" + r.itemId + "|" + (r.size || "");
    const ex = qty.get(k);
    if (!ex || (+r.ts || 0) > (+ex.ts || 0)) qty.set(k, r);
  }
  const q = (loc, id, size) => { const r = qty.get(loc + "|" + id + "|" + (size || "")); return r ? (+r.qty || 0) : null; };
  const carries = (it, loc) => !it.locs || !it.locs.length || it.locs.some((l) => locMatch(l, loc));

  const locTotals = Object.fromEntries(locs.map((l) => [l, 0]));
  let grand = 0;
  const groups = [];
  for (const c of cats) {
    const its = items.filter((it) => it.catId === c.id).sort((a, b) => String(a.name || "").trim().localeCompare(String(b.name || "").trim(), "en", { sensitivity: "base", numeric: true }));
    if (!its.length) continue;
    const rows = [];
    for (const it of its) {
      const at = locs.filter((l) => carries(it, l));
      if (!at.length) continue;
      const row = { id: it.id, name: it.name || "", desc: it.desc || "", apparel: !!it.apparel, at, byLoc: {}, total: 0, sizes: null };
      if (it.apparel) {
        row.sizes = SIZES.map((sz) => {
          const s = { size: sz, byLoc: {}, total: 0 };
          for (const l of at) { const v = q(l, it.id, sz); s.byLoc[l] = v; s.total += v || 0; }
          return s;
        });
        for (const l of at) { let t = 0, any = false; for (const s of row.sizes) { if (s.byLoc[l] != null) { any = true; t += s.byLoc[l]; } } row.byLoc[l] = any ? t : null; }
      } else {
        for (const l of at) row.byLoc[l] = q(l, it.id, "");
      }
      for (const l of at) { const v = row.byLoc[l] || 0; row.total += v; locTotals[l] += v; }
      grand += row.total;
      rows.push(row);
    }
    if (rows.length) groups.push({ cat: c.name || "", rows });
  }

  // Submission status per store.
  const status = locs.map((l) => {
    const subs = (data.invSubs || []).filter((s) => s && locMatch(s.loc, l)).sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
    const last = subs[0] || null;
    const lastT = last ? Date.parse(last.at || last.countDate || "") : NaN;
    return { loc: l, submitted: !!(last && !isNaN(lastT) && lastT >= since), lastAt: last ? (last.at || null) : null, lastDate: last ? (last.countDate || last.week || null) : null, by: last ? (last.by || "") : "" };
  });
  return { locs, groups, locTotals, grand, status, since, now, windowDays };
}

function fmtDay(iso) {
  if (!iso) return "";
  const t = Date.parse(String(iso).length <= 10 ? iso + "T12:00:00" : iso);
  if (isNaN(t)) return String(iso);
  return new Date(t).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago" });
}
const n = (v) => (v == null ? "–" : String(v));

// Mobile-first: max-width 600px, fluid, no flexbox, compact numeric columns (store codes + Total).
export function renderRollupHTML(r, opts = {}) {
  const title = opts.title || "Weekly Inventory — All Stores";
  const dateLbl = new Date(r.now).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
  const missing = r.status.filter((s) => !s.submitted);
  const th = "padding:6px 4px;font-size:11px;color:#8a7358;text-align:right;font-weight:700;white-space:nowrap";
  const td = "padding:6px 4px;font-size:13px;text-align:right;white-space:nowrap";
  const cols = r.locs.map((l) => `<th style="${th}">${esc(shortLoc(l))}</th>`).join("") + `<th style="${th};color:#231a12">Total</th>`;

  const statusRows = r.status.map((s) => {
    const ok = s.submitted;
    const line = ok ? `Submitted ${esc(fmtDay(s.lastAt))}${s.by ? " by " + esc(s.by) : ""}` : (s.lastAt ? `NOT SUBMITTED — using last count (${esc(fmtDay(s.lastAt))})` : "NOT SUBMITTED — no count on file");
    return `<tr><td style="padding:6px 0;font-size:14px;font-weight:700">${ok ? "✅" : "⚠️"} ${esc(s.loc)}</td></tr><tr><td style="padding:0 0 8px 24px;font-size:12px;color:${ok ? "#5c6b4f" : "#b3261e"};${ok ? "" : "font-weight:700"}">${line}</td></tr>`;
  }).join("");

  const totalsRow = `<tr>${r.locs.map((l) => `<td style="${td};font-weight:800">${r.locTotals[l]}</td>`).join("")}<td style="${td};font-weight:800;color:#7a5a2b">${r.grand}</td></tr>`;

  let body = "";
  for (const g of r.groups) {
    body += `<tr><td colspan="${r.locs.length + 2}" style="padding:14px 4px 4px;font-size:12px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:#7a5a2b;border-bottom:2px solid #e6dccb">${esc(g.cat)}</td></tr>`;
    for (const row of g.rows) {
      const cells = r.locs.map((l) => `<td style="${td};color:${row.at.includes(l) ? "#231a12" : "#c9bba5"}">${row.at.includes(l) ? n(row.byLoc[l]) : "·"}</td>`).join("");
      body += `<tr style="border-bottom:1px solid #f0e8da"><td style="padding:6px 4px;font-size:13px;font-weight:600;word-break:break-word">${esc(row.name)}</td>${cells}<td style="${td};font-weight:800">${row.total}</td></tr>`;
      if (row.apparel) {
        for (const s of row.sizes) {
          const sc = r.locs.map((l) => `<td style="${td};font-size:12px;color:${row.at.includes(l) ? "#5a4a36" : "#c9bba5"}">${row.at.includes(l) ? n(s.byLoc[l]) : "·"}</td>`).join("");
          body += `<tr><td style="padding:3px 4px 3px 18px;font-size:12px;color:#8a7358">${s.size}</td>${sc}<td style="${td};font-size:12px;font-weight:700">${s.total}</td></tr>`;
        }
      }
    }
  }

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;background:#f3ede2;padding:14px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#231a12;-webkit-text-size-adjust:100%">
<div style="max-width:600px;width:100%;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(60,40,15,.08)">
  <div style="background:#2b1d12;color:#f3e6cf;padding:16px 16px">
    <div style="font-size:18px;font-weight:800">${esc(title)}</div>
    <div style="font-size:12px;opacity:.8;margin-top:3px">${esc(dateLbl)} · counts from the last ${r.windowDays} days</div>
  </div>
  <div style="padding:14px 14px 4px">
    ${missing.length ? `<div style="background:#fdecea;border-left:4px solid #b3261e;padding:10px 12px;border-radius:6px;font-size:13px;margin-bottom:12px"><b>${missing.length} store${missing.length > 1 ? "s" : ""} did not submit:</b> ${missing.map((s) => esc(s.loc)).join(", ")}. Their last count is used in the totals below.</div>` : `<div style="background:#eaf4e6;border-left:4px solid #2f7a3f;padding:10px 12px;border-radius:6px;font-size:13px;margin-bottom:12px"><b>All stores submitted.</b></div>`}
    <table role="presentation" style="width:100%;border-collapse:collapse">${statusRows}</table>
  </div>
  <div style="padding:4px 10px 16px">
    <table style="width:100%;border-collapse:collapse;table-layout:auto">
      <thead><tr><th style="${th};text-align:left">Units on hand</th>${cols}</tr></thead>
      <tbody><tr><td style="padding:6px 4px;font-size:13px;font-weight:800">All items</td>${totalsRow.replace(/^<tr>|<\/tr>$/g, "")}</tr>${body}</tbody>
    </table>
    <div style="font-size:11px;color:#8a7358;margin-top:12px">· = not carried at that store &nbsp; – = carried but not counted</div>
  </div>
  <div style="padding:10px 16px 16px;font-size:11px;color:#8a7358;border-top:1px solid #f0e8da">Mikey Systems · weekly inventory rollup</div>
</div></body></html>`;
}

export function renderRollupText(r) {
  let t = `Weekly Inventory — All Stores\n\n`;
  for (const s of r.status) t += `${s.submitted ? "OK " : "MISSING "} ${s.loc}${s.lastAt ? " (last " + fmtDay(s.lastAt) + ")" : ""}\n`;
  t += `\nTotals: ${r.locs.map((l) => shortLoc(l) + " " + r.locTotals[l]).join(" · ")} · All ${r.grand}\n`;
  for (const g of r.groups) {
    t += `\n${g.cat.toUpperCase()}\n`;
    for (const row of g.rows) {
      t += `${row.name}: ${row.at.map((l) => shortLoc(l) + " " + n(row.byLoc[l])).join(", ")} = ${row.total}\n`;
      if (row.apparel) for (const s of row.sizes) t += `   ${s.size}: ${row.at.map((l) => shortLoc(l) + " " + n(s.byLoc[l])).join(", ")} = ${s.total}\n`;
    }
  }
  return t + `\n— Mikey Systems`;
}

export function rollupSubject(r) {
  const miss = r.status.filter((s) => !s.submitted).length;
  const d = new Date(r.now).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
  return `Inventory — All Stores — ${d}${miss ? ` — ${miss} store${miss > 1 ? "s" : ""} missing` : ""}`;
}

export function emailsList(v) { return String(v || "").split(/[,;\s]+/).map((s) => s.trim()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)); }

export async function sendRollup(data, { apiKey, from, to, now } = {}) {
  const r = buildRollup(data, { now });
  const recips = to && to.length ? to : emailsList(data.settings && data.settings.invRollupTo);
  if (!recips.length) return { ok: true, skipped: "no_recipient", rollup: r };
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: "Bearer " + apiKey, "content-type": "application/json" },
    body: JSON.stringify({ from, to: recips, subject: rollupSubject(r), html: renderRollupHTML(r), text: renderRollupText(r) }),
  });
  const j = await resp.json().catch(() => ({}));
  if (!resp.ok) return { ok: false, error: (j && (j.message || j.name)) || ("HTTP " + resp.status) };
  return { ok: true, id: j.id || null, to: recips, missing: r.status.filter((s) => !s.submitted).map((s) => s.loc) };
}

// ── "Inventory not done" alert ────────────────────────────────────────────────────────────
// Wednesday 10 AM Central (5 h before the 3 PM rollup): every store that hasn't submitted a count
// since last Wednesday's 3 PM rollup gets an e-mail to its store manager(s) — app users with the
// Retail Manager role ("retail") assigned to that store, with an e-mail on file. No manager e-mail →
// falls back to that store's reorder recipient (settings.invEmailByLoc[store] / invEmailTo).
const okEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || "").trim());
export function storeManagers(data, loc) {
  const users = ((data.auth && data.auth.users) || []).filter((u) => u && !u._del && u.role === "retail" && okEmail(u.email));
  const at = (u) => (Array.isArray(u.locations) && u.locations.length ? u.locations : [u.location]).filter(Boolean);
  const mgrs = users.filter((u) => at(u).some((l) => locMatch(l, loc)));
  let to = [...new Set(mgrs.map((u) => String(u.email).trim()))];
  const names = mgrs.map((u) => u.name || "");
  if (!to.length) { const s = data.settings || {}; const fb = String(((s.invEmailByLoc || {})[loc]) || s.invEmailTo || "").split(/[,;]\s*/).map((x) => x.trim()).filter(okEmail); to = fb; }
  return { to, names };
}
export function reminderPlan(data, now = Date.now()) {
  const r = buildRollup(data, { now, windowDays: 7 - 5 / 24 }); // since last Wednesday 3 PM
  return r.status.filter((s) => !s.submitted).map((s) => ({ loc: s.loc, lastAt: s.lastAt, ...storeManagers(data, s.loc) }));
}
export async function sendReminders(data, { apiKey, from, now = Date.now(), dry = false, appUrl = "https://lrwc-ttb-tracker.netlify.app/" } = {}) {
  const plan = reminderPlan(data, now);
  // One e-mail per person: someone who manages several behind stores gets a single list.
  const byTo = new Map(); const out = [];
  for (const p of plan) {
    if (!p.to.length) { out.push({ loc: p.loc, skipped: "no_recipient" }); continue; }
    for (const e of p.to) { const k = e.toLowerCase(); if (!byTo.has(k)) byTo.set(k, { to: e, stores: [] }); byTo.get(k).stores.push(p); }
  }
  for (const { to, stores } of byTo.values()) {
    const names = stores.map((p) => p.loc);
    const one = stores.length === 1;
    const subject = `Inventory not done — ${names.join(", ")} — due today by 3 PM`;
    const rows = stores.map((p) => `<tr><td style="padding:6px 0;font-size:14px;font-weight:700">⚠️ ${esc(p.loc)}</td><td style="padding:6px 0 6px 12px;font-size:13px;color:#6b5a45;text-align:right">last count: ${esc(p.lastAt ? fmtDay(p.lastAt) : "never")}</td></tr>`).join("");
    const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#231a12">
      <div style="background:#fdecea;border-left:4px solid #b3261e;padding:12px 14px;border-radius:6px">
        <div style="font-size:16px;font-weight:800">${one ? esc(names[0]) + " hasn’t" : stores.length + " stores haven’t"} submitted this week’s inventory</div>
        <table style="width:100%;border-collapse:collapse;margin-top:6px">${rows}</table>
        <div style="font-size:14px;margin-top:8px">The all-stores rollup goes out <b>today at 3 PM Central</b>. Please get ${one ? "the count" : "the counts"} done and hit <b>Submit</b> in Store Inventory before then.</div>
      </div>
      <p style="margin:14px 0"><a href="${esc(appUrl)}" style="background:#7a5a2b;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:700;display:inline-block">Open Mikey Systems</a></p>
      <p style="font-size:12px;color:#8a7a63">Automatic reminder from Mikey Systems — sent Wednesdays at 10 AM to store managers whose store hasn’t submitted since last Wednesday’s rollup.</p></div>`;
    const text = `Inventory not submitted this week: ${stores.map((p) => p.loc + " (last count " + (p.lastAt ? fmtDay(p.lastAt) : "never") + ")").join("; ")}. The rollup goes out today at 3 PM Central — please count and Submit in Store Inventory before then. ${appUrl}`;
    if (dry) { out.push({ to, stores: names, dry: true }); continue; }
    const resp = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: "Bearer " + apiKey, "content-type": "application/json" }, body: JSON.stringify({ from, to: [to], subject, html, text }) });
    const j = await resp.json().catch(() => ({}));
    out.push(resp.ok ? { to, stores: names, id: j.id || null } : { to, stores: names, error: (j && (j.message || j.name)) || "HTTP " + resp.status });
  }
  return { ok: true, due: plan.length, results: out };
}
