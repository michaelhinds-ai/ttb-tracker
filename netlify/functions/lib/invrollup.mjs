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
  const cats = (data.invCats || []).filter((c) => c && !c._del).sort((a, b) => ((a.ord || 0) - (b.ord || 0)) || String(a.name || "").localeCompare(String(b.name || "")));
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
    const its = items.filter((it) => it.catId === c.id).sort((a, b) => ((a.ord || 0) - (b.ord || 0)) || String(a.name || "").localeCompare(String(b.name || "")));
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
