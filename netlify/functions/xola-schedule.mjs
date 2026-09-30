// Xola bookings by the hour they RUN — feeds the staffing planner on Busy Times.
// POST { startDate, endDate }  (YYYY-MM-DD, up to 8 days per call; the app asks week by week)
// -> { configured, accounts:[ { key, label, seller, tz, ok, bookings:[ {date, hour, minute, guests, name} ], truncated } ] }
// Guests = purchase-item quantity. Cancelled / refunded items are already dropped by the fetch.
import { env as sqEnv, todayInTz, json } from "./lib/square.mjs";
import { accounts, eachAccount, fetchPurchaseItemsRange, sellerName, num } from "./lib/xola.mjs";

const ymd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
// Local date/hour for a booking. Prefer Xola's own local fields (arrivalDate + arrivalTime HHMM);
// fall back to converting arrivalDateTime into the seller's timezone.
function whenOf(it, tz) {
  const at = it.arrivalTime != null && it.arrivalTime !== "" ? String(it.arrivalTime).padStart(4, "0") : "";
  if (it.arrivalDate && /^\d{4}$/.test(at)) return { date: String(it.arrivalDate).slice(0, 10), hour: +at.slice(0, 2), minute: +at.slice(2) };
  const dt = it.arrivalDateTime || it.arrival;
  if (dt) {
    const d = new Date(dt);
    if (!isNaN(d)) {
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d).map((p) => [p.type, p.value]));
      return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: (+parts.hour) % 24, minute: +parts.minute };
    }
  }
  if (it.arrivalDate) return { date: String(it.arrivalDate).slice(0, 10), hour: null, minute: null };
  return null;
}

export default async (req) => {
  const accts = accounts();
  if (!accts.length) return json({ configured: false, error: "not_configured", accounts: [] }, 200);
  let p = {}; try { p = await req.json(); } catch { p = {}; }
  const tz = sqEnv().tz;
  const from = ymd(p.startDate) ? p.startDate : todayInTz(tz);
  let to = ymd(p.endDate) ? p.endDate : from;
  // keep each call small enough to finish inside Netlify's time limit
  const maxTo = new Date(Date.parse(from + "T00:00:00Z") + 7 * 86400000).toISOString().slice(0, 10);
  if (to > maxTo) to = maxTo;
  const rows = await eachAccount(accts, async (a) => {
    const [pull, name] = await Promise.all([
      fetchPurchaseItemsRange(a, { startDate: from, endDate: to }),
      a.label ? Promise.resolve(null) : sellerName(a),
    ]);
    const bookings = [];
    for (const it of pull.items) {
      const w = whenOf(it, a.tz); if (!w) continue;
      const guests = num(it.quantity) || 1;
      const nm = (it.experience && (it.experience.name || it.experience.title)) || it.name || it.experienceName || "Experience";
      bookings.push({ date: w.date, hour: w.hour, minute: w.minute, guests, name: String(nm).slice(0, 80) });
    }
    return { name, bookings, truncated: pull.truncated };
  });
  return json({ configured: true, startDate: from, endDate: to, accounts: rows.map((r) => ({ ...r, label: r.label || r.name || r.seller })) });
};

export const config = { path: "/api/xola/schedule" };
