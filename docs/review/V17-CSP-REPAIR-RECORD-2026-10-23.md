# V17 record — hosted CSP inline-style repair (candidate, NOT deployed)

- Date: 2026-10-23
- Trigger: Codex live-UI review (Chrome 155, all 9 views at 1440/768/375,
  753 CSP console errors) and the user's report that the live UI is
  unacceptable. Release verdict on the live deployment: **DO NOT SHIP**
  (unchanged by this record — the live site still serves the broken build
  until a reviewed replacement is approved).

## Root cause — verified from live + source

- The deployed `_headers` sends `style-src 'self'` (live response header
  re-read 2026-10-23). It blocks every inline `style="..."` attribute.
- The deployed ship set carried **65 inline-style template sites**:
  index.html 21, js/goals.js 14, js/indicators.js 11, js/habits.js 8,
  js/investments.js 7, js/countdowns.js 4.
- Mechanism of the worst breaks: the countdown fill's width was an inline
  style (blocked → fill rendered at full width); the Settings file input
  hid itself with `style="display: none;"` (blocked → the native chooser
  rendered visibly and forced Settings to 478px wide at a 375px viewport).
- The pre-deployment local gates never sent the deployed headers, so the
  empty-data boot PASS never exercised visual quality under CSP.

## The repair (one bounded change set)

- Ownership: UI lane (app files only), QA lane (one new spec only),
  coordinator as sole assembler. No CSP change, no `unsafe-inline`, no
  token/Access/MCP change, `js/store.js` untouched, no synthetic data
  shipped (tests use invented records only).
- All 65 static inline styles moved to external semantic classes in
  `css/app.css` (post-repair grep: `style="` = 0 in index.html + js/).
- Dynamic numerics via CSSOM: the countdown fill width is written with
  `element.style.width` after render, clamped finite 0–100, so the
  rendered width equals the data percent; conditional colors became
  class toggles (`is-overdue`, `is-done`, `is-late`, `is-positive`,
  `is-negative`). The goals ring dash values stay SVG presentation
  attributes (not style attributes; values unchanged).
- Settings: the file input uses a `.visually-hidden-input` class
  (1px, clipped, opacity 0 — not `display:none`), so it stays
  keyboard-focusable and the trigger opens the real chooser; button
  groups and filter bars wrap (`flex-wrap`, `max-width: 100%`).
- News: a fresh profile now renders an explicit honest empty state
  ("no live news backend is connected yet" + the add-feed actions), and
  failed sources produce visible status text instead of a blank view.
  The public-source news pipeline remains separate work (design package
  at `docs/review/refresh-worker/`); this repair does not deliver news.

## Evidence

- New required spec `qa/v4/hosted-headers.spec.mjs` +
  `qa/v4/fixtures-headers-deployed.txt` (the deployed `_headers`,
  verbatim; the spec parses and serves them). Cases V17-HOSTED-01..05
  registered required in `scripts/write-browser-results.mjs`.
- On the broken tree (f0382666): HOSTED-01 FAIL (917 CSP console
  messages, 917 securitypolicyviolation events, first violation
  `style-src-attr` / blockedURI `inline`); HOSTED-02 FAIL (fill measured
  100.00%, expected 40%); HOSTED-03 FAIL (Settings 478px at 375/320);
  HOSTED-04 FAIL (input leaked, 253×64, display:block); HOSTED-05 PASS.
- On the candidate: HOSTED 5/5 PASS — 0 CSP messages and 0 violations
  across all 9 views; fill measured exactly 40.00% (137.9px / 344.7px);
  no overflow in any view at 375 or 320; input concealed (1×1, clipped)
  with Tab+Enter opening the real chooser; populated Today/News render.
- Full local gate on the candidate content (local commit
  `81af17a321344a6f813f0b1d8d3fd29aec949d84`, tree-identical to the
  published commit for all code/QA files): **LOCAL GATE PASS, runId
  `7e4be0ba-e648-44b3-9678-d1ae75ddb44f` — 61 required browser cases PASS
  (56 prior + 5 V17), Node files 20/20, negative checks 17/17, packager
  staging exact 21 files.**
- Known flake, recorded honestly: V16-ACCESS-01 (keyboard import) failed
  inside two earlier full-gate attempts with "Enter on the import
  trigger opened no file chooser" — the dropped-headless-chooser mode
  the case itself guards with one retry. It passed in the solo spec run,
  in a back-to-back pair run after acceptance.spec, in V17-HOSTED-04,
  and in the final gate run above. No code change was made for it.
- Screenshots (outside the repo, coordinator preview with the actual
  deployed headers + invented records): BEFORE and AFTER sets of
  Today, News, Goals (populated), Settings, modal, and charts at
  1440/768/375, plus a fresh-profile News shot — 19 files per set, at
  `hidden_files/v17-csp-fix-20261023/screenshots/` in the coordinator
  workspace. Settings-375 before shows the leaked native chooser and
  wrapped buttons; after shows a clean single row.

## Published candidate

- Commit `30e5457104ccba160d3e25cd2d532f9ebf98cb39` on `codex/v5-review`
  (11 files: 8 app files, `scripts/write-browser-results.mjs`,
  `qa/v4/hosted-headers.spec.mjs`, `qa/v4/fixtures-headers-deployed.txt`).
- Verified from a fresh clone: all 11 files byte-identical to the gated
  tree; hosted spec re-run on the published commit: 5/5 PASS.
- **Not deployed.** Live replacement waits for review of this candidate.
  The deployed Version ID remains `b89a72f3-a87f-48c8-8a33-ba2eb68c5b84`.
