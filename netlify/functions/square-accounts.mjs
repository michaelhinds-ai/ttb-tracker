// Connection status for every configured Square account (GET /api/square/accounts).
// Lets the Retail Sales tab show which accounts are live before pulling a day.
import { accounts, sqFor, json, todayInTz } from "./lib/square.mjs";

export default async () => {
  const accts = accounts();
  if (!accts.length) return json({ configured: false, accounts: [] });

  const rows = await Promise.all(accts.map(async (a) => {
    const base = { key: a.key, label: a.label, environment: a.environment, tz: a.tz, today: todayInTz(a.tz) };
    try {
      const r = await sqFor(a, "/v2/locations");
      const locs = (r.locations || []).filter((l) => l.status === "ACTIVE");
      return {
        ...base,
        connected: true,
        merchant: (locs[0] && locs[0].business_name) || null,
        locations: locs.map((l) => ({ id: l.id, name: l.name || l.id })),
      };
    } catch (e) {
      return { ...base, connected: false, error: (e && e.status) === 401 ? "unauthorized" : "error" };
    }
  }));

  return json({ configured: true, count: rows.length, accounts: rows });
};

export const config = { path: "/api/square/accounts" };
