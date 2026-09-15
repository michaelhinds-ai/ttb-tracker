// Site-wide password gate for Mikey Systems (Netlify Edge Function).
function readEnv(key) {
  try { if (typeof Netlify !== "undefined" && Netlify.env && Netlify.env.get) { const v = Netlify.env.get(key); if (v) return v; } } catch (_) {}
  try { if (typeof process !== "undefined" && process.env && process.env[key]) { return process.env[key]; } } catch (_) {}
  try { if (typeof Deno !== "undefined" && Deno.env && Deno.env.get) { const v = Deno.env.get(key); if (v) return v; } } catch (_) {}
  return "";
}

export default async (request, context) => {
  const PASS = readEnv("SITE_PASSWORD");
  if (!PASS) return context.next();
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
