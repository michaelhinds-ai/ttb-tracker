/**
 * Abandoned checkout recovery sender. Scheduled every 15 minutes.
 *
 * Runs on a schedule rather than off the webhook because Shopify documents no
 * firing frequency for checkouts/update at all — it may fire once, or many
 * times as the customer edits. Treating the webhook as an upsert and deciding
 * when to send from a timer makes that frequency irrelevant, which is the
 * right shape regardless of how it actually behaves.
 *
 * Schedule per checkout, measured from when it was created:
 *   +1h   reminder
 *   +24h  objection handling
 *   +72h  scarcity
 *
 * A checkout stops the sequence when an order arrives with its
 * `checkout_token`, when completed_at appears, or when it is deleted.
 *
 * Volume is small — roughly 35 abandonments a day at this store's order rate —
 * so this comfortably fits a normal function timeout. If that ever changes,
 * split it the way notify-drops is split.
 */

import {
  listOpenCheckouts,
  recordCheckoutSend,
  getProductImages,
  getMember,
  unsubToken,
  SUPPRESSED_STATUSES
} from './lib/notify-core.mjs';
import { buildRecoveryEmail, sendMandrill } from './lib/notify-mail.mjs';

/**
 * Send times, in hours after the checkout was created.
 *
 * Set any of these to 0 to switch that step off. That exists because Shopify's
 * own abandoned-checkout automation is already running here and performing
 * well (64.7% open, $24.7k recovered), so the first reminder is covered.
 * Turning step 1 off and starting at 24h makes this a pure addition rather
 * than a competing sequence — Shopify does the reminder, these do the
 * follow-ups Shopify never sends.
 *
 * Whatever you set, step 1 must land comfortably AFTER Shopify's own send or
 * customers get two near-identical emails.
 */
const STEPS = [
  { step: 1, afterHours: Number(process.env.NOTIFY_RECOVER_H1 ?? 1) },
  { step: 2, afterHours: Number(process.env.NOTIFY_RECOVER_H2 ?? 24) },
  { step: 3, afterHours: Number(process.env.NOTIFY_RECOVER_H3 ?? 72) }
].filter((s) => Number.isFinite(s.afterHours) && s.afterHours > 0);

const MAX_SENDS_PER_RUN = 200;

function unsubUrlFor(email) {
  const base = (process.env.NOTIFY_PUBLIC_URL || 'https://lrwc-ttb-tracker.netlify.app')
    .replace(/\/+$/, '');
  return `${base}/api/notify/unsubscribe?e=${encodeURIComponent(email)}&t=${unsubToken(email)}`;
}

/** Which step, if any, is due for this checkout right now. */
function dueStep(rec) {
  const ageHours = (Date.now() - Date.parse(rec.createdAt || rec.firstSeen)) / 3600000;
  if (!Number.isFinite(ageHours)) return null;

  // Walk backwards so a checkout that sat unsent through several windows gets
  // the most recent relevant message, not a burst of all three.
  for (let i = STEPS.length - 1; i >= 0; i--) {
    const s = STEPS[i];
    if (ageHours >= s.afterHours && !rec.sent?.[s.step]) return s.step;
  }
  return null;
}

export default async () => {
  if (process.env.NOTIFY_RECOVER_ENABLED === 'false') {
    console.log('[recover] disabled by NOTIFY_RECOVER_ENABLED=false');
    return new Response('ok', { status: 200 });
  }

  const all = await listOpenCheckouts();

  const candidates = all.filter(
    (r) => !r.recoveredAt && r.email && r.recoverUrl && (r.items || []).length
  );

  const due = [];
  for (const rec of candidates) {
    const step = dueStep(rec);
    if (step) due.push({ rec, step });
    if (due.length >= MAX_SENDS_PER_RUN) break;
  }

  if (!due.length) {
    console.log(`[recover] nothing due (${all.length} tracked, ${candidates.length} eligible)`);
    return new Response('ok', { status: 200 });
  }

  // One cache read for every product across every due email.
  const productIds = [
    ...new Set(due.flatMap(({ rec }) => rec.items.map((i) => i.productId).filter(Boolean)))
  ];
  const images = await getProductImages(productIds);

  let sent = 0;
  let suppressed = 0;
  let failed = 0;

  for (const { rec, step } of due) {
    try {
      // Mandrill ignores Mailchimp's unsubscribe state, so check it ourselves.
      // getMember returns null for people who were never in the audience —
      // a checkout abandoner usually is not, and that is fine to email.
      const member = await getMember(rec.email);
      if (member && SUPPRESSED_STATUSES.has(member.status)) {
        suppressed += 1;
        await recordCheckoutSend(rec.token, step); // don't re-check every 15 min
        continue;
      }

      const items = rec.items.map((i) => ({
        ...i,
        image: i.image || (i.productId ? images[i.productId] : null) || null
      }));

      const unsubUrl = unsubUrlFor(rec.email);
      const { html, text, subject } = buildRecoveryEmail({
        step,
        items,
        recoverUrl: rec.recoverUrl,
        unsubUrl,
        firstName: rec.firstName || member?.firstName || ''
      });

      await sendMandrill({
        to: rec.email,
        subject,
        html,
        text,
        tags: ['cart-recovery', `cart-recovery-${step}`],
        unsubUrl
      });

      await recordCheckoutSend(rec.token, step);
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(`[recover] step ${step} failed for ${rec.token}: ${err?.message || err}`);
    }
  }

  console.log(
    `[recover] ${all.length} tracked, ${candidates.length} eligible, ${due.length} due — ` +
      `sent ${sent}, suppressed ${suppressed}, failed ${failed}`
  );

  return new Response(JSON.stringify({ ok: true, sent, suppressed, failed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};

export const config = {
  schedule: '*/15 * * * *'
};
