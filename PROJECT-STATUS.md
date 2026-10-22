# Dashboard project status

Updated: 2026-10-23 (post-V16). Authority for current state. Supersedes
the post-V15 status below, which is retained as the V15 section.

## Current state

- Stack: vanilla JavaScript ES modules, no build step. IndexedDB
  tracked-snapshot store (`js/store.js`), BroadcastChannel cross-tab
  updates, static hosting. Chart.js is bundled locally
  (`js/chart.umd.js`); its offline behavior is executed in V16
  (see docs/ACCEPTANCE.md).
- Repository: `lullabie/dashboard-cloudflare`, public, MIT LICENSE.
  Base commit: `29d43ff04a6abb257b5046c85f2fcba6f0bb679d` (main).
- Review branch: `codex/v5-review`, head
  `cfefa9af327a83174d38c38fe27556c3685a4294` (V16 candidate; the
  docs bundle on top of it carries this status). Draft
  PR #2 tracks it. Main is unchanged; nothing is merged or deployed.
- A stale candidate branch `bulk-phase-20261019` exists; its release
  claim was withdrawn on 2026-10-20. It is evidence, not a candidate.
- The app ships empty of personal data. All test data is invented.
- Zero LICENSE changes on the review branch: `git diff
  29d43ff..cfefa9a -- LICENSE` is empty (checked 2026-10-23).

## V14B state (current)

- Frozen commit: `4883425958486fdc62897b2270097dd98f40d0fa` — the
  V14B QA correction (deterministic native barrier in
  `qa/v4/places-browser.spec.mjs` only; production tree byte-identical
  to the V14 frozen commit `0c2d779`).
- STORE carries the V14 transactional repair authority
  (`claimAdoptionRepair`, commit `f8074d8`). Current js/store.js
  SHA-256 `7f77e9effc6556c1e27e995da5db3835bb6da40564241cad7a7a669a5578dd95`.
  Current js/feeds.js SHA-256
  `b0fe9d6b31caa11f6dbec86afae6fa38912ed7d6ff4c6f259001bd472620be88`
  (the FEEDS replacement source; the old v3 session stays parked as
  evidence and its stale branch must not be used).
- Local browser acceptance on the frozen commit: PASS. Coordinator
  gate (Chromium 156.0.8078.4, Node v24.20.0): Node 14/14, browser
  29 total / 28 required PASS, negative 17/17, runId `735ae833`.
  Evidence: `docs/review/evidence/v14b/`.
- Codex independent verification at head `1696d37` (installed Chrome
  155.0.8059.85, Node 24.19, isolated native IndexedDB/BroadcastChannel,
  invented records): full gate exit 0, 28 required PASS, negative
  17/17, runId `efb3274d`; a separate places run also passed with a
  real stale proof. The V14B Chrome local regression is closed.
- Host acceptance: NOT RUN. No release approval exists. The
  shippable claim withdrawn on 2026-10-20 stays withdrawn.
- Remaining complete-app acceptance gaps are listed in
  docs/ACCEPTANCE.md (post-V14B section): host acceptance, the
  every-form and time matrices, maps UI CRUD, college markup,
  investments round-trip, populated explorers, chart offline
  fallback, isolated keyboard/modal cases, and the asset-manifest
  packaging check.

## V16 state (current)

- Frozen candidate: `cfefa9af327a83174d38c38fe27556c3685a4294`
  (parent `3f257bc`). Complete-app local acceptance: four new
  matrix specs (forms, Toronto time, content, accessibility/
  offline; 23 cases, all registered required), four bounded
  `js/main.js` repairs the matrix found (nested-modal Escape,
  habits archive partition, habit title contract, investment
  duplicate-submit guard), one Lane B spec correction. Record:
  `docs/review/V16-EXECUTION-RECORD.md`.
- Codex independently accepted V15B at `3f257bc` before V16
  (exit 0, 33 required Chrome PASS, runId `606f3b8c`).
- Local gate on the frozen V16 candidate (sandbox Chromium
  156.0.8078.4, Node v24.20.0): PASS — 56 required browser cases
  (57 total), 19/19 Node lane-test files, negative 17/17,
  exact staging PASS (21 files), runId `32de95bd`. Evidence:
  `docs/review/evidence/v16/`.
- Current js/main.js SHA-256
  `43316e7b84100416e6fd12496d47fb5c484568bd50fb6a958eb30efe8eaae7e6`.
  js/store.js and js/feeds.js are unchanged from V15.
- Codex independent rerun of `cfefa9a` on installed Chrome:
  pending. Host acceptance: NOT RUN. No release approval; the
  withdrawn shippable claim stays withdrawn. The pages.yml
  replacement remains a patch only (`docs/review/V15-PAGES-WORKFLOW.patch`
  applies cleanly in check-only mode; the branch file is
  unchanged, GitHub API 403).

## V15 state (superseded by V16 above)

- Frozen candidate: `7883921607c27f308af33c383fab74ce58371fa7`
  (assembled locally as `3ef0e08`, verified byte-identical). Repairs
  the eight Codex deployment-prep audit blockers at `433842b`:
  jobs producer/adoption contract (`docs/review/V15-CONTRACT.md`,
  published first at `0900a75`), safe goals/habits rendering,
  stale-modal baseline guard, exact staged-asset manifest checker,
  full third-party notices, honest indicators panel. Record:
  `docs/review/V15-EXECUTION-RECORD.md`.
- Local gate on the frozen candidate (sandbox Chromium 156.0.8078.4,
  Node v24.20.0): PASS — 33 required browser cases (34 total), 19
  Node lane-test files, negative 17/17, package stage check PASS,
  runId `355b1fba`. Evidence: `docs/review/evidence/v15/`.
- Current js/store.js SHA-256
  `3d96eee79e7e34405d78049117a0741e7b7b09a0e6b7f5bb260dc32ea839e35c`.
  Current js/feeds.js SHA-256
  `b0fe9d6b31caa11f6dbec86afae6fa38912ed7d6ff4c6f259001bd472620be88`
  (unchanged in V15).
- The pages.yml replacement is prepared as a reviewable patch
  (`docs/review/V15-PAGES-WORKFLOW.patch`); applying it through the
  GitHub API returns 403 (workflows permission) — the file on the
  branch is unchanged and no workaround was attempted.
- Codex independent inspection of `7883921`: pending. Host
  acceptance: NOT RUN. No release approval; the withdrawn shippable
  claim stays withdrawn.

## V14B state (superseded by V15 above)

## Backend status: UNACCEPTED

No Cloudflare resource, Worker, D1/KV store, OAuth app, paid fallback or
enabled product schedule exists or is authorized. Hosted authentication,
Workers/D1 behavior, Free CPU limits and unattended updates remain
**UNVERIFIED**. Local tests do not pass hosted acceptance.

## Rollback and recovery

- Every lane artifact is an immutable patch file with a recorded
  SHA-256; assembly selects patches by hash. Rollback of the assembled
  review branch = check out the prior frozen commit; never force-push
  and never rewrite a published review commit.
- User data recovery is a product feature, not a deploy action: JSON
  export before changes, import with restore preview and confirmation.
  A failed automatic import download must leave the losing payload
  recoverable by an explicit manual export (v3 contract).
- Code rollback is not a data restore. IndexedDB contents survive code
  rollback; schema changes require an explicit migration decision by
  the store owner (Track A session) before they ship.
- If a review branch is rejected, keep it as evidence and assemble a
  new branch from the verified base; do not reset or delete remote work.

## Open decisions and blockers

- FEEDS v3 bytes are unrecoverable from the old session (recorded
  blocker). The replacement source is integrated with its own
  provenance and is not labeled the v3 artifact. The old session
  stays parked as evidence; do not message it or harvest from it.
- The old GitHub Pages workflow (`.github/workflows/pages.yml`) remains
  a named packaging gate until reviewed. Preparing an asset allowlist
  does not authorize running or replacing it.
- Local browser acceptance has run on the frozen commit for the
  registry cases (see docs/ACCEPTANCE.md). Complete-app acceptance
  has not: the gaps listed there remain open, host acceptance is
  NOT RUN, and nothing in this document is a shippable claim.

## V15 packager-safety correction (2026-10-23)

Codex's full run on 2d8a688 ended exit 1 (Node 18/19) and found a
P1 in the packager's --stage path (delete-before-validate) plus a
Windows loader bug in its test. Both are fixed and frozen at
6f5a74b (two tooling files only; application identical to
7883921). Coordinator gate on 6f5a74b: runner exit 0, 33 required
browser cases PASS, negative 17/17, runId 6287e6b2. The branch
pages workflow is still unchanged (403), host acceptance is
NOT RUN, and no release approval exists. Detail:
docs/review/V15-EXECUTION-RECORD.md addendum.
