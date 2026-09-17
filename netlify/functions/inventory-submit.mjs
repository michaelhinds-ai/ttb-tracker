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

  const anyApparel = lines.some((l) => l && l.apparel);
  const colspanHead = anyApparel
    ? `<th align="left">Item</th>${SIZES.map((s) => `<th align="center">${s}</th>`).join("")}<th align="center">Total</th>`
    : `<th align="left">Item</th><th align="center">Count</th>`;

  let body = "";
  for (const c of cats) {
    body += `<tr><td colspan="${anyApparel ? SIZES.length + 2 : 2}" style="background:#f0e9db;font-weight:700;padding:7px 10px;border-top:1px solid #ddd">${esc(c.name)}</td></tr>`;
    for (const ln of c.rows) {
      const name = `<b>${esc(ln.item || "")}</b>${ln.desc ? `<div style="font-size:11px;color:#8a7a63">${esc(ln.desc)}</div>` : ""}`;
      if (anyApparel) {
        if (ln.apparel) {
          const sz = ln.sizes || {};
          const cells = SIZES.map((s) => `<td align="center" style="padding:5px 8px;border-bottom:1px solid #eee">${sz[s] != null ? esc(sz[s]) : ""}</td>`).join("");
          body += `<tr><td style="padding:5px 10px;border-bottom:1px solid #eee">${name}</td>${cells}<td align="center" style="padding:5px 8px;border-bottom:1px solid #eee;font-weight:700">${esc(ln.qty || 0)}</td></tr>`;
        } else {
          body += `<tr><td style="padding:5px 10px;border-bottom:1px solid #eee">${name}</td><td colspan="${SIZES.length}" style="border-bottom:1px solid #eee"></td><td align="center" style="padding:5px 8px;border-bottom:1px solid #eee;font-weight:700">${esc(ln.qty || 0)}</td></tr>`;
        }
      } else {
        body += `<tr><td style="padding:5px 10px;border-bottom:1px solid #eee">${name}</td><td align="center" style="padding:5px 8px;border-bottom:1px solid #eee;font-weight:700">${esc(ln.qty || 0)}</td></tr>`;
      }
    }
  }

  const subject = `Inventory — ${loc}${countDate ? " · " + fmtDate(countDate) : ""}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3ede2;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(60,40,15,.08)">
      <div style="background:#231a12;color:#f3ede2;padding:18px 24px;font-weight:700;font-size:16px">Mikey Systems · Store Inventory</div>
      <div style="padding:22px 24px">
        <table style="border-collapse:collapse;width:100%;margin-bottom:14px">
          <tr><td style="color:#8a7a63;font-size:13px;width:120px;padding:3px 0">Location</td><td style="font-size:15px;font-weight:600;padding:3px 0">${esc(loc)}</td></tr>
          <tr><td style="color:#8a7a63;font-size:13px;padding:3px 0">Inventory date</td><td style="font-size:15px;padding:3px 0">${countDate ? esc(fmtDate(countDate)) : "—"}</td></tr>
          <tr><td style="color:#8a7a63;font-size:13px;padding:3px 0">Counted by</td><td style="font-size:15px;padding:3px 0">${esc(by || "—")}</td></tr>
          <tr><td style="color:#8a7a63;font-size:13px;padding:3px 0">Total units</td><td style="font-size:15px;font-weight:700;padding:3px 0">${esc(totalUnits)}</td></tr>
        </table>
        <table style="border-collapse:collapse;width:100%;font-size:14px;border:1px solid #e5ddcd">
          <thead><tr style="background:#231a12;color:#f3ede2">${colspanHead.replace(/<th /g, '<th style="padding:7px 10px;font-size:12px" ')}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <div style="padding:14px 24px;background:#faf6ee;color:#8a7a63;font-size:12px">Submitted automatically from Mikey Systems when the ${esc(loc)} count was completed.</div>
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
