import { env, discovery, redirectUri, store } from "./lib/qb.mjs";

export default async (req) => {
  const { clientId, environment } = env();
  if (!clientId) return new Response("QuickBooks is not configured (QB_CLIENT_ID missing in environment variables).", { status: 500 });
  const url = new URL(req.url);
  const ws = (url.searchParams.get("ws") || "").trim();
  let d;
  try { d = await discovery(environment); } catch (e) { return new Response("Could not reach Intuit discovery document: " + e.message, { status: 502 }); }
  const rand = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random());
  const state = `${ws}~${rand}`;
  try { await store().set("oauth_state", state); } catch (e) {}
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: redirectUri(req),
    state,
  });
  return Response.redirect(`${d.authorization_endpoint}?${params.toString()}`, 302);
};

export const config = { path: "/api/qb/connect" };
