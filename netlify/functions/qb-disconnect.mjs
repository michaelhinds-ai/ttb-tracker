import { env, discovery, basicAuth, loadTokens, clearTokens } from "./lib/qb.mjs";

// Handles both the app's disconnect button (?app=1 → JSON) and Intuit's disconnect ping (→ HTML).
export default async (req) => {
  const { environment } = env();
  const tok = await loadTokens();
  if (tok && tok.refresh_token) {
    try {
      const d = await discovery(environment);
      const rev = d.revocation_endpoint || "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
      await fetch(rev, { method: "POST", headers: { "Authorization": basicAuth(), "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ token: tok.refresh_token }) });
    } catch (e) { console.error("QB revoke error", e && e.message); }
  }
  await clearTokens();
  const url = new URL(req.url);
  if (url.searchParams.get("app")) return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  return new Response("QuickBooks disconnected.", { status: 200, headers: { "content-type": "text/plain" } });
};

export const config = { path: "/api/qb/disconnect" };
