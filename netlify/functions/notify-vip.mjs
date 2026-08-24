/**
 * VIP invite sender. Scheduled daily at 15:00 UTC (10am Central).
 *
 * Two jobs in one place:
 *
 *   1. BACKFILL (once). Pulls everyone with 2+ orders from Shopify and queues
 *      them with staggered send dates spread across NOTIFY_VIP_BACKFILL_DAYS.
 *      Runs only when NOTIFY_VIP_BACKFILL=on and only once — state is recorded
 *      so a redeploy cannot re-run it.
 *
 *   2. DRIP (every day). Sends whatever is due, capped per run.
 *
 * The drip exists for a specific reason. This sending domain has almost no
 * history. Emitting several thousand messages in one burst is the classic
 * signature of a compromised domain, and getting flagged would damage every
 * flow already running — restock, cart recovery, weekly drops. Spreading the
 * backfill over two weeks costs nothing and protects all of it.
 *
 * To start the backfill:  set NOTIFY_VIP_BACKFILL=on, redeploy, wait a day.
 * To check before sending: set NOTIFY_VIP_DRY_RUN=on — it queues and logs but
 * sends nothing.
 */

import {
  enqueueVip,
  listVipQueue,
  markVipSent,
  getVipMembers,
  getMember,
  unsubToken,
  getJobState,
  setJobState,
  SUPPRESSED_STATUSES
} from './lib/notify-core.mjs';
import { fetchRepeatCustomers } from './lib/shopify.mjs';
import { buildVipEmail, sendMandrill } from './lib/notify-mail.mjs';

const STATE_KEY = 'vip';
const PER_RUN_CAP = Number(process.env.NOTIFY_VIP_PER_DAY || 300);
const BACKFILL_DAYS = Number(process.env.NOTIFY_VIP_BACKFILL_DAYS || 14);
const EXCLUDE_TAG = (process.env.NOTIFY_VIP_EXCLUDE_TAG || 'subscriber').toLowerCase();

function unsubUrlFor(email) {
  const base = (process.env.NOTIFY_PUBLIC_URL || 'https://lrwc-ttb-tracker.netlify.app')
    .replace(/\/+$/, '');
  return `${base}/api/notify/unsubscribe?e=${encodeURIComponent(email)}&t=${unsubToken(email)}`;
}

async function runBackfill(state) {
  console.log('[vip] backfill starting — pulling repeat customers from Shopify');

  const customers = await fetchRepeatCustomers({ minOrders: 2 });
  const members = await getVipMembers();

  const eligible = customers.filter((c) => {
    if (members[c.email.toLowerCase()]) return false;          // already a member
    if ((c.tags || []).includes(EXCLUDE_TAG)) return false;    // tagged as a subscriber
    return true;
  });

  // Spread evenly across the window so no single day spikes.
  const perDay = Math.max(1, Math.ceil(eligible.length / BACKFILL_DAYS));
  let queued = 0;

  for (let i = 0; i < eligible.length; i++) {
    const dayOffset = Math.floor(i / perDay);
    const sendAfter = new Date(Date.now() + dayOffset * 86400000).toISOString();
    const r = await enqueueVip({
      email: eligible[i].email,
      firstName: eligible[i].firstName,
      source: 'backfill',
      sendAfter
    });
    if (r.queued) queued += 1;
  }

  await setJobState(STATE_KEY, {
    ...state,
    backfillDoneAt: new Date().toISOString(),
    backfillFound: customers.length,
    backfillQueued: queued
  });

  console.log(
    `[vip] backfill queued ${queued} of ${customers.length} repeat customers ` +
      `(${customers.length - eligible.length} skipped as members/tagged), ` +
      `~${perDay}/day over ${BACKFILL_DAYS} days`
  );
}

export default async () => {
  const state = (await getJobState(STATE_KEY)) || {};
  const dryRun = process.env.NOTIFY_VIP_DRY_RUN === 'on';

  /* ---- 1. Backfill, once ---- */
  if (process.env.NOTIFY_VIP_BACKFILL === 'on' && !state.backfillDoneAt) {
    try {
      await runBackfill(state);
    } catch (err) {
      // Most likely cause is a missing read_customers scope. Loud, and does
      // not stop the daily drip of live second-order triggers.
      console.error(`[vip] BACKFILL FAILED: ${err?.message || err}`);
    }
  }

  /* ---- 2. Drip ---- */
  const queue = await listVipQueue();
  const now = Date.now();
  const due = queue
    .filter((r) => !r.sentAt && Date.parse(r.sendAfter) <= now)
    .slice(0, PER_RUN_CAP);

  if (!due.length) {
    const pending = queue.filter((r) => !r.sentAt).length;
    console.log(`[vip] nothing due today (${pending} still queued for later)`);
    return new Response('ok', { status: 200 });
  }

  if (dryRun) {
    console.log(`[vip] DRY RUN — would send ${due.length} invites today. Nothing sent.`);
    return new Response('ok', { status: 200 });
  }

  const members = await getVipMembers();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const rec of due) {
    try {
      // Joined since being queued — the backfill can sit for two weeks.
      if (members[rec.email.toLowerCase()]) {
        await markVipSent(rec.email);
        skipped += 1;
        continue;
      }

      // Mandrill ignores Mailchimp's unsubscribe state, so check it here.
      const member = await getMember(rec.email);
      if (member && SUPPRESSED_STATUSES.has(member.status)) {
        await markVipSent(rec.email);
        skipped += 1;
        continue;
      }

      const unsubUrl = unsubUrlFor(rec.email);
      const { html, text, subject } = buildVipEmail({
        firstName: rec.firstName || member?.firstName || '',
        unsubUrl
      });

      await sendMandrill({
        to: rec.email,
        subject,
        html,
        text,
        tags: ['vip-invite', `vip-${rec.source}`],
        unsubUrl
      });

      await markVipSent(rec.email);
      sent += 1;
    } catch (err) {
      failed += 1;
      if (failed <= 10) console.error(`[vip] failed for ${rec.email}: ${err?.message || err}`);
    }
  }

  const remaining = queue.filter((r) => !r.sentAt).length - sent - skipped;
  console.log(
    `[vip] sent ${sent}, skipped ${skipped} (member or unsubscribed), failed ${failed}. ` +
      `${Math.max(0, remaining)} still queued.`
  );

  return new Response(JSON.stringify({ ok: true, sent, skipped, failed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};

export const config = {
  schedule: '0 15 * * *'
};
