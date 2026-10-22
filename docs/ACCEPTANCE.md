# Dashboard acceptance registry

Updated: 2026-10-23 (post-V16 notes). **This is the single acceptance
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
| Every form: delayed commit, rejection, retained input, retry, duplicate click | TEST-UI-002 | PASS — V16 note (2026-10-23): V16-FORM-01..07 execute the full lifecycle for goal, habit, place, job, investment and college forms plus two-tab held-modal conflicts, on frozen candidate `cfefa9a` (coordinator gate, Chromium 156.0.8078.4, runId `32de95bd`). Two defects found and repaired inside the matrix: habit name/title mismatch and investment duplicate-submit (record: `docs/review/V16-EXECUTION-RECORD.md`). |
| Goals/habits midnight, DST and saved-zone matrix; legacy achievement; archive/restore; honest late/missing history | TEST-HABITS-001, matrix zone cases | PASS — V16 note (2026-10-23): V16-TIME-01..05 execute the pinned Toronto matrix on `cfefa9a` (same gate run): both sides of midnight, spring and fall DST, a different browser zone following pinned Toronto (no saved-zone setting exists — recorded as an observation), legacy achievement, archive/restore, honest late/missing history. The archive/restore case found and repaired the habits archive partition defect. |
| Maps unique-ID CRUD | Matrix-only case | PASS — V16 note (2026-10-23): V16-CONTENT-01 on `cfefa9a` (same gate run): UI create/edit/delete with unique, stable IDs across reloads. |
| College markup stays text (no injected HTML) | Matrix-only case | PASS — V16 note (2026-10-23): V16-CONTENT-02 on `cfefa9a` (same gate run): markup entered through the real form stays literal, stored verbatim, no element created. |
| Investments numeric round-trip | Matrix-only case | PASS — V16 note (2026-10-23): V16-CONTENT-03 on `cfefa9a` (same gate run): zero, decimal and large values exact through save, reload, export and reimport. |
| Populated explorers render real data | Matrix-only case | PASS — V16 note (2026-10-23): V16-CONTENT-04/05 on `cfefa9a` (same gate run): populated Jobs and Investments explorers filter and sort as labelled; record opening is proven through the card Edit path (the chart explorer has no row-click navigation). |
| Feed reload, ordering and cross-tab conflict | TEST-FEEDS-001..003 | PASS (frozen `4883425`; Codex rerun at `1696d37`) |
| Keyboard-operable import control | TEST-UI-002 | PASS — V16 note (2026-10-23): V16-ACCESS-01 on `cfefa9a` (same gate run): a full import completed keyboard-only. |
| Nested modal focus, Escape, focus return | TEST-UI-002 | PASS — V16 note (2026-10-23): V16-ACCESS-02 on `cfefa9a` (same gate run): nested News Sources modal stack; one Escape closes only the top layer and returns focus to the parent. The case found and repaired the whole-stack Escape defect. |
| Viewports 320x568 and 375px | TEST-UI-002 | PASS (TEST-UI-002h/i) |
| Reduced motion | TEST-UI-002 | PASS (TEST-UI-002j) |
| Chart CDN unavailable/offline fallback | Matrix-only case | PASS — V16 note (2026-10-23): Chart.js is bundled locally (`js/chart.umd.js`), not CDN-loaded. V16-OFFLINE-01/02 on `cfefa9a` (same gate run): with all outside requests blocked the charts render from the bundle; with the library request aborted the app shows the honest unavailable state and other views keep working. |
| Exact release asset manifest | Packaging check (Track E script) | PASS as a local packaging check — V16 note (2026-10-23): on `cfefa9a` the checker passes and `--stage` produces exactly 21 files with every local reference resolved (also V16-OFFLINE-03, staged-folder smoke). This is not a release approval; no release tree or owner acceptance exists. |
| Zero LICENSE changes | Packaging check + patch review | Verified at branch level 2026-10-22: `git diff 29d43ff..1696d37 -- LICENSE` is empty. |

## Remaining complete-app acceptance gaps (post-V14B, 2026-10-22)

Local browser acceptance on the frozen assembled commit is complete
for the cases in the registry above (coordinator gate at `4883425`;
Codex independent rerun at `1696d37`, runId `efb3274d`). The V14B
Chrome local regression is closed. V15 note (2026-10-22): the frozen
V15 candidate `7883921` also passes the local gate (33 required
cases including the five new V15-AUDIT cases, runId `355b1fba`;
record `docs/review/V15-EXECUTION-RECORD.md`), and the jobs form
now has executed create/edit coverage inside V15-AUDIT-01/02 — the
every-form matrix below still stands for the other forms. The
following gaps remain open and block any complete-app acceptance
claim:

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
10. **Exact release asset manifest packaging check** — not run as a
    release gate. V15 progress: the checker is now exact (exclusions
    first, exact staged set, dependency closure) and its `--stage`
    run passes on the V15 frozen candidate (evidence:
    `docs/review/evidence/v15/package-v15.txt`); no release tree or
    owner acceptance exists. The old GitHub Pages workflow
    (`.github/workflows/pages.yml`) remains a named packaging gate
    until reviewed; a replacement is prepared at
    `docs/review/V15-PAGES-WORKFLOW.patch` (the GitHub API returns
    403 for the workflows path, so the branch file is unchanged).
11. **Release approval: none.** The shippable claim withdrawn on
    2026-10-20 stays withdrawn. No merge and no deployment are
    authorized by any result recorded here.

V16 closing note (2026-10-23): gaps 2–10 above are closed locally
on frozen candidate `cfefa9a` — coordinator gate PASS (56 required
browser cases including the 23 new V16 cases, 19/19 Node files,
negative 17/17, runId `32de95bd`; record
`docs/review/V16-EXECUTION-RECORD.md`; evidence
`docs/review/evidence/v16/`). The V16 matrix found four app
defects (nested-modal Escape, habits archive partition, habit
name/title mismatch, investment duplicate submit); all four were
repaired in bounded one-file lanes inside the same candidate.
Codex reruns the candidate on installed Chrome. Gaps 1 (host
acceptance) and 11 (release approval) remain open and still
block any complete-app or shippable claim.

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
