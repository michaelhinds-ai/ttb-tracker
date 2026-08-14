// Shared Square API helpers (server-side only). Uses a seller access token from env.
const API_BASE = {
  production: "https://connect.squareup.com",
  sandbox: "https://connect.squareupsandbox.com",
};

export function env() {
  return {
    token: Netlify.env.get("SQUARE_ACCESS_TOKEN") || "",
    environment: (Netlify.env.get("SQUARE_ENVIRONMENT") || "production").toLowerCase(),
    locationId: Netlify.env.get("SQUARE_LOCATION_ID") || "L23JY23H1APF3",
    version: Netlify.env.get("SQUARE_VERSION") || "2024-01-18",
    tz: Netlify.env.get("SQUARE_TZ") || "America/Chicago",
  };
}
export function apiBase(e) { return API_BASE[e] || API_BASE.production; }

// ---- Multi-account support -------------------------------------------------
// Account 1 is the original SQUARE_ACCESS_TOKEN. Account 2 is optional and only
// appears once SQUARE_ACCESS_TOKEN_2 is set in Netlify. Labels/timezones fall
// back sensibly so nothing breaks if only account 1 is configured.
export function accounts() {
  const g = (k) => Netlify.env.get(k) || "";
  const baseTz = g("SQUARE_TZ") || "America/Chicago";
  const baseVersion = g("SQUARE_VERSION") || "2024-01-18";
  const baseEnv = (g("SQUARE_ENVIRONMENT") || "production").toLowerCase();
  const list = [
    {
      key: "a1",
      label: g("SQUARE_LABEL_1") || "",   // empty => callers fall back to the Square business name
      token: g("SQUARE_ACCESS_TOKEN"),
      environment: baseEnv,
      version: baseVersion,
      tz: baseTz,
    },
    {
      key: "a2",
      label: g("SQUARE_LABEL_2") || "",
      token: g("SQUARE_ACCESS_TOKEN_2"),
      environment: (g("SQUARE_ENVIRONMENT_2") || baseEnv).toLowerCase(),
      version: g("SQUARE_VERSION_2") || baseVersion,
      tz: g("SQUARE_TZ_2") || baseTz,
    },
  ];
  return list.filter((a) => !!a.token);
}

// Same as sq(), but against a specific account object from accounts().
export async function sqFor(acct, path, { method = "GET", body } = {}) {
  if (!acct || !acct.token) throw new SqError("not_configured", 401, "No access token for this account.");
  const r = await fetch(apiBase(acct.environment) + path, {
    method,
    headers: {
      "Authorization": "Bearer " + acct.token,
      "Square-Version": acct.version,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  if (!r.ok) throw new SqError("square_error", r.status, (json && json.errors) || text);
  return json;
}

export class SqError extends Error {
  constructor(code, status, detail) { super(code); this.code = code; this.status = status; this.detail = detail; }
}

export async function sq(path, { method = "GET", body } = {}) {
  const { token, environment, version } = env();
  if (!token) throw new SqError("not_configured", 401, "No SQUARE_ACCESS_TOKEN set.");
  const r = await fetch(apiBase(environment) + path, {
    method,
    headers: {
      "Authorization": "Bearer " + token,
      "Square-Version": version,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  if (!r.ok) throw new SqError("square_error", r.status, (json && json.errors) || text);
  return json;
}

// The month's [start,end) as RFC3339 instants in the seller's local timezone.
export function monthRange(year, month /*1-12*/, tz) {
  const startISO = localMidnightUTC(year, month, 1, tz);
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  const endISO = localMidnightUTC(ny, nm, 1, tz);
  return { startISO, endISO };
}
// A single local day's [start,end) as RFC3339 instants, from "YYYY-MM-DD".
export function dayRange(ymd, tz) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const startISO = localMidnightUTC(y, m, d, tz);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const endISO = localMidnightUTC(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), tz);
  return { startISO, endISO };
}

// "YYYY-MM-DD" for right now in the given timezone.
export function todayInTz(tz) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return p; // en-CA formats as YYYY-MM-DD
}

function localMidnightUTC(y, m, d, tz) {
  let guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false, year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(guess));
    const g = (t) => +parts.find((p) => p.type === t).value;
    let hr = g("hour"); if (hr === 24) hr = 0;
    const localAsUTC = Date.UTC(g("year"), g("month") - 1, g("day"), hr, g("minute"), g("second"));
    const diff = Date.UTC(y, m - 1, d, 0, 0, 0) - localAsUTC;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess).toISOString();
}

export function json(o, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
