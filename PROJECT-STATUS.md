# Dashboard project status

Updated: 2026-10-21. Authority for current state. Supersedes the
2026-10-16 status (which described a pre-build repository and a proposed
Cloudflare backend; that plan is historical, see docs/plan-b/).

## Current state

- Stack: vanilla JavaScript ES modules, no build step. IndexedDB
  tracked-snapshot store (`js/store.js`), BroadcastChannel cross-tab
  updates, static hosting. Chart.js loads from CDN with an offline
  fallback requirement (acceptance gate, see docs/ACCEPTANCE.md).
- Repository: `lullabie/dashboard-cloudflare`, public, MIT LICENSE.
  Verified base commit for the v4 bundle:
  `29d43ff04a6abb257b5046c85f2fcba6f0bb679d` (main).
- A stale candidate branch `bulk-phase-20261019` exists; its release
  claim was withdrawn on 2026-10-20. It is evidence, not a candidate.
- The app ships empty of personal data. All test data is invented.

## v3 repair lanes (verified under Node mocks, not browser acceptance)

- STORE (js/store.js): v3 + BroadcastChannel correction + degraded-save
  correction harvested and verified. Current store.js SHA-256
  `b600175c04e7100e8bb7bb6a8e5cd899f5eb0cb6663cd16f85ad64c22074be11`
  (21,197 bytes). A v4 lifecycle repair (repeated-init listener leak)
  is open as Track A of the v4 bundle.
- MAIN (js/main.js and owned modules): v3 + test-label correction
  harvested and verified.
- HABITS (js/habits.js) and PROGRESS (js/visuals/progress-summary.js):
  v3 + habit-contract correction harvested and verified.
- FEEDS (js/feeds.js): v3 repair **blocked**. The old session never
  delivered its v3 source through the API; the published branch
  `codex-feeds-fix-10139058434333404787` is a stale pre-v3 artifact and
  must not be used as the repair. A single replacement session is
  authorized as Track B of the v4 bundle, starting from the verified
  Source Packet v2 feeds.js (SHA-256
  `8f712a052eaa6240a847280212e3be5bf7f0622fe129a609e39841fe318f7047c`).

## v4 bundle (active, marker CODEX-DASHBOARD-PHASES-V4-20261021)

- Track A: STORE listener-lifecycle repair (Jules STORE session).
- Track B: FEEDS replacement session (one new session, plan approval
  required before work).
- Track C: source assembly and import closure on a `codex/` review
  branch (Muse assembler, sole writer of the assembled branch).
- Track D: independent QA preparation under `qa/v4/` (no production edits).
- Track E: test runner, documentation and asset packaging (this record).
- Phase 2 (ordered integration and full browser acceptance) starts only
  after a complete Phase 1 source is retrievable. No merge and no
  deployment are part of this bundle.

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
  blocker). Track B replaces the work with new provenance; it must not
  be labeled the v3 artifact.
- The old GitHub Pages workflow (`.github/workflows/pages.yml`) remains
  a named packaging gate until reviewed. Preparing an asset allowlist
  does not authorize running or replacing it.
- Full browser acceptance (Phase 2) has not run. Nothing in this
  document is a shippable claim.
