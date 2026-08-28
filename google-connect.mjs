import { authUrl, env, json } from "./lib/gbp.mjs";
export default async (req) => {
  if (!env().clientId) return json({ error: "not_configured", detail: "Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in Netlify." }, 400);
  const ws = new URL(req.url).searchParams.get("ws") || "";
  return new Response(null, { status: 302, headers: { Location: authUrl(req, ws) } });
};
export const config = { path: "/api/google/connect" };
