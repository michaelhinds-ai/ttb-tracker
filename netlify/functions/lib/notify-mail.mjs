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

/**
 * Masthead logos.
 *
 * URLs come from the existing thank-you email asset spec, where both marks are
 * already known to read correctly on a dark header. Overridable by env so a
 * rebrand does not need a code change.
 *
 * Falls back to the text wordmark when neither is set, and every logo carries
 * alt text — a large share of recipients see images blocked on first contact
 * with a new sending domain, and a header that vanishes entirely looks broken.
 */
const LOGO_NBC =
  process.env.NOTIFY_LOGO_NBC_URL ||
  'https://nashvillebarrelco.com/images/nbc-logo.png';
const LOGO_LR =
  process.env.NOTIFY_LOGO_LR_URL ||
  'https://louisvillerickhouse.com/images/LR_Wordmark_PMS_9180.png';

function mastheadHtml(fromName) {
  const cells = [];

  if (LOGO_NBC) {
    cells.push(
      `<td style="padding:0 10px;text-align:center;vertical-align:middle;">` +
        `<img src="${LOGO_NBC}" alt="Nashville Barrel Co" width="128" ` +
        `style="width:128px;max-width:44vw;height:auto;display:block;border:0;"></td>`
    );
  }
  if (LOGO_LR) {
    cells.push(
      `<td style="padding:0 10px;text-align:center;vertical-align:middle;">` +
        `<img src="${LOGO_LR}" alt="Louisville Rickhouse Whiskey Co" width="140" ` +
        `style="width:140px;max-width:46vw;height:auto;display:block;border:0;"></td>`
    );
  }

  if (!cells.length) {
    return `<div style="font-family:Georgia,serif;font-size:12px;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:#D4A53A;">
          ${escapeHtml(fromName)}
        </div>`;
  }

  return `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;">
          <tr>${cells.join('')}</tr>
        </table>`;
}

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
      <tr><td style="padding:30px 32px 8px;text-align:center;">
        ${mastheadHtml(FROM_NAME)}
        <div style="width:40px;height:1px;background:#D4A53A;opacity:.55;margin:20px auto 0;"></div>
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

/**
 * The weekly new-bottles roundup.
 *
 * Unlike the restock alert this is marketing, not a requested one-off, so it
 * carries a real opt-out. Mandrill does not honour Mailchimp's audience
 * unsubscribes, so the link is our own signed endpoint, and the same URL goes
 * into List-Unsubscribe / List-Unsubscribe-Post — Gmail and Yahoo require
 * one-click for bulk marketing.
 */
export function buildDropsEmail({ products, unsubUrl, heading }) {
  const count = products.length;
  const title =
    heading || (count === 1 ? 'A new barrel just landed' : `${count} new barrels just landed`);

  const rows = products
    .map((p) => {
      const name = escapeHtml(p.title);
      const url = escapeHtml(p.url);
      const img = p.image
        ? `<td width="96" style="padding:0 14px 0 0;vertical-align:top;">
             <a href="${url}"><img src="${escapeHtml(p.image)}" alt="${name}" width="96"
               style="width:96px;height:auto;display:block;border:0;border-radius:4px;"></a>
           </td>`
        : '';
      return `<tr><td style="padding:0 0 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
          style="background:rgba(212,165,58,.05);border:1px solid rgba(212,165,58,.18);border-radius:4px;">
          <tr><td style="padding:14px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              ${img}
              <td style="vertical-align:middle;">
                <div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#F4EFE6;line-height:1.4;">${name}</div>
                <a href="${url}" style="display:inline-block;margin-top:8px;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#D4A53A;text-decoration:none;">View bottle &rarr;</a>
              </td>
            </tr></table>
          </td></tr>
        </table>
      </td></tr>`;
    })
    .join('');

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0806;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0806;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#12100d;border:1px solid #33291B;border-radius:6px;">
      <tr><td style="padding:30px 30px 8px;text-align:center;">
        ${mastheadHtml(FROM_NAME)}
        <div style="width:40px;height:1px;background:#D4A53A;opacity:.55;margin:20px auto 0;"></div>
      </td></tr>

      <tr><td style="padding:22px 30px 0;text-align:center;">
        <h1 style="margin:0 0 10px;font-family:Georgia,serif;font-size:25px;line-height:1.24;color:#F4EFE6;font-weight:700;">
          ${escapeHtml(title)}
        </h1>
        <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#A79C8C;">
          Single barrels, while they last.
        </p>
      </td></tr>

      <tr><td style="padding:22px 30px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      </td></tr>

      <tr><td style="padding:6px 30px 30px;">
        <div style="border-top:1px solid #241d14;padding-top:18px;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.7;color:#6E6558;text-align:center;">
          <p style="margin:0 0 10px;">${COMPLIANCE_HTML}</p>
          <p style="margin:0 0 10px;">Please drink responsibly. You must be 21+ to purchase. Shipping restrictions apply by state.</p>
          <p style="margin:0;"><a href="${escapeHtml(unsubUrl)}" style="color:#8A8175;">Unsubscribe from new bottle emails</a></p>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const text =
    `${title}\n\n` +
    products.map((p) => `${p.title}\n${p.url}`).join('\n\n') +
    `\n\n${htmlToText(COMPLIANCE_HTML)}\n` +
    `Please drink responsibly. You must be 21+ to purchase. Shipping restrictions apply by state.\n\n` +
    `Unsubscribe: ${unsubUrl}\n`;

  return { html, text, subject: title };
}

/**
 * Abandoned checkout recovery. Three steps, three different jobs:
 *
 *   1 (+1h)   Reminder. They probably got distracted. Short, no discount.
 *   2 (+24h)  Objection handling. For spirits the objections are specific —
 *             "can you even ship to me", "what is a single barrel", "is this
 *             the same bottle in the photo". Answer them.
 *   3 (+72h)  Scarcity, honestly stated. A single barrel really can sell out.
 *
 * Deliberately no discount code in any of them. Discounting a cart someone was
 * already willing to buy trains people to abandon, and on spirits it drags in
 * the state-by-state coupon restrictions for no reason.
 */
const RECOVERY_COPY = {
  1: {
    subject: (n) => (n ? `You left ${n} behind` : 'You left something behind'),
    heading: 'Still thinking it over?',
    blurb: 'Your cart is saved and waiting. Pick up right where you left off.',
    cta: 'Finish checkout'
  },
  2: {
    subject: () => 'A few things worth knowing before you decide',
    heading: 'Questions people usually have',
    blurb:
      'Every bottle is a single barrel, so what is in the photo is what ships. We cannot ship to every state &mdash; if yours is not covered, checkout will tell you before you pay.',
    cta: 'Go back to your cart'
  },
  3: {
    subject: (n) => (n ? `${n} may not last` : 'Your cart may not last'),
    heading: 'Last look',
    blurb:
      'Single barrels are exactly that &mdash; one barrel. When it is gone we cannot reorder it. Your cart is still here for now.',
    cta: 'Claim your bottle'
  }
};

export function buildRecoveryEmail({ step, items, recoverUrl, unsubUrl, firstName }) {
  const copy = RECOVERY_COPY[step] || RECOVERY_COPY[1];
  const firstItem = items[0]?.title || '';
  const hi = firstName ? `${escapeHtml(firstName)}, ` : '';

  const rows = items
    .map((it) => {
      const name = escapeHtml(it.title);
      const qty = Number(it.quantity) > 1 ? ` &times;${Number(it.quantity)}` : '';
      const img = it.image
        ? `<td width="72" style="padding:0 12px 0 0;vertical-align:top;">
             <img src="${escapeHtml(it.image)}" alt="${name}" width="72"
               style="width:72px;height:auto;display:block;border:0;border-radius:4px;"></td>`
        : '';
      return `<tr><td style="padding:0 0 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
          style="background:rgba(212,165,58,.05);border:1px solid rgba(212,165,58,.18);border-radius:4px;">
          <tr><td style="padding:12px 14px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              ${img}
              <td style="vertical-align:middle;font-family:Helvetica,Arial,sans-serif;font-size:13.5px;font-weight:600;color:#F4EFE6;line-height:1.4;">
                ${name}${qty}
              </td>
            </tr></table>
          </td></tr>
        </table>
      </td></tr>`;
    })
    .join('');

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0806;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0806;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#12100d;border:1px solid #33291B;border-radius:6px;">
      <tr><td style="padding:30px 30px 8px;text-align:center;">
        ${mastheadHtml(FROM_NAME)}
        <div style="width:40px;height:1px;background:#D4A53A;opacity:.55;margin:20px auto 0;"></div>
      </td></tr>

      <tr><td style="padding:22px 30px 0;text-align:center;">
        <h1 style="margin:0 0 10px;font-family:Georgia,serif;font-size:24px;line-height:1.25;color:#F4EFE6;font-weight:700;">
          ${hi}${copy.heading}
        </h1>
        <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.65;color:#A79C8C;">
          ${copy.blurb}
        </p>
      </td></tr>

      <tr><td style="padding:22px 30px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      </td></tr>

      <tr><td style="padding:8px 30px 0;text-align:center;">
        <a href="${escapeHtml(recoverUrl)}" style="display:inline-block;background:#D4A53A;color:#0a0806;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;text-decoration:none;padding:15px 34px;border-radius:4px;">
          ${copy.cta}
        </a>
      </td></tr>

      <tr><td style="padding:26px 30px 30px;">
        <div style="border-top:1px solid #241d14;padding-top:18px;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.7;color:#6E6558;text-align:center;">
          <p style="margin:0 0 10px;">${COMPLIANCE_HTML}</p>
          <p style="margin:0 0 10px;">Please drink responsibly. You must be 21+ to purchase. Shipping restrictions apply by state.</p>
          <p style="margin:0;"><a href="${escapeHtml(unsubUrl)}" style="color:#8A8175;">Unsubscribe</a></p>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const text =
    `${copy.heading}\n\n${htmlToText(copy.blurb)}\n\n` +
    items.map((it) => `- ${it.title}${Number(it.quantity) > 1 ? ' x' + it.quantity : ''}`).join('\n') +
    `\n\n${copy.cta}: ${recoverUrl}\n\n` +
    `${htmlToText(COMPLIANCE_HTML)}\n` +
    `Please drink responsibly. You must be 21+ to purchase. Shipping restrictions apply by state.\n\n` +
    `Unsubscribe: ${unsubUrl}\n`;

  return { html, text, subject: copy.subject(firstItem) };
}

/** Send one message. Throws on transport failure, returns Mandrill's per-recipient result. */
export async function sendMandrill({ to, subject, html, text, tags = [], unsubUrl = null }) {
  const key = process.env.MANDRILL_API_KEY;
  if (!key) throw new Error('MANDRILL_API_KEY is not set');
  if (!FROM_EMAIL) throw new Error('NOTIFY_FROM_EMAIL is not set');

  const headers = {};
  if (REPLY_TO) headers['Reply-To'] = REPLY_TO;
  if (unsubUrl) {
    // RFC 8058 one-click. Gmail and Yahoo require both headers from bulk
    // senders; a body link alone is not enough.
    headers['List-Unsubscribe'] = `<${unsubUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

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
        headers: Object.keys(headers).length ? headers : undefined,
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
