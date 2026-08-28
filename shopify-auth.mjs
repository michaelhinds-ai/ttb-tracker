// One-time Shopify OAuth "start" endpoint.
// For stores on Shopify's new managed-install system, custom apps never reveal a
// static Admin API token in the UI (you only get Client ID + Secret). This mints
// one for you: it sends you to Shopify's approval screen, and the companion
// /api/shopify/callback exchanges the result for a real Admin API token.
//
// Netlify env needed:  SHOPIFY_STORE, SHOPIFY_CLIENT_ID  (SHOPIFY_CLIENT_SECRET for the callback)
// In the Shopify dev-dashboard app, add this to the app's Allowed redirect URL(s):
//   https://lrwc-ttb-tracker.netlify.app/api/shopify/callback
// Then just visit:  https://lrwc-ttb-tracker.netlify.app/api/shopify/auth
const g = (k) => (typeof Netlify !== "undefined" ? Netlify.env.get(k) : process.env[k]) || "";

export default async (req) => {
  const store = g("SHOPIFY_STORE").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const clientId = g("SHOPIFY_CLIENT_ID");
  if (!store || !clientId) {
    return new Response("Set SHOPIFY_STORE and SHOPIFY_CLIENT_ID in Netlify first, then redeploy.", { status: 400 });
  }
  const origin = new URL(req.url).origin;
  const redirect = `${origin}/api/shopify/callback`;
  const scope = g("SHOPIFY_SCOPES") || "read_customers";
  const state = "bsd-" + Math.random().toString(36).slice(2);
  const url = `https://${store}/admin/oauth/authorize`
    + `?client_id=${encodeURIComponent(clientId)}`
    + `&scope=${encodeURIComponent(scope)}`
    + `&redirect_uri=${encodeURIComponent(redirect)}`
    + `&state=${encodeURIComponent(state)}`;
  return Response.redirect(url, 302);
};

export const config = { path: "/api/shopify/auth" };
