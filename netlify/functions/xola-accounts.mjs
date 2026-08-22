// Connection status for every configured Xola seller (GET /api/xola/accounts).
// Mirrors /api/square/accounts so the Retail Sales tab can show which sellers are
// live before pulling a day — and, more usefully, surface a seller that is
// configured but unreachable, which would otherwise just look like a slow day.
import { json, todayInTz } from "./lib/square.mjs";
import { accounts, eachAccount, hasAnyTransactions, xFor } from "./lib/xola.mjs";

export default async () => {
  const accts = accounts();
  if (!accts.length) return json({ configured: false, accounts: [] });

  const rows = await eachAccount(accts, async (a) => {
    // Proves the key and the seller id are good — but ONLY that. Profile access
    // and transaction access are separate grants in Xola, so a seller can answer
    // here with its name and still return an empty transaction list forever.
    const s = await xFor(a, `/api/sellers/${encodeURIComponent(a.seller)}`, { timeoutMs: 6000 });
    // So ask the question that actually matters for a revenue report.
    const readable = await hasAnyTransactions(a);
    return {
      connected: true,
      readable,
      name: (s && (s.name || s.company || (s.user && s.user.name))) || null,
      currency: (s && s.currency) || null,
    };
  });

  return json({
    configured: true,
    count: rows.length,
    accounts: rows.map((r) => ({
      key: r.key,
      label: r.label || r.name || r.seller,
      seller: r.seller,
      tz: r.tz,
      today: todayInTz(r.tz),
      connected: !!r.ok,
      // true = transactions visible, false = none visible at all, null = couldn't tell.
      readable: r.ok ? (r.readable === undefined ? null : r.readable) : null,
      name: r.name || null,
      currency: r.currency || null,
      error: r.ok
        ? (r.readable === false ? "no_transactions_visible" : undefined)
        : (r.status === 401 || r.status === 403 ? "unauthorized" : r.error || "error"),
      detail: r.ok
        ? (r.readable === false
            ? "Reachable, but this key returns no transactions for this seller at any date. Either the seller has never traded or the key cannot read its transactions — its revenue and sales tax will report as zero."
            : undefined)
        : r.detail,
    })),
  });
};

export const config = { path: "/api/xola/accounts" };
