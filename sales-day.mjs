// Per-location / per-employee sales for a given day, as JSON — powers the
// home-screen drill-down when you tap a location's sales card.
// POST { date? }  ->  { ok, date, rows:[{ location, account, sales, txns, employees:[...] }] }
import { fullDigest } from "./lib/salesdigest.mjs";
import { env as sqEnv, todayInTz, json } from "./lib/square.mjs";

export default async (req) => {
  let p = {}; if (req.method === "POST") { try { p = await req.json(); } catch { p = {}; } }
  const tz = sqEnv().tz;
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(p.date || "") ? p.date : todayInTz(tz);
  try {
    const dig = await fullDigest(ymd);
    return json({ ok: true, date: ymd, tz, rows: dig.rows, errors: dig.errors || [] });
  } catch (e) {
    return json({ ok: false, error: "square_failed", detail: String((e && e.message) || e) }, 200);
  }
};
export const config = { path: "/api/sales/day" };
