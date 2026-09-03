// Payroll pull for a pay period. For a start/end date range, walks every Square
// account (accounts()) and every active location, and returns per-employee:
//   • hours worked  (from Labor Timecards: clock-out − clock-in − unpaid breaks)
//   • card tips      (sum of Payment.tip_money attributed to that team member)
//   • cash tips      (declared_cash_tip_money on the team member's timecards)
// Shaped as accounts → locations → employees, plus a combined by-employee roll-up.
//
// POST /api/square/payroll   body: { start:"YYYY-MM-DD", end:"YYYY-MM-DD" }
//   start = first day of the period (inclusive)
//   end   = first day of the NEXT period (exclusive) — i.e. the pay date.
// Everything is bounded by each account's own timezone.
import { accounts, sqFor, json } from "./lib/square.mjs";

// ---- local-midnight helpers (per account tz) ------------------------------
function localMidnightUTC(y, m, d, tz) {
  let guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false, year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(guess));
    const g = (t) => +parts.find((p) => p.type === t).value;
    let hr = g("hour"); if (hr === 24) hr = 0;
    const localAsUTC = Date.UTC(g("year"), g("month") - 1, g("day"), hr, g("minute"), g("second"));
    const diff = Date.UTC(y, m - 1, d, 0, 0, 0) - localAsUTC;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess).toISOString();
}
function dayStartISO(ymd, tz) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return localMidnightUTC(y, m, d, tz);
}
const hoursBetween = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 3600000;
// Local calendar day (YYYY-MM-DD) of a timestamp in the account's timezone — used
// to bucket tips and hours into the same business day for pool allocation.
function localYmd(iso, tz) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(iso));
  const g = (t) => parts.find((p) => p.type === t).value;
  return g("year") + "-" + g("month") + "-" + g("day");
}

// Split each business day's tip pool among the tip-eligible people who worked that
// day at that location, proportional to hours (the seller's Square tip setting).
//   dayPool:  locId -> ymd -> tip cents (the pot to split)
//   dayHours: locId -> ymd -> { tmId: hours }
//   people:   tmId -> { tipEligible }
// Returns { pooled: `${tmId}|${locId}` -> cents (float), unallocated: cents with
// no eligible worker on that day }.
export function allocateDailyPool(dayPool, dayHours, people) {
  const pooled = {}; let unallocated = 0;
  Object.keys(dayPool).forEach((lid) => {
    Object.keys(dayPool[lid]).forEach((ymd) => {
      const pot = dayPool[lid][ymd]; if (!pot) return;
      const hrsMap = (dayHours[lid] && dayHours[lid][ymd]) || {};
      let eligHrs = 0;
      Object.keys(hrsMap).forEach((tmId) => { if ((people[tmId] || {}).tipEligible) eligHrs += hrsMap[tmId]; });
      if (eligHrs <= 0) { unallocated += pot; return; } // nobody eligible clocked in → can't split
      Object.keys(hrsMap).forEach((tmId) => {
        if (!(people[tmId] || {}).tipEligible) return;
        const k = tmId + "|" + lid;
        pooled[k] = (pooled[k] || 0) + pot * (hrsMap[tmId] / eligHrs);
      });
    });
  });
  return { pooled, unallocated };
}

// ---- per-account roll-up ---------------------------------------------------
async function forAccount(acct, startYmd, endYmd) {
  const tz = acct.tz || "America/Chicago";
  const startISO = dayStartISO(startYmd, tz);
  const endISO = dayStartISO(endYmd, tz);
  const nowISO = new Date().toISOString();

  // Active locations for this account.
  const locResp = await sqFor(acct, "/v2/locations");
  const locations = (locResp.locations || []).filter((l) => l.status === "ACTIVE");
  const locName = {}; locations.forEach((l) => { locName[l.id] = l.name; });
  const locIds = locations.map((l) => l.id);

  // Jobs → tip eligibility. Square pools tips only among tip-eligible jobs, so we
  // read which job IDs are marked tip-eligible in the seller's Square settings.
  const eligibleJob = {}; let jobsKnown = false;
  {
    let cursor = null, pages = 0;
    do {
      let resp; try { resp = await sqFor(acct, "/v2/team-members/jobs" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : "")); }
      catch { resp = {}; }
      (resp.jobs || []).forEach((j) => { jobsKnown = true; if (j.id) eligibleJob[j.id] = !!j.is_tip_eligible; });
      cursor = resp.cursor || null; pages++;
    } while (cursor && pages < 10);
  }

  // Team members → name + title + tip eligibility (merge ACTIVE and INACTIVE so
  // anyone who worked resolves). A member is tip-eligible if any of their job
  // assignments references a tip-eligible job. If we couldn't read the job config
  // at all, fall back to treating everyone as eligible so pooling still happens.
  const people = {};
  for (const status of ["ACTIVE", "INACTIVE"]) {
    let cursor = null, pages = 0;
    do {
      const body = { query: { filter: { status } }, limit: 200 };
      if (cursor) body.cursor = cursor;
      let resp; try { resp = await sqFor(acct, "/v2/team-members/search", { method: "POST", body }); }
      catch { resp = {}; }
      (resp.team_members || []).forEach((tm) => {
        const name = [tm.given_name, tm.family_name].filter(Boolean).join(" ").trim() || "Team member";
        const assigns = ((tm.wage_setting || {}).job_assignments || []);
        const title = (assigns[0] || {}).job_title || "";
        let tipEligible = !jobsKnown; // no job data → default eligible
        if (jobsKnown) assigns.forEach((ja) => { if ((ja.job_id && eligibleJob[ja.job_id]) || ja.is_tip_eligible === true) tipEligible = true; });
        people[tm.id] = { name, title, tipEligible };
      });
      cursor = resp.cursor || null; pages++;
    } while (cursor && pages < 10);
  }

  // Timecards in the window → hours + declared cash tips, keyed by member+location.
  const acc = {}; // key `${tmId}|${locId}` -> {hours, cashTips, cardTips, collected}
  const bucket = (tmId, locId) => {
    const k = tmId + "|" + locId;
    if (!acc[k]) acc[k] = { tmId, locId, hours: 0, cashTips: 0, cardTips: 0, collected: 0, open: false };
    return acc[k];
  };
  // Per business-day structures for the tip pool: hours each person worked that
  // day at that location, and the total card tips collected that day (the pool).
  const dayHours = {}; // locId -> ymd -> { tmId: hours }
  const dayPool = {};  // locId -> ymd -> tip cents
  const addDayHours = (locId, ymd, tmId, hrs) => {
    (dayHours[locId] = dayHours[locId] || {}); (dayHours[locId][ymd] = dayHours[locId][ymd] || {});
    dayHours[locId][ymd][tmId] = (dayHours[locId][ymd][tmId] || 0) + hrs;
  };
  {
    let cursor = null, pages = 0;
    do {
      const body = {
        query: {
          filter: {
            location_ids: locIds,
            start: { start_at: startISO, end_at: endISO },
          },
          sort: { field: "START_AT", order: "ASC" },
        },
        limit: 200,
      };
      if (cursor) body.cursor = cursor;
      let resp; try { resp = await sqFor(acct, "/v2/labor/timecards/search", { method: "POST", body }); }
      catch { resp = {}; }
      (resp.timecards || []).forEach((tc) => {
        const tmId = tc.team_member_id; if (!tmId) return;
        const b = bucket(tmId, tc.location_id);
        const end = tc.end_at || nowISO;      // OPEN shift → count up to now
        if (!tc.end_at) b.open = true;
        let hrs = hoursBetween(tc.start_at, end);
        // subtract unpaid breaks
        (tc.breaks || []).forEach((br) => {
          if (br.is_paid) return;
          if (br.start_at && br.end_at) hrs -= hoursBetween(br.start_at, br.end_at);
        });
        if (hrs > 0) { b.hours += hrs; addDayHours(tc.location_id, localYmd(tc.start_at, tz), tmId, hrs); }
        b.cashTips += ((tc.declared_cash_tip_money || {}).amount || 0);
      });
      cursor = resp.cursor || null; pages++;
    } while (cursor && pages < 20);
  }

  // Card tips: Payments must be queried per location (list defaults to main location).
  // Every completed tip feeds that location's daily POOL (the amount to split), and
  // we also keep the raw who-rang-it-up total for reference (pre-pool "collected").
  for (const locId of locIds) {
    let cursor = null, pages = 0;
    do {
      const qs = new URLSearchParams({
        begin_time: startISO, end_time: endISO, location_id: locId, limit: "100",
      });
      if (cursor) qs.set("cursor", cursor);
      let resp; try { resp = await sqFor(acct, "/v2/payments?" + qs.toString()); }
      catch { resp = {}; }
      (resp.payments || []).forEach((p) => {
        if (p.status && p.status !== "COMPLETED") return; // ignore voided/failed/authorized-only
        const tip = (p.tip_money || {}).amount || 0;
        if (!tip) return;
        const lid = p.location_id || locId;
        const ymd = localYmd(p.created_at || startISO, tz);
        (dayPool[lid] = dayPool[lid] || {}); dayPool[lid][ymd] = (dayPool[lid][ymd] || 0) + tip;
        const tmId = p.team_member_id; if (tmId) bucket(tmId, lid).collected += tip;
      });
      cursor = resp.cursor || null; pages++;
    } while (cursor && pages < 40);
  }

  // Allocate each day's pool among tip-eligible workers, proportional to hours.
  const { pooled, unallocated } = allocateDailyPool(dayPool, dayHours, people);
  Object.keys(acc).forEach((k) => { acc[k].cardTips = Math.round(pooled[k] || 0); });

  // Shape into locations[] with employees[].
  const byLoc = {};
  locIds.forEach((id) => { byLoc[id] = { id, name: locName[id] || id, employees: [] }; });
  Object.values(acc).forEach((b) => {
    if (!byLoc[b.locId]) byLoc[b.locId] = { id: b.locId, name: locName[b.locId] || b.locId, employees: [] };
    const per = people[b.tmId] || { name: "Team member", title: "", tipEligible: true };
    byLoc[b.locId].employees.push({
      id: b.tmId, name: per.name, title: per.title,
      hours: Math.round(b.hours * 100) / 100,
      cardTips: b.cardTips,            // pooled take-home (what to pay)
      cardCollected: b.collected,      // raw tips rung up on their own sales (pre-pool)
      cashTips: b.cashTips, tips: b.cardTips + b.cashTips,
      tipEligible: per.tipEligible !== false,
      open: b.open,
    });
  });
  const locsOut = Object.values(byLoc)
    .map((l) => {
      l.employees.sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
      l.totals = l.employees.reduce((t, e) => ({
        hours: t.hours + e.hours, cardTips: t.cardTips + e.cardTips,
        cashTips: t.cashTips + e.cashTips, tips: t.tips + e.tips,
      }), { hours: 0, cardTips: 0, cashTips: 0, tips: 0 });
      l.totals.hours = Math.round(l.totals.hours * 100) / 100;
      return l;
    })
    .filter((l) => l.employees.length) // hide locations with no activity this period
    .sort((a, b) => b.totals.hours - a.totals.hours);

  return {
    key: acct.key,
    label: acct.label || (locResp.locations && locResp.locations[0] && locResp.locations[0].business_name) || "Square account",
    tz,
    locations: locsOut,
    tipPool: { basis: "hours", eligibleOnly: jobsKnown, unallocatedCents: Math.round(unallocated) },
  };
}

export default async (req) => {
  const accts = accounts();
  if (!accts.length) return json({ ok: false, error: "not_configured", detail: "No Square access tokens set." });

  let body = {}; try { body = await req.json(); } catch { /* allow query */ }
  const url = new URL(req.url);
  const start = body.start || url.searchParams.get("start");
  const end = body.end || url.searchParams.get("end");
  if (!start || !end) return json({ ok: false, error: "bad_request", detail: "Provide start and end (YYYY-MM-DD)." });

  const results = [];
  for (const a of accts) {
    try { results.push(await forAccount(a, start, end)); }
    catch (e) { results.push({ key: a.key, label: a.label || "Square account", error: String((e && e.detail) || e.message || e).slice(0, 300), locations: [] }); }
  }

  // Combined by-employee roll-up across every account + location.
  const combined = {};
  results.forEach((acc) => (acc.locations || []).forEach((loc) => loc.employees.forEach((e) => {
    const k = (e.name + "|" + (e.title || "")).toLowerCase();
    if (!combined[k]) combined[k] = { name: e.name, title: e.title, hours: 0, cardTips: 0, cashTips: 0, tips: 0, locations: [] };
    const c = combined[k];
    c.hours += e.hours; c.cardTips += e.cardTips; c.cashTips += e.cashTips; c.tips += e.tips;
    if (!c.locations.includes(loc.name)) c.locations.push(loc.name);
  })));
  const byEmployee = Object.values(combined)
    .map((c) => ({ ...c, hours: Math.round(c.hours * 100) / 100 }))
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));

  const grand = byEmployee.reduce((t, e) => ({
    hours: Math.round((t.hours + e.hours) * 100) / 100,
    cardTips: t.cardTips + e.cardTips, cashTips: t.cashTips + e.cashTips, tips: t.tips + e.tips,
  }), { hours: 0, cardTips: 0, cashTips: 0, tips: 0 });

  return json({ ok: true, start, end, accounts: results, byEmployee, grand });
};

export const config = { path: "/api/square/payroll" };
