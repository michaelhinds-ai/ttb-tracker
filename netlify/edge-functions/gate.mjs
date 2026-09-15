// Site-wide password gate for Mikey Systems.
function readEnv(key) {
  try { if (typeof Netlify !== "undefined" && Netlify.env) { const v = Netlify.env.get(key); if (v) return v; } } catch (_) {}
  try { if (typeof Deno !== "undefined" && Deno.env) { const v = Deno.env.get(key); if (v) return v; } } catch (_) {}
  return "";
}

export default async (request, context) => {
  const PASS = readEnv("SITE_PASSWORD");
  if (!PASS) return context.next();                 // not configured yet → don't lock
  const USER = readEnv("SITE_USER") || "lrwc";

  const header = request.headers.get("authorization") || "";
  let ok = false;
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const i = decoded.indexOf(":");
      ok = (decoded.slice(0, i) === USER && decoded.slice(i + 1) === PASS);
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
