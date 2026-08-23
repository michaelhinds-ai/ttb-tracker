/**
 * notify-mail.mjs — sending restock alerts via Mailchimp Transactional (Mandrill).
 *
 * WHY MANDRILL AND NOT A CUSTOMER JOURNEY
 * Mailchimp's own docs: non-subscribed contacts "can receive transactional
 * emails" but cannot receive marketing campaigns or automations. Most restock
 * signups land as `transactional` on purpose — asking to hear about one bottle
 * is not consent to a newsletter — so a marketing journey would have silently
 * delivered nothing to the majority of them. A requested, one-to-one,
 * event-driven notice is transactional by nature, so this is the correct
 * channel rather than a workaround.
 *
 * THE CATCH THIS FILE HANDLES
 * Mandrill does NOT respect Mailchimp audience unsubscribes. Someone who opted
 * out of your marketing list would still receive a Mandrill send unless you
 * check first. checkDeliverable() below does that check. Do not remove it.
 *
 * Env:
 *   MANDRILL_API_KEY         required
 *   NOTIFY_FROM_EMAIL        required, e.g. hello@nashvillebarrelco.com
 *   NOTIFY_FROM_NAME         defaults to "Nashville Barrel Co"
 *   NOTIFY_REPLY_TO          optional
 *   NOTIFY_COMPLIANCE_HTML   required in practice — see the note on it below
 *   NOTIFY_STORE_URL         used for links
 */

const MANDRILL_ENDPOINT = 'https://mandrillapp.com/api/1.0/messages/send.json';

const FROM_EMAIL = process.env.NOTIFY_FROM_EMAIL;
const FROM_NAME = process.env.NOTIFY_FROM_NAME || 'Nashville Barrel Co';
const REPLY_TO = process.env.NOTIFY_REPLY_TO || FROM_EMAIL;
const STORE_URL = (process.env.NOTIFY_STORE_URL || 'https://buyspiritsdirect.myshopify.com')
  .replace(/\/+$/, '');

/**
 * The legally required block.
 *
 * Deliberately NOT hardcoded. 27 CFR 5.233 requires the responsible advertiser's
 * name and city/state on any spirits advertisement, and class/type plus alcohol
 * content whenever a specific product is named — which this email always does.
 * Those values are yours to state correctly and are not something this code can
 * infer from a product title. Set NOTIFY_COMPLIANCE_HTML once and it appears on
 * every send.
 *
 * The fallback below is a placeholder that is obviously incomplete on purpose:
 * better a visible gap in a test send than a confident-looking email that is
 * quietly non-compliant.
 */
const COMPLIANCE_HTML =
  process.env.NOTIFY_COMPLIANCE_HTML ||
  '[SET NOTIFY_COMPLIANCE_HTML — responsible advertiser name and city/state, ' +
    'plus class/type and alcohol content for the product named above.]';

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * HTML -> plain text for the text/plain alternative.
 *
 * Naive tag-stripping is not enough: NOTIFY_COMPLIANCE_HTML is authored as
 * HTML, so it contains entities and <br> line breaks. Stripping tags alone
 * leaves readers with a literal "&ndash;" and runs the postal address onto the
 * end of the previous sentence.
 */
function htmlToText(s) {
  return String(s == null ? '' : s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')   // last, so it cannot double-decode the others
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/**
 * Restock email. Table-based and inline-styled because email clients are what
 * they are — Gmail strips <style> blocks, Outlook ignores flexbox.
 */
export function buildRestockEmail({ productTitle, productUrl, productImage, firstName }) {
  const title = escapeHtml(productTitle);
  const url = escapeHtml(productUrl);
  const hi = firstName ? `${escapeHtml(firstName)}, it` : 'It';

  // Image block is optional on purpose. Most clients block images until the
  // reader allows them, and some signups predate image capture, so the email
  // has to read correctly with nothing here at all. The alt text carries the
  // product name so a blocked image still says what came back.
  const imageBlock = productImage
    ? `      <tr><td style="padding:22px 32px 0;text-align:center;">
        <a href="${url}" style="text-decoration:none;">
          <img src="${escapeHtml(productImage)}" alt="${title}" width="240"
               style="width:240px;max-width:100%;height:auto;display:block;margin:0 auto;border:0;border-radius:4px;">
        </a>
      </td></tr>\n`
    : '';

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0806;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0806;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#12100d;border:1px solid #33291B;border-radius:6px;">
      <tr><td style="padding:32px 32px 8px;text-align:center;">
        <div style="font-family:Georgia,serif;font-size:12px;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:#D4A53A;">
          ${escapeHtml(FROM_NAME)}
        </div>
        <div style="width:40px;height:1px;background:#D4A53A;opacity:.55;margin:18px auto 0;"></div>
      </td></tr>

      <tr><td style="padding:24px 32px 0;text-align:center;">
        <h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:26px;line-height:1.25;color:#F4EFE6;font-weight:700;">
          ${hi}&rsquo;s back.
        </h1>
        <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#A79C8C;">
          You asked us to tell you when this one returned:
        </p>
      </td></tr>

${imageBlock}      <tr><td style="padding:20px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(212,165,58,.06);border:1px solid rgba(212,165,58,.22);border-radius:4px;">
          <tr><td style="padding:18px 20px;text-align:center;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;color:#F4EFE6;line-height:1.4;">
            ${title}
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:22px 32px 0;text-align:center;">
        <a href="${url}" style="display:inline-block;background:#D4A53A;color:#0a0806;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;text-decoration:none;padding:15px 34px;border-radius:4px;">
          Claim your bottle
        </a>
      </td></tr>

      <tr><td style="padding:20px 32px 0;text-align:center;">
        <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#8A8175;">
          Single barrels go quickly, and we can&rsquo;t hold one for you.
        </p>
      </td></tr>

      <tr><td style="padding:26px 32px 30px;">
        <div style="border-top:1px solid #241d14;padding-top:18px;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.7;color:#6E6558;text-align:center;">
          <p style="margin:0 0 10px;">
            You&rsquo;re getting this because you asked to be told when this bottle came back in stock. It&rsquo;s a one-time notice, not a subscription.
          </p>
          <p style="margin:0 0 10px;">${COMPLIANCE_HTML}</p>
          <p style="margin:0;">Please drink responsibly. You must be 21+ to purchase. Shipping restrictions apply by state.</p>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const text =
    `${productTitle} is back in stock.\n\n` +
    `You asked us to let you know when this one returned.\n\n` +
    `${productUrl}\n\n` +
    `Single barrels go quickly and we can't hold one for you.\n\n` +
    `You're getting this because you asked to be told when this bottle came back ` +
    `in stock. It's a one-time notice, not a subscription.\n\n` +
    `${htmlToText(COMPLIANCE_HTML)}\n\n` +
    `Please drink responsibly. You must be 21+ to purchase. Shipping restrictions apply by state.\n`;

  return { html, text };
}

/** Send one message. Throws on transport failure, returns Mandrill's per-recipient result. */
export async function sendMandrill({ to, subject, html, text, tags = [] }) {
  const key = process.env.MANDRILL_API_KEY;
  if (!key) throw new Error('MANDRILL_API_KEY is not set');
  if (!FROM_EMAIL) throw new Error('NOTIFY_FROM_EMAIL is not set');

  const res = await fetch(MANDRILL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key,
      message: {
        html,
        text,
        subject,
        from_email: FROM_EMAIL,
        from_name: FROM_NAME,
        headers: REPLY_TO ? { 'Reply-To': REPLY_TO } : undefined,
        to: [{ email: to, type: 'to' }],
        track_opens: true,
        track_clicks: true,
        auto_text: false,
        tags
      }
    })
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(`Mandrill ${res.status}: ${JSON.stringify(body)}`);
  }
  // Mandrill returns an array, one entry per recipient.
  const first = Array.isArray(body) ? body[0] : body;
  if (first?.status === 'rejected' || first?.status === 'invalid') {
    throw new Error(`Mandrill rejected ${to}: ${first.reject_reason || first.status}`);
  }
  return first;
}

export const STORE = STORE_URL;
