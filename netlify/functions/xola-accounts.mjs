// Connection status for every configured Xola seller (GET /api/xola/accounts).
// Mirrors /api/square/accounts so the Retail Sales tab can show which sellers are
// live before pulling a day — and, more usefully, surface a seller that is
// configured but unreachable, which would otherwise just look like a slow day.
import { json, todayInTz } from "./lib/square.mjs";
import { accounts, eachAccount, xFor } from "./lib/xola.mjs";

export default async () => {
  const accts = accounts();
  if (!accts.length) return json({ configured: false, accounts: [] });

  const rows = await eachAccount(accts, async (a) => {
    // Cheapest call that proves both the key and the seller id are good.
    const s = await xFor(a, `/api/sellers/${encodeURIComponent(a.seller)}`, { timeoutMs: 6000 });
    return {
      connected: true,
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
      name: r.name || null,
      currency: r.currency || null,
      error: r.ok ? undefined : (r.status === 401 || r.status === 403 ? "unauthorized" : r.error || "error"),
      detail: r.ok ? undefined : r.detail,
    })),
  });
};

export const config = { path: "/api/xola/accounts" };
