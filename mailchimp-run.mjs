// Manually-invokable Square + Shopify -> Mailchimp sync (HTTP, returns JSON).
// The scheduled weekly job (mailchimp-sync) can't be hit over HTTP, so this is the
// endpoint you use to test and to seed.
//
//   /.netlify/functions/mailchimp-run?dry=1     report counts, write NOTHING
//   /.netlify/functions/mailchimp-run?full=1    import EVERYONE now (small directories;
//                                               use mailchimp-import-background for a big seed)
//   /.netlify/functions/mailchimp-run           incremental (last ~8 days), and writes
//   &days=30                                    widen the look-back window
import { json } from "./lib/square.mjs";
import { mcConfig, shopifyConfig, runSync } from "./lib/mailchimp.mjs";

export default async (req) => {
  const cfg = mcConfig();
  if (!cfg.ok) return json({ configured: false, error: "not_configured", detail: "Set MAILCHIMP_API_KEY and MAILCHIMP_LIST_ID in Netlify." }, 200);
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") != null;
  const full = url.searchParams.get("full") != null;
  const days = +url.searchParams.get("days") || 8;
  try {
    const r = await runSync({ full, dry, sinceDays: days });
    return json({ ok: true, shopifyConfigured: shopifyConfig().ok, ...r });
  } catch (e) {
    return json({ error: "sync_error", status: (e && e.status) || null, detail: (e && (e.detail || e.message)) || "error" }, 502);
  }
};

export const config = { path: "/api/mailchimp/run" };
