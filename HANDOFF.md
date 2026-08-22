# TTB Tracker — Project State

Living handoff doc. Attach this at the start of a new Claude chat and it picks up
where the last one left off. Update it when work lands, not on a schedule.

**Last updated:** 2026-08-22
**App name:** Mikey Systems — TTB Reporting Tracker (Louisville Rickhouse, DSP-KY-20181)
**Repo:** `michaelhinds-ai/ttb-tracker` (public) · **Deploy:** Netlify, `lrwc-ttb-tracker.netlify.app`

> **Deploy URL corrected 2026-08-22.** Earlier versions of this file said
> `distillery-ttb-tracker.netlify.app`. That site is dead — it 404s on
> `/api/square/accounts`. The live site is **`lrwc-ttb-tracker.netlify.app`**
> (Netlify project `lrwc-ttb-tracker`, site id `ab913eb5-5dec-46c8-8ecf-711e7cafd319`),
> which serves the Square and Xola functions and reports two Square accounts
> configured. Verified by probing both.
>
> **The local folder is not a clone of this repo.** `Documents\GitHub\ttb-tracker`
> on hinds-dell is a separate local-only history (branch `master`, no remote) that
> tracks just 7 files — `public/index.html` plus `netlify/functions/data.mjs`. It has
> none of the Square/Xola functions. Its `public/index.html` *is* byte-identical to
> the repo's (blob `77714fe`), but do not expect to push from there. Changes reach
> production through GitHub, which has historically been "Add files via upload"
> through the web UI.

---

## ⚠️ Read this first: do not enable the Xola connector

The Xola MCP connector **breaks any chat it is loaded in**. Every request fails with:

```
API Error: 400 tools.89.custom.input_schema.properties:
Property keys should match pattern '^[a-zA-Z0-9_.-]{1,64}$'
```

**Cause:** Xola's REST API filters with bracketed params (`createdAt[gte]`,
`items_realizedAt[lte]`). Their MCP server publishes those verbatim as JSON Schema
property keys. `[` and `]` aren't legal there, so Anthropic's API rejects the whole
tool list — before any tool runs. It fires on *every* message, even "hello".

**This is a bug on Xola's server. It is not fixable from our side and not caused by
our code.** A chat that hits it is unrecoverable; turn the connector off or start fresh.

**Rule:** pull Xola data over plain HTTPS with `X-API-KEY` (which is what our Netlify
functions already do), never through the connector.

**Open action:** report to Xola support. Suggested wording — *"Your MCP server's tool
input schemas use bracketed query params like `createdAt[gte]` as property keys, which
violates Anthropic's `^[a-zA-Z0-9_.-]{1,64}$` requirement and 400s every request."*

---

## What this is

Static frontend + Netlify functions. Federal TTB and Kentucky excise/sales-tax
reporting for the distillery, with cross-device sync via Netlify Blobs.

| Path | What it is |
|---|---|
| `public/index.html` | **The real app.** ~241 KB, all logic inline. |
| `index.html` (repo root) | **Stale duplicate**, ~121 KB, no Square/Xola code. See backlog. |
| `netlify/functions/` | 18 functions — Square, Xola, QuickBooks, Blobs sync, backup email |
| `netlify/functions/lib/` | `square.mjs`, `xola.mjs`, `qb.mjs` shared helpers |
| `public/*.pdf` | TTB 5000.24 / 5110.11 / 5110.28, KY 73A525 |

Data sources: **Square** (retail / gift shop) and **Xola** (experiences, tours).
Money is dollars in Xola, cents in Square — `lib/square.mjs` converts.

---

## Current state

### Landed this session — multi-seller Xola

Xola was hardcoded to one seller; Mike runs three, so two sellers' revenue and sales
tax were missing from the reports entirely. Square already handled two accounts and
was left alone.

- **New `netlify/functions/lib/xola.mjs`** — mirrors `lib/square.mjs`. Open-ended
  `accounts()` list, per-seller fan-out with error isolation, bounded paginated fetch.
- **`xola-summary` / `xola-salestax`** run every seller concurrently, returning
  per-seller figures plus a combined rollup. Top-level totals keep their old field
  names, so anything reading the previous shape still works.
- **New `/api/xola/accounts`** — per-seller connection status, mirrors the Square one.
- **Frontend** — "By seller" table on Retail Sales, one source row per seller on the
  KY tab, both CSV exports broken out by seller.

Verified with stubbed-API tests: 31 assertions covering rollup arithmetic, label
precedence, experience-list merging across sellers, legacy single-seller env, and
failure isolation. All passing.

**Status: not yet merged.** Delivered as `xola-multi-seller.patch` (44 KB, applies
cleanly to `main`). The container's git proxy refused to push — the repo isn't in the
session's authorized set. Apply with `git am`, or authorize the repo and have Claude push.

### Also fixed: the endpoint hang

Old `fetchTransactions` allowed **300 sequential pages with no timeout and no abort** —
it could not finish inside Netlify's 10s function limit, and the frontend has no
timeout either, so the UI span forever. Now capped at 60 pages with each request's
timeout clamped to the remaining budget. A dead seller returns in ~5s as a labeled
error row. Measured worst case: 5.1s.

---

## Environment variables (Netlify)

Xola — the seller is chosen per-request, so **one `XOLA_API_KEY` covers every seller it
can see.** Only add per-seller keys if one key can't reach them all.

```
XOLA_API_KEY            shared key (required)
XOLA_SELLER_ID_1..N     seller ids — _1 falls back to legacy XOLA_SELLER_ID
XOLA_API_KEY_1..N       optional per-seller key override
XOLA_LABEL_1..N         optional display name (else the seller's Xola name)
XOLA_TZ_1..N            optional, defaults to SQUARE_TZ
XOLA_API_BASE           default https://xola.com
```

A fourth seller later is just `XOLA_SELLER_ID_4` — no code change.

Square: `SQUARE_ACCESS_TOKEN` / `_2`, `SQUARE_LOCATION_ID`, `SQUARE_ENVIRONMENT`,
`SQUARE_VERSION`, `SQUARE_TZ`, `SQUARE_LABEL_1` / `_2`. Capped at 2 accounts by design.

**Pending:** `XOLA_SELLER_ID_2` and `XOLA_SELLER_ID_3` still need to be set in Netlify.
Until they are, the reports show one seller and behave exactly as before.

---

## Backlog, worst first

1. **Report endpoints have no auth.** `/api/xola/summary`, `/api/square/summary`,
   `/api/square/salestax` and friends are unauthenticated. Anyone who knows the Netlify
   URL can pull daily revenue. Should sit behind the workspace code or a shared secret.
2. **No timeouts anywhere in the frontend.** Zero `AbortController` in
   `public/index.html`; every `fetch()` waits forever, so a slow function spins the UI
   indefinitely. The Xola side is now bounded server-side, Square is not.
3. **Square pagination is unbounded.** `do…while(cursor)` with no page cap in
   `square-summary`, `square-report`, `square-salestax`, `square-transactions`,
   `square-setup-tags` — same failure mode Xola just had. `square-summary` also
   re-scans the whole catalog (200/page) on *every* daily call to build the bottle-mL
   map, with no caching.
4. **Two divergent `index.html` files.** Root copy is stale and misleading. Delete it
   or make it a redirect.
5. **Report the Xola MCP bug** (see top of file).

---

## Conventions worth keeping

- **A failed data source must never silently read as zero.** Missing seller data makes
  tax owed look *lower* than it is, which is the dangerous direction before a filing.
  Per-account pulls return an error row; the KY tab renders a red warning and the CSV
  writes `UNAVAILABLE`. Keep this property in anything new.
- One account failing never blanks the others — `Promise.all` with per-account catch.
- New account slots come from an open-ended env list, not another hardcoded constant.
- Response shapes stay backward compatible: add an `accounts[]` array, keep the
  existing top-level totals.
- Rates in the app are editable in Setup and must be confirmed against ttb.gov and
  revenue.ky.gov before filing.
