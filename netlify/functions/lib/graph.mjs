// Microsoft Graph client-credentials helper for Mikey Systems.
// Reads/sends mail for monitored mailboxes using an app registration (daemon) —
// no per-user login. Requires these Netlify env vars:
//   MSGRAPH_TENANT         Directory (tenant) ID
//   MSGRAPH_CLIENT_ID      Application (client) ID
//   MSGRAPH_CLIENT_SECRET  Client secret VALUE
// Access is expected to be scoped (RBAC for Applications / Application Access Policy)
// to only the monitored mailboxes — the token itself is tenant-wide.

let _tok = null, _exp = 0;

export function graphConfigured() {
  return !!(process.env.MSGRAPH_TENANT && process.env.MSGRAPH_CLIENT_ID && process.env.MSGRAPH_CLIENT_SECRET);
}

export async function graphToken() {
  const now = Date.now();
  if (_tok && now < _exp - 60000) return _tok;
  const tenant = (process.env.MSGRAPH_TENANT || "").trim();
  const cid = (process.env.MSGRAPH_CLIENT_ID || "").trim();
  const sec = (process.env.MSGRAPH_CLIENT_SECRET || "").trim();
  if (!tenant || !cid || !sec) throw new Error("Microsoft 365 is not configured yet (set MSGRAPH_TENANT, MSGRAPH_CLIENT_ID, MSGRAPH_CLIENT_SECRET in Netlify).");
  const body = new URLSearchParams({
    client_id: cid, client_secret: sec,
    scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials",
  });
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error("Microsoft sign-in failed: " + (j.error_description || j.error || ("HTTP " + r.status)));
  _tok = j.access_token; _exp = now + ((j.expires_in || 3600) * 1000);
  return _tok;
}

// Call a Graph v1.0 endpoint. `path` starts with "/". Returns parsed JSON ({} on 204).
export async function graph(path, opts = {}) {
  const tok = await graphToken();
  const r = await fetch("https://graph.microsoft.com/v1.0" + path, {
    ...opts,
    headers: { authorization: "Bearer " + tok, "content-type": "application/json", ...(opts.headers || {}) },
  });
  if (r.status === 204) return {};
  const txt = await r.text();
  let j = {}; try { j = txt ? JSON.parse(txt) : {}; } catch { j = {}; }
  if (!r.ok) {
    const msg = (j.error && (j.error.message || j.error.code)) || ("HTTP " + r.status);
    const err = new Error("Graph " + path.split("?")[0] + ": " + msg);
    err.status = r.status; throw err;
  }
  return j;
}

export function jsonResp(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
