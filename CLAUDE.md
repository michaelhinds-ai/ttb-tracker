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
  guide only (not printed); art files in `public/labels/`. Knockout zones `panel.knockout` ([{t:'ellipse',cx,cy,rx,ry}|{t:'poly',pts}] in % of panel) = pre-printed art an image may never print over: preview redraws the bg on top inside each zone (`_lblKnockPv`), the PDF rasterizes image fields with the zones erased (`_lblKnockImg`). `panel.printArea` {x,y,w,h,rx,ry} (%) = rounded rect an image may print inside (outside it is erased in print and the bg redrawn in preview). NBC Collaborative front: badge circle+shield knockout traced from the bg pixels (black edge +~0.4%) and printArea = inside the gold frame (x 9.1 y 20.85 w 82.2 h 58).
- Fonts: helv/times/courier (PDF standard), hand/hand2/mont (embedded base64), plus 22 Google
  fonts in `public/fonts/lbl/<key>-r|b.ttf` (`LBL_WEBFONTS`). PDF baseline uses the preview font's
  metrics (`_lblBaseOff`) so print = preview. PDFs open in a tab pre-opened at click (`_pdfPreopen/_pdfShow`). Text colour: `_lblColorCtl` (swatches `LBL_SWATCHES` + colour picker) in the editor (`f.color`) and per print next to the font picker (`lblRunColor` → `_lblRunPos[..].color`, kept by "Save positions to template"). Per-print flag on a text field: `flagLabel`/`flagPrefix`/`flagFontPt` → checkbox at print (`lblRunFlag`) swaps the prefix (+size) for that print (Oak King: "Single barrel" → "Single Barrel Selected by: ").
- Templates: LRWC Single Barrel, Nashtucky, NBC Single Barrel, NBC Collaborative (spirittype1),
  Circle, Stella's Secret Stash (rot 270, needs 6.50" length), NBC Small Batch (`nbcsmallbatch1`). Oak King Straight Rye (`oakkingrye1`, single panel 3×6″, art `oakking_front/back.jpg`; Selected by / Proof→ALC/VOL / Age / bottom-right text OR image). Tennquila Barrel Aged Agave (`tennquila1`, front only 3.8×4.44″, art `tennquila_front/back.jpg`; 2 age-statement lines + ALC/VOL (number only, label prints the %) + Proof, all Pen font, in the white strip at the bottom). NBC Barrel Aged Maple Syrup (`nbcmaple1`, the only maple template, 3×3.5″, full-color art printed as a fixed image field `/labels/nbc_maple_syrup3.jpg` at 103% for bleed on blank stock; sheet rot 90 — roll runs labels 3.5″ across × 3″ along, C6500 paper 3.5 W × 3.0 L). NBC Barrel Aged Honey (`nbchoney1`) = same setup, art `nbc_honey.jpg`. To add a template from a scan: crop art at 300 dpi into public/labels, measure box px → %, then write the template server-side (fetch /api/data, push into labelTemplates with newer `_upd`, POST cloudPayload with `_baseSavedAt=_savedAt`) — pushing into local state + save() gets wiped by the constant merge loop.

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
  distilled/proof prefilled, qty = ordered qty. Mark done keeps the queue tidy (no Shopify write needed). Prefills: aged 7, distilled Kentucky, proof 121.00, Bottled-by → Nashville Barrel Co choice (the Collaborative template's 'Bottled by' choice field is on the BACK panel; clOpenOrder searches front then back) — v20261029b. Knockout/printArea tightened in v20261029c. Preview cover (.lblpv-ko, z 2) sits over images only (z 1); text/lines/UPC stay on top (z 3) — v20261029d.

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

## Bandwidth (v20261031a)
- Live-sync poll (`resync`, every 8s per visible screen) sends `?since=<_syncTag>`; `/api/data` GET answers `{_unchanged:true}` when the blob (and root blob for a linked company) hasn't changed for that login kind/user. Tags: `o:` no-auth, `b:` bootstrap/login screen, `r:`/`l:`/`f:` + uid:role. `_syncTag` is stripped on POST and never stored. Previously every poll re-downloaded the whole workspace.
- Update check (`checkForUpdate`, every 60s + on focus/touch) is a HEAD request comparing the deploy ETag; the ~580 KB page is only fetched when the ETag changes (or every 30 min as a safety net). Previously it downloaded the full page every minute on every open screen.
- Netlify already Brotli-compresses function and page responses (content-encoding: br).
Retail hub age alert (v20261101a): red banner `#ageAlert` at the top of `view-retailhub` — "Alert: To serve, DOB has to be on or before <today − 21 years>" (`_ageCutoff21`, Feb 29 → Feb 28), refreshed on every renderRetailHub and every minute so it rolls over at midnight.

## Voice agent MCP (Nov 2026)
- `netlify/functions/voice-mcp.mjs` at `/mcp/nbc`: read-only MCP server (streamable HTTP, JSON-RPC POST) for the NBC phone receptionist (xAI Grok Voice Agent "Nashville Barrel Co Reception"). Tools: list_experiences, find_open_times, check_dates over the Nashville Xola sellers (XOLA_STATE_n=TN, else label match). No booking/cancel/refund/guest lookup by design.
- Auth: env `VOICE_MCP_TOKEN`; agent sends `Authorization: Bearer <token>`.

## Checklist e-mails (v20261102a) — server-side, no client involvement
- `checklist-notify.mjs` (every 10 min) reads the ROOT blob and e-mails each newly completed checklist once (sent keys in Blobs store `checklist-notify`/`sent`; first run only marks existing ones): Store Inventory + Supplies Checklist (`invSubs`, kind 'supply') and every Joy Ride → Jennifer; Opening / Closing / Daily Task (that weekday's `clean` items) / Bathrooms (`clean` day 7) / Slushie → Jennifer for HQ & Church St, Adam for Louisville (`isLouisville`). "Completed" = every item for that store/kind/date checked (today + yesterday in store time).
- Slushie now has a "✅ Mark slushie machine cleaned" button (`slushToggle`, dutyChecks kind 'slush', itemId 'slush'); before it was only a video.
- `checklist-weekly.mjs` (Sundays 14:00 UTC) — last Sun–Sat grid per store (✓ / n/N / ✗), slushie weekly, "by employee" (items checked, lists finished, lists left unfinished). To: CHECKLIST_RECAP_TO, else BACKUP_EMAIL_TO + Jennifer.
- Recipients = app users named Jen/Jennifer and Adam (their e-mail on file); env overrides CHECKLIST_EMAIL_JH / CHECKLIST_EMAIL_LOU. Shared code: `lib/checklists.mjs`.
- `/api/checklist-run` (back-office token): `?mode=weekly&dry=1&html=1` preview, `?mode=weekly` send now, `?mode=notify&dry=1` pending list.
Labels (v20261102b): text fields can take 2+ lines — `f.multiline` (editor checkbox "Allow 2 lines"; default ON for fields labelled Selected by / Collaborator, `_lblMulti`) renders a textarea, Enter = new line (PDF/preview already split on \n). New font `condserif` ("Condensed Serif — LRWC Selected by"): Roboto Serif static instance wdth 62 / opsz 28, wght 560 (r) & 720 (b), Latin-subset, in public/fonts/lbl/.
Label PDF draws image fields first, then text/arcs/lines/UPC, so text always prints over a customer image (preview already layers text z 3 over images z 1) — v20261102c.
Custom label orders (v20261103a): queue sorted oldest open first (done after, newest first); checkbox per NBC order + "Select all open" + "🖨 Print selected" → `clPrintSelected` loads each order via clOpenOrder, builds it with `lblBuildPdf` in collect mode (`_lblCollect` = array → bytes pushed, no window, no auto-save of edits) and merges pages (pdf-lib copyPages) into one PDF, then offers to mark them done. Order # prints on the back label: text field labelled "Order #" (`clOrderNo`, right of the tristar logo x58 y63.5 9pt — moved there in v20261103c from the top-right corner, which ran off the edge; added to the Collaborative template by `_clEnsureOrderField` if missing), value `_clOrderNo(o)` = orderName + "W" when `o.wax`. Server `wax` flag: 1of1 Seal attr /wax/, a wax add-on line in the order (1of1 "Wax seal", matched by `_bottle`), or wax in the variant/attributes. 1of1 orders keep their own print button (finished files), not batch.
Label print screen (v20261103b): each image field has ↗ Open image / ⬇ Download (lblImgOpen/lblImgDownload, blob URL of the image as currently used); custom-order queue rows have 'download' next to the customer's original logo (clDownloadImg). Re-upload with the field's image picker.
Custom-order print screen banner (_clBanner) shows the customer's original logo + approved proof thumbnails (open ↗ / download) — v20261103d.
Custom-order print screen: '✅ Mark completed' (clCompleteCurrent) saves edits, marks the order done, returns to the queue (done orders hidden) — v20261103e. Batch print already offers to mark the batch done.
Custom label orders (v20261103f): server reads '_Logo' / '_Label Proof' (theme '11-03-26 b' renames the inputs in assets/custom-label-geometry.js so image links stay off packing slips) as well as the old names; NBC wax = 'Wax' property + custom-label-black-wax line (_bottle); giftBox flag (gift box add-on line or property) → GIFT BOX badge.
Custom orders Barrel # by tier (_clBarrelNo): 7yr C2026, 10yr I2026, 19yr D2026 — v20261103g (older saved edits with plain 2026 are upgraded on open).
Collaborative template: one-time _clStatsNudge (flag _statsNudge1) raises Proof −0.5% and ALC/VOL −0.7% to sit on the printed PROOF / % ALC./VOL. baselines — v20261103h.
Label PDF emoji (v20261103i): emoji in text (\p{Extended_Pictographic} sequences, _LBL_EMO_*) are rendered to PNG with the system emoji font (_lblEmojiPng) and drawn inline at the text size; fonts have no emoji glyphs so they used to vanish. ©/® stay text.
Barrels 'Empty 1' (emptyBarrel, v20261103j): splits one barrel off an aging lot at the per-barrel avg PG as its own record (status 'Loss', lossDate, emptiedFromLot) so receipts are unchanged, lot qty −1 / pgTotal −avg, and adds a stor_loss ledger entry (src 'empty:<id>') → 5110.11 storage loss that month. Reactivate on a Loss barrel removes that entry. Audit report counts Loss barrels as losses.
1of1 printing (v20261103k): 'Print front + back' now loads the order's two 900x1800 files into label template oneofone1 ('1of1 Bourbon — 3×6 front + back', two full-bleed image fields, sheet rot 90 6.3×6 front x0 / back x3.3 — UNCALIBRATED guess) and builds a normal label PDF; the old HTML print (browser headers/page numbers/scaling) is clPrint1of1Html, unused.
oneofone1 calibrated from the 11/3 grid (live data): labels ≈ x 0.06–2.88 and 3.12–6.15 on the 6.3×6 rot-90 sheet; panels shrunk to 2.85×5.7 so the 3×6 file fits inside, front {0.04,0.15}, back {3.14,0.15}.

- 1of1 (v20261103l): front prints on the RIGHT label (fully printable; left label loses ~0.3in at its left edge). Image fields support fit:"fill" (stretch to box) — ooFront uses it so the 1:2 proof fills the ~3.2x6.05 label with bleed. Back on left label.

- 1of1 back (v20261103m): text field ooOrderNo (Order #, +W for wax) in the top-right margin above the back art frame; added to existing template on load; filled by clPrint1of1.
- 1of1 calibration (11/3 flatbed scan of grid, paper 7x6.15, rot 90): left label ~x0.30-3.50, right ~3.76-6.96, both start ~y0.17 and run past the 6.15 page. Back on left {0.475,0.345} (2.85x5.7), front on right {3.66,0.12} (3.4x6.1 fill).

## nbc-customs label template (v20261104a)
- Template id `nbccustoms1`, name "nbc-customs": the 1of1 Classic label redrawn with the Nashville Barrel Co logo (NBC color logo on the rule where the 1of1 seal was, no seal; back says "Bottled by: Nashville Barrel Company, Nashville, TN DSP-TN21095" and NASHVILLEBARRELCO.COM). Created on first visit to Label Printing by `_ncEnsureTemplate()` (write cap), copying panel sizes, sheet and adj from `oneofone1` so it prints on the same stock with the same calibration.
- Art: `public/labels/nbc_customs_front.jpg` / `nbc_customs_back.jpg` (900×1800, rendered from 1of1-site templates.js with the logos swapped). Printed as full-panel image fields with `noKnock:true`.
- New field options: `noKnock` (image skips the panel knockout/printArea) and `fit:'cover'` (image fills its box and is cropped, preview + print). The customer photo (`ncPhoto`) is `fit:'cover'` in the window, clipped by printArea, with the seal knocked out.
- Editable: Bottled for (hand), Proof (link proof → ABV), ALC./VOL., Age, Class (choices), back Class + Distilled in (choices), Order #.

## Full Custom Label orders open in nbc-customs (v20261105a)

Shopify "Full Custom Label" orders carry `_Label Template` = `nbc-customs` (the API returns it as `o.template`). `clOpenOrder` checks it: nbc-customs orders load template `nbccustoms1` (photo → `ncPhoto` with the website's placement, name → `ncName` sized like the website at 50px/600 wide, age → `ncAge` as "N Years", class and Distilled-in from the variant, order # on the back) and skip the "Bottled by Nashville Barrel Co" default. Every other custom label order still opens in NBC Collaborative Bottling.

## nbc-customs badge layer (v20261105b)

The polygon knockout around the NBC badge left white corners beside the round seal. The badge is now its own top layer: field `ncBadge` (`/labels/nbc_badge.png`, transparent, x 33.615 y 51.25 w 32.768 h 12.5 %, noKnock) right after `ncPhoto`, and the front `knockout` is empty (`printArea` still clips the photo to the window). `_ncBadgeMigrate` adds it to an existing template on the next Label Printing open by a user who can write. `_lblEmbedImg` loads built-in `/labels/*.png` as PNG so the alpha survives (before, URL images went through `labelFlattenLogo` onto white).

## Custom label orders can't bleed into each other (v20261105c)

Order #31630 reopened with another order's logo (SIP), 10 Years / Indiana and no text. Opening an order is async (logo download, fonts, saved images); opening a second order before the first finished let the first order's logo and values land on the second order's screen, and Save stored them under the wrong order. `clOpenOrder` now takes a token and `_clOpenOrder` stops after each await if a newer open started; `clSaveEdits` refuses while an order is still loading. A record already saved wrong is fixed with **Discard saved changes** on that order.
- TIB-in lot codes (v20261106j): _lotCode(distillDate) = YY + month letter A-L + DD (2015-09-09 -> 15I09). Set on new TIB-in barrels (b.lot) and receipt lines; _tibLotBackfill in normalize fills existing TIB barrels/lines with no lot/barrelNo.

- 11/8 data-loss incident: the pre-login (bootstrap) copy was cached and pushed as real data after a slow login, wiping collections + the PIN hash. Fixes (v20261108c/d): bootstrap never cached (window._bootState), cloudSave/persist refuse with no real data (_noRealData), server mass-drop guard merges instead of replacing, keeps dailyBackups and pinHash, MIN_CLIENT_BUILD=v20261108c. Recovery tools: Daily backups "Recover missing", Setup "Recover missing from a backup file" (5am emailed .json). Login has "Forgot PIN?" (auth-forgot.mjs, emailed 6-digit code).

- NBC Collaborative on blank white 3x6 (v20261109c, Mike 2026-11-09): Collaborative custom orders open template `nbccollab2` (CC_TPL), built once by `_ccEnsureTemplate` from the old pre-printed template (`emuy8nkqmjbbp`, kept as fallback) + the nbc-customs back, sheet and calibration. The whitened art `/labels/nbc_collab_front_white.jpg` (badge redrawn from the vector logo in black/gold, v20261109d) prints as locked field `ccArt`, and `/labels/nbc_collab_badge.png` prints as top layer `ccBadge` over the customer logo (no knockouts); every front field, the logo window (printArea) and knockouts are mapped onto the 3x6 label in the 3.15x6.1 panel with `_lblOnLabel`. Website placements (photo + text) are mapped the same way; the Shopify page canvas is 600x1200 for this label now. Saved edits record `tpl`; edits saved on the old template get their front positions mapped when reopened.
- Zebra ZT421 (v20261109e): per-device printer choice (localStorage lblPrinter epson|zebra) on the label print screen. Templates keep sheetZ/adjZ for the Zebra (falls back to the Epson sheet until calibrated); lblNormalize swaps them in, lblEditSave/lblAdjSave write the Zebra copies.
- sheet.bake (v20261109g): rotate the label page by redrawing it rotated (embedPage) instead of the PDF /Rotate flag — Chrome+Zebra driver ignored /Rotate. Used by LRWC sheetZ.
- Weekly checklist recap (11/9): Mike+Jen get all stores; Kelly (user email matching "kelly" or CHECKLIST_RECAP_NBC) gets Nashville-only (HQ+Church St); Adam (CHECKLIST_EMAIL_LOU/RECAP_LOU) gets Louisville-only. recapHTML(d,start,only "nbc"|"lou").

## Label Printing per-user access + custom-order search (v20261110a)
- `u.labelAccess` (Users form checkbox "Label Printing") → `canLabel()`; `viewBlocked` allows LABELER_VIEWS when true. Sanitized in data.mjs + lib/authtoken.mjs. Jennifer has it.
- Custom label orders card: search box (`_clQ`, `_clMatch`, `clSearch`) matches order # (with/without #, W suffix), customer, label text; searches done orders too. Only #clOrdersList is re-rendered so the input keeps focus.

## Inventory-not-done alert (inventory-remind.mjs)
- Wednesdays 10 AM Central (cron 15,16 UTC, sends on the 10 AM run). Stores with no submission since last Wed 3 PM rollup → one e-mail per person (stores grouped) to Retail Manager users (role "retail", location match, e-mail on file); fallback settings.invEmailByLoc[store] / invEmailTo. Logic in lib/invrollup.mjs (`reminderPlan`, `sendReminders`).
- Dry run: POST /api/inventory-rollup-send { ws, remind:true, dry:true }.
