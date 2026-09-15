// Site-wide password gate for Mikey Systems.
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
