# V14 QA-Correction Record — Deterministic Race Capture for V13-PLACES-01

Branch: `codex/v5-review`
Base commit: `96ed58620c957df61ac42b7baeecf7790f8b4551` (head after the V14 record)
Frozen commit: `4883425958486fdc62897b2270097dd98f40d0fa` (the QA patch; the
production tree is byte-identical to V14's frozen `0c2d779` — only the spec changed)
Frozen gate: local gate PASS (see Gate section). Host acceptance: NOT RUN.
Release status: NOT shippable. No merge, no deploy. PR #2 remains draft.

## Why this bundle exists

Codex's independent installed-Chrome gate on the V14 candidate
(runId `8114fc9e-ee93-4830-a4af-6e87e3958f4b`, Node 24.19.0,
Chrome 155.0.8059.85) returned NOT PASS. `V13-PLACES-01` phase 7
failed: both barrier captures held the SAME canonical id, and the
selected tab's save resolved `{committed:true, conflict:false}`
with the title edit landed.

Codex's diagnosis, accepted here: this does NOT prove a store
regression. The spec's barrier polled `getData()` every 5 ms and
cannot guarantee a pre-claim snapshot; the phase-7 logic wrongly
assumed a same-id capture must still be stale. The captured
snapshot was fresh (taken after the repair claim settled), so its
save committing was correct behavior. Codex's independent
3-attempt diagnostic converged both tabs at revision 3 — the
store behaved as designed. The defect was in the QA spec this
coordinator shipped: it passed in the sandbox Chromium by timing
luck. This bundle fixes the spec, and only the spec.

## The corrected capture (qa/v4/places-browser.spec.mjs, one owner)

+452/−73, sha256
`a04556a8b59878b3c2ea887231d89b35ce8152f64d76f9d172de394712827054`.
Case `V13-PLACES-01` extended in place; no new case ID.

Barrier design. The obvious candidate — hold a readwrite
transaction open from before the sync post — was tested and
rejected empirically: a held readwrite transaction blocks later
readonly AND readwrite transactions on the same store across
connections, so it would also block the pages' adoption reads and
adoption could never complete under it. The implemented barrier
uses the window after each page's adoption-read transaction
exists and before its claim transaction can be created:

- Each race page pre-opens a test-owned IndexedDB connection and
  runs a MessageChannel turn chain (no store patching, no mocks).
- The first turn that observes the race place in `getData()`
  stashes the page's minted id and a tracked snapshot on `window`
  (object identity retained in-page), starts a capture-time disk
  proof (a readonly transaction created in the same turn), and —
  synchronously in the same turn — creates a readwrite hold on
  the pre-opened connection, kept alive by a get-request chain
  gated on a page-side release flag.
- Determinism: that observing turn was enqueued before the claim
  transaction can exist, because the claim's transaction is
  created only in the IDB open-success task of the claim's own
  `openDB()` call, which the observed adoption itself starts. The
  hold therefore queues ahead of every claim transaction while
  the adoption read (created earlier) has already run. No claim
  can settle while a hold is active; the driver releases both
  holds only after both captures and disk proofs are collected.

Precondition gates. Phase 7 asserts stale rejection ONLY on proof:

- G1 (mint differs): a capture whose minted id differs from the
  durable winner's must have adopted the poisoned record, so its
  snapshot token carries the poisoned revision.
- G2 (capture-time disk proof): the capture's same-turn readonly
  read completed while the hold was active and still shows the
  poisoned record durable (poisoned revision, race place
  id-less). This proves stale even the claim winner's own
  pre-settle snapshot — the case G1 cannot separate from a fresh
  capture, and exactly the configuration Codex's Chrome run hit.

If neither capture is provably stale, no rejection is asserted
and the case's PASS is downgraded to NOT RUN with the reason in
the detail (a FAIL is never downgraded). Captured ids, token
revisions, disk proofs, and the winner's id/revision are recorded
in the case detail data. Phase 8 is new and unconditional: a
FRESH post-settle snapshot from the other page must commit, with
the disk carrying the edit under the canonical id at exactly
winner revision + 1 — the behavior Codex's run actually
exercised, now asserted as correct in its own phase. The old
edit-preservation phase follows as phase 9 with one scheduling
adaptation (it waits for the loser page to adopt phase 8's save
first), explained in the spec. The old "agreement case" —
same-id captures must still be rejected — is removed: that
assumption was the defect.

## Runs (standalone spec, QA_BROWSER=chromium, Chromium 156.0.8078.4)

- GREEN on the V14 store (`7f77e9ef…`): three runs of the final
  spec, all PASS, all with genuine stale captures under the
  barrier — across runs, both gates (G1, G2) and both page roles
  (winner stale by disk-proof; loser stale by mint-differs) were
  exercised.
- RED on the V13 store (overlay `113e97ed…`, reverted after):
  FAIL, exit 1 — "the losing tab's provably stale snapshot save
  was not rejected (outcome resolved, result
  {"committed":true,"conflict":false}; stale page A captured mint
  … at token revision 2, canonical … at revision 2)", the durable
  id became the loser's mint, and the expected cascade followed.
  The race coverage is therefore still a real regression test:
  deterministic RED on the defective store, deterministic GREEN
  on the corrected one.

## STORE read-only review (no source change)

The ordered review of early-user-save ordering is published at
`docs/review/STORE-REVIEW-V14B.md` (sha256 `a443783a…`). Verdict:
the invariant holds in every interleaving; source change
required: none. Basis: a claim write and a window-snapshot save
are the same CAS transition (disk at adopted generation/revision
→ write at revision+1), and IndexedDB serializes the contending
transactions, so exactly one of {claim A, claim B, save A, save B}
takes the transition and every later one observes the advanced
disk and takes a non-writing branch — the 24 permutations
collapse to 4 convergent classes. Probe-backed (35/35 across
three runs in the adoption-test harness): cross-collection edits
from speculative snapshots are safe (the mint becomes canonical
via the authorized write; the other tab supersede-adopts;
provenance stays exactly once); import in the window converges
in both orders; a failed claim leaves the store ready with the
in-memory repair standing and a later user save as the durability
fallback; the settle guard cannot revert a tab that advanced via
its own save mid-claim. One observation recorded, not a
violation: a loser's downloaded conflict draft carries its
speculative mints, so a deliberate later import of that draft is
a user-confirmed wholesale replace; it cannot fork the live
record.

## Also published in this bundle

Sanitized V14 frozen-gate artifacts under
`docs/review/evidence/v14/`: `gate-output-v14.txt` (sanitized
sha256 `14ad81ca…`; the only change vs the raw artifact is the
local tree-path prefix replaced by `<tree>`, 14 occurrences,
round-trip verified), `browser-results-v14.json` (`0491ad5c…`,
byte-identical — no absolute paths present), `negative-v14.txt`
(`3341619a…`, byte-identical).

## Gate (frozen commit 4883425, fresh clone)

- Command: `QA_BROWSER=chromium node scripts/run-review-tests.mjs`
  plus `node scripts/run-negative-checks.mjs`.
- Node lane: 14/14 files PASS.
- Browser: 29 total cases, 28 required — all PASS, including
  `V13-PLACES-01` with the deterministic barrier.
- Negative checks: 17/17.
- Report: schemaVersion 2, runId
  `735ae833-629a-456e-a88d-0364a0be3e63`, generatedAt
  `2026-10-22T16:57:15.419Z`, runtime `node v24.20.0; browser
  Chromium 156.0.8078.4 (QA_BROWSER=chromium)`.
- Raw gate artifacts (sha256): gate output `3e9e65bf…`, browser
  results `60fe95e9…`, negative output `0aa86620…` (retained in
  the coordinator's V14B working set).
- Codex reruns the installed-Chrome gate on this frozen commit;
  that run is the acceptance-relevant Chrome evidence.
