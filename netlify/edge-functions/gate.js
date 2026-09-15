// Site-wide password gate — fail-open, no Deno reference.
export default async (request, context) => {
  try {
    let PASS = "", USER = "lrwc";
    try { if (typeof Netlify !== "undefined" && Netlify.env) { PASS = Netlify.env.get("SITE_PASSWORD") || ""; USER = Netlify.env.get("SITE_USER") || "lrwc"; } } catch (_) {}
    if (!PASS && typeof globalThis !== "undefined" && globalThis.process && globalThis.process.env) {
      PASS = globalThis.process.env.SITE_PASSWORD || PASS;
      USER = globalThis.process.env.SITE_USER || USER;
    }
    if (!PASS) return context.next();

    const header = request.headers.get("authorization") || "";
    if (header.indexOf("Basic ") === 0) {
      const decoded = atob(header.slice(6));
      const i = decoded.indexOf(":");
      if (decoded.slice(0, i) === USER && decoded.slice(i + 1) === PASS) return context.next();
    }
    return new Response("Authentication required.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Mikey Systems", charset="UTF-8"', "Cache-Control": "no-store" }
    });
  } catch (e) {
    return context.next();
  }
};

export const config = { path: "/*" };
