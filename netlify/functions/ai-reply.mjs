// "Ask AI" for the Monitored Inbox — polishes a draft support reply.
// POST /api/ai-reply  { draft, incoming, mailbox } -> { ok, reply }
// Env: ANTHROPIC_API_KEY (required), AI_MODEL (optional, defaults below).
function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  let b = {}; try { b = await req.json(); } catch { b = {}; }
  const key = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!key) return json({ ok: false, error: "AI isn’t set up yet — add ANTHROPIC_API_KEY in Netlify and redeploy." }, 200);
  const model = (process.env.AI_MODEL || "claude-3-5-haiku-latest").trim();

  const draft = String(b.draft || "").slice(0, 4000);
  const incoming = String(b.incoming || "").slice(0, 6000);
  const system = "You help a Kentucky/Nashville distillery's customer-support team write email replies. Improve the given draft reply so it is professional, warm, and concise, and directly answers the customer. Preserve any specific facts, prices, dates, or commitments in the draft — do not invent new ones. If the draft is empty, write a helpful reply to the customer's message. Return ONLY the reply text — no preamble, no subject line, and no signature block unless one is already in the draft.";
  const user = `Customer's message:\n"""${incoming || "(not available)"}"""\n\nDraft reply to improve:\n"""${draft || "(empty — please draft a good reply)"}"""`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 1000, system, messages: [{ role: "user", content: user }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return json({ ok: false, error: "AI error: " + ((j.error && j.error.message) || ("HTTP " + r.status)) }, 200);
    const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
    if (!text) return json({ ok: false, error: "AI returned nothing — try again." }, 200);
    return json({ ok: true, reply: text });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 200);
  }
};

export const config = { path: "/api/ai-reply" };
