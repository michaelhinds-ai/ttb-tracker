// Monday-morning all-stores inventory rollup → settings.invRollupTo (set in the app:
// Store Inventory → Manage → "Weekly all-stores rollup"). One email per workspace in BACKUP_WS.
// Runs at 13:00 and 14:00 UTC on Mondays and only sends on the run that is 8 AM in Nashville,
// so it stays 8 AM Central through daylight-saving changes.
// Env: RESEND_API_KEY, BACKUP_WS, optional INV_FROM / SALES_FROM.
import { getStore } from "@netlify/blobs";
import { sendRollup } from "./lib/invrollup.mjs";

function chicagoHour(d = new Date()) { return +new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }).format(d) % 24; }

export default async (req) => {
  let force = false; try { const b = await req.json(); force = !!(b && b.force); } catch {}
  if (!force && chicagoHour() !== 8) return new Response("not 8am Central — skipped", { status: 200 });
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) { console.error("inventory-rollup: RESEND_API_KEY missing"); return new Response("no api key", { status: 200 }); }
  const from = (process.env.INV_FROM || process.env.SALES_FROM || "Mikey Systems <sales@nashvillebarrelco.com>").trim();
  const wsCodes = (process.env.BACKUP_WS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const store = getStore({ name: "ttb-data", consistency: "strong" });
  let sent = 0;
  for (const code of wsCodes) {
    try {
      const data = await store.get(`ws_${code}`, { type: "json" });
      if (!data) continue;
      const r = await sendRollup(data, { apiKey, from });
      if (r.ok && !r.skipped) sent++;
      console.log("inventory-rollup", code.slice(0, 6), JSON.stringify({ ok: r.ok, skipped: r.skipped, error: r.error, missing: r.missing }));
    } catch (e) { console.error("inventory-rollup failed for workspace", e && e.message); }
  }
  return new Response("sent " + sent, { status: 200 });
};

export const config = { schedule: "0 13,14 * * 1" };
