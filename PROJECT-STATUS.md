# Dashboard project status

Updated: 2026-10-22 (post-V14B). Authority for current state. Supersedes
the 2026-10-21 status (v3/v4 lane state, now historical; the lane
records remain under docs/review/).

## Current state

- Stack: vanilla JavaScript ES modules, no build step. IndexedDB
  tracked-snapshot store (`js/store.js`), BroadcastChannel cross-tab
  updates, static hosting. Chart.js loads from CDN with an offline
  fallback requirement (acceptance gate, see docs/ACCEPTANCE.md).
- Repository: `lullabie/dashboard-cloudflare`, public, MIT LICENSE.
  Base commit: `29d43ff04a6abb257b5046c85f2fcba6f0bb679d` (main).
- Review branch: `codex/v5-review`, head
  `1696d372e3ce6bf0fc9d875c31747d65d7b22cdb`. Draft PR #2 tracks it.
  Main is unchanged; nothing is merged or deployed.
- A stale candidate branch `bulk-phase-20261019` exists; its release
  claim was withdrawn on 2026-10-20. It is evidence, not a candidate.
- The app ships empty of personal data. All test data is invented.
- Zero LICENSE changes on the review branch: `git diff
  29d43ff..1696d37 -- LICENSE` is empty (checked 2026-10-22).

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
