// Read-only MCP server for the Nashville Barrel Co phone receptionist (xAI Grok Voice Agent).
// Streamable-HTTP MCP (JSON-RPC over POST, stateless). Exposes ONLY read tools over the
// Nashville Xola sellers: list experiences, open times for a date. It cannot book, cancel,
// refund or see any guest's reservation.
//
// ENV:
//   VOICE_MCP_TOKEN   Required. The voice agent sends it as "Authorization: Bearer <token>".
//   XOLA_*            Reuses lib/xola.mjs sellers. Nashville = sellers with XOLA_STATE_n=TN.
// URL: https://lrwc-ttb-tracker.netlify.app/mcp/nbc
import { accounts, xFor } from "./lib/xola.mjs";

const g = (k) => (typeof Netlify !== "undefined" ? Netlify.env.get(k) : process.env[k]) || "";
const TZ = "America/Chicago";
const BOOK_URL = "https://nashvillebarrelco.com/";

function nashvilleSellers() {
  const all = accounts();
  const tn = all.filter((a) => a.state === "TN");
  return tn.length ? tn : all.filter((a) => /nash|nbc|barrel|church|fessler/i.test(a.label));
}

// --- experience list, cached per warm instance for 10 minutes
let cache = { at: 0, data: null };
async function experiences() {
  if (cache.data && Date.now() - cache.at < 600000) return cache.data;
  const out = [];
  await Promise.all(nashvilleSellers().map(async (a) => {
    try {
      const r = await xFor(a, "/api/experiences", { query: { seller: a.seller, limit: 100 }, timeoutMs: 6000 });
      const list = Array.isArray(r) ? r : (r && (r.data || r.experiences)) || [];
      for (const e of list) {
        if (!e || e.disabled === true || e.status === "disabled" || e.archived === true) continue;
        out.push({
          id: e.id || e._id,
          name: e.name || "",
          location: a.label || "Nashville",
          price: typeof e.price === "number" ? e.price : null,
          priceType: e.priceType || "",
          durationMin: e.duration || null,
          about: String(e.excerpt || e.desc || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240),
          bookingUrl: `https://checkout.xola.com/index.html#seller/${a.seller}/experiences/${e.id || e._id}?openExternal=true`,
          _acct: a,
        });
      }
    } catch (err) { out.push({ error: `${a.label || a.key}: ${err.code || err.message}` }); }
  }));
  cache = { at: Date.now(), data: out };
  return out;
}

const fmtTime = (t) => { // "1430" or 1430 -> "2:30 PM"
  const s = String(t).padStart(4, "0"); let h = +s.slice(0, 2); const m = s.slice(2, 4);
  const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${m} ${ap}`;
};
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const okDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");
const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dayName = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

function pickLocation(list, loc) {
  if (!loc || /all|any|both/i.test(loc)) return list;
  const want = /church|down|ryman|broadway/i.test(loc) ? /church|down/i : /fessler|hq|east|main|distill/i;
  const f = list.filter((e) => want.test(e.location));
  return f.length ? f : list;
}
function matchExperience(list, q) {
  if (!q) return null;
  const s = String(q).toLowerCase();
  return list.find((e) => e.id === q) || list.find((e) => e.name.toLowerCase() === s)
    || list.find((e) => e.name.toLowerCase().includes(s))
    || list.find((e) => s.split(/\s+/).filter((w) => w.length > 3).every((w) => e.name.toLowerCase().includes(w)));
}
async function availability(exp, start, end) {
  const r = await xFor(exp._acct, `/api/experiences/${encodeURIComponent(exp.id)}/availability`, { query: { start, end }, timeoutMs: 6000 });
  return r || {};
}
function slotsFor(av, date, party) {
  const d = av[date];
  if (d == null) return [];
  if (typeof d === "number") return d >= party ? [{ time: "all day", seats: d }] : [];
  return Object.keys(d).sort().filter((t) => +d[t] >= party).map((t) => ({ time: fmtTime(t), seats: +d[t] }));
}

// --- tools
const TOOLS = [
  { name: "list_experiences",
    description: "List the tours, tastings and experiences Nashville Barrel Co sells, with location, price per person, length and a booking link. Use for 'what tours do you have', prices, or before checking times.",
    inputSchema: { type: "object", properties: { location: { type: "string", description: "'Fesslers Lane' (HQ), 'Church Street' (downtown), or 'all'. Default all." } } } },
  { name: "find_open_times",
    description: "Open, bookable start times on a date (and seats left), across experiences. Use when a caller asks what is available on a day. Dates are Central Time.",
    inputSchema: { type: "object", required: ["date"], properties: {
      date: { type: "string", description: "YYYY-MM-DD. Convert words like 'this Saturday' to a date first." },
      location: { type: "string", description: "'Fesslers Lane', 'Church Street' or 'all'." },
      experience: { type: "string", description: "Optional experience name or id to narrow to one experience." },
      party_size: { type: "integer", description: "Number of guests; only times with at least this many seats are returned. Default 1." } } } },
  { name: "check_dates",
    description: "For one experience, which of the next days (up to 14) have open times. Use when a caller is flexible on the date.",
    inputSchema: { type: "object", required: ["experience"], properties: {
      experience: { type: "string", description: "Experience name or id." },
      start_date: { type: "string", description: "YYYY-MM-DD, default today." },
      days: { type: "integer", description: "How many days to look ahead, 1-14. Default 7." },
      party_size: { type: "integer", description: "Guests. Default 1." } } } },
];

async function callTool(name, a = {}) {
  const list = (await experiences()).filter((e) => !e.error);
  if (!list.length) return "Live booking data is unavailable right now. Please send the caller to nashvillebarrelco.com to see times and book.";
  if (name === "list_experiences") {
    const l = pickLocation(list, a.location);
    return l.map((e) => `• ${e.name} — ${e.location}${e.price != null ? ` — $${e.price}${/person|guest|outing/i.test(e.priceType) || !e.priceType ? " per person" : ""}` : ""}${e.durationMin ? ` — about ${e.durationMin} min` : ""}${e.about ? `. ${e.about}` : ""} [id ${e.id}]`).join("\n")
      + `\nBooking: ${BOOK_URL} (or the experience booking link).`;
  }
  if (name === "find_open_times") {
    const date = okDate(a.date) ? a.date : null;
    if (!date) return "Please give the date as YYYY-MM-DD.";
    if (date < today()) return `${dayName(date)} is in the past.`;
    const party = Math.max(1, Math.min(60, +a.party_size || 1));
    let l = pickLocation(list, a.location);
    if (a.experience) { const m = matchExperience(l, a.experience) || matchExperience(list, a.experience); if (m) l = [m]; }
    const lines = await Promise.all(l.slice(0, 12).map(async (e) => {
      try { const s = slotsFor(await availability(e, date, date), date, party); return s.length ? `• ${e.name} (${e.location}): ${s.map((x) => `${x.time} (${x.seats} open)`).join(", ")}` : null; }
      catch { return `• ${e.name}: couldn't check right now`; }
    }));
    const hit = lines.filter(Boolean);
    return hit.length ? `Open times on ${dayName(date)}${party > 1 ? ` for ${party} guests` : ""}:\n${hit.join("\n")}\nTo book: ${BOOK_URL}`
      : `Nothing open on ${dayName(date)}${party > 1 ? ` for ${party} guests` : ""}. Offer another day, or for groups larger than the public tours, private events through Kelly.`;
  }
  if (name === "check_dates") {
    const e = matchExperience(list, a.experience);
    if (!e) return `I couldn't find that experience. Options: ${list.map((x) => x.name).join("; ")}.`;
    const start = okDate(a.start_date) && a.start_date >= today() ? a.start_date : today();
    const days = Math.max(1, Math.min(14, +a.days || 7)), end = addDays(start, days - 1);
    const party = Math.max(1, Math.min(60, +a.party_size || 1));
    const av = await availability(e, start, end);
    const out = [];
    for (let i = 0; i < days; i++) { const d = addDays(start, i); const s = slotsFor(av, d, party); if (s.length) out.push(`• ${dayName(d)}: ${s.map((x) => x.time).join(", ")}`); }
    return out.length ? `${e.name} (${e.location}) open dates${party > 1 ? ` for ${party}` : ""}:\n${out.join("\n")}` : `${e.name} has no open times from ${dayName(start)} to ${dayName(end)}.`;
  }
  throw Object.assign(new Error(`Unknown tool: ${name}`), { rpc: -32602 });
}

// --- JSON-RPC / MCP plumbing
const J = (obj, status = 200) => new Response(obj == null ? null : JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
async function handle(m) {
  const { id, method, params } = m || {};
  if (id === undefined || id === null) return null; // notification
  try {
    if (method === "initialize") return { jsonrpc: "2.0", id, result: { protocolVersion: (params && params.protocolVersion) || "2025-03-26", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "nbc-bookings", version: "1.0.0" }, instructions: "Read-only Nashville Barrel Co booking info from Xola. Times are Central. You cannot book; send callers to nashvillebarrelco.com." } };
    if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
    if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    if (method === "tools/call") {
      try { const text = await callTool(params && params.name, (params && params.arguments) || {}); return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } }; }
      catch (e) { if (e.rpc) throw e; return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "Booking data couldn't be reached right now. Send the caller to nashvillebarrelco.com." }], isError: true } }; }
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  } catch (e) { return { jsonrpc: "2.0", id, error: { code: e.rpc || -32603, message: e.message } }; }
}

export default async (req) => {
  const token = g("VOICE_MCP_TOKEN");
  if (!token) return J({ error: "not_configured" }, 503);
  const auth = req.headers.get("authorization") || "";
  const given = auth.replace(/^Bearer\s+/i, "") || req.headers.get("x-api-key") || "";
  if (given !== token) return J({ error: "unauthorized" }, 401);
  if (req.method !== "POST") return new Response("Use POST (MCP streamable HTTP).", { status: 405, headers: { allow: "POST" } });
  let body; try { body = await req.json(); } catch { return J({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
  if (Array.isArray(body)) { const r = (await Promise.all(body.map(handle))).filter(Boolean); return r.length ? J(r) : new Response(null, { status: 202 }); }
  const r = await handle(body);
  return r ? J(r) : new Response(null, { status: 202 });
};

export const config = { path: "/mcp/nbc" };
