/**
 * relay-addresses.mjs — the single gate for addresses that must never enter the
 * marketing audience.
 *
 * WHY THIS EXISTS
 * ---------------
 * OTA booking channels (GetYourGuide, Viator, Klook and the rest) do not give
 * the operator the guest's own address. They hand over an anonymised relay that
 * forwards for the life of the booking and then stops. GetYourGuide's looks
 * like:
 *
 *     customer-f43eg4tqq74cah63@reply.getyourguide.com
 *
 * and, per GetYourGuide's own supplier documentation, it stops accepting mail
 * SEVEN DAYS after the activity runs. Xola records whatever the channel put on
 * the booking; the weekly sync copied that into Mailchimp as a `subscribed`
 * contact; and every campaign since has earned a hard bounce from an address
 * that was never a customer's to begin with.
 *
 * Three independent reasons to drop them — any one would be enough:
 *
 *   1. DELIVERABILITY. These are not "might bounce" addresses, they are
 *      certain bounces on a timer. Gmail and Yahoo price hard-bounce rate
 *      directly into sender reputation, so a steady trickle of them taxes the
 *      delivery of every other message from the domain.
 *   2. CONSENT. Booking a distillery tour through an OTA is not opting in to
 *      whiskey marketing. There is no consent record behind these addresses.
 *   3. CHANNEL TERMS. The relay exists for booking logistics. OTAs do not
 *      permit it to be harvested as a marketing list.
 *
 * TWO TIERS, DELIBERATELY
 * -----------------------
 * BLOCKED domains are ones confirmed to be machine relays. They are filtered
 * out at every source and purged from the audience.
 *
 * FLAGGED domains merely belong to a booking channel. They are reported and
 * never auto-removed, because a domain like `viator.com` could just as easily
 * be a real account manager you actually want to reach. The report tells you
 * what is really in the list; you promote a domain to BLOCKED by adding it to
 * MAILCHIMP_BLOCKED_DOMAINS, no deploy required.
 *
 * The bias is deliberate: silently dropping a real customer is a worse failure
 * than leaving one relay address in for another week.
 */

const env = (k) =>
  (typeof Netlify !== 'undefined' ? Netlify.env.get(k) : process.env[k]) || '';

/** Confirmed anonymised-relay domains. Matched exactly or as a parent suffix. */
const BLOCKED_DOMAINS = [
  'reply.getyourguide.com' // confirmed: expires 7 days after the activity
];

/**
 * Booking-channel domains worth a look. Substring match on the host, used for
 * REPORTING ONLY — never to drop an address.
 */
const FLAGGED_BRANDS = [
  'getyourguide', 'viator', 'tripadvisor', 'klook', 'airbnb', 'expedia',
  'booking.com', 'civitatis', 'musement', 'tiqets', 'headout', 'peek.com',
  'fareharbor', 'groupon', 'veltra', 'isango', 'projectexpedition',
  'toursbylocals', 'withlocals', 'getaguide', 'xola.com'
];

/**
 * Local parts that are never a person. An automated mailbox cannot consent and
 * will not buy a bottle.
 */
const ROLE_LOCAL_PARTS = new Set([
  'noreply', 'no-reply', 'no_reply', 'donotreply', 'do-not-reply',
  'do_not_reply', 'mailer-daemon', 'mailerdaemon', 'postmaster', 'bounce',
  'bounces', 'abuse', 'devnull', 'null', 'undisclosed-recipients'
]);

/** Reserved / non-routable TLDs — RFC 2606 and RFC 6761. Cannot receive mail. */
const RESERVED_TLDS = new Set(['invalid', 'test', 'example', 'localhost', 'local']);

/** Reserved second-level domains that exist only for documentation. */
const RESERVED_DOMAINS = new Set(['example.com', 'example.org', 'example.net']);

/** Operator-managed additions, comma-separated, no deploy needed. */
function extraBlocked() {
  return env('MAILCHIMP_BLOCKED_DOMAINS')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

/** Split an address into normalised local part and host. Null if unparseable. */
export function splitAddress(email) {
  const v = String(email == null ? '' : email).trim().toLowerCase();
  const at = v.lastIndexOf('@');
  if (at <= 0 || at === v.length - 1) return null;
  const local = v.slice(0, at);
  const host = v.slice(at + 1).replace(/\.+$/, '');
  if (!host.includes('.') || /\s/.test(v)) return null;
  return { local, host };
}

/** True when `host` is `domain` itself or a subdomain of it. */
function hostMatches(host, domain) {
  return host === domain || host.endsWith('.' + domain);
}

/**
 * Why this address must not be mailed, or null if it is fine.
 *
 * Returns a short machine-readable reason so callers can log and count what
 * they dropped rather than discarding addresses invisibly.
 */
export function undeliverableReason(email) {
  const parts = splitAddress(email);
  if (!parts) return 'malformed';
  const { local, host } = parts;

  const tld = host.slice(host.lastIndexOf('.') + 1);
  if (RESERVED_TLDS.has(tld)) return 'reserved-tld';
  if (RESERVED_DOMAINS.has(host)) return 'reserved-domain';
  if (ROLE_LOCAL_PARTS.has(local)) return 'role-address';

  for (const d of BLOCKED_DOMAINS) if (hostMatches(host, d)) return 'ota-relay';
  for (const d of extraBlocked()) if (hostMatches(host, d)) return 'blocked-domain';

  return null;
}

/** Convenience predicate for the hot path. */
export function isMailable(email) {
  return undeliverableReason(email) === null;
}

/** Report-only: does this look like a booking channel worth reviewing? */
export function flaggedBrand(email) {
  const parts = splitAddress(email);
  if (!parts) return null;
  return FLAGGED_BRANDS.find((b) => parts.host.includes(b)) || null;
}

/**
 * Drop every unmailable contact from a {email,...} list.
 * Returns the survivors plus a per-reason tally of what went, so the caller can
 * surface it instead of quietly shrinking the audience.
 */
export function filterMailable(contacts) {
  const kept = [];
  const dropped = {};
  const examples = {};
  for (const c of contacts || []) {
    const reason = undeliverableReason(c && c.email);
    if (reason) {
      dropped[reason] = (dropped[reason] || 0) + 1;
      if (!examples[reason]) examples[reason] = String((c && c.email) || '');
      continue;
    }
    kept.push(c);
  }
  return { kept, dropped, examples };
}

export const _internals = { BLOCKED_DOMAINS, FLAGGED_BRANDS, ROLE_LOCAL_PARTS };
