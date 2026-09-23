// Weekly store supply reorder → emails the list to the designated person, split into
// "Order & deliver to <store>" and "Pick up from HQ".
// POST /api/supply-submit
//   { to, loc, by, week, submittedAt, deliver:[names], hq:[names], ws }
// Env: RESEND_API_KEY (required). From: SUPPLY_FROM || INV_FROM || SALES_FROM ||
//      "Mikey Systems <sales@nashvillebarrelco.com>".
function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  let b = {}; try { b = await req.json(); } catch { b = {}; }

  const to = String(b.to || "").trim();
  const loc = String(b.loc || "").trim() || "Store";
  const by = String(b.by || "").trim();
  const week = String(b.week || "").trim();
  const deliver = Array.isArray(b.deliver) ? b.deliver.map((x) => String(x || "")).filter(Boolean) : [];
  const hq = Array.isArray(b.hq) ? b.hq.map((x) => String(x || "")).filter(Boolean) : [];

  if (!deliver.length && !hq.length) return json({ ok: true, skipped: "no_items" });
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ ok: true, skipped: "no_recipient" });

  const key = (process.env.RESEND_API_KEY || "").trim();
  if (!key) return json({ ok: false, error: "RESEND_API_KEY not set" }, 200);
  const from = (process.env.SUPPLY_FROM || process.env.INV_FROM || process.env.SALES_FROM || "Mikey Systems <sales@nashvillebarrelco.com>").trim();

  const section = (title, tint, list) => list.length ? (
    `<tr><td style="background:${tint};font-weight:700;padding:9px 14px;border-top:1px solid #e5ddcd;font-size:14px">${esc(title)} · ${list.length}</td></tr>` +
    list.map((n) => `<tr><td style="padding:9px 14px;border-bottom:1px solid #eee;font-size:15px;line-height:1.4">${esc(n)}</td></tr>`).join("")
  ) : "";

  const rows = section(`Order & deliver to ${loc}`, "#f0e9db", deliver) + section("Pick up from HQ", "#efe3d0", hq);
  const total = deliver.length + hq.length;

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#f3ede2;padding:14px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#231a12;-webkit-text-size-adjust:100%">
    <div style="max-width:600px;width:100%;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(60,40,15,.08)">
      <div style="background:#231a12;color:#f3ede2;padding:15px 18px;font-weight:700;font-size:17px">Mikey Systems · Supply Reorder</div>
      <div style="padding:16px 18px">
        <div style="font-size:15px;line-height:1.5;margin-bottom:12px">
          <div style="font-size:19px;font-weight:700">${esc(loc)}</div>
          ${week ? `<div style="color:#8a7a63">Week of ${esc(week)}</div>` : ""}
          <div style="color:#8a7a63">${by ? "Submitted by " + esc(by) + " · " : ""}${total} item${total === 1 ? "" : "s"} to reorder</div>
        </div>
        <table role="presentation" style="border-collapse:collapse;width:100%;border:1px solid #e5ddcd;border-radius:10px;overflow:hidden"><tbody>${rows}</tbody></table>
      </div>
      <div style="padding:12px 18px;background:#faf6ee;color:#8a7a63;font-size:12px">Submitted from Mikey Systems when ${esc(loc)} flagged these supplies to reorder.</div>
    </div>
  </body></html>`;

  let text = `Supply Reorder — ${loc}${week ? " (week of " + week + ")" : ""}\nSubmitted by: ${by || "—"}\n`;
  if (deliver.length) text += `\n== Order & deliver to ${loc} ==\n` + deliver.map((n) => "  - " + n).join("\n") + "\n";
  if (hq.length) text += `\n== Pick up from HQ ==\n` + hq.map((n) => "  - " + n).join("\n") + "\n";
  text += `\n— Mikey Systems`;

  const subject = `Supply Reorder — ${loc}${week ? " · week of " + week : ""} (${total})`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + key, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return json({ ok: false, error: (j && (j.message || j.name)) || ("HTTP " + r.status) }, 200);
    return json({ ok: true, id: j.id || null });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 200);
  }
};

export const config = { path: "/api/supply-submit" };
