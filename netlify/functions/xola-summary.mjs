// Xola experience revenue for the Retail Sales tab, recognized on the day the
// experience was REDEEMED (items.realizedAt) — not the day it was booked.
// So a tour paid last week but run today shows as today's revenue.
//
// Every configured Xola seller is pulled independently and gets its own figures;
// those roll up into one combined total. A seller that errors or times out comes
// back as an error row and the rest of the report still renders.
//
// POST { startDate, endDate, endCapISO? }   (YYYY-MM-DD day or range)
// GET  ?probe=1                              (a couple realized items, money only)
//
// Response:
//   { configured, startDate, endDate, tz, startISO, endISO,
//     accounts: [ { key, label, seller, ok, orderCount, guests, netSales, tax,
//                   collected, grossSales, avgTicket, experiences[], truncated } ],
//     ...combined totals at the top level (back-compatible with the old shape) }
import { env as sqEnv, dayRange, todayInTz, json } from "./lib/square.mjs";
import { accounts, eachAccount, fetchTransactions, hasAnyTransactions, sellerName, num, r2 } from "./lib/xola.mjs";

const TOP_N_ACCOUNT = 10;
const TOP_N_ROLLUP = 15;

export default async (req) => {
  const url = new URL(req.url);
  const accts = accounts();
  if (!accts.length) return json({ configured: false, error: "not_configured" }, 200);

  const tz = sqEnv().tz;
  let p;
  if (req.method === "GET") p = { probe: url.searchParams.get("probe") != null };
  else if (req.method === "POST") { try { p = await req.json(); } catch { p = {}; } }
  else return json({ error: "method_not_allowed" }, 405);

  const ymd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  const from = ymd(p.startDate) ? p.startDate : (ymd(p.date) ? p.date : todayInTz(tz));
  const to = ymd(p.endDate) ? p.endDate : from;

  // One seller may sit in a different timezone, so the window is computed per account.
  const windowFor = (a) => {
    const startISO = dayRange(from, a.tz).startISO;
    let endISO = dayRange(to, a.tz).endISO;
    if (typeof p.endCapISO === "string" && p.endCapISO && p.endCapISO > startISO && p.endCapISO < endISO) endISO = p.endCapISO;
    return { startISO, endISO };
  };

  const rows = await eachAccount(accts, async (a) => {
    const { startISO, endISO } = windowFor(a);
    const [pull, name] = await Promise.all([
      fetchTransactions(a, {
        type: "purchase", dateField: "items_realizedAt", startISO, endISO,
        report: true, probe: !!p.probe,
      }),
      a.label ? Promise.resolve(null) : sellerName(a),
    ]);
    const t = tally(pull.rows, startISO, endISO, !!p.probe);
    // An empty window is ambiguous — quiet day, or a key blind to this seller.
    // Only worth the extra question when nothing came back, and only a definite
    // `false` counts: an errored probe leaves this unflagged rather than crying wolf.
    const unreadable = pull.rows.length === 0 && (await hasAnyTransactions(a)) === false;
    return { ...t, truncated: pull.truncated, unreadable, name, startISO, endISO };
  });

  // Label precedence: explicit XOLA_LABEL_n, then the seller's own Xola name, then the id.
  const accountsOut = rows.map((r) => ({ ...r, label: r.label || r.name || r.seller }));

  if (p.probe) {
    return json({
      configured: true, probe: true,
      accounts: accountsOut.map((a) => ({
        key: a.key, label: a.label, seller: a.seller, ok: a.ok,
        error: a.error || undefined, detail: a.detail || undefined,
        realizedItems: (a.sample || []).length, sample: a.sample || [],
      })),
    });
  }

  const live = accountsOut.filter((a) => a.ok);
  const combined = rollup(live);
  const failed = accountsOut.filter((a) => !a.ok)
    .map((a) => ({ key: a.key, label: a.label, error: a.error, detail: a.detail }));
  const unreadable = live.filter((a) => a.unreadable)
    .map((a) => ({ key: a.key, label: a.label, seller: a.seller }));

  return json({
    configured: true,
    startDate: from, endDate: to, tz,
    // Window of the first account, for display. Per-account windows are on each row.
    startISO: (accountsOut[0] && accountsOut[0].startISO) || null,
    endISO: (accountsOut[0] && accountsOut[0].endISO) || null,
    accountCount: accountsOut.length,
    accounts: accountsOut.map((a) => ({
      key: a.key, label: a.label, seller: a.seller, tz: a.tz, ok: a.ok,
      error: a.error || undefined, status: a.status || undefined, detail: a.detail || undefined,
      truncated: a.truncated || false,
      unreadable: a.unreadable || false,
      orderCount: a.orderCount || 0, guests: a.guests || 0,
      netSales: a.netSales || 0, tax: a.tax || 0, collected: a.collected || 0,
      grossSales: a.grossSales || 0, avgTicket: a.avgTicket || 0,
      experiences: a.experiences || [],
    })),
    failed: failed.length ? failed : undefined,
    // A seller whose transactions this key cannot see contributes a clean, quiet
    // zero to every total below. That reads as a slow day and understates the
    // business, so it is surfaced next to the outright failures, not buried.
    unreadable: unreadable.length ? unreadable : undefined,
    partial: failed.length > 0 || unreadable.length > 0,
    truncated: live.some((a) => a.truncated),
    // ---- combined totals, same field names the single-seller version returned ----
    ...combined,
  });
};

// Sum one seller's transactions over its window.
function tally(txns, startISO, endISO, probe) {
  let orderCount = 0, guests = 0, net = 0, tax = 0, collected = 0;
  const exp = {}; const sample = [];
  for (const t of txns) {
    const pMap = {}; for (const pi of ((t.purchase && t.purchase.items) || [])) pMap[pi.id] = pi;
    let counted = false;
    for (const it of (t.items || [])) {
      const rz = it.realizedAt; if (!rz || !(rz >= startISO && rz < endISO)) continue;
      const gr = num(it.gross), tf = num(it.taxFee); const pretax = gr - tf;
      const q = num((pMap[it.orderItem && it.orderItem.id] || {}).quantity) || 0;
      net += pretax; tax += tf; collected += gr; guests += q; counted = true;
      const nm = (pMap[it.orderItem && it.orderItem.id] || {}).name || it.name || "Experience";
      const e = exp[nm] || (exp[nm] = { name: nm, guests: 0, net: 0 });
      e.guests += q; e.net += pretax;
      if (probe && sample.length < 6) sample.push({ name: nm, realizedAt: rz, gross: gr, taxFee: tf, pretax: r2(pretax), quantity: q });
    }
    if (counted) orderCount++;
  }
  return {
    orderCount, guests: r2(guests), netSales: r2(net), tax: r2(tax), collected: r2(collected),
    grossSales: r2(net), avgTicket: orderCount ? r2(net / orderCount) : 0,
    experiences: topExperiences(exp, TOP_N_ACCOUNT),
    sample: probe ? sample : undefined,
  };
}

// Combine the live sellers into one set of totals, merging the experience lists
// by name so the same tour sold by two sellers shows as one line.
function rollup(rows) {
  let orderCount = 0, guests = 0, net = 0, tax = 0, collected = 0;
  const exp = {};
  for (const r of rows) {
    orderCount += r.orderCount || 0;
    guests += r.guests || 0;
    net += r.netSales || 0;
    tax += r.tax || 0;
    collected += r.collected || 0;
    for (const e of (r.experiences || [])) {
      const c = exp[e.name] || (exp[e.name] = { name: e.name, guests: 0, net: 0 });
      c.guests += e.guests || 0; c.net += e.net || 0;
    }
  }
  return {
    orderCount, guests: r2(guests), netSales: r2(net), tax: r2(tax), collected: r2(collected),
    grossSales: r2(net), avgTicket: orderCount ? r2(net / orderCount) : 0,
    experiences: topExperiences(exp, TOP_N_ROLLUP),
  };
}

function topExperiences(map, limit) {
  return Object.values(map)
    .map((e) => ({ name: e.name, guests: r2(e.guests), net: r2(e.net) }))
    .sort((a, b) => b.net - a.net)
    .slice(0, limit);
}

export const config = { path: "/api/xola/summary" };
