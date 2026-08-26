import { exchangeCode, json } from "./lib/gbp.mjs";
export default async (req) => {
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  const err = u.searchParams.get("error");
  const ws = u.searchParams.get("state") || "";
  if (err) return new Response(null, { status: 302, headers: { Location: u.origin + "/?gbp=error#" + (ws?("ws="+encodeURIComponent(ws)):"") } });
  if (!code) return json({ error: "no_code" }, 400);
  try {
    await exchangeCode(req, code);
    return new Response(null, { status: 302, headers: { Location: u.origin + "/?gbp=connected#" + (ws?("ws="+encodeURIComponent(ws)):"") } });
  } catch (e) {
    return new Response(null, { status: 302, headers: { Location: u.origin + "/?gbp=error#" + (ws?("ws="+encodeURIComponent(ws)):"") } });
  }
};
export const config = { path: "/api/google/callback" };
