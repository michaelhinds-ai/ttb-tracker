// Wednesday 10 AM Central: e-mail each store manager whose store hasn't submitted its weekly
// inventory since last Wednesday's 3 PM rollup (see lib/invrollup.mjs → sendReminders).
// Runs at 15:00 and 16:00 UTC and only sends on the run that is 10 AM in Nashville (DST-proof).
// Manual / dry run: POST /api/inventory-rollup-send { ws, remind: true, dry: true }.
import { getStore } from "@netlify/blobs";
import { sendReminders } from "./lib/invrollup.mjs";

function chicagoHour(d = new Date()) { return +new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }).format(d) % 24; }

export default async () => {
  if (chicagoHour() !== 10) return new Response("not 10am Central — skipped", { status: 200 });
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) { console.error("inventory-remind: RESEND_API_KEY missing"); return new Response("no api key", { status: 200 }); }
  const from = (process.env.INV_FROM || process.env.SALES_FROM || "Mikey Systems <sales@nashvillebarrelco.com>").trim();
  const wsCodes = (process.env.BACKUP_WS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const store = getStore({ name: "ttb-data", consistency: "strong" });
  for (const code of wsCodes) {
    try {
      const data = await store.get(`ws_${code}`, { type: "json" });
      if (!data) continue;
      const r = await sendReminders(data, { apiKey, from });
      console.log("inventory-remind", code.slice(0, 6), JSON.stringify(r));
    } catch (e) { console.error("inventory-remind failed", e && e.message); }
  }
  return new Response("ok", { status: 200 });
};

export const config = { schedule: "0 15,16 * * 3" }; // Wednesdays; the 10 AM Central run sends
