# Mikey Systems (ttb-tracker2) — project memory for Claude

Read this first in any new chat. **Update it whenever work lands** (new feature, rule, gotcha,
or open item) and commit it with that change. Older notes: `HANDOFF.md` (Aug 2026, Xola/Square
env vars, backlog) — still valid for those topics.

**Last updated:** 2026-10-13 · **Current build:** `v20261013n`

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
  record. Emptying a tote = Dumped; leftover = storage loss.
- A failed data source must never read as zero (see HANDOFF.md conventions).

## Label system (LRWC workspace)
- Templates: `sheet{on,wIn,hIn,rot,front{xIn,yIn},back{...}}`; fields `xPct,yPct,wPct,hPct,fontPt,
  font,bold,upper,prefix,suffix,link(proof/abv),fixed,choices,growUp,lineH`. Background art is a
  guide only (not printed); art files in `public/labels/`.
- Fonts: helv/times/courier (PDF standard), hand/hand2/mont (embedded base64), plus 22 Google
  fonts in `public/fonts/lbl/<key>-r|b.ttf` (`LBL_WEBFONTS`). PDF baseline uses the preview font's
  metrics (`_lblBaseOff`) so print = preview. PDFs open in a tab pre-opened at click (`_pdfPreopen/_pdfShow`).
- Templates: LRWC Single Barrel, Nashtucky, NBC Single Barrel, NBC Collaborative (spirittype1),
  Circle, Stella's Secret Stash (rot 270, needs 6.50" length), NBC Small Batch (`nbcsmallbatch1`).

## Other features worth knowing
Bottling Log approvals: anyone with `write` (Super Admin, managers, Barrel Manager) can Approve/Edit pending entries on the Bottling Log page itself as well as the Bottling page; each pending row has a **Gift shop** tick → `pbApprove(id,gift)` records a gift-shop removal (excise + $0 GiftShop invoice) instead of in-bond finished goods. The Bottling page's own "Bottle a Barrel / Lot" form also takes an optional bottle photo (`boPhoto` → uploaded after `doBottle` via `_boAttachPhoto`, sets `bt.photoId`; 📷 link in Bottling History).
Orders stay open until "Mark shipped" (TTB removal + QuickBooks sync at ship). Transfers in Bond
page (`view-tib`). Production Bottling Log with approvals + nightly email. Store Inventory with HQ
Warehouse tab for NBC HQ staff. Tips (staff can fix their own). Xola "today" card. Shopify Store
card (Shopify GraphQL needs `@idempotent` on inventory mutations). Full backup .zip in Setup & Data.

## Open items (Oct 13 2026)
- Google Business Profile API: still 0 quota (not approved). Case 1-3523000042024 (Aug 25) went
  nowhere; Mike is resubmitting the access form. Reviews card switches on by itself when approved.
- NBC Small Batch template: needs a test print (fonts/positions adjustable in the print screen).
- Stella: driver Label length 6.50" + final test print.
- Square connector needs reconnecting (tips / merch-by-location questions).
- October 5110.11 (both companies) uses the corrected storage math — review before Casey files.
