// One-time Shopify OAuth "callback": Shopify sends you here with a ?code after you
// approve. We swap that code (plus your Client ID + Secret) for a permanent Admin
// API access token and show it once so you can paste it into Netlify.
//
// Netlify env needed:  SHOPIFY_STORE, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET
const g = (k) => (typeof Netlify !== "undefined" ? Netlify.env.get(k) : process.env[k]) || "";

function page(body, status = 200) {
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<body style="font-family:system-ui,-apple-system,sans-serif;max-width:680px;margin:40px auto;padding:0 16px;line-height:1.5">${body}</body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

export default async (req) => {
  const store = g("SHOPIFY_STORE").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const clientId = g("SHOPIFY_CLIENT_ID");
  const clientSecret = g("SHOPIFY_CLIENT_SECRET");
  const u = new URL(req.url);
  const code = u.searchParams.get("code");

  if (!code) return page("<h2>Missing <code>?code</code></h2><p>Start the connect flow at <code>/api/shopify/auth</code>.</p>", 400);
  if (!store || !clientId || !clientSecret) {
    return page("<h2>Not configured</h2><p>Set <code>SHOPIFY_STORE</code>, <code>SHOPIFY_CLIENT_ID</code> and <code>SHOPIFY_CLIENT_SECRET</code> in Netlify, redeploy, then try again.</p>", 400);
  }

  let r, text = "", b = null;
  try {
    r = await fetch(`https://${store}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    text = await r.text();
    try { b = JSON.parse(text); } catch { /* keep raw */ }
  } catch (e) {
    return page(`<h2>Network error talking to Shopify</h2><pre>${(e && e.message) || e}</pre>`, 502);
  }

  if (!r.ok || !(b && b.access_token)) {
    return page(`<h2>Token exchange failed (${r.status})</h2><pre style="white-space:pre-wrap">${(text || "").slice(0, 400)}</pre>` +
      `<p>Common causes: the callback URL isn't in the app's Allowed redirect URLs, or the Client ID/Secret in Netlify don't match this app.</p>`, 502);
  }

  const token = b.access_token;
  return page(
    `<h2>Shopify connected &#10003;</h2>
     <p>Copy this Admin API token, paste it into Netlify as <code>SHOPIFY_ADMIN_TOKEN</code>, and redeploy:</p>
     <p style="font:14px/1.4 monospace;word-break:break-all;background:#0b0b0b;color:#3ad06a;padding:14px;border-radius:8px">${token}</p>
     <p style="color:#555">Scopes granted: ${b.scope || "(none reported)"}</p>
     <p>After it's saved in Netlify + redeployed, the weekly sync will pull Shopify customers automatically. You can then delete <code>SHOPIFY_CLIENT_ID</code> / <code>SHOPIFY_CLIENT_SECRET</code> if you want &mdash; the sync only needs <code>SHOPIFY_ADMIN_TOKEN</code>.</p>
     <p style="color:#b00">Don't paste this token into chat &mdash; Netlify only.</p>`,
    200
  );
};

export const config = { path: "/api/shopify/callback" };
