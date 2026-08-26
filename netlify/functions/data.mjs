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
  const byId = new Map();
  for (const it of a) { if (it && it.id != null) byId.set(it.id, it); }
  for (const it of b) { if (it && it.id != null) byId.set(it.id, it); } // incoming wins on conflict
  const seen = new Set(b.filter((x) => x && x.id != null).map((x) => x.id));
  const out = [...b];                                   // keep incoming order first…
  for (const it of a) { if (it && it.id != null && !seen.has(it.id)) out.push(byId.get(it.id)); } // …then append cloud-only records
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
