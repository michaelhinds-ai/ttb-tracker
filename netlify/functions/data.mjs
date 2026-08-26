import { getStore } from "@netlify/blobs";

// Synced key-value store for the TTB tracker — one JSON blob per workspace code.
// Conflict-safe: each save carries the _savedAt it was based on. If the cloud has
// advanced since (another device saved in between), we MERGE record collections by
// id instead of letting the stale save overwrite — so no order/entry/customer is ever
// lost when two devices are open at once.
const ARR_KEYS = [
  "entries", "orders", "customers", "finishedGoods", "barrels", "bottlings",
  "skus", "tibouts", "tibins", "tasks", "docs", "assets", "barrelsProc", "dailyBackups",
];

function mergeById(cloudArr, incArr) {
  const a = Array.isArray(cloudArr) ? cloudArr : [];
  const b = Array.isArray(incArr) ? incArr : [];
  const cloudById = new Map();
  for (const it of a) { if (it && it.id != null) cloudById.set(it.id, it); }
  // For a record present on both sides, keep whichever was changed most recently (_upd).
  // Records that never carry _upd (orders, customers, …) default to 0, so incoming wins —
  // same as before. Records that DO carry _upd (finished goods) can't be reverted by a
  // stale device that holds an older copy.
  const winner = (inc) => { const ex = cloudById.get(inc.id); if (ex && (Number(ex._upd) || 0) > (Number(inc._upd) || 0)) return ex; return inc; };
  const seen = new Set();
  const out = [];
  for (const it of b) { if (it && it.id != null) { seen.add(it.id); out.push(winner(it)); } else if (it) out.push(it); }
  for (const it of a) { if (it && it.id != null && !seen.has(it.id)) out.push(it); } // append cloud-only records
  return out;
}

function mergeStates(cloud, inc) {
  const out = { ...inc };
  for (const k of ARR_KEYS) out[k] = mergeById(cloud[k], inc[k]);
  // Merge the user list too (by id), so a device that hasn't seen a new user doesn't drop them.
  if ((cloud.auth && Array.isArray(cloud.auth.users)) || (inc.auth && Array.isArray(inc.auth.users))) {
    out.auth = { ...(inc.auth || {}), users: mergeById(cloud.auth && cloud.auth.users, inc.auth && inc.auth.users) };
  }
  return out;
}

export default async (req) => {
  const url = new URL(req.url);
  const ws = (url.searchParams.get("ws") || "").trim();
  if (!ws || ws.length < 8) return json({ error: "missing_or_short_workspace" }, 400);

  const store = getStore({ name: "ttb-data", consistency: "strong" });
  const key = `ws_${ws}`;

  try {
    if (req.method === "GET") {
      const data = await store.get(key, { type: "json" });
      return json(data ?? null);
    }

    if (req.method === "POST" || req.method === "PUT") {
      const body = await req.json();
      if (!body || typeof body !== "object") return json({ error: "bad_body" }, 400);
      const base = body._baseSavedAt;
      if ("_baseSavedAt" in body) delete body._baseSavedAt;

      const current = await store.get(key, { type: "json" });
      let toSave = body, merged = false;
      // Only merge when there's a genuine conflict (the client based its save on an older
      // cloud version). In the normal case (base matches) we save as-is, so deletes/reverses
      // propagate correctly.
      if (current && current._savedAt && base != null && String(current._savedAt) !== String(base)) {
        toSave = mergeStates(current, body);
        merged = true;
      }
      const savedAt = new Date().toISOString();
      const saved = { ...toSave, _savedAt: savedAt };
      await store.setJSON(key, saved);
      return json(merged ? { ok: true, savedAt, merged: true, state: saved } : { ok: true, savedAt });
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (e) {
    return json({ error: "server_error", detail: String((e && e.message) || e) }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
export const config = { path: "/api/data" };
