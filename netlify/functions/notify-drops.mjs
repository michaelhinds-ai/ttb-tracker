/**
 * Weekly trigger for the new-bottles email.
 *
 * Thursdays 16:00 UTC — 11am Central, which lands mid-morning for most of the
 * US and gives the weekend browsers something to click. Change the cron below
 * to move it.
 *
 * All this does is kick off notify-drops-background, for the same reason
 * mailchimp-sync exists separately from mailchimp-import-background: a
 * scheduled function has a short timeout, and emailing thousands of people
 * does not fit in it. The background function returns a blank 202 immediately
 * and does the work behind it; its output goes to the function log.
 *
 * Scheduled functions cannot be invoked over HTTP (Netlify returns 403). To
 * run this manually, hit the background function directly:
 *   .../.netlify/functions/notify-drops-background
 */

export default async () => {
  const base = (process.env.NOTIFY_PUBLIC_URL || 'https://lrwc-ttb-tracker.netlify.app')
    .replace(/\/+$/, '');
  const url = `${base}/.netlify/functions/notify-drops-background`;

  try {
    const res = await fetch(url, { method: 'POST' });
    console.log(`[drops] weekly trigger fired -> ${url} (${res.status})`);
  } catch (err) {
    console.error(`[drops] weekly trigger FAILED to reach the background function: ${err?.message || err}`);
  }

  return new Response('ok', { status: 200 });
};

export const config = {
  schedule: '0 16 * * 4'
};
