// Clock-in tardiness detection. Compares Square SCHEDULED shifts against actual
// worked shifts (clock-ins). A scheduled shift whose start is more than
// `thresholdMin` minutes in the past with no matching clock-in = late.
import { accounts, sqFor, apiBase } from "./square.mjs";

// The Scheduled Shifts API needs a recent Square version; pin one for that call
// so it works even if the account's default SQUARE_VERSION is older.
const SCHED_VERSION = "2024-12-18";
async function schedFetch(acct, path, body) {
  const r = await fetch(apiBase(acct.environment) + path, {
    method: "POST",
    headers: { "Authorization": "Bearer " + acct.token, "Square-Version": SCHED_VERSION, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  if (!r.ok) { const e = new Error("sched " + r.status + ": " + t.slice(0, 200)); e.status = r.status; throw e; }
  return j;
}

async function teamNames(acct) {
  const map = {}; let cursor = null;
  for (let i = 0; i < 5; i++) {
    let r; try { r = await sqFor(acct, "/v2/team-members/search", { method: "POST", body: cursor ? { cursor } : {} }); } catch { break; }
    for (const t of (r && r.team_members) || []) map[t.id] = [t.given_name, t.family_name].filter(Boolean).join(" ").trim() || t.email_address || t.id;
    cursor = r && r.cursor; if (!cursor) break;
  }
  return map;
}
async function locNames(acct) {
  const map = {};
  try { const r = await sqFor(acct, "/v2/locations"); for (const l of (r && r.locations) || []) map[l.id] = l.name || l.id; } catch {}
  return map;
}

function detailsOf(ss) { return ss.published_shift_details || ss.draft_shift_details || ss; }

// Late scheduled shifts for one account, for the local day window [startISO,endISO).
// Returns [{ id, name, teamMemberId, location, startAt, minutesLate }].
export async function accountLate(acct, startISO, endISO, thresholdMin) {
  const locIds = Object.keys(await locNames(acct));
  const [tm, loc] = await Promise.all([teamNames(acct), locNames(acct)]);
  // Scheduled shifts in the window.
  let scheduled = [];
  const sres = await schedFetch(acct, "/v2/labor/scheduled-shifts/search", {
    query: { filter: { location_ids: locIds.length ? locIds : undefined, start: { start_at: startISO, end_at: endISO } } },
    limit: 200,
  });
  scheduled = (sres && sres.scheduled_shifts) || [];
  // Actual worked shifts (clock-ins) in the window.
  let worked = [];
  try {
    const wres = await sqFor(acct, "/v2/labor/shifts/search", { method: "POST", body: { query: { filter: { location_ids: locIds.length ? locIds : undefined, start: { start_at: startISO, end_at: endISO } } }, limit: 200 } });
    worked = (wres && wres.shifts) || [];
  } catch { worked = []; }
  const now = Date.now();
  const out = [];
  for (const ss of scheduled) {
    const d = detailsOf(ss);
    if (d.is_deleted) continue;
    const tmId = d.team_member_id; const startAt = d.start_at;
    if (!tmId || !startAt) continue;
    const startMs = Date.parse(startAt);
    if (!(startMs <= now)) continue;                    // shift hasn't started yet
    if (now - startMs > 8 * 3600 * 1000) continue;       // too old to care
    if (now - startMs < thresholdMin * 60 * 1000) continue; // still inside the grace window
    // Did this person clock in anywhere around this shift?
    const clockedIn = worked.some((w) => {
      if (w.team_member_id !== tmId) return false;
      const ws = Date.parse(w.start_at || "");
      return isFinite(ws) && ws >= startMs - 90 * 60 * 1000 && ws <= now + 5 * 60 * 1000;
    });
    if (clockedIn) continue;
    out.push({ id: ss.id || (tmId + "|" + startAt), name: tm[tmId] || tmId, teamMemberId: tmId, location: loc[d.location_id] || d.location_id || "", startAt, minutesLate: Math.round((now - startMs) / 60000) });
  }
  return out;
}

// Across all accounts. Bubbles a per-account error up as { error } so the caller
// can tell "scheduling not available" from "nobody late".
export async function allLate(startISO, endISO, thresholdMin) {
  const accts = accounts();
  const results = await Promise.all(accts.map(async (a) => {
    try { return { rows: await accountLate(a, startISO, endISO, thresholdMin) }; }
    catch (e) { return { error: String((e && e.message) || e), status: e && e.status }; }
  }));
  const rows = results.flatMap((r) => r.rows || []);
  const errors = results.filter((r) => r.error).map((r) => r.error);
  return { rows, errors };
}

export function lateEmailHTML(rows, thresholdMin, tz) {
  const when = new Date().toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const items = rows.map((r) => `<tr style="border-top:1px solid #efe7d9"><td style="padding:8px 14px;font-weight:600">${escp(r.name)}</td><td style="padding:8px 14px">${escp(r.location)}</td><td style="padding:8px 14px">${new Date(r.startAt).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })}</td><td style="padding:8px 14px;text-align:right;color:#b23b3b;font-weight:700">${r.minutesLate} min late</td></tr>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#f3ede1;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#2a2118"><div style="max-width:560px;margin:0 auto;padding:20px">
    <h1 style="font-size:19px;margin:0 0 2px">⏰ Missed clock-in</h1>
    <div style="color:#7a6a55;font-size:13px;margin:0 0 14px">As of ${escp(when)} — not clocked in ${thresholdMin}+ minutes after their scheduled start.</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid #e7ded0;border-radius:12px;overflow:hidden">
      <thead><tr style="background:#3a2a1c;color:#f4e9d6;text-align:left"><th style="padding:9px 14px">Employee</th><th style="padding:9px 14px">Location</th><th style="padding:9px 14px">Scheduled</th><th style="padding:9px 14px;text-align:right">Late</th></tr></thead>
      <tbody>${items}</tbody></table>
    <p style="color:#9a8b73;font-size:11px;margin-top:14px">Based on Square scheduled shifts vs. actual clock-ins.</p></div></body></html>`;
}
function escp(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
