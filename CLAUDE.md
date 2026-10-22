# Mikey Systems (ttb-tracker2) — project memory for Claude

Read this first in any new chat. **Update it whenever work lands** (new feature, rule, gotcha,
or open item) and commit it with that change. Older notes: `HANDOFF.md` (Aug 2026, Xola/Square
env vars, backlog) — still valid for those topics.

**Last updated:** 2026-10-21 · **Current build:** `v20261021a`

## What it is
- Single-page app `public/index.html` (~12k lines, all JS inline) + Netlify functions in
  `netlify/functions/*.mjs`. Live: https://lrwc-ttb-tracker.netlify.app (Netlify auto-deploys on push).
- Owner: Mike Hinds. Terse, wants execution, honest pushback. Deploys by clicking
  **Push origin** in GitHub Desktop. Always end a change by telling him to push.
- Root-level `app*.js`, `*.mjs`, `index.html` in the repo root are **stale leftovers** — the real
  code is `public/` and `netlify/functions/`.

## Two companies, two workspaces (Netlify Blobs)
- `ROOT_WS` Louisville Rickhouse (LRWC) `7d72874cf4714c4e9242a22c39c42a65` — home of logins,
  retail, inventory, mail, marketing, **the label system** (templates + Label Library).
- `NBC_WS` Nashville Barrel Co `d7ee258b1c714b6fab306c4a9396825d` — fully separate data/reports/QuickBooks.
- `COMPANIES={lrwc,nbc}`, `CO`, `IS_NBC`, `switchCompany()`. Company access from user locations
  (`userCos()`); `SHARED_LRWC_VIEWS` (labels, labelprint, upclookup) open for NBC-only logins.
- Server `data.mjs`: merges arrays by id using `_upd`; `ARR_KEYS` must list every synced array
  (incl. labelRuns, labelTemplates, trustedDevices, bottleSubs, filings). `op=append` endpoint
  drops records into the other company (internal transfer). Client `UPD_KEYS` + `normalize()`
  must also know new keys.
- `/api/docs` = file/blob store (photos, label images as `doc:<id>`, licenses…). `?list=1` lists ids (auth).

## Deploy workflow (how Claude ships)
1. Start from the latest built copy (`/mnt/user-data/outputs/vXXXX/index.html` in the cloud
   session) **or stage the file from this folder** — never from an old cloud git checkout.
   ⚠️ **Server files (`netlify/functions/*`) must be copied/edited from THIS folder** — the cloud
   repo copy is stale; overwriting `data.mjs` from it once deleted the internal-transfer endpoint.
   This folder's working copy has CRLF; repo blobs are LF — write LF.
2. Edit with exact-string replace; bump build in 3 places: `var APP_BUILD`, `_bt.textContent='vX·inline'`, `id="buildTag"`.
3. `node --check` the extracted scripts; Playwright test (serve `public/` on :8767; route
   `**/api/**` first; route cdnjs/jsdelivr libs to local npm copies — sandbox can't reach CDNs).
4. Write into this folder (device_commit_files), commit with `git -c user.email=noreply@anthropic.com
   -c user.name=Claude -c gc.auto=0 -c maintenance.auto=false commit -qam "..."`. Deleting is blocked,
   so git leaves `.lock` files: before/after commit move them with
   `for f in $(find .git -name '*.lock' ! -name 'stale-*'); do mv -n "$f" ".git/stale-$(date +%s%N)-$(basename $f)"; done`
   (the `! -name 'stale-*'` matters — without it names grow until "File name too long").
5. Mike pushes. Live data edits (templates etc.) are done through Claude in Chrome on a signed-in
   Mikey Systems tab: fetch server → set `_upd` newer → POST `cloudPayload()` → verify. One session per login.

## Roles
Trusted devices (Setup → Users): a device is approved once ON that device (token in localStorage/cookie); each device can then be limited to specific deviceLock users (`d.users` ids, empty = all restricted staff) — enforced in `deviceTrusted(uid)` and server auth-login.mjs.
labeler ("Label Printer" — only Label Printing, Case labels, UPC lookup: `LABELER_VIEWS`; switchView redirects everything else to labelprint AND clears editor/print state so Home = template list; userCos=['lrwc']; server `filterForLabels` reads only skus/upcs/labelTemplates/labelRuns, writes only labelRuns/labelTemplates; no `write` cap so no template Edit/Delete),
admin, admin2, editor, manager, barrelmgr (James Davenport), production (Taylor), retail (Retail
Manager), retailemp. Per-user flags: viewOnly, invAdmin, seesSales, devApprove, docUpload,
custAdmin (Kelly), shopAccess (Shopify Store card). Server tokens carry role + some flags.

## TTB reporting rules (don't break)
- Storage 5110.11 = `storageFigures()`/`_stFlow()`; processing = `procFigures()`.
- **Filed months are frozen**: `filedOverride()` checks `state.filings` (Casey taps "Mark as filed
  with TTB" on the Pay.gov values report → locks figures + snapshot), then hard-coded
  `FILED_FORMS` (LRWC Jul–Sep 2026) / `FILED_FORMS_NBC` (Aug–Sep 2026). Next month opens from filed close.
- Lot-drawn barrels (`fromBottling` + `lotDraw` or notes "Barrel drawn from lot…") DO count as
  deposits; other `fromBottling` records are tracking-only (`_stSkip`). A bottling removes its
  **received** PG from storage (bottled → processing, rest → loss). Dumps tied to a bottling
  (`dumpBottlingId`) aren't counted again.
- **Totes**: `container:'tote'` barrel record, `pgTotal` = what's left. Filling barrels by weight
  (`gaugeByWeight`, Table-4 factors computed from OIML density; 190 pf = 0.14720 vs TTB 0.14718)
  creates barrels with the tote's `tibInDate`. Bottling from a tote creates a `toteDraw` dumped
  record. Bottling page shows "— up to N from this tote" next to # of bottles once proof is entered (remaining PG × (1 − bottling loss) ÷ PG per 750 ml). Emptying a tote = Dumped; leftover = storage loss.
- A failed data source must never read as zero (see HANDOFF.md conventions).

## Label system (LRWC workspace)
- Templates: `sheet{on,wIn,hIn,rot,front{xIn,yIn},back{...}}`; fields `xPct,yPct,wPct,hPct,fontPt,
  font,bold,upper,prefix,suffix,link(proof/abv),fixed,choices,growUp,lineH`. Background art is a
  guide only (not printed); art files in `public/labels/`.
- Fonts: helv/times/courier (PDF standard), hand/hand2/mont (embedded base64), plus 22 Google
  fonts in `public/fonts/lbl/<key>-r|b.ttf` (`LBL_WEBFONTS`). PDF baseline uses the preview font's
  metrics (`_lblBaseOff`) so print = preview. PDFs open in a tab pre-opened at click (`_pdfPreopen/_pdfShow`). Text colour: `_lblColorCtl` (swatches `LBL_SWATCHES` + colour picker) in the editor (`f.color`) and per print next to the font picker (`lblRunColor` → `_lblRunPos[..].color`, kept by "Save positions to template"). Per-print flag on a text field: `flagLabel`/`flagPrefix`/`flagFontPt` → checkbox at print (`lblRunFlag`) swaps the prefix (+size) for that print (Oak King: "Single barrel" → "Single Barrel Selected by: ").
- Templates: LRWC Single Barrel, Nashtucky, NBC Single Barrel, NBC Collaborative (spirittype1),
  Circle, Stella's Secret Stash (rot 270, needs 6.50" length), NBC Small Batch (`nbcsmallbatch1`). Oak King Straight Rye (`oakkingrye1`, single panel 3×6″, art `oakking_front/back.jpg`; Selected by / Proof→ALC/VOL / Age / bottom-right text OR image). Tennquila Barrel Aged Agave (`tennquila1`, front only 3.8×4.44″, art `tennquila_front/back.jpg`; 2 age-statement lines + ALC/VOL (number only, label prints the %) + Proof, all Pen font, in the white strip at the bottom). To add a template from a scan: crop art at 300 dpi into public/labels, measure box px → %, then write the template server-side (fetch /api/data, push into labelTemplates with newer `_upd`, POST cloudPayload with `_baseSavedAt=_savedAt`) — pushing into local state + save() gets wiped by the constant merge loop.

## Custom Label Bottle orders (Shopify → Label Printing) — v20261021a
- buyspiritsdirect.com sells a "Custom Label Bottle" (product `custom-label-bottle`, theme template
  `product.custom-label.liquid`). The customer uploads a logo, types a line, drags/scales the logo on a
  live canvas; the order carries line-item properties `Label Text`, `Logo` (file URL), `Label Proof`
  (PNG of the preview), `Comment`, `_Label Template`, `_Logo Placement` (JSON cx,cy,wFrac,hFrac,scale,bgRemoved).
- `netlify/functions/custom-label-orders.mjs` → `/api/custom-label/orders` (GET list, POST done-state in
  Blobs store `custom-label`). Needs the Shopify app scope **read_orders** (same client-credentials auth as
  shopify-summary). Requires a session token when AUTH_SECRET is set.
- Client: `clOrdersHTML()` card at the top of Label Printing (only when the NBC Collaborative template
  `emuy8nkqmjbbp` exists). "Open in template" → `clOpenOrder()` = lblStartPrint + logo fetched from the
  Shopify CDN into `_lblRunImgs['front_<imgField>']`, placement mapped into `_lblRunPos`, text/aged/
  distilled/proof prefilled, qty = ordered qty. Mark done keeps the queue tidy (no Shopify write needed).

## Other features worth knowing
Store Inventory par by store: `it.targetByLoc[store]` overrides the default `it.target` (blank = default, 0 = no par there); `_invTarget(it,loc)`; inventory admins edit it inline in the Par column (`invSetPar`) or in the item editor ("Par by store").
Task comments: 💬 on an open task (assigner ↔ assignee only) adds to `t.comments`, sets `t.unread=[otherId]` (red "new" badge + Mark read), and emails the other person via task-notify `kind:'comment'`. task-notify looks up the recipient's email by `toId` server-side for any kind (retail logins can't see emails) — that also fixed "task done" emails when a retail user completes.
Joy Ride log (`view-joyride`, `state.joyRides`): Retail tile shown only for retail logins at Church St (`_joyLocOk`, /church/i on clocked-in or assigned store) + admins; entry = date, driver, guests, byName/byLoc, one $5 envelope; Today/Week/Month/All totals, admin CSV. Server: joyRides in ARR_KEYS, ALWAYS_MERGE, TOMBSTONE (soft-delete via `_softDelId`), RETAIL_WRITE_KEYS; retail reads their store's entries.
Home navigation: the dog, the "Mikey Systems" title, the crumb's Home and every "← Home" button call `goHome()` → the LRWC card page (switches back from NBC unless the login is NBC-only); retail → retailhub, labeler → labelprint.
Bottling Log approvals: anyone with `write` (Super Admin, managers, Barrel Manager) can Approve/Edit pending entries on the Bottling Log page itself as well as the Bottling page; each pending row has a **Gift shop** tick → `pbApprove(id,gift)` records a gift-shop removal (excise + $0 GiftShop invoice) instead of in-bond finished goods. The Bottling page's own "Bottle a Barrel / Lot" form also takes an optional bottle photo (`boPhoto` → uploaded after `doBottle` via `_boAttachPhoto`, sets `bt.photoId`; 📷 link in Bottling History). The gift-shop option is labelled **"GiftShop / DTC"** in the UI (internals still `giftShop`, customer "GiftShop"). Bottling form has a Customer field (`bo_customer` → `bt.customer`, prefilled from approved entries); Bottling History has a search box (`renderBottlingHist`, matches barrel #, customer, spirit, dates, proof, "dtc").
Orders stay open until "Mark shipped" (TTB removal + QuickBooks sync at ship). Transfers in Bond
page (`view-tib`). Production Bottling Log with approvals + nightly email. Direct bottlings on the Bottling page also create an approved Bottling Log entry (`_logDirectBottling`, `direct:true`, linked by `bottlingId`). Store Inventory with HQ
Warehouse tab for NBC HQ staff. Tips (staff can fix their own). Xola "today" card. Shopify Store
card (Shopify GraphQL needs `@idempotent` on inventory mutations). Full backup .zip in Setup & Data.

## Email audience hygiene (Mailchimp)
- `lib/relay-addresses.mjs` is the ONE gate for what may enter the marketing audience. Used by
  `lib/mailchimp.mjs` (`runSync` + `mcUpsert` + `mcWelcome`) and `lib/notify-core.mjs` (`validEmail`),
  so the weekly sync, the notify-me modal and the welcome tagger all share it. Route new sources
  through it rather than adding a second check.
- **Why it exists:** OTA channels hand Xola an anonymised relay instead of the guest's own address.
  GetYourGuide's `customer-xxxx@reply.getyourguide.com` **stops accepting mail 7 days after the
  tour**. The sync was copying those in as `subscribed` and `mcWelcome()` was tagging them into the
  journey, so campaigns hard-bounced off addresses that were never customers. Hard bounces cost
  sender reputation across all six lifecycle flows, and an OTA booking carries no marketing consent.
- **Two tiers, deliberately.** BLOCKED domains are dropped and purged — only `reply.getyourguide.com`
  is confirmed. FLAGGED booking-channel brands (viator, klook, airbnb…) are reported and NEVER
  auto-removed, because `sales@getyourguide.com` could be a real contact. Promote a domain by adding
  it to `MAILCHIMP_BLOCKED_DOMAINS` (comma-separated) — no deploy needed. Bias is deliberate:
  dropping a real customer is worse than leaving one relay in for another week.
- `mailchimp-purge.mjs` clears the ones already in. Reports by default; ARCHIVES (reversible, never a
  hard delete) only with `?confirm=1&token=` matching `NOTIFY_ADMIN_TOKEN`. Once that var is set the
  endpoint is locked for reads too, since the report alone reveals audience size and composition.
- `runSync` now returns `rejected` / `rejectedExamples` counts so a shrinking audience is never silent.
- Server-only change — no `APP_BUILD` bump.

## Open items (Oct 13 2026)
- Google Business Profile API: **approved Oct 14 2026** (300 QPM), 7 listings connected. Reviews run is time-budgeted: `runWeeklyReviews({budgetMs})` does parallel batches of 4, saves the log per batch, returns `remaining`/`partial`; the Run button and the Monday scheduled job loop until done (a Netlify function dies at ~10s → HTML error page, which was the "Unexpected token <" bug). North Knox listings are skipped (`SKIP_LISTINGS` in lib/gbp.mjs). Reply prompt describes each listing (Louisville KY vs Nashville TN); model = `ANTHROPIC_MODEL` env or `claude-haiku-4-5`, 3.5s timeout → template fallback.
- Public reviews feed for the marketing sites: `GET /api/reviews/public?brand=lr|nbc` (netlify/functions/reviews-public.mjs). Returns rating, total count, up to 8 curated 5★ reviews (name + last initial, clipped text), per-location counts. Cached 6h in the gbp-data blob store (`public-<brand>`), CORS open, `?refresh=1` forces a refetch. Brand → listing match is a title regex in BRANDS. Consumed by louisvillerickhouse.com and nashvillebarrelco.com homepages/tours pages (Oct 18 2026).
- NBC Small Batch template: needs a test print (fonts/positions adjustable in the print screen).
- Stella: driver Label length 6.50" + final test print.
- Square connector needs reconnecting (tips / merch-by-location questions).
- October 5110.11 (both companies) uses the corrected storage math — review before Casey files.
- Email: deploy, set `NOTIFY_ADMIN_TOKEN`, then run `/.netlify/functions/mailchimp-purge?token=…`
  to see the domain census; review `flaggedForReview` before archiving with `&confirm=1`.
- Mailchimp's Shopify app is still not installed, so none of the six email flows has revenue
  attribution. Finding 01 of the Aug audit; still open.
