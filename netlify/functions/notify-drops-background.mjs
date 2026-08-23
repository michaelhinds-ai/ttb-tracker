/**
 * POST /.netlify/functions/notify-drops-background
 *
 * The weekly "new bottles" email. Background function because it can be
 * emailing thousands of people and a normal function would time out — same
 * pattern as the existing mailchimp-import-background.
 *
 * WHAT GOES IN IT
 *   - published in the last 30 days (recordProduct enforces the window)
 *   - not already announced
 *   - currently in stock
 *   - not Locksmith-gated, and not tagged `do-not-announce`
 *
 * WHO GETS IT
 *   subscribed AND (tagged `drops-optin` OR SOURCE = online). Walk-in and tour
 *   contacts brought in by the weekly sync are deliberately excluded: they
 *   never asked for drop emails, and uninterested recipients are where spam
 *   complaints come from.
 *
 * FIRST RUN IS A DRAFT
 *   The first execution emails the finished HTML to NOTIFY_REVIEW_EMAIL and
 *   sends to nobody, so a bad title or a Locksmith miss is caught once before
 *   it reaches customers. Every run after that is fully automatic. Set
 *   NOTIFY_DROPS_MODE=draft to keep it in review mode permanently, or
 *   =send to skip the draft step.
 */

import {
  listIndexedProducts,
  markProductsAnnounced,
  listDropsAudience,
  unsubToken,
  getJobState,
  setJobState
} from './lib/notify-core.mjs';
import { fetchLocks, summariseLocks, isAnnounceable } from './lib/locksmith.mjs';
import { buildDropsEmail, sendMandrill, STORE } from './lib/notify-mail.mjs';

const CONCURRENCY = 8;
const STATE_KEY = 'drops';

function unsubUrlFor(email) {
  const base = (process.env.NOTIFY_PUBLIC_URL || 'https://lrwc-ttb-tracker.netlify.app')
    .replace(/\/+$/, '');
  return `${base}/api/notify/unsubscribe?e=${encodeURIComponent(email)}&t=${unsubToken(email)}`;
}

/** Simple bounded-concurrency map. Keeps Mandrill happy and the log readable. */
async function pooled(items, limit, fn) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

export default async () => {
  const started = Date.now();

  /* ---- 1. Which bottles? ---- */
  const indexed = await listIndexedProducts();
  const unannounced = indexed.filter((p) => !p.announcedAt && p.inStock);

  if (!unannounced.length) {
    console.log(`[drops] nothing to announce (${indexed.length} in index)`);
    return new Response('ok', { status: 200 });
  }

  /* ---- 2. Drop anything gated ---- */
  let locks = null;
  try {
    locks = await fetchLocks();
  } catch (err) {
    console.error(`[drops] Locksmith lookup failed: ${err?.message || err}`);
  }
  const summary = locks ? summariseLocks(locks) : null;

  const announceable = [];
  for (const p of unannounced) {
    const verdict = isAnnounceable(
      { id: p.id, tags: p.tags || [], collectionIds: p.collectionIds || [] },
      summary
    );
    if (verdict.ok) announceable.push(p);
    else console.log(`[drops] skipping "${p.title}" — ${verdict.reason}`);
  }

  if (!announceable.length) {
    console.log(`[drops] all ${unannounced.length} candidates were gated or suppressed`);
    return new Response('ok', { status: 200 });
  }

  const products = announceable
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .map((p) => ({
      id: p.id,
      title: p.title,
      image: p.image,
      url: p.handle ? `${STORE}/products/${p.handle}` : STORE
    }));

  /* ---- 3. Draft or send? ---- */
  const state = (await getJobState(STATE_KEY)) || {};
  const mode = process.env.NOTIFY_DROPS_MODE || (state.firstRunDone ? 'send' : 'draft');
  const reviewer = process.env.NOTIFY_REVIEW_EMAIL || process.env.NOTIFY_FROM_EMAIL;

  if (mode === 'draft') {
    const { html, text, subject } = buildDropsEmail({
      products,
      unsubUrl: unsubUrlFor(reviewer)
    });
    await sendMandrill({
      to: reviewer,
      subject: `[DRAFT — not sent to customers] ${subject}`,
      html,
      text,
      tags: ['drops-draft']
    });

    // Deliberately NOT marked announced: these bottles should go out for real
    // on the next run once the draft has been looked at.
    await setJobState(STATE_KEY, { ...state, firstRunDone: true, lastDraftAt: new Date().toISOString() });
    console.log(
      `[drops] DRAFT sent to ${reviewer} with ${products.length} bottles. ` +
        'Next scheduled run will send for real.'
    );
    return new Response('ok', { status: 200 });
  }

  /* ---- 4. Send ---- */
  const { recipients, scanned, total } = await listDropsAudience();
  console.log(
    `[drops] ${products.length} bottles -> ${recipients.length} recipients ` +
      `(scanned ${scanned} of ${total} subscribed)`
  );

  if (!recipients.length) {
    console.warn('[drops] no eligible recipients — nothing sent, bottles left unannounced');
    return new Response('ok', { status: 200 });
  }

  let sent = 0;
  const failures = [];

  await pooled(recipients, CONCURRENCY, async (r) => {
    try {
      const unsubUrl = unsubUrlFor(r.email);
      const { html, text, subject } = buildDropsEmail({ products, unsubUrl });
      await sendMandrill({ to: r.email, subject, html, text, tags: ['drops-weekly'], unsubUrl });
      sent += 1;
    } catch (err) {
      failures.push(r.email);
      if (failures.length <= 10) {
        console.error(`[drops] failed for ${r.email}: ${err?.message || err}`);
      }
    }
  });

  // Only mark announced once something actually went out, so a total failure
  // retries next week rather than silently swallowing the release.
  if (sent > 0) await markProductsAnnounced(products.map((p) => p.id));

  await setJobState(STATE_KEY, {
    ...state,
    firstRunDone: true,
    lastSendAt: new Date().toISOString(),
    lastSendCount: sent
  });

  console.log(
    `[drops] done in ${Math.round((Date.now() - started) / 1000)}s — ` +
      `sent ${sent}/${recipients.length}, failed ${failures.length}, ` +
      `announced ${sent > 0 ? products.length : 0} bottles`
  );

  return new Response(JSON.stringify({ ok: true, sent, failed: failures.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};
