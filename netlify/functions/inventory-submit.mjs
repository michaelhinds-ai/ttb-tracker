// Weekly store inventory submission → emails the reorder list to the designated person.
// POST /api/inventory-submit
//   { to, loc, by, countDate, submittedAt, totalUnits, lines:[{cat,item,desc,apparel,sizes,qty}], ws }
// Env: RESEND_API_KEY (required). From: INV_FROM || SALES_FROM ||
//      "Mikey Systems <sales@nashvillebarrelco.com>" (Resend-verified domain to reach any recipient).
const SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];
function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function fmtDate(d) { if (!d) return ""; const t = Date.parse(String(d).length <= 10 ? String(d) + "T00:00:00" : String(d)); if (isNaN(t)) return String(d); return new Date(t).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }); }

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  let b = {}; try { b = await req.json(); } catch { b = {}; }

  const to = String(b.to || "").trim();
  const loc = String(b.loc || "").trim() || "Store";
  const by = String(b.by || "").trim();
  const countDate = String(b.countDate || "").trim();
  const totalUnits = Number(b.totalUnits || 0);
  const lines = Array.isArray(b.lines) ? b.lines : [];

  if (!lines.length) return json({ ok: true, skipped: "no_lines" });
  // No recipient set for this store — the client already saved it; just report back.
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ ok: true, skipped: "no_recipient" });

  const key = (process.env.RESEND_API_KEY || "").trim();
  if (!key) return json({ ok: false, error: "RESEND_API_KEY not set" }, 200);
  const from = (process.env.INV_FROM || process.env.SALES_FROM || "Mikey Systems <sales@nashvillebarrelco.com>").trim();

  // Group lines by category, preserving submitted order.
  const cats = [];
  const seen = {};
  for (const ln of lines) {
    const c = String(ln.cat || "Items");
    if (!seen[c]) { seen[c] = { name: c, rows: [] }; cats.push(seen[c]); }
    seen[c].rows.push(ln);
  }

  // Mobile-first: no wide multi-column grids. Each item is one row (name on the left, total on the
  // right); apparel sizes show as small wrapping chips under the name, so nothing overflows a phone.
  let body = "";
  for (const c of cats) {
    body += `<tr><td colspan="2" style="background:#f0e9db;font-weight:700;padding:9px 14px;border-top:1px solid #e5ddcd;font-size:14px">${esc(c.name)}</td></tr>`;
    for (const ln of c.rows) {
      const name = `<span style="font-weight:600">${esc(ln.item || "")}</span>${ln.desc ? `<span style="font-size:12px;color:#8a7a63"> — ${esc(ln.desc)}</span>` : ""}`;
      let sizeChips = "";
      if (ln.apparel) {
        const sz = ln.sizes || {};
        const chips = SIZES.filter((s) => sz[s] != null && sz[s] !== "").map((s) => `<span style="display:inline-block;background:#f0e9db;border-radius:6px;padding:2px 8px;margin:3px 5px 0 0;font-size:13px;white-space:nowrap"><b>${esc(s)}</b>&nbsp;${esc(sz[s])}</span>`).join("");
        sizeChips = `<div style="margin-top:2px">${chips || '<span style="color:#a99;font-size:12px">none counted</span>'}</div>`;
      }
      body += `<tr><td style="padding:10px 14px;border-bottom:1px solid #eee;vertical-align:top">${name}${sizeChips}</td><td style="padding:10px 14px;border-bottom:1px solid #eee;text-align:right;font-weight:800;font-size:16px;white-space:nowrap;vertical-align:top">${esc(ln.qty || 0)}</td></tr>`;
    }
  }

  const subject = `Inventory — ${loc}${countDate ? " · " + fmtDate(countDate) : ""}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#f3ede2;padding:14px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#231a12;-webkit-text-size-adjust:100%">
    <div style="max-width:600px;width:100%;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(60,40,15,.08)">
      <div style="background:#231a12;color:#f3ede2;padding:15px 18px;font-weight:700;font-size:17px">Mikey Systems · Store Inventory</div>
      <div style="padding:16px 18px">
        <div style="font-size:15px;line-height:1.5;margin-bottom:12px">
          <div style="font-size:19px;font-weight:700">${esc(loc)}</div>
          <div style="color:#8a7a63">${countDate ? esc(fmtDate(countDate)) : ""}${by ? " · counted by " + esc(by) : ""}</div>
          <div style="margin-top:3px">Total units: <b>${esc(totalUnits)}</b></div>
        </div>
        <table role="presentation" style="border-collapse:collapse;width:100%;font-size:15px;border:1px solid #e5ddcd;border-radius:10px;overflow:hidden">${body}</table>
      </div>
      <div style="padding:12px 18px;background:#faf6ee;color:#8a7a63;font-size:12px">Submitted automatically from Mikey Systems when the ${esc(loc)} count was completed.</div>
    </div>
  </body></html>`;

  // Plain-text fallback
  let text = `Store Inventory — ${loc}\nInventory date: ${countDate ? fmtDate(countDate) : "—"}\nCounted by: ${by || "—"}\nTotal units: ${totalUnits}\n\n`;
  for (const c of cats) {
    text += `== ${c.name} ==\n`;
    for (const ln of c.rows) {
      if (ln.apparel) { const sz = ln.sizes || {}; const parts = SIZES.filter((s) => sz[s] != null).map((s) => `${s}:${sz[s]}`); text += `  ${ln.item}${ln.desc ? " (" + ln.desc + ")" : ""} — ${parts.join(" ")} = ${ln.qty || 0}\n`; }
      else text += `  ${ln.item}${ln.desc ? " (" + ln.desc + ")" : ""} — ${ln.qty || 0}\n`;
    }
  }
  text += `\n— Mikey Systems`;

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

export const config = { path: "/api/inventory-submit" };
