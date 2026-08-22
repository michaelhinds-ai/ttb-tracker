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

### Landed 2026-08-22 — the silent-zero fix

Multi-seller went live and immediately caught a real one. All three sellers reported
`connected: true`, and the two Nashville sellers reported **zero revenue** — which was
wrong. Their dashboards showed bookings checked in that same day.

Cause: **profile access and transaction access are separate grants in Xola.** The
shared `XOLA_API_KEY` could read `/api/sellers/{id}` for all three (so the connection
check passed and returned their real names) but `/api/transactions` came back as an
empty list — `200 OK`, no `401`, no `403` — for the two it could not see. An empty
list is exactly what a genuinely quiet day looks like, so nothing was flagged.

This is the failure this project's central convention exists to prevent, and the
original connection check walked straight past it.

- **`hasAnyTransactions(acct)` in `lib/xola.mjs`** — asks for ONE transaction with no
  date filter. Any seller with a trading history has one; none means the key is
  almost certainly blind to that seller. Returns `true` / `false` / `null`, and
  **only a definite `false` flags** — a timeout must never be reported as unreadable.
- **`xola-summary` / `xola-salestax`** run it only when a window came back empty
  (so the extra call costs nothing on a normal day, and never on a busy one), and
  expose `unreadable[]` alongside `failed[]`. `partial` now covers both.
- **`xola-accounts`** gained a `readable` field and stops reporting a blind seller
  as healthy — it returns `no_transactions_visible` with an explanation.
- **Frontend** — the KY tab's red banner names the blind sellers and says the total
  is too LOW; the By-seller table marks the row `(no data visible)`; the CSV writes
  `UNREADABLE` rather than a bare `0`.

Verified with stubbed-API tests: 10 assertions covering readable / blind / errored
sellers, the null-is-not-false guard, the probe carrying no date filter, and the
no-probe-when-rows-exist path. All passing.

**The lesson worth keeping: a health check must exercise the same permission the
report depends on.** Reading a name proved nothing about reading money.

### Landed 2026-08-22 — Tennessee tax kept off the Kentucky return

With all three sellers finally reporting, the KY Sales & Use tab was summing tax
across all of them. Two are Nashville. Their transactions carry Metro Transit Tax,
Downtown Alcohol Fee and similar — **Tennessee** tax, landing on a **Kentucky**
return. Wrong in both directions at once: Kentucky overstated, Tennessee unfiled.

The single-seller version was correct by construction — Xola meant Louisville, and
there was nothing else to include. Fanning it across three sellers quietly assumed
they shared a jurisdiction.

- **`XOLA_STATE_n`** per seller (`KY`, `TN`). `lib/xola.mjs` carries it on each account.
- **`xola-salestax` pulls KY sellers only** — non-KY sellers are not even fetched,
  which also removes them as a source of timeouts on this endpoint. Response gains
  `scope:"KY"`, `kySellerCount`, `otherStates[]` and `unclassified[]`.
- **An unclassified seller is excluded AND flagged.** Excluding one silently
  understates Kentucky; including one silently overstates it. Neither is allowed to
  happen quietly, so it forces `partial` and a red banner naming the seller.
- **Legacy default:** while *no* `XOLA_STATE_n` is set anywhere, seller 1 is treated
  as KY, preserving the old correct behaviour. The moment any state is set the
  classification is taken at face value — so setting `_2` and `_3` but forgetting
  `_1` drops Louisville out of KY loudly rather than carrying it silently.

Verified with 10 assertions: the real config, nothing set, the forgot-`_1` typo,
case/whitespace handling, a fourth KY seller joining, and no-KY-sellers-at-all.

**Xola tax is gone from the daily Retail Sales view** — KPI tile, the vs-last-year
row, the By-seller column and the CSV column. It spans two states, so no single
figure there could be meaningful. Tax lives on the KY tab, which now scopes itself
properly. The Square blocks keep their tax tiles; those are one jurisdiction.

`square-salestax` was checked and is clean — it uses the single `SQUARE_ACCESS_TOKEN`
and never fanned across both Square accounts, so the Square half of the KY return
was never polluted.

### The three Xola sellers

| Slot | Seller | ID |
|---|---|---|
| 1 | Louisville Rickhouse Whiskey Co | `69c2f539f783c835670bcee4` |
| 2 | Nashville Barrel Co (HQ) | `614b695157db5a047f79f0c3` |
| 3 | The Tasting Room Nashville (Church St) | `64dfbbedaecd0740d90c00d5` |

Three separate Xola logins, so **one key does not cover all three** — `XOLA_API_KEY_2`
and `XOLA_API_KEY_3` are required, not optional. Xola shows the seller ID nowhere in
its UI; it was read out of the seller app's own `seller=` request parameter.

### Known-wrong: Louisville's timezone

Everything runs on `SQUARE_TZ = America/Chicago`, including Louisville, which is
Eastern. Confirmed from live data: a Premium Tasting shown at 12:00 PM on the Xola
dashboard has `realizedAt` of `16:00Z` — noon Eastern, 11am Central. So Louisville's
day boundaries are an hour off.

Deliberately **not** fixed yet. `lib/xola.mjs` supports `XOLA_TZ_n` per seller, but
`SQUARE_TZ` is shared across both Square accounts, so correcting only the Xola half
would make the two sides of the same daily report disagree — worse than being
consistently off. Fix both together: per-account timezone on the Square side first.

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
XOLA_STATE_1..N         KY or TN — which state's return this seller's tax belongs on
XOLA_API_BASE           default https://xola.com
```

**Required, and each seller needs its own key** — three sellers means three Xola
logins means three keys. `XOLA_API_KEY` covers seller 1; `_2` and `_3` are not
optional. A key that reaches a seller's *profile* may still be blind to its
transactions; see the silent-zero section above.

A fourth seller later is just `XOLA_SELLER_ID_4` — no code change.

Square: `SQUARE_ACCESS_TOKEN` / `_2`, `SQUARE_LOCATION_ID`, `SQUARE_ENVIRONMENT`,
`SQUARE_VERSION`, `SQUARE_TZ`, `SQUARE_LABEL_1` / `_2`. Capped at 2 accounts by design.

**Set 2026-08-22:** `XOLA_SELLER_ID_1/_2/_3` and `XOLA_LABEL_1/_2/_3` are live.

**Set 2026-08-22:** all three `XOLA_API_KEY_n`. Verified live — 17 bookings,
65 guests, $2,159.56 net across the three sellers.

**Pending:** `XOLA_STATE_1=KY`, `XOLA_STATE_2=TN`, `XOLA_STATE_3=TN`. Until they are
set the legacy default holds (seller 1 = KY) and the two Nashville sellers show as
unclassified with a red banner on the KY tab.

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
5. **Per-account timezone.** Louisville is Eastern, everything computes in Central.
   Needs `SQUARE_TZ_n` to match `XOLA_TZ_n`; fix both halves in one change.
6. **Square has no equivalent of the readability probe.** `square-summary` and
   `square-salestax` can still return a quiet zero for an account whose token has
   been scoped down or revoked. Same fix, same reasoning.
7. **Report the Xola MCP bug** (see top of file).

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
