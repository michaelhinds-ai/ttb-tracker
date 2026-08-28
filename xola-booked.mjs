// Xola BOOKED revenue for the P&L — recognized on the day a tour was booked/paid
// (transaction createdAt), not the day it runs. This is the opposite basis from
// the Retail Sales tab (which uses arrival date). Net of tax and of refunds.
// POST { year, month }  ->  { configured, basis:"booked", accounts:[{key,label,ok,netSales,...}] }
import { accounts, eachAccount, fetchTransactions, hasAnyTransactions, sellerName, r2 } from "./lib/xola.mjs";
import { env as sqEnv, monthRange, json } from "./lib/square.mjs";

const isNum = (v) => typeof v === "number" && isFinite(v);
function txnTax(t) {
  let s = 0;
  for (const it of (t.items || [])) {
    if (isNum(it.taxFee)) { s += it.taxFee; continue; }
    for (const f of (it.fees || [])) if (f && /tax/i.test(f.name || "") && isNum(f.amount)) s += f.amount;
  }
  return s;
}
function txnGross(t) { let s = 0; for (const it of (t.items || [])) if (isNum(it.gross)) s += it.gross; return s; }

export default async (req) => {
  const accts = accounts();
  if (!accts.length) return json({ configured: false, error: "not_configured", accounts: [] }, 200);
  let p = {}; if (req.method === "POST") { try { p = await req.json(); } catch { p = {}; } }
  const year = +p.year, month = +p.month;
  if (!(year > 2000) || !(month >= 1 && month <= 12)) return json({ configured: true, error: "bad_month", accounts: [] }, 200);

  const tz = sqEnv().tz;
  const { startISO, endISO } = monthRange(year, month, tz);
  const dateField = "createdAt"; // BOOKED basis

  const rows = await eachAccount(accts, async (a) => {
    const [purchases, refunds, name] = await Promise.all([
      fetchTransactions(a, { type: "purchase", startISO, endISO, dateField }),
      fetchTransactions(a, { type: "refund", startISO, endISO, dateField }),
      a.label ? Promise.resolve(null) : sellerName(a),
    ]);
    let gross = 0, tax = 0; for (const t of purchases.rows) { gross += txnGross(t); tax += txnTax(t); }
    let rGross = 0, rTax = 0; for (const t of refunds.rows) { rGross += Math.abs(txnGross(t)); rTax += Math.abs(txnTax(t)); }
    const netSales = r2((gross - tax) - (rGross - rTax)); // pretax, net of refunds
    const unreadable = purchases.rows.length === 0 && refunds.rows.length === 0 && (await hasAnyTransactions(a)) === false;
    return {
      name, unreadable,
      truncated: purchases.truncated || refunds.truncated,
      purchaseCount: purchases.rows.length, refundCount: refunds.rows.length,
      netSales, grossSales: r2(gross - rGross), tax: r2(tax - rTax),
    };
  });

  const accountsOut = rows.map((r) => ({
    key: r.key, label: r.label || r.name || r.seller, seller: r.seller, ok: r.ok,
    error: r.error || undefined, detail: r.detail || undefined,
    unreadable: r.unreadable || false, truncated: r.truncated || false,
    netSales: r.netSales || 0, grossSales: r.grossSales || 0, tax: r.tax || 0,
    purchaseCount: r.purchaseCount || 0,
  }));

  return json({ configured: true, basis: "booked", year, month, tz, startISO, endISO, accounts: accountsOut });
};
export const config = { path: "/api/xola/booked" };
