/**
 * VIP invite sender. Background function — invoked daily by notify-vip.mjs,
 * and callable by hand at:
 *   .../.netlify/functions/notify-vip-background
 *
 * Background rather than scheduled because the backfill can make ~60
 * paginated Shopify calls and then two blob operations for each of several
 * thousand customers. That does not fit a normal function timeout; it would
 * die partway and leave a half-built queue with backfillDoneAt unset,
 * re-running from scratch the next day.
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
import { fetchRepeatCustomers, fetchSubscriptionMembers } from './lib/shopify.mjs';
import { buildVipEmail, sendMandrill } from './lib/notify-mail.mjs';

const STATE_KEY = 'vip';
const PER_RUN_CAP = Number(process.env.NOTIFY_VIP_PER_DAY || 300);
const BACKFILL_DAYS = Number(process.env.NOTIFY_VIP_BACKFILL_DAYS || 14);
/**
 * Customer tags that mean "already a member — do not invite".
 *
 * These are the store's real tags, confirmed by reading customer records:
 * `Active Subscriber` and `member-monthly` travel together on every
 * subscription customer. An earlier guess of `subscriber` matched nothing,
 * which would have invited all ~100 existing members to join the thing they
 * already pay for.
 *
 * NOT excluded by default: the separate `vip` tag. It appears on plenty of
 * customers who are not Active Subscribers, so it means something else —
 * probably granted access rather than a paid membership. Add it here if that
 * turns out to be wrong.
 */
const EXCLUDE_TAGS = (process.env.NOTIFY_VIP_EXCLUDE_TAGS || 'active subscriber,member-monthly')
  .split(',')
  .map((t) => t.trim().toLowerCase())
  .filter(Boolean);

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
    if (members[c.email.toLowerCase()]) return false;                        // already a member
    if ((c.tags || []).some((t) => EXCLUDE_TAGS.includes(t))) return false;  // tagged as a subscriber
    return true;
  });

  // Spread evenly across the window so no single day spikes.
  const perDay = Math.max(1, Math.ceil(eligible.length / BACKFILL_DAYS));
  let queued = 0;

  // Concurrency matters here: this is two blob round-trips per customer, and
  // sequentially a few thousand of them takes long enough to matter even in a
  // background function.
  const CONCURRENCY = 12;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < eligible.length) {
        const i = cursor++;
        const dayOffset = Math.floor(i / perDay);
        try {
          const r = await enqueueVip({
            email: eligible[i].email,
            firstName: eligible[i].firstName,
            source: 'backfill',
            sendAfter: new Date(Date.now() + dayOffset * 86400000).toISOString()
          });
          if (r.queued) queued += 1;
        } catch (err) {
          console.error(`[vip] enqueue failed for ${eligible[i].email}: ${err?.message || err}`);
        }
      }
    })
  );

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

/**
 * Refresh the known-members list from recent orders, every run.
 *
 * Runs daily rather than once because the backfill drips over two weeks: some-
 * one queued on day 1 might subscribe on day 3, and should not then receive an
 * invitation on day 10. It also repairs the queue built before the correct
 * exclude tags were known — those members are already queued, and this is what
 * causes the drip to skip them.
 */
async function refreshMembers() {
  try {
    const emails = await fetchSubscriptionMembers();
    for (const e of emails) await markVipMember(e);
    console.log(`[vip] member refresh — ${emails.length} active subscribers found in recent orders`);
    return emails.length;
  } catch (err) {
    console.error(`[vip] member refresh FAILED (invites may reach existing members): ${err?.message || err}`);
    return 0;
  }
}

export default async () => {
  const state = (await getJobState(STATE_KEY)) || {};
  const dryRun = process.env.NOTIFY_VIP_DRY_RUN === 'on';

  // Before anything else, so both the backfill and the drip see current members.
  await refreshMembers();

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

  const members = await getVipMembers();

  if (dryRun) {
    // Report the member split explicitly. A bare "would send N" cannot show
    // whether the exclusion is actually working, and getting that wrong means
    // inviting paying members to join what they already pay for.
    const wouldSkip = due.filter((r) => members[r.email.toLowerCase()]).length;
    const pending = queue.filter((r) => !r.sentAt).length;
    console.log(
      `[vip] DRY RUN — ${due.length} due today: would send ${due.length - wouldSkip}, ` +
        `skip ${wouldSkip} as existing members. ${pending} queued overall. Nothing sent.`
    );
    return new Response('ok', { status: 200 });
  }
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
