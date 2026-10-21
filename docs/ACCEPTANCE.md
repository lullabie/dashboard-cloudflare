# Dashboard acceptance registry

Updated: 2026-10-21 (v4 bundle). **This is the single acceptance
registry.** Track D's `qa/v4/TEST-POINTS.md` is only a
harness-to-TEST-ID map; it does not register status. Do not create a
second registry elsewhere.

Status rule: an ID is **NOT RUN** until it passes on the frozen
assembled commit in the stated environment. Lane-level STATIC or MOCK
evidence is recorded as notes; it never changes an ID's status.
Each executed result must name the commit, source hash where needed,
exact command or steps, runner/browser versions, origin and database
isolation, expected result, observed result and PASS/FAIL/NOT RUN.

## Test-point registry (Track D IDs, v4)

| ID | Criterion | Environment | Status | Evidence notes |
|---|---|---|---|---|
| TEST-UI-001 | Complete imports; Today, Goals and Updates start with no uncaught error | Real browser, assembled commit | NOT RUN | Import closure is Track C work; four lane patches alone do not prove startup. |
| TEST-STORE-001 | Degraded init and failed re-init block writes; reads/export remain available | Real browser + real IndexedDB | NOT RUN | MOCK evidence exists: degraded-save suite passes under Node doubles (coordinator and Codex repros, 2026-10-21). |
| TEST-STORE-002 | Explicit successful recovery permits one durable save; reload preserves it | Real browser + real IndexedDB | NOT RUN | MOCK recovery cases pass in the storage degraded/recovery suite (7/7, Codex check 2026-10-21). |
| TEST-STORE-003 | Repeated init leaves one active subscription; two real tabs refresh correctly | Real browser, two tabs, one origin | NOT RUN | Open defect V4-STORE-LISTENER-LIFECYCLE: three inits leave three active channels (Track A repair). Single-init registration passes under MOCK. |
| TEST-STORE-004 | Post-commit notification failure settles accurately and does not induce duplicate retry | Real browser + real IndexedDB | NOT RUN | Track A adds a notification test file; no executed result yet. |
| TEST-FEEDS-001 | Persisted cache/generation, module reload, valid refresh and reload preserve the new result | Real browser | NOT RUN | Blocked on Track B (FEEDS replacement). The v3 fix (defects F1/F2) was never delivered; the stale branch is not evidence. |
| TEST-FEEDS-002 | Paused refresh plus another tab's accepted manual/source/domain edit loses neither accepted change | Real browser, two tabs | NOT RUN | Blocked on Track B. |
| TEST-FEEDS-003 | Reversed response order, changed/deleted source, timeout/oversize/malformed response preserve ordering and last valid cache | Real browser with harness response barriers | NOT RUN | Blocked on Track B. Harness prepared by Track D under `qa/v4/`. |
| TEST-HABITS-001 | Actual control creates/removes `completedAt`; summary, reload and local-day boundary agree | Real browser | NOT RUN | MOCK evidence exists: progress summary counts `completedAt` objects 1/1 (Codex repro, 2026-10-21). |
| TEST-UI-002 | Form rejection retains input; retry; import cancel/reject/repeat selection; export readback; keyboard focus; 320x568 and 375px layout; reduced motion (each subcase recorded separately) | Real browser | NOT RUN | MAIN's earlier fixed PASS strings for accessibility/motion were replaced with NOT EXECUTED in the v3 label correction; no browser result exists. |

## Release criteria categories (v3 bundle) — coverage map

Every category below must be covered by the Phase 2 matrix on the
frozen assembled commit before any shippable claim. Categories map to
the test points above or to matrix-only cases owned by Track D.

| Category | Covered by | Status |
|---|---|---|
| Fresh load; complete startup wiring | TEST-UI-001 | NOT RUN |
| localStorage upgrade and recovery | TEST-STORE-002, matrix legacy cases | NOT RUN |
| Clean and malformed import/export; losing draft recoverable after failed download | TEST-UI-002, TEST-STORE-001 | NOT RUN |
| Real-IndexedDB commit/abort/denial; two-tab conflicts; genuine concurrent first open | TEST-STORE-001..004 | NOT RUN |
| Every form: delayed commit, rejection, retained input, retry, duplicate click | TEST-UI-002 | NOT RUN |
| Goals/habits midnight, DST and saved-zone matrix; legacy achievement; archive/restore; honest late/missing history | TEST-HABITS-001, matrix zone cases | NOT RUN |
| Maps unique-ID CRUD | Matrix-only case | NOT RUN |
| College markup stays text (no injected HTML) | Matrix-only case | NOT RUN |
| Investments numeric round-trip | Matrix-only case | NOT RUN |
| Populated explorers render real data | Matrix-only case | NOT RUN |
| Feed reload, ordering and cross-tab conflict | TEST-FEEDS-001..003 | NOT RUN |
| Keyboard-operable import control | TEST-UI-002 | NOT RUN |
| Nested modal focus, Escape, focus return | TEST-UI-002 | NOT RUN |
| Viewports 320x568 and 375px | TEST-UI-002 | NOT RUN |
| Reduced motion | TEST-UI-002 | NOT RUN |
| Chart CDN unavailable/offline fallback | Matrix-only case | NOT RUN |
| Exact release asset manifest | Packaging check (Track E script) | NOT RUN |
| Zero LICENSE changes | Packaging check + patch review | Verified per patch at harvest; branch-level check NOT RUN |

## Unresolved host requirements (not acceptance failures — unscoped)

Hosted authentication, Cloudflare Workers/D1 behavior, Free CPU
limits and unattended scheduled updates remain **UNVERIFIED** and
outside this bundle. The backend is UNACCEPTED. Local or browser
results must never be reported as hosted acceptance. The old GitHub
Pages workflow (`.github/workflows/pages.yml`) remains a named
packaging gate until reviewed.

## Historical note

The 2026-10-16 version of this file was a gate map for the proposed
Cloudflare host (all cases NOT RUN). That host plan is historical;
its S2 invariant references remain useful background for contract
changes, which must be recorded explicitly before acceptance.
