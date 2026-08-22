// Shared Xola API helpers (server-side only). Mirrors lib/square.mjs so the two
// integrations behave the same way: an open-ended list of accounts, each pulled
// independently, one failure never blanking the others.
//
// ENV — an open-ended list of sellers. Add a 4th by setting XOLA_SELLER_ID_4;
// no code change required.
//
//   XOLA_API_KEY            Shared key, used for any seller without its own key.
//   XOLA_SELLER_ID          Legacy single-seller var. Still honored as seller 1.
//   XOLA_SELLER_ID_1..N     Seller ids. _1 falls back to XOLA_SELLER_ID.
//   XOLA_API_KEY_1..N       Optional per-seller key, when one key can't see them all.
//   XOLA_LABEL_1..N         Optional display name. Falls back to the seller's Xola name.
//   XOLA_TZ_1..N            Optional per-seller timezone. Falls back to SQUARE_TZ.
//   XOLA_API_BASE           Default https://xola.com
//
// Whether you need one key or three depends on your Xola login: if all three
// sellers sit under the same account, XOLA_API_KEY alone covers them, because
// the seller is chosen per-request via the `seller` query param.

const MAX_SELLERS = 12;   // hard ceiling on how many XOLA_SELLER_ID_n we look for
const MAX_PAGES = 60;     // page cap — the old code allowed 300, which could not finish in time
// Netlify's synchronous function limit is 10s. Sellers run in parallel, so the
// whole response is bounded by ONE seller's budget. The per-request timeout is
// clamped to whatever is left of that budget, which makes the worst case the
// budget itself rather than budget + one full page timeout.
// Lowered from 5000 so a retry fits inside the same budget. A healthy seller
// answers in about a second, so 4s is already generous; the extra headroom buys
// a second attempt, which is what the observed failures actually needed.
const PAGE_TIMEOUT_MS = 4000;
const TOTAL_BUDGET_MS = 8000;
// The readability probe only ever runs after a window came back EMPTY, which
// means that pull finished in one fast page. Kept short so the extra question
// still fits inside Netlify's 10s ceiling.
const PROBE_TIMEOUT_MS = 2500;

const g = (k) => (typeof Netlify !== "undefined" ? Netlify.env.get(k) : process.env[k]) || "";

export function apiBase() {
  return (g("XOLA_API_BASE") || "https://xola.com").replace(/\/+$/, "");
}

export class XolaError extends Error {
  constructor(code, status, detail) { super(code); this.code = code; this.status = status; this.detail = detail; }
}

// Every configured seller, in order. Sellers with no id are skipped, so a gap in
// the numbering (1 and 3 set, 2 empty) collapses cleanly instead of erroring.
export function accounts() {
  const sharedKey = g("XOLA_API_KEY");
  const baseTz = g("XOLA_TZ") || g("SQUARE_TZ") || "America/Chicago";
  const out = [];
  for (let i = 1; i <= MAX_SELLERS; i++) {
    const seller = g(`XOLA_SELLER_ID_${i}`) || (i === 1 ? g("XOLA_SELLER_ID") : "");
    if (!seller) continue;
    const apiKey = g(`XOLA_API_KEY_${i}`) || sharedKey;
    if (!apiKey) continue; // no credential reaches this seller — treat as unconfigured
    out.push({
      key: `x${i}`,
      label: g(`XOLA_LABEL_${i}`) || "",   // empty => callers fall back to the Xola seller name
      seller,
      apiKey,
      tz: g(`XOLA_TZ_${i}`) || baseTz,
      // Which state's return this seller's sales tax belongs on. Louisville is KY;
      // the Nashville sellers are TN and must never reach a Kentucky filing.
      state: (g(`XOLA_STATE_${i}`) || "").trim().toUpperCase(),
    });
  }
  // Legacy default: before per-seller states existed there was only ever one Xola
  // seller — Louisville — so the KY return was right by construction. Preserve
  // that ONLY while nobody has classified anything. The moment any XOLA_STATE_n
  // is set the classification is taken at face value, and an unclassified seller
  // is reported rather than assumed, because guessing its state is how tax ends
  // up on the wrong return.
  if (out.length && !out.some((a) => a.state)) out[0].state = "KY";
  return out;
}

// One request against the Xola REST API for a specific account.
export async function xFor(acct, path, { method = "GET", query, timeoutMs = PAGE_TIMEOUT_MS } = {}) {
  if (!acct || !acct.apiKey) throw new XolaError("not_configured", 401, "No API key for this seller.");
  const qs = new URLSearchParams(query || {});
  const url = `${apiBase()}${path}${qs.toString() ? `?${qs.toString()}` : ""}`;
  let r;
  try {
    r = await fetch(url, {
      method,
      headers: { "X-API-KEY": acct.apiKey, "Accept": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // A timeout here is the failure mode that used to hang the whole report.
    const to = e && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new XolaError(to ? "timeout" : "network_error", to ? 504 : 502, to ? `No response in ${timeoutMs}ms.` : String((e && e.message) || e));
  }
  const text = await r.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  if (!r.ok) {
    // 429 and 5xx are worth trying again; a 401 or a 400 never is.
    const code = r.status === 429 ? "rate_limited" : (r.status >= 500 ? "server_error" : "xola_error");
    throw new XolaError(code, r.status, (body && (body.message || body.error)) || text);
  }
  return body;
}

// Transient failures worth a second attempt. A bad key or a malformed query is
// not transient and must fail immediately rather than burning the time budget.
const RETRYABLE = new Set(["timeout", "network_error", "rate_limited", "server_error"]);

// One page, retried on transient failures for as long as the budget allows.
//
// Measured warm, a seller answers in 0.5-1.1s. The failures seen in production
// were bursts, not slowness: the Retail tab fires this period AND the prior year
// at once, so three sellers become six concurrent queries and Xola starts
// throttling — the busiest seller loses. A single retry clears that; a longer
// timeout would not, because the problem was never one slow response.
async function pageWithRetry(acct, path, query, deadline) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const left = deadline - Date.now();
    if (left <= 250) break;
    try {
      return await xFor(acct, path, { query, timeoutMs: Math.min(PAGE_TIMEOUT_MS, left) });
    } catch (e) {
      lastErr = e;
      if (!RETRYABLE.has(e && e.code)) throw e;
      // Short backoff, and only if there is still budget to make the retry count.
      const wait = 200 * (attempt + 1);
      if (deadline - Date.now() <= wait + 500) break;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr || new XolaError("timeout", 504, "No budget left for this page.");
}

// The seller's display name, for labeling a report column. Never throws — a
// label is cosmetic and must not take down a data pull.
export async function sellerName(acct) {
  try {
    const s = await xFor(acct, `/api/sellers/${encodeURIComponent(acct.seller)}`, { timeoutMs: 5000 });
    return (s && (s.name || s.company || (s.user && s.user.name))) || null;
  } catch { return null; }
}

// Paginated transaction pull for ONE seller.
// Bounded three ways: per-request timeout, total time budget, and a page cap.
// Returns { rows, truncated } so a caller can tell the user the window was cut
// short rather than silently reporting a low number.
export async function fetchTransactions(acct, {
  type, startISO, endISO, dateField = "createdAt", report = false, limit = 100, probe = false,
} = {}) {
  const rows = [];
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let cursor = null, truncated = false, pages = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    // Clamp this page's timeout to the budget that remains, so a page started
    // late can never push the response past TOTAL_BUDGET_MS.
    const left = deadline - Date.now();
    if (left <= 250) { truncated = true; break; }
    const query = { seller: acct.seller, limit: String(probe ? 5 : limit) };
    if (type) query.type = type;
    if (startISO) query[`${dateField}[gte]`] = startISO;
    if (endISO) query[`${dateField}[lte]`] = endISO;
    if (report) query.context = "report";
    if (cursor) query.cursor = cursor;

    const body = await pageWithRetry(acct, "/api/transactions", query, deadline);
    const batch = Array.isArray(body) ? body : (body && body.data) || [];
    for (const t of batch) rows.push(t);
    pages++;

    if (probe) break;
    const next = body && body.paging && body.paging.next;
    cursor = next ? extractCursor(next) : null;
    if (!cursor || batch.length === 0) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }
  return { rows, truncated, pages };
}

export function extractCursor(next) {
  const m = /[?&]cursor=([^&]+)/.exec(next || "");
  return m ? decodeURIComponent(m[1]) : null;
}

// Does this key see ANY transaction for this seller, ever?
//
// A seller returning nothing for a reporting window is ambiguous: it is either a
// genuinely quiet day, or a key that cannot read that seller's transactions at
// all. Xola answers 200 with an empty list in BOTH cases — no 401, no 403 — so
// an empty window on its own proves nothing. Reading the seller's profile does
// not settle it either: profile access and transaction access are separate
// grants, which is how three sellers can all report "connected" while two of
// them silently contribute zero revenue.
//
// The one question that separates them is this: ask for a single transaction
// with no date filter. Any seller with a trading history has one. None means the
// key is almost certainly blind to this seller.
//
// Returns true (readable), false (no transactions visible at all), or null
// (could not tell — a timeout or error must never be reported as unreadable).
export async function hasAnyTransactions(acct, timeoutMs = PROBE_TIMEOUT_MS) {
  try {
    const body = await xFor(acct, "/api/transactions", {
      query: { seller: acct.seller, limit: "1" },
      timeoutMs,
    });
    const batch = Array.isArray(body) ? body : (body && body.data) || [];
    return batch.length > 0;
  } catch {
    return null;
  }
}

// Run every account concurrently, catching per-account so one bad seller
// returns an error row instead of failing the whole response.
export async function eachAccount(accts, fn) {
  return Promise.all(accts.map(async (a) => {
    const base = { key: a.key, label: a.label || null, seller: a.seller, tz: a.tz };
    try {
      const data = await fn(a);
      return { ...base, ok: true, ...data };
    } catch (e) {
      return {
        ...base, ok: false,
        error: (e && e.code) || "xola_error",
        status: (e && e.status) || null,
        detail: safe(e && (e.detail || e.message)),
      };
    }
  }));
}

export function num(v) { const n = +v; return isFinite(n) ? n : 0; }
export function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
export function safe(d) {
  try { return typeof d === "string" ? d.slice(0, 400) : JSON.stringify(d).slice(0, 400); } catch { return ""; }
}
