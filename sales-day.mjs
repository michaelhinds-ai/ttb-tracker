// Per-location / per-employee sales for a given day, as JSON — powers the
// home-screen drill-down when you tap a location's sales card.
// POST { date? }  ->  { ok, date, rows:[{ location, account, sales, txns, employees:[...] }] }
import { fullDigest } from "./lib/salesdigest.mjs";
import { env as sqEnv, todayInTz, json } from "./lib/square.mjs";

export default async (req) => {
  let p = {}; if (req.method === "POST") { try { p = await req.json(); } catch { p = {}; } }
  const tz = sqEnv().tz;
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  const startDate = ok(p.startDate) ? p.startDate : (ok(p.date) ? p.date : todayInTz(tz));
  const endDate = ok(p.endDate) ? p.endDate : startDate;
  try {
    const dig = await fullDigest(startDate, endDate);
    return json({ ok: true, date: startDate, startDate, endDate, tz, rows: dig.rows, errors: dig.errors || [] });
  } catch (e) {
    return json({ ok: false, error: "square_failed", detail: String((e && e.message) || e) }, 200);
  }
};
export const config = { path: "/api/sales/day" };
