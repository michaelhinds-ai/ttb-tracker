/**
 * /api/notify/unsubscribe?e=<email>&t=<token>
 *
 * Opt-out for the weekly new-bottles email.
 *
 * This has to exist as our own endpoint. Mandrill does not honour Mailchimp's
 * audience unsubscribes, so a Mailchimp-generated link would not stop our
 * sends — and the weekly drops email is marketing, so CAN-SPAM requires a
 * working opt-out, while Gmail and Yahoo require RFC 8058 one-click from bulk
 * senders.
 *
 * POST  — the one-click path. Mailbox providers fire this with no user
 *         interaction, so it must succeed silently and never show a
 *         confirmation page.
 * GET   — a person clicking the link in the footer. Shows a plain page.
 *
 * The token is an HMAC of the address, so nobody can unsubscribe a stranger by
 * editing the query string.
 */

import { verifyUnsubToken, unsubscribeMember } from './lib/notify-core.mjs';

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#0a0806;color:#F4EFE6;font-family:Helvetica,Arial,sans-serif;">
<div style="max-width:26rem;margin:18vh auto;padding:2rem;text-align:center;">
  <div style="font-size:.72rem;font-weight:600;letter-spacing:.28em;text-transform:uppercase;color:#D4A53A;">
    Nashville Barrel Co
  </div>
  <div style="width:2.5rem;height:1px;background:#D4A53A;opacity:.55;margin:1.1rem auto 1.8rem;"></div>
  <h1 style="font-family:Georgia,serif;font-size:1.5rem;font-weight:700;margin:0 0 .7rem;">${title}</h1>
  <p style="font-size:.95rem;line-height:1.6;color:#A79C8C;margin:0;">${body}</p>
</div></body></html>`;
}

const htmlResponse = (status, title, body) =>
  new Response(page(title, body), {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });

export default async (req) => {
  const url = new URL(req.url);
  const email = (url.searchParams.get('e') || '').trim();
  const token = (url.searchParams.get('t') || '').trim();
  const oneClick = req.method === 'POST';

  if (!email || !verifyUnsubToken(email, token)) {
    console.warn(`[unsub] rejected bad or missing token for "${email}"`);
    return oneClick
      ? new Response('bad token', { status: 400 })
      : htmlResponse(
          400,
          'That link did not work',
          'It may have been truncated by your email client. Reply to any of our emails and we will take you off the list by hand.'
        );
  }

  try {
    await unsubscribeMember(email);
    console.log(`[unsub] ${email} unsubscribed (${oneClick ? 'one-click' : 'link'})`);
  } catch (err) {
    console.error(`[unsub] FAILED for ${email}: ${err?.message || err}`);
    // Never tell a one-click caller it failed — providers retry, and a repeated
    // failure counts against sender reputation. Log it and move on.
    return oneClick
      ? new Response('ok', { status: 200 })
      : htmlResponse(
          500,
          'Something went wrong',
          'We could not process that just now. Reply to any of our emails and we will remove you by hand.'
        );
  }

  if (oneClick) return new Response('ok', { status: 200 });

  return htmlResponse(
    200,
    'You are unsubscribed',
    'You will not get any more marketing emails from us. If you asked to be told when a specific bottle came back in stock, that one alert will still reach you.'
  );
};

export const config = { path: '/api/notify/unsubscribe' };
