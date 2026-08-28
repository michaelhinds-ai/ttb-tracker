// Xola sales-tax pull for the Kentucky Sales & Use return (Louisville Rickhouse, KY).
// Sums the "Kentucky Sales Tax" collected on Xola experience/merch sales for a month,
// net of refunds, so it can be added to the Square figure on the KY tab.
//
// SCOPE: Kentucky sellers only (XOLA_STATE_n === "KY"). Xola spans two states —
// Louisville is KY, the two Nashville sellers are TN — and a Kentucky return must
// never carry Tennessee tax. Non-KY sellers are excluded and reported separately;
// a seller with no XOLA_STATE_n set is excluded AND flagged, because guessing is
// how tax lands on the wrong return in either direction.
//
// Every KY seller is summed independently and then combined, so the remit total
// covers all of them. One seller failing leaves the others intact and flags the
// response as partial — important, because a silently-missing seller would
// understate what you owe.
//
// Confirmed from live data: each PURCHASE transaction has items[] with a numeric `taxFee`
// (and a fees[] entry named "Kentucky Sales Tax"); amounts are in DOLLARS.
//
// POST { year, month, basis? }             -> monthly tax total (net of refunds)
// POST { probe:true } or GET ?probe=1      -> a couple transactions' MONEY fields only (no PII)
//
// Env: see lib/xola.mjs for the full list (XOLA_API_KEY, XOLA_SELLER_ID_1..N, ...).
import { env as sqEnv, monthRange, json } from "./lib/square.mjs";
import { accounts, eachAccount, fetchTransactions, hasAnyTransactions, sellerName, r2 } from "./lib/xola.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const all = accounts();
  if (!all.length) {
    return json({ configured: false, error: "not_configured", detail: "Set XOLA_API_KEY and XOLA_SELLER_ID_1 in Netlify." }, 200);
  }

  // ONLY Kentucky sellers belong on a Kentucky return. The Nashville sellers
  // collect Tennessee tax — Metro Transit Tax, Downtown Alcohol Fee and the rest —
  // and rolling those into this total would overstate what is owed to Kentucky
  // while leaving Tennessee unaccounted for. Non-KY sellers are not even fetched:
  // it is wasted time, and it removes any chance of the wrong money leaking in.
  const accts = all.filter((a) => a.state === "KY");
  const otherStates = all.filter((a) => a.state && a.state !== "KY")
    .map((a) => ({ key: a.key, label: a.label || a.seller, state: a.state }));
  // A seller nobody has classified is the one case that must be loud. Excluding it
  // silently understates Kentucky; including it silently overstates Kentucky.
  const unclassified = all.filter((a) => !a.state)
    .map((a) => ({ key: a.key, label: a.label || a.seller }));

  // Same month boundaries as the Square KY report so the combined total lines up.
  const tz = sqEnv().tz;

  let p;
  if (req.method === "GET") p = { probe: url.searchParams.get("probe") != null };
  else if (req.method === "POST") { try { p = await req.json(); } catch { p = {}; } }
  else return json({ error: "method_not_allowed" }, 405);

  if (p.probe) {
    const probes = await eachAccount(accts, async (a) => {
      const pull = await fetchTransactions(a, { type: "purchase", probe: true });
      return { count: pull.rows.length, sample: pull.rows.slice(0, 5).map(moneyOnly) };
    });
    return json({ configured: true, probe: true, accounts: probes });
  }

  const year = +p.year, month = +p.month;
  if (!(year > 2000) || !(month >= 1 && month <= 12)) return json({ error: "bad_month" }, 400);
  const { startISO, endISO } = monthRange(year, month, tz);

  // "collected" (default): count tax by when the booking was PAID (createdAt), net refunds.
  // "realized": count tax by when the EXPERIENCE happened (items.realizedAt); cancellations never count.
  const basis = p.basis === "realized" ? "realized" : "collected";
  const dateField = basis === "realized" ? "items_realizedAt" : "createdAt";

  const rows = await eachAccount(accts, async (a) => {
    const [purchases, refunds, name] = await Promise.all([
      fetchTransactions(a, { type: "purchase", startISO, endISO, dateField }),
      fetchTransactions(a, { type: "refund", startISO, endISO, dateField }),
      a.label ? Promise.resolve(null) : sellerName(a),
    ]);

    let taxCollected = 0, grossSales = 0;
    for (const t of purchases.rows) { taxCollected += txnTax(t); grossSales += txnGross(t); }
    let taxRefunded = 0;
    for (const t of refunds.rows) taxRefunded += Math.abs(txnTax(t));

    // Nothing at all for the month is ambiguous. A key that cannot read this
    // seller returns exactly the same empty list as a seller that genuinely sold
    // nothing — and here that difference is tax owed, so it gets asked about.
    const unreadable = purchases.rows.length === 0 && refunds.rows.length === 0
      && (await hasAnyTransactions(a)) === false;

    return {
      name,
      unreadable,
      truncated: purchases.truncated || refunds.truncated,
      purchaseCount: purchases.rows.length,
      refundCount: refunds.rows.length,
      taxCollected: r2(taxCollected),
      taxRefunded: r2(taxRefunded),
      taxNet: r2(taxCollected - taxRefunded),
      grossSales: r2(grossSales),
    };
  });

  const accountsOut = rows.map((r) => ({
    key: r.key, label: r.label || r.name || r.seller, seller: r.seller, ok: r.ok,
    error: r.error || undefined, status: r.status || undefined, detail: r.detail || undefined,
    truncated: r.truncated || false,
    unreadable: r.unreadable || false,
    purchaseCount: r.purchaseCount || 0, refundCount: r.refundCount || 0,
    taxCollected: r.taxCollected || 0, taxRefunded: r.taxRefunded || 0,
    taxNet: r.taxNet || 0, grossSales: r.grossSales || 0,
  }));

  const live = accountsOut.filter((a) => a.ok);
  const sum = (f) => r2(live.reduce((n, a) => n + (a[f] || 0), 0));
  const failed = accountsOut.filter((a) => !a.ok)
    .map((a) => ({ key: a.key, label: a.label, error: a.error, detail: a.detail }));
  const unreadable = live.filter((a) => a.unreadable)
    .map((a) => ({ key: a.key, label: a.label, seller: a.seller }));

  return json({
    configured: true, year, month, tz, startISO, endISO, basis,
    accountCount: accountsOut.length,
    accounts: accountsOut,
    failed: failed.length ? failed : undefined,
    // A seller this key cannot read contributes zero tax and no error. Before a
    // filing that is the worst possible shape for a bug, so it rides alongside
    // the hard failures and forces the same red warning.
    unreadable: unreadable.length ? unreadable : undefined,
    // Everything below covers Kentucky sellers ONLY.
    scope: "KY",
    kySellerCount: accts.length,
    otherStates: otherStates.length ? otherStates : undefined,
    unclassified: unclassified.length ? unclassified : undefined,
    // A partial or truncated pull understates tax owed — the UI must say so out loud.
    // An unclassified seller counts as partial too: its tax is on no return at all.
    partial: failed.length > 0 || unreadable.length > 0 || unclassified.length > 0,
    truncated: live.some((a) => a.truncated),
    // Legacy single-seller field, kept so nothing that reads it breaks.
    seller: (accountsOut[0] && accountsOut[0].seller) || null,
    // ---- combined totals across every live seller ----
    purchaseCount: live.reduce((n, a) => n + (a.purchaseCount || 0), 0),
    refundCount: live.reduce((n, a) => n + (a.refundCount || 0), 0),
    taxCollected: sum("taxCollected"),
    taxRefunded: sum("taxRefunded"),
    taxNet: sum("taxNet"),
    grossSales: sum("grossSales"),
  });
};

// Tax on one transaction = sum of item.taxFee (fallback to fees[] entries named like a tax).
function txnTax(t) {
  let s = 0;
  for (const it of (t.items || [])) {
    if (isNum(it.taxFee)) { s += it.taxFee; continue; }
    for (const f of (it.fees || [])) if (f && /tax/i.test(f.name || "") && isNum(f.amount)) s += f.amount;
  }
  return s;
}
function txnGross(t) { let s = 0; for (const it of (t.items || [])) if (isNum(it.gross)) s += it.gross; return s; }

// Strip everything but money fields for the probe (no customer PII).
function moneyOnly(t) {
  return {
    id: t.id, type: t.type, createdAt: t.createdAt, amount: t.amount, currency: t.currency,
    items: (t.items || []).map((it) => ({ gross: it.gross, net: it.net, taxFee: it.taxFee, fees: it.fees, commission: it.commission })),
  };
}

function isNum(v) { return typeof v === "number" && isFinite(v); }
export const config = { path: "/api/xola/salestax" };
