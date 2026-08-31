// Who's clocked in / out today — reads Square worked shifts (timecards) for the
// day and returns each person's clock-in and clock-out time by location.
// POST { date? }  ->  { ok, date, rows:[{location, name, clockIn, clockOut, open}], errors:[] }
import { accounts, sqFor, dayRange, todayInTz, env as sqEnv, json } from "./lib/square.mjs";

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

async function accountShifts(acct, ymd) {
  const tz = acct.tz || sqEnv().tz;
  const { startISO, endISO } = dayRange(ymd, tz);
  const [tm, loc] = await Promise.all([teamNames(acct), locNames(acct)]);
  const locIds = Object.keys(loc);
  let shifts = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const body = { query: { filter: { location_ids: locIds.length ? locIds : undefined, start: { start_at: startISO, end_at: endISO } }, sort: { field: "START_AT", order: "ASC" } }, limit: 200 };
    if (cursor) body.cursor = cursor;
    const r = await sqFor(acct, "/v2/labor/shifts/search", { method: "POST", body });
    for (const s of (r && r.shifts) || []) shifts.push(s);
    cursor = r && r.cursor; if (!cursor) break;
  }
  return shifts.map((s) => ({
    location: loc[s.location_id] || s.location_id || "",
    name: tm[s.team_member_id] || s.team_member_id || "—",
    clockIn: s.start_at || null,
    clockOut: s.end_at || null,
    open: !s.end_at,
  }));
}

export default async (req) => {
  const accts = accounts();
  if (!accts.length) return json({ ok: false, error: "not_configured", rows: [] }, 200);
  let p = {}; if (req.method === "POST") { try { p = await req.json(); } catch {} }
  const tz = sqEnv().tz;
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(p.date || "") ? p.date : todayInTz(tz);
  const results = await Promise.all(accts.map((a) => accountShifts(a, ymd).then((rows) => ({ rows })).catch((e) => ({ error: String((e && e.message) || e) }))));
  const rows = results.flatMap((r) => r.rows || []);
  const errors = results.filter((r) => r.error).map((r) => r.error);
  // Sort: currently-clocked-in first, then by clock-in time.
  rows.sort((a, b) => (b.open - a.open) || String(a.clockIn).localeCompare(String(b.clockIn)));
  return json({ ok: true, date: ymd, tz, rows, errors });
};
export const config = { path: "/api/square/clockins" };
