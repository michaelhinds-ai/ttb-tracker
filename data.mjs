import { getStore } from "@netlify/blobs";

// Simple synced key-value store for the TTB tracker.
// Each distillery workspace is a private code; data is one JSON blob per code.
export default async (req, context) => {
  const url = new URL(req.url);
  const ws = (url.searchParams.get("ws") || "").trim();

  // Require a reasonably-long workspace code so the bare domain can't reach real data.
  if (!ws || ws.length < 8) {
    return json({ error: "missing_or_short_workspace" }, 400);
  }

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
      const savedAt = new Date().toISOString();
      await store.setJSON(key, { ...body, _savedAt: savedAt });
      return json({ ok: true, savedAt });
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (e) {
    return json({ error: "server_error", detail: String(e && e.message || e) }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const config = { path: "/api/data" };
