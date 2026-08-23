// One-time FULL import of every eligible Square + Shopify contact into Mailchimp.
// This is a Netlify BACKGROUND function (filename ends in -background): it returns
// 202 immediately and runs up to 15 minutes, so it can page through the entire
// customer directory that the 10s sync function can't finish in one shot.
//
// Run once to seed the audience:  /.netlify/functions/mailchimp-import-background
// Results are written to the Netlify function log (background functions can't
// return a body to the browser). After this, the weekly mailchimp-sync keeps it current.
import { mcConfig, runSync } from "./lib/mailchimp.mjs";

export default async () => {
  const cfg = mcConfig();
  if (!cfg.ok) { console.log("mailchimp-import: not configured (need MAILCHIMP_API_KEY + MAILCHIMP_LIST_ID)"); return; }
  try {
    const r = await runSync({ full: true, dry: false });
    console.log("mailchimp-import complete:", JSON.stringify(r));
  } catch (e) {
    console.error("mailchimp-import failed:", (e && (e.detail || e.message)) || e);
  }
};
