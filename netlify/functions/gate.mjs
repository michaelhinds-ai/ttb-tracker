// Site-wide password gate for Mikey Systems.
// Runs on EVERY request (page, assets, and /api/*) before anything else, so a
// stranger with the link can't even load the app or reach the data endpoint.
//
// Turn it on:
//   1. Deploy this file (netlify/edge-functions/gate.mjs).
//   2. In Netlify → Site settings → Environment variables, add:
//        SITE_PASSWORD = <the shared password you choose>
//      (optional) SITE_USER = <a username, defaults to "lrwc">
//   3. Redeploy. From then on the browser asks for the password once; your
//      per-person PIN login still runs behind it.
//
// Safety: if SITE_PASSWORD is empty/unset, the gate stays OPEN — so deploying
// the file can't lock you out before you've set the password. Set the password
// to activate the lock.

export default async (request, context) => {
  const PASS = Deno.env.get("SITE_PASSWORD") || "";
  if (!PASS) return context.next();                 // not configured yet → don't lock
  const USER = Deno.env.get("SITE_USER") || "lrwc";

  const header = request.headers.get("authorization") || "";
  let ok = false;
  if (header.startsWith("Basic ")) {
    try {
      const [u, p] = atob(header.slice(6)).split(":");
      ok = (u === USER && p === PASS);
    } catch (_) { ok = false; }
  }
  if (ok) return context.next();

  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Mikey Systems", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
};

export const config = { path: "/*" };
