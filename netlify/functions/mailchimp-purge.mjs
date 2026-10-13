/**
 * mailchimp-purge.mjs — find and remove addresses that were never real people.
 *
 * Background: OTA channels hand the operator an anonymised relay address rather
 * than the guest's own. GetYourGuide's looks like
 * `customer-f43eg4tqq74cah63@reply.getyourguide.com` and stops accepting mail
 * seven days after the tour. Xola stored them, the weekly sync copied them into
 * Mailchimp, and campaigns have been hard-bouncing off them ever since.
 * lib/relay-addresses.mjs now stops new ones at the door; this clears out the
 * ones already in the audience.
 *
 * SAFETY — this endpoint reads by default and writes only when pushed:
 *   • With no query string it REPORTS and changes nothing.
 *   • Writing requires BOTH ?confirm=1 AND a token matching NOTIFY_ADMIN_TOKEN.
 *     If that variable is unset the endpoint is permanently read-only, so an
 *     unconfigured deploy cannot be made to delete anything.
 *   • Removal means ARCHIVE, not permanent delete. Archived contacts stop
 *     counting toward the plan and can never be mailed, but Mailchimp keeps
 *     them, so a mistake is recoverable.
 *   • Nothing is archived unless lib/relay-addresses.mjs says it is
 *     undeliverable. "Flagged" booking-channel domains are reported only.
 *
 * Usage:
 *   /.netlify/functions/mailchimp-purge                      report
 *   /.netlify/functions/mailchimp-purge?domains=1            + full domain census
 *   /.netlify/functions/mailchimp-purge?confirm=1&token=XXX  archive the relays
 */
import { json } from "./lib/square.mjs";
import { mcConfig } from "./lib/mailchimp.mjs";
import { undeliverableReason, flaggedBrand, splitAddress } from "./lib/relay-addresses.mjs";
import { createHash } from "node:crypto";

const env = (k) => (typeof Netlify !== "undefined" ? Netlify.env.get(k) : process.env[k]) || "";
const md5 = (s) => createHash("md5").update(String(s).trim().toLowerCase()).digest("hex");

async function mc(path, { method = "GET", body } = {}) {
  const { key, dc } = mcConfig();
  const r = await fetch(`https://${dc}.api.mailchimp.com/3.0${path}`, {
    method,
    headers: {
      Authorization: "Basic " + Buffer.from("apikey:" + key).toString("base64"),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return null; // archive returns no content
  const text = await r.text();
  let b = null;
  try { b = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!r.ok) {
    const e = new Error("mailchimp_" + r.status);
    e.status = r.status;
    e.detail = (b && (b.detail || b.title)) || String(text).slice(0, 200);
    throw e;
  }
  return b;
}

/** Page the whole audience, keeping only the few fields we need. */
async function allMembers(list) {
  const out = [];
  const fields = "total_items,members.email_address,members.status";
  for (let offset = 0, pages = 0; pages < 60; pages++, offset += 1000) {
    const b = await mc(`/lists/${list}/members?count=1000&offset=${offset}&fields=${fields}`);
    const batch = (b && b.members) || [];
    out.push(...batch);
    if (batch.length < 1000) break;
  }
  return out;
}

/** Run tasks with a small concurrency cap so Mailchimp does not throttle us. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
    })
  );
  return out;
}

/** Mask an address for reporting: keeps it diagnosable without dumping the list. */
function mask(email) {
  const p = splitAddress(email);
  if (!p) return "(malformed)";
  const head = p.local.slice(0, 3);
  return `${head}${p.local.length > 3 ? "…" : ""}@${p.host}`;
}

export default async (req) => {
  const cfg = mcConfig();
  if (!cfg.ok) {
    return json({ error: "not_configured", detail: "Set MAILCHIMP_API_KEY and MAILCHIMP_LIST_ID." }, 200);
  }

  let confirm = false, token = "", wantDomains = false, limit = 5000;
  try {
    const url = new URL(req.url);
    confirm = url.searchParams.get("confirm") != null;
    token = url.searchParams.get("token") || "";
    wantDomains = url.searchParams.get("domains") != null;
    limit = Math.min(+url.searchParams.get("limit") || 5000, 5000);
  } catch { /* scheduled invocation: no query string, stays read-only */ }

  // Once NOTIFY_ADMIN_TOKEN exists the endpoint is fully locked, read included —
  // the report alone would otherwise tell a stranger how big the audience is and
  // who it is made of. Before the variable is set the report still works so you
  // can look before configuring anything, and writes are impossible either way.
  const admin = env("NOTIFY_ADMIN_TOKEN");
  if (admin && token !== admin) return json({ error: "bad_token" }, 403);

  let members;
  try {
    members = await allMembers(cfg.list);
  } catch (e) {
    return json({ error: "read_failed", status: e.status || null, detail: e.detail || e.message }, 502);
  }

  const byDomain = new Map();
  const removable = [];
  const flagged = [];
  const reasons = {};
  const statuses = {};

  for (const m of members) {
    const email = (m && m.email_address) || "";
    const status = (m && m.status) || "unknown";
    statuses[status] = (statuses[status] || 0) + 1;

    const parts = splitAddress(email);
    const host = parts ? parts.host : "(malformed)";
    byDomain.set(host, (byDomain.get(host) || 0) + 1);

    const reason = undeliverableReason(email);
    if (reason) {
      reasons[reason] = (reasons[reason] || 0) + 1;
      removable.push({ email, status, reason });
      continue;
    }
    const brand = flaggedBrand(email);
    if (brand) flagged.push({ email: mask(email), status, brand });
  }

  const domainCensus = [...byDomain.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([domain, count]) => ({ domain, count }));

  const report = {
    audienceSize: members.length,
    byStatus: statuses,
    removable: {
      total: removable.length,
      byReason: reasons,
      samples: removable.slice(0, 15).map((r) => ({ email: mask(r.email), status: r.status, reason: r.reason })),
    },
    // Booking-channel domains that are NOT auto-removed. Review these; if one is
    // junk, add the domain to MAILCHIMP_BLOCKED_DOMAINS and re-run. No deploy.
    flaggedForReview: {
      total: flagged.length,
      contacts: flagged.slice(0, 40),
    },
    topDomains: domainCensus.slice(0, wantDomains ? 200 : 25),
  };

  if (!confirm) {
    return json({
      mode: "report",
      ...report,
      next: removable.length
        ? "Re-run with ?confirm=1&token=NOTIFY_ADMIN_TOKEN to archive the removable contacts."
        : "Nothing to remove.",
    });
  }

  // ---- write path ---------------------------------------------------------
  if (!admin) {
    return json({ error: "writes_disabled", detail: "NOTIFY_ADMIN_TOKEN is not set, so this endpoint is read-only.", ...report }, 403);
  }

  const targets = removable.slice(0, limit);
  let archived = 0;
  const failures = [];
  await mapLimit(targets, 5, async (t) => {
    try {
      await mc(`/lists/${cfg.list}/members/${md5(t.email)}`, { method: "DELETE" });
      archived++;
    } catch (e) {
      failures.push({ email: mask(t.email), status: e.status || null, detail: e.detail || e.message });
    }
  });

  return json({
    mode: "archive",
    ...report,
    archived,
    remaining: Math.max(0, removable.length - targets.length),
    failures: failures.slice(0, 10),
    note: "Archived, not permanently deleted — recoverable from Mailchimp's archived contacts view.",
  });
};
