// Monitored Inbox backend for Mikey Systems — one function, several actions.
// POST /api/graph-mail  { action, ... }
//
//   { action:"ping" }
//       → { ok, configured }                         // is Microsoft 365 wired up?
//
//   { action:"inbox", mailbox, top? }
//       → { ok, mailbox, rows:[{ id, conversationId, subject, from{name,address},
//                                received, preview, isRead, replied }] }
//         Newest first. `replied` = someone sent a message in that conversation
//         at/after the incoming message (so admin can spot un-answered mail).
//
//   { action:"thread", mailbox, conversationId }
//       → { ok, messages:[{ id, from{name,address}, to:[{name,address}], date,
//                           outgoing, preview, html }] }  // whole conversation, oldest first
//
//   { action:"send", mailbox, messageId, comment }   // reply on the thread as `mailbox`
//   { action:"send", mailbox, to, subject, comment } // or a fresh message
//       → { ok }
//
// Access is limited to the mailboxes your Entra app is scoped to (see the setup guide).
import { graph, graphConfigured, jsonResp } from "./lib/graph.mjs";

const enc = encodeURIComponent;
function addr(a) { const e = (a && a.emailAddress) || a || {}; return { name: e.name || "", address: (e.address || "").toLowerCase() }; }

export default async (req) => {
  if (req.method !== "POST") return jsonResp({ ok: false, error: "method_not_allowed" }, 405);
  let b = {}; try { b = await req.json(); } catch { b = {}; }
  const action = b.action || "ping";

  if (action === "ping") return jsonResp({ ok: true, configured: graphConfigured() });
  if (!graphConfigured()) return jsonResp({ ok: false, error: "not_configured", detail: "Microsoft 365 isn't connected yet — add the MSGRAPH_* variables in Netlify." }, 200);

  try {
    if (action === "inbox") {
      const mb = (b.mailbox || "").trim(); if (!mb) return jsonResp({ ok: false, error: "no_mailbox" }, 400);
      const top = Math.max(1, Math.min(50, +b.top || 25));
      const sel = "$select=id,conversationId,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead";
      const inbox = await graph(`/users/${enc(mb)}/mailFolders/inbox/messages?${sel}&$top=${top}&$orderby=receivedDateTime desc`);
      // Pull recent Sent items to decide which conversations have been replied to.
      let sentByConv = {};
      try {
        const sent = await graph(`/users/${enc(mb)}/mailFolders/sentitems/messages?$select=conversationId,sentDateTime&$top=100&$orderby=sentDateTime desc`);
        (sent.value || []).forEach((m) => { const t = +new Date(m.sentDateTime || 0); if (!sentByConv[m.conversationId] || t > sentByConv[m.conversationId]) sentByConv[m.conversationId] = t; });
      } catch { /* sent-items read is best-effort */ }
      const rows = (inbox.value || []).map((m) => {
        const recv = +new Date(m.receivedDateTime || 0);
        return { id: m.id, conversationId: m.conversationId, subject: m.subject || "(no subject)",
          from: addr(m.from), received: m.receivedDateTime, preview: m.bodyPreview || "", isRead: !!m.isRead,
          replied: (sentByConv[m.conversationId] || 0) >= recv && recv > 0 };
      });
      return jsonResp({ ok: true, mailbox: mb, rows });
    }

    if (action === "thread") {
      const mb = (b.mailbox || "").trim(), conv = (b.conversationId || "").trim();
      if (!mb || !conv) return jsonResp({ ok: false, error: "bad_request" }, 400);
      // $filter on conversationId can't combine with $orderby — sort client-side.
      // Expand attachment METADATA only (no contentBytes) so the payload stays small;
      // the actual bytes are fetched per-attachment via the "attachment" action.
      const sel = "$select=id,subject,from,toRecipients,receivedDateTime,sentDateTime,body,bodyPreview,hasAttachments";
      const exp = "$expand=attachments($select=id,name,contentType,size,isInline,contentId)";
      const res = await graph(`/users/${enc(mb)}/messages?$filter=conversationId eq '${conv.replace(/'/g, "''")}'&${sel}&${exp}&$top=50`);
      const msgs = (res.value || []).map((m) => {
        const from = addr(m.from);
        const atts = (m.attachments || [])
          .filter((a) => (a["@odata.type"] || "").indexOf("fileAttachment") >= 0 || a.contentType)
          .map((a) => ({ id: a.id, name: a.name || "attachment", contentType: a.contentType || "", size: a.size || 0, isInline: !!a.isInline }));
        return { id: m.id, from, to: (m.toRecipients || []).map(addr), date: m.receivedDateTime || m.sentDateTime,
          outgoing: from.address === mb.toLowerCase(), preview: m.bodyPreview || "", html: (m.body && m.body.content) || "", attachments: atts };
      }).sort((x, y) => (+new Date(x.date || 0)) - (+new Date(y.date || 0)));
      return jsonResp({ ok: true, messages: msgs });
    }

    if (action === "attachment") {
      const mb = (b.mailbox || "").trim(), mid = b.messageId, aid = b.attachmentId;
      if (!mb || !mid || !aid) return jsonResp({ ok: false, error: "bad_request" }, 400);
      const a = await graph(`/users/${enc(mb)}/messages/${enc(mid)}/attachments/${enc(aid)}`);
      if (!a || !a.contentBytes) return jsonResp({ ok: false, error: "no_content", detail: "That attachment can't be shown here (it may be a linked/cloud file)." }, 200);
      return jsonResp({ ok: true, name: a.name || "attachment", contentType: a.contentType || "application/octet-stream", dataUrl: `data:${a.contentType || "application/octet-stream"};base64,${a.contentBytes}` });
    }

    if (action === "send") {
      const mb = (b.mailbox || "").trim(); if (!mb) return jsonResp({ ok: false, error: "no_mailbox" }, 400);
      const comment = String(b.comment || "");
      const emails = (v) => (Array.isArray(v) ? v : String(v || "").split(/[,;\s]+/)).map((x) => String(x || "").trim()).filter((x) => x.indexOf("@") > 0);
      const recips = (arr) => arr.map((a) => ({ emailAddress: { address: a } }));
      const cc = emails(b.cc), toExtra = emails(b.to);

      if (b.mode === "forward" && b.messageId) {
        if (!toExtra.length) return jsonResp({ ok: false, error: "no_recipient", detail: "Add at least one address to forward to." }, 200);
        await graph(`/users/${enc(mb)}/messages/${enc(b.messageId)}/forward`, { method: "POST", body: JSON.stringify({ comment, toRecipients: recips(toExtra) }) });
      } else if (b.messageId) {
        // Reply on the thread (to the original sender). Cc anyone extra — coworkers or outside.
        const payload = { comment };
        const message = {};
        if (cc.length) message.ccRecipients = recips(cc);
        if (toExtra.length) message.toRecipients = recips(toExtra);
        if (Object.keys(message).length) payload.message = message;
        await graph(`/users/${enc(mb)}/messages/${enc(b.messageId)}/reply`, { method: "POST", body: JSON.stringify(payload) });
      } else {
        if (!toExtra.length) return jsonResp({ ok: false, error: "no_recipient" }, 400);
        const message = { subject: b.subject || "", body: { contentType: "Text", content: comment }, toRecipients: recips(toExtra) };
        if (cc.length) message.ccRecipients = recips(cc);
        await graph(`/users/${enc(mb)}/sendMail`, { method: "POST", body: JSON.stringify({ message, saveToSentItems: true }) });
      }
      return jsonResp({ ok: true });
    }

    return jsonResp({ ok: false, error: "unknown_action" }, 400);
  } catch (e) {
    return jsonResp({ ok: false, error: String((e && e.message) || e) }, 200);
  }
};

export const config = { path: "/api/graph-mail" };
