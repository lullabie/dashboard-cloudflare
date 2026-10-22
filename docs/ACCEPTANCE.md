# Dashboard acceptance registry

Updated: 2026-10-22 (post-V14B audit). **This is the single acceptance
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
| TEST-UI-001 | Complete imports; Today, Goals and Updates start with no uncaught error | Real browser, assembled commit | PASS | Executed on frozen commit `4883425` (coordinator gate, Chromium 156.0.8078.4, runId `735ae833`) and independently at head `1696d37` (Codex, installed Chrome 155.0.8059.85, runId `efb3274d`): app booted, all 9 nav views rendered, zero uncaught errors. Evidence: `docs/review/evidence/v14b/browser-results-v14b.json`. |
| TEST-STORE-001 | Degraded init and failed re-init block writes; reads/export remain available | Real browser + real IndexedDB | PASS | Same two runs: poisoned higher-version DB forces degraded init; failed re-init stays degraded; saves reject; reads/export remain available. |
| TEST-STORE-002 | Explicit successful recovery permits one durable save; reload preserves it | Real browser + real IndexedDB | PASS | Same two runs: explicit initStore restores ready; one save commits (revision 1 → 2); a real reload preserves it. |
| TEST-STORE-003 | Repeated init leaves one active subscription; two real tabs refresh correctly | Real browser, two tabs, one origin | PASS | Same two runs: three initStore calls construct 3 channels, close 2, leave 1 active; a save in tab A becomes visible in tab B. Defect V4-STORE-LISTENER-LIFECYCLE is closed by this executed result. |
| TEST-STORE-004 | Post-commit notification failure settles accurately and does not induce duplicate retry | Real browser + real IndexedDB | PASS | Same two runs: saveData resolves `{committed: true, conflict: false}` while postMessage throws; the durable record advances exactly once. |
| TEST-FEEDS-001 | Persisted cache/generation, module reload, valid refresh and reload preserve the new result | Real browser | PASS | Same two runs, on the integrated FEEDS replacement source (feeds SHA-256 `b0fe9d6b…`): cache persisted in IndexedDB; generation stable across reload; valid refresh preserved the prior item and added the new one. The earlier Track B block no longer applies; the stale v3 branch remains non-evidence. |
| TEST-FEEDS-002 | Paused refresh plus another tab's accepted manual/source/domain edit loses neither accepted change | Real browser, two tabs | PASS | Same two runs: paused refresh committed after tab B's edit; the refreshed item and tab B's manual entry are both present. |
| TEST-FEEDS-003 | Reversed response order, changed/deleted source, timeout/oversize/malformed response preserve ordering and last valid cache | Real browser with harness response barriers | PASS | Same two runs: reversed order keeps newer items and blocks the older response by token; deleted source commits nothing late; oversize, malformed and HTTP 500 each preserve the last valid cache. |
| TEST-HABITS-001 | Actual control creates/removes `completedAt`; summary, reload and local-day boundary agree | Real browser | PASS | Same two runs: `completedAt` occurrence created for the local day, preserved across reload with the same timestamp, and removed by the actual control. |
| TEST-UI-002 | Form rejection retains input; retry; import cancel/reject/repeat selection; export readback; keyboard focus; 320x568 and 375px layout; reduced motion (each subcase recorded separately) | Real browser | PASS | Same two runs: all ten subcases PASS, each recorded separately in the browser results — 002a rejection retains input, 002b retry, 002c import cancel, 002d import reject, 002e repeat selection, 002f export readback, 002g keyboard focus, 002h 320x568, 002i 375px, 002j reduced motion. |

## Release criteria categories (v3 bundle) — coverage map

Every category below must be covered by the Phase 2 matrix on the
frozen assembled commit before any shippable claim. Categories map to
the test points above or to matrix-only cases owned by Track D.

| Category | Covered by | Status |
|---|---|---|
| Fresh load; complete startup wiring | TEST-UI-001 | PASS (frozen `4883425`; Codex rerun at `1696d37`) |
| localStorage upgrade and recovery | TEST-STORE-002, matrix legacy cases | PASS (TEST-STORE-002, TEST-STORE-005, V5-STORE-01, V5-STORE-02, V10-RECOVERY-01, V11-RECOVERY-02 in the same gate runs) |
| Clean and malformed import/export; losing draft recoverable after failed download | TEST-UI-002, TEST-STORE-001 | PASS (TEST-UI-002c/d/e/f; conflict draft download in V5-STORE-02) |
| Real-IndexedDB commit/abort/denial; two-tab conflicts; genuine concurrent first open | TEST-STORE-001..004 | PASS (TEST-STORE-001..005 and V13-PLACES-01 in the same gate runs) |
| Every form: delayed commit, rejection, retained input, retry, duplicate click | TEST-UI-002 | NOT RUN — partial coverage only: the goal form passes rejection/retained-input/retry (TEST-UI-002a/b). Other forms and duplicate click have no executed case. |
| Goals/habits midnight, DST and saved-zone matrix; legacy achievement; archive/restore; honest late/missing history | TEST-HABITS-001, matrix zone cases | NOT RUN — partial coverage only: TEST-HABITS-001 passes local-day create/remove/reload. The midnight/DST/zone matrix, legacy achievement and archive/restore have no executed case. |
| Maps unique-ID CRUD | Matrix-only case | NOT RUN — place-ID repair at adoption is covered by V13-PLACES-01 and V5-STORE-01; a UI CRUD matrix case has not run. |
| College markup stays text (no injected HTML) | Matrix-only case | NOT RUN |
| Investments numeric round-trip | Matrix-only case | NOT RUN |
| Populated explorers render real data | Matrix-only case | NOT RUN — TEST-UI-001 renders all views at boot; no dedicated populated-explorer case has run. |
| Feed reload, ordering and cross-tab conflict | TEST-FEEDS-001..003 | PASS (frozen `4883425`; Codex rerun at `1696d37`) |
| Keyboard-operable import control | TEST-UI-002 | NOT RUN — partial coverage only: keyboard focus order and return pass (TEST-UI-002g); no isolated keyboard import-control case has run. |
| Nested modal focus, Escape, focus return | TEST-UI-002 | NOT RUN — partial coverage only: focus order and focus return pass (TEST-UI-002g); nested modal and Escape have no isolated case. |
| Viewports 320x568 and 375px | TEST-UI-002 | PASS (TEST-UI-002h/i) |
| Reduced motion | TEST-UI-002 | PASS (TEST-UI-002j) |
| Chart CDN unavailable/offline fallback | Matrix-only case | NOT RUN |
| Exact release asset manifest | Packaging check (Track E script) | NOT RUN |
| Zero LICENSE changes | Packaging check + patch review | Verified at branch level 2026-10-22: `git diff 29d43ff..1696d37 -- LICENSE` is empty. |

## Remaining complete-app acceptance gaps (post-V14B, 2026-10-22)

Local browser acceptance on the frozen assembled commit is complete
for the cases in the registry above (coordinator gate at `4883425`;
Codex independent rerun at `1696d37`, runId `efb3274d`). The V14B
Chrome local regression is closed. The following gaps remain open
and block any complete-app acceptance claim:

1. **Host acceptance: NOT RUN.** Hosted authentication, Cloudflare
   Workers/D1 behavior, Free CPU limits and unattended scheduled
   updates are UNVERIFIED. The backend is UNACCEPTED.
2. **Every-form matrix:** forms other than the goal form (delayed
   commit, rejection, retained input, retry, duplicate click) have
   no executed case.
3. **Time matrix:** goals/habits midnight, DST and saved-zone cases;
   legacy achievement; archive/restore; honest late/missing
   history — no executed case.
4. **Maps/places UI CRUD matrix case** — not run (adoption repair
   cases PASS; see the coverage map).
5. **College markup-injection case** — not run.
6. **Investments numeric round-trip** — not run.
7. **Populated explorers render case** — not run as a dedicated case.
8. **Chart CDN unavailable/offline fallback** — not run.
9. **Keyboard-operable import control (isolated)** and **nested
   modal focus/Escape** — not run as isolated cases.
10. **Exact release asset manifest packaging check** — not run. The
    old GitHub Pages workflow (`.github/workflows/pages.yml`) remains
    a named packaging gate until reviewed.
11. **Release approval: none.** The shippable claim withdrawn on
    2026-10-20 stays withdrawn. No merge and no deployment are
    authorized by any result recorded here.

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
