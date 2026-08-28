// Shared QuickBooks Online OAuth2 + API helpers (server-side only).
import { getStore } from "@netlify/blobs";

const DISCOVERY = {
  production: "https://developer.api.intuit.com/.well-known/openid_configuration",
  sandbox: "https://developer.api.intuit.com/.well-known/openid_sandbox_configuration",
};
const API_BASE = {
  production: "https://quickbooks.api.intuit.com",
  sandbox: "https://sandbox-quickbooks.api.intuit.com",
};
const MINOR = "70"; // QBO API minor version

export function env() {
  return {
    clientId: Netlify.env.get("QB_CLIENT_ID") || "",
    clientSecret: Netlify.env.get("QB_CLIENT_SECRET") || "",
    environment: (Netlify.env.get("QB_ENVIRONMENT") || "production").toLowerCase(),
  };
}
export function store() { return getStore({ name: "qb-tokens", consistency: "strong" }); }
export function redirectUri(req) { return new URL(req.url).origin + "/api/qb/callback"; }
export function basicAuth() {
  const { clientId, clientSecret } = env();
  return "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

let _disc = null;
export async function discovery(environment) {
  if (_disc) return _disc;
  const r = await fetch(DISCOVERY[environment] || DISCOVERY.production);
  if (!r.ok) throw new QBError("discovery_failed", r.status, await r.text(), r.headers.get("intuit_tid"));
  _disc = await r.json();
  return _disc;
}
export function apiBase(environment) { return API_BASE[environment] || API_BASE.production; }

export async function saveTokens(tok) { await store().setJSON("tokens", { ...tok, savedAt: Date.now() }); }
export async function loadTokens() { return await store().get("tokens", { type: "json" }); }
export async function clearTokens() { try { await store().delete("tokens"); } catch (e) {} }

export class QBError extends Error {
  constructor(code, status, detail, tid) { super(code); this.code = code; this.status = status; this.detail = detail; this.tid = tid; }
}

// Return { accessToken, realmId, environment } refreshing when needed. null if not connected.
export async function getAccess() {
  const { clientId, clientSecret, environment } = env();
  let tok = await loadTokens();
  if (!tok || !tok.access_token) return null;
  const expiresAt = (tok.savedAt || 0) + ((tok.expires_in || 3600) * 1000);
  if (Date.now() < expiresAt - 300000) return { accessToken: tok.access_token, realmId: tok.realmId, environment };
  // refresh
  const d = await discovery(environment);
  const r = await fetch(d.token_endpoint, {
    method: "POST",
    headers: { "Authorization": basicAuth(), "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.refresh_token }),
  });
  if (!r.ok) { await clearTokens(); throw new QBError("refresh_failed", r.status, await r.text(), r.headers.get("intuit_tid")); }
  const nt = await r.json();
  tok = { ...tok, ...nt, savedAt: Date.now() };
  await saveTokens(tok);
  return { accessToken: tok.access_token, realmId: tok.realmId, environment };
}

// Call a QBO API path (e.g. "/invoice"). Retries once on 401 after forcing a refresh.
export async function qbFetch(path, opts = {}) {
  const acc = await getAccess();
  if (!acc) throw new QBError("not_connected", 401, "No QuickBooks connection");
  const url = `${apiBase(acc.environment)}/v3/company/${acc.realmId}${path}`;
  const call = (token) => fetch(url, { ...opts, headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json", "Content-Type": "application/json", ...(opts.headers || {}) } });
  let res = await call(acc.accessToken);
  if (res.status === 401) {
    const tok = await loadTokens();
    if (tok) { tok.savedAt = 0; await saveTokens(tok); }
    const acc2 = await getAccess();
    if (acc2) res = await call(acc2.accessToken);
  }
  const tid = res.headers.get("intuit_tid");
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) {}
  if (!res.ok) throw new QBError("api_error", res.status, text, tid);
  return { json, tid };
}

export async function qbQuery(query) {
  const r = await qbFetch(`/query?minorversion=${MINOR}&query=${encodeURIComponent(query)}`, { method: "GET" });
  return r.json;
}
export const MINOR_VERSION = MINOR;
export function escapeQ(s) { return String(s || "").replace(/'/g, "\\'"); }
export function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
