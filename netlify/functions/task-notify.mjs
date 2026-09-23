// Task completion notice — emails whoever ASSIGNED a task when it's marked done.
// POST /api/task-notify  { to, toName, task, completedBy, note, due, ws } -> { ok }
// Env: RESEND_API_KEY (required). From address: TASK_FROM || SALES_FROM ||
//      "Mikey Systems <sales@nashvillebarrelco.com>" (must be a Resend-verified domain
//      to reach addresses other than the account owner's).
function json(o, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function fmtDue(d) {
  if (!d) return "";
  const t = Date.parse(String(d) + "T00:00:00");
  if (isNaN(t)) return String(d);
  return new Date(t).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  let b = {};
  try { b = await req.json(); } catch { b = {}; }

  const to = String(b.to || "").trim();
  const toName = String(b.toName || "").trim();
  const task = String(b.task || "").trim();
  const completedBy = String(b.completedBy || "").trim();
  const note = String(b.note || "").trim();
  const due = String(b.due || "").trim();

  // No recipient email on file — nothing to send, but don't error the client.
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ ok: true, skipped: "no_recipient" });
  if (!task) return json({ ok: true, skipped: "no_task" });

  const key = (process.env.RESEND_API_KEY || "").trim();
  if (!key) return json({ ok: false, error: "RESEND_API_KEY not set" }, 200);
  const from = (process.env.TASK_FROM || process.env.SALES_FROM || "Mikey Systems <sales@nashvillebarrelco.com>").trim();

  const who = completedBy || "Someone";
  const subject = "✓ Task completed: " + (task.length > 60 ? task.slice(0, 57) + "…" : task);

  const dueLine = due ? `<tr><td style="padding:4px 0;color:#8a7a63;font-size:13px">Was due</td><td style="padding:4px 0 4px 14px;font-size:14px">${esc(fmtDue(due))}</td></tr>` : "";
  const noteBlock = note
    ? `<div style="margin:18px 0 4px;padding:14px 16px;background:#f6efe2;border-left:3px solid #7a5a2b;border-radius:0 8px 8px 0">
         <div style="font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#8a7a63;font-weight:700;margin-bottom:5px">Comment from ${esc(who)}</div>
         <div style="font-size:15px;color:#231a12;white-space:pre-wrap">${esc(note)}</div>
       </div>`
    : `<div style="margin:16px 0 4px;color:#8a7a63;font-size:14px">No comment was left.</div>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#f3ede2;padding:14px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#231a12;-webkit-text-size-adjust:100%">
    <div style="max-width:560px;width:100%;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(60,40,15,.08)">
      <div style="background:#231a12;color:#f3ede2;padding:15px 18px;font-weight:700;font-size:17px">Mikey Systems · Task completed</div>
      <div style="padding:18px">
        <p style="margin:0 0 6px;font-size:15px;color:#231a12">Hi${toName ? " " + esc(toName) : ""},</p>
        <p style="margin:0 0 16px;font-size:15px;color:#231a12"><b>${esc(who)}</b> marked a task you assigned as complete.</p>
        <table style="border-collapse:collapse;width:100%">
          <tr><td style="padding:4px 0;color:#8a7a63;font-size:13px;width:80px">Task</td><td style="padding:4px 0 4px 14px;font-size:15px;font-weight:600;color:#231a12">${esc(task)}</td></tr>
          <tr><td style="padding:4px 0;color:#8a7a63;font-size:13px">Completed</td><td style="padding:4px 0 4px 14px;font-size:14px">${esc(new Date().toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }))} CT</td></tr>
          ${dueLine}
        </table>
        ${noteBlock}
      </div>
      <div style="padding:12px 18px;background:#faf6ee;color:#8a7a63;font-size:12px">Sent automatically by Mikey Systems when the task was checked off.</div>
    </div>
  </body></html>`;

  const text = `${who} marked a task you assigned as complete.\n\nTask: ${task}\n${due ? "Was due: " + fmtDue(due) + "\n" : ""}Completed: ${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })} CT\n\n${note ? "Comment from " + who + ":\n" + note : "No comment was left."}\n\n— Mikey Systems`;

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

export const config = { path: "/api/task-notify" };
