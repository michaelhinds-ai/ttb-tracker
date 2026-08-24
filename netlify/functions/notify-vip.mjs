/**
 * Daily trigger for the VIP invite job. 15:00 UTC — 10am Central.
 *
 * All this does is start notify-vip-background, which is where the work
 * happens. Split for two reasons: the backfill is far too slow for a
 * scheduled function's timeout, and scheduled functions cannot be invoked
 * over HTTP (Netlify returns 403), so without this split there would be no
 * way to run it on demand.
 *
 * To run it by hand — for the dry run, or after changing settings:
 *   .../.netlify/functions/notify-vip-background
 * It returns a blank 202 straight away; the output goes to the function log.
 */

export default async () => {
  const base = (process.env.NOTIFY_PUBLIC_URL || 'https://lrwc-ttb-tracker.netlify.app')
    .replace(/\/+$/, '');
  const url = `${base}/.netlify/functions/notify-vip-background`;

  try {
    const res = await fetch(url, { method: 'POST' });
    console.log(`[vip] daily trigger fired -> ${url} (${res.status})`);
  } catch (err) {
    console.error(`[vip] daily trigger FAILED to reach the background function: ${err?.message || err}`);
  }

  return new Response('ok', { status: 200 });
};

export const config = {
  schedule: '0 15 * * *'
};
