import { getStore } from "@netlify/blobs";

// Compliance document store. Files (license, DSP permit, EIN letter, tax certs…) live
// in a Netlify blob store, scoped by workspace code. Only lightweight metadata (name,
// category, size) is kept in the app's synced state — the bytes never bloat the sync.
export default async (req) => {
  const url = new URL(req.url);
  const ws = (url.searchParams.get("ws") || "").trim();
  if (!ws || ws.length < 8) return json({ error: "missing_or_short_workspace" }, 400);
  const store = getStore({ name: "ttb-docs" });
  const id = (url.searchParams.get("id") || "").trim();
  const key = (i) => `ws_${ws}_${i}`;
  try {
    if (req.method === "POST" || req.method === "PUT") {
      const body = await req.json();
      if (!body || !body.id || !body.dataB64) return json({ error: "bad_body" }, 400);
      const bin = atob(body.dataB64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      await store.set(key(body.id), bytes, { metadata: { name: body.name || "file", type: body.type || "application/octet-stream" } });
      return json({ ok: true, id: body.id, size: bytes.length });
    }
    if (req.method === "GET") {
      if (!id) return json({ error: "missing_id" }, 400);
      const res = await store.getWithMetadata(key(id), { type: "arrayBuffer" });
      if (!res || !res.data) return json({ error: "not_found" }, 404);
      const meta = res.metadata || {};
      const dl = url.searchParams.get("dl") != null;
      const fname = String(meta.name || "file").replace(/[^\w.\- ]+/g, "_");
      return new Response(res.data, { status: 200, headers: {
        "content-type": meta.type || "application/octet-stream",
        "content-disposition": (dl ? "attachment" : "inline") + `; filename="${fname}"`,
        "cache-control": "private, no-store",
      }});
    }
    if (req.method === "DELETE") {
      if (!id) return json({ error: "missing_id" }, 400);
      await store.delete(key(id));
      return json({ ok: true });
    }
    return json({ error: "method_not_allowed" }, 405);
  } catch (e) {
    return json({ error: "server_error", detail: String((e && e.message) || e) }, 500);
  }
};
function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }
export const config = { path: "/api/docs" };
