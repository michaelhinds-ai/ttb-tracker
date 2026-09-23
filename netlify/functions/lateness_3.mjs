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

// Enriched clock status for the day: every worked shift with its matching
// scheduled shift, so we can tell late arrivals and people still on the clock
// past their scheduled end. Returns
// [{ id, name, teamMemberId, location, clockIn, clockOut, open, schedStart, schedEnd, lateInMin, overMin }].
export async function accountClockStatus(acct, startISO, endISO) {
  const [tm, loc] = await Promise.all([teamNames(acct), locNames(acct)]);
  const locIds = Object.keys(loc);
  let scheduled = [];
  try {
    const sres = await schedFetch(acct, "/v2/labor/scheduled-shifts/search", { query: { filter: { location_ids: locIds.length ? locIds : undefined, start: { start_at: startISO, end_at: endISO } } }, limit: 200 });
    scheduled = (sres && sres.scheduled_shifts) || [];
  } catch (e) { scheduled = []; } // scheduling may be off — still return worked shifts (no late/over info)
  let worked = [];
  try {
    const wres = await sqFor(acct, "/v2/labor/shifts/search", { method: "POST", body: { query: { filter: { location_ids: locIds.length ? locIds : undefined, start: { start_at: startISO, end_at: endISO } }, sort: { field: "START_AT", order: "ASC" } }, limit: 200 } });
    worked = (wres && wres.shifts) || [];
  } catch (e) { worked = []; }
  const now = Date.now();
  return worked.map((w) => {
    const tmId = w.team_member_id;
    const clockIn = w.start_at || null, clockOut = w.end_at || null, open = !clockOut;
    const clockInMs = Date.parse(clockIn || "");
    // Match the scheduled shift closest to this clock-in (same person, within 6h).
    let sStart = null, sEnd = null, sStartMs = null, sEndMs = null, best = Infinity;
    for (const ss of scheduled) {
      const d = detailsOf(ss);
      if (d.is_deleted || d.team_member_id !== tmId) continue;
      const ms = Date.parse(d.start_at || "");
      if (!isFinite(ms)) continue;
      const diff = Math.abs(ms - (isFinite(clockInMs) ? clockInMs : ms));
      if (diff < best && diff < 6 * 3600 * 1000) { best = diff; sStart = d.start_at; sEnd = d.end_at; sStartMs = ms; sEndMs = Date.parse(d.end_at || ""); }
    }
    const lateInMin = (sStartMs != null && Number.isFinite(clockInMs)) ? Math.round((clockInMs - sStartMs) / 60000) : null;
    // Only an overstay when there is a REAL scheduled end. Number.isFinite (not the
    // global isFinite) is required: isFinite(null) coerces null->0 and would report
    // "minutes since 1970" (~29.8M) for anyone clocked in with no matching schedule.
    const overMin = (open && sEndMs != null && Number.isFinite(sEndMs)) ? Math.round((now - sEndMs) / 60000) : null;
    return { id: w.id || (tmId + "|" + clockIn), name: tm[tmId] || tmId, teamMemberId: tmId, location: loc[w.location_id] || w.location_id || "", clockIn, clockOut, open, schedStart: sStart, schedEnd: sEnd, lateInMin, overMin };
  });
}
export async function allClockStatus(startISO, endISO) {
  const accts = accounts();
  const results = await Promise.all(accts.map(async (a) => {
    try { return { rows: await accountClockStatus(a, startISO, endISO) }; }
    catch (e) { return { error: String((e && e.message) || e), status: e && e.status }; }
  }));
  return { rows: results.flatMap((r) => r.rows || []), errors: results.filter((r) => r.error).map((r) => r.error) };
}
// ---- Mobile-friendly email shell + person card (stacked, no wide tables) --------------------
function _lateWrap(title, sub, inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#f3ede1;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#2a2118;-webkit-text-size-adjust:100%">
    <div style="max-width:600px;width:100%;margin:0 auto;padding:16px 14px">
      <h1 style="font-size:20px;margin:0 0 3px">${title}</h1>
      <div style="color:#7a6a55;font-size:14px;line-height:1.4;margin:0 0 14px">${sub}</div>
      ${inner}
      <p style="color:#9a8b73;font-size:11px;margin-top:6px">Based on Square scheduled shifts vs. actual clock-ins.</p>
    </div>
  </body></html>`;
}
function _lateCard(name, badge, meta) {
  return `<div style="background:#fff;border:1px solid #e7ded0;border-radius:12px;padding:12px 14px;margin-bottom:10px">
    <table role="presentation" style="width:100%;border-collapse:collapse"><tr>
      <td style="font-weight:700;font-size:16px;vertical-align:top">${name}</td>
      <td style="text-align:right;color:#b23b3b;font-weight:800;font-size:14px;white-space:nowrap;vertical-align:top;padding-left:10px">${badge}</td>
    </tr></table>
    <div style="color:#7a6a55;font-size:13.5px;margin-top:4px">${meta}</div>
  </div>`;
}
// Email for people still clocked in past their scheduled end by graceMin+.
export function overstayEmailHTML(rows, graceMin, tz) {
  const when = new Date().toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const t = (iso) => iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }) : "—";
  const items = rows.map((r) => _lateCard(escp(r.name), `${r.overMin} min over`, `${escp(r.location)} · scheduled off ${t(r.schedEnd)}`)).join("");
  return _lateWrap("🕒 Still clocked in past scheduled end", `As of ${escp(when)} — still on the clock ${graceMin}+ minutes after their scheduled off time. Worth a check that they're still working (or forgot to clock out).`, items);
}
// Email for people who DID clock in, but late (more than graceMin after start).
export function lateArrivalEmailHTML(rows, graceMin, tz) {
  const when = new Date().toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const t = (iso) => iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }) : "—";
  const items = rows.map((r) => _lateCard(escp(r.name), `${r.lateInMin} min late`, `${escp(r.location)} · scheduled ${t(r.schedStart)} · clocked in ${t(r.clockIn)}`)).join("");
  return _lateWrap("⏰ Clocked in late", `As of ${escp(when)} — clocked in more than ${graceMin} minutes after their scheduled start.`, items);
}
export function lateEmailHTML(rows, thresholdMin, tz) {
  const when = new Date().toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const t = (iso) => new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const items = rows.map((r) => _lateCard(escp(r.name), `${r.minutesLate} min late`, `${escp(r.location)} · scheduled ${t(r.startAt)}`)).join("");
  return _lateWrap("⏰ Missed clock-in", `As of ${escp(when)} — not clocked in ${thresholdMin}+ minutes after their scheduled start.`, items);
}
function escp(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
