import { env, discovery, redirectUri, basicAuth, saveTokens, store } from "./lib/qb.mjs";

function page(title, msg, backHref) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
  <style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f6f1e7;color:#2b2118;display:grid;place-items:center;height:100vh;margin:0}
  .card{background:#fffdf8;border:1px solid #e4d9c6;border-radius:14px;padding:34px 40px;box-shadow:0 8px 24px rgba(60,40,20,.08);max-width:440px;text-align:center}
  h1{font-size:20px;margin:0 0 8px}p{color:#6a5740;font-size:14px}a{display:inline-block;margin-top:16px;background:#a8582b;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-weight:700}</style></head>
  <body><div class="card"><h1>${title}</h1><p>${msg}</p><a href="${backHref}">Return to the app</a></div></body></html>`;
}

export default async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const state = url.searchParams.get("state") || "";
  const ws = state.split("~")[0] || "";
  const back = "/" + (ws ? "#ws=" + encodeURIComponent(ws) : "");
  const { clientId, clientSecret, environment } = env();

  if (url.searchParams.get("error")) return new Response(page("Connection cancelled", "QuickBooks authorization was cancelled.", back), { status: 200, headers: { "content-type": "text/html" } });
  if (!code || !realmId) return new Response(page("Connection failed", "Missing authorization code or company id from Intuit.", back), { status: 400, headers: { "content-type": "text/html" } });

  try {
    const d = await discovery(environment);
    const r = await fetch(d.token_endpoint, {
      method: "POST",
      headers: { "Authorization": basicAuth(), "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(req) }),
    });
    const tid = r.headers.get("intuit_tid");
    if (!r.ok) { const t = await r.text(); console.error("QB token exchange failed", r.status, tid, t); return new Response(page("Connection failed", `Token exchange failed (status ${r.status}). Ref: ${tid || "n/a"}`, back), { status: 200, headers: { "content-type": "text/html" } }); }
    const tok = await r.json();
    await saveTokens({ ...tok, realmId });
    try { await store().delete("oauth_state"); } catch (e) {}
    return new Response(page("QuickBooks connected", "Your Louisville QuickBooks company is now linked. You can close this and return to the app.", back), { status: 200, headers: { "content-type": "text/html" } });
  } catch (e) {
    console.error("QB callback error", e && e.message);
    return new Response(page("Connection error", "Something went wrong finishing the QuickBooks connection: " + (e && e.message), back), { status: 200, headers: { "content-type": "text/html" } });
  }
};

export const config = { path: "/api/qb/callback" };
