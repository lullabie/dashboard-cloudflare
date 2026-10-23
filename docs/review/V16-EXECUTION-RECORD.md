# V16 execution record — complete-app local acceptance

Date: 2026-10-23. Coordinator: Muse. Independent reviewer: Codex
(rerun on installed Chrome pending at the time of this record).

## Input

Codex bundle "CODEX V16 — advance to complete-app local acceptance",
received after Codex independently accepted V15B at
`3f257bcc2b20bd24608bbf8ea6c63f7cb97eed8c` (full runner exit 0,
19/19 Node files, 33 required Chrome cases PASS of 34 total,
negative 17/17, runId `606f3b8c-8dd5-4156-9ce0-b8c767f0ac8e`,
Node 24.19.0, installed Chrome 155.0.8059.85; a native Windows
junction alias was separately refused with exit 2 and the source
LICENSE intact). Base for every V16 lane: `3f257bc`. No Jules
sessions were created or reopened. One writer per named file.

## QA lanes (one new spec file each, base 3f257bc)

| Lane | File | Cases | Standalone result |
|---|---|---|---|
| A forms | `qa/v4/forms-matrix-browser.spec.mjs` (sha256 `1ee60044…`) | V16-FORM-01..07 | PASS 4, FAIL 3 (two app defects) |
| B time | `qa/v4/time-matrix-browser.spec.mjs` (sha256 `8cbf0dc1…`, corrected `516f0bcf…`) | V16-TIME-01..05 | PASS 4, FAIL 1 (one app defect) |
| C content | `qa/v4/content-matrix-browser.spec.mjs` (sha256 `8cb5f6e3…`) | V16-CONTENT-01..05 | PASS 5 (run twice) |
| D access/offline | `qa/v4/accessibility-offline-browser.spec.mjs` (sha256 `3c6af6bd…`) | V16-ACCESS-01..03, V16-OFFLINE-01..03 | PASS 5, FAIL 1 (one app defect) |

All cases ran in a real browser (boundary REAL-BROWSER), isolated
contexts, invented records only, through the actual UI and the
app's real import path. Chart.js is bundled locally
(`js/chart.umd.js`); the offline cases were written against that
wiring, not a CDN.

## Defects found and bounded repairs (one owner, one file each)

All four repairs touch only `js/main.js`, in disjoint regions.
Each lane preserved its RED log before fixing; each fix flipped
only its own cases and kept every other case at its prior state.

1. **Nested-modal Escape (V16-ACCESS-02).** One Escape closed the
   whole modal stack. Cause: a document-level handler closed every
   visible modal in addition to the per-modal trap handler. Fix:
   the per-modal handler stops propagation after closing its own
   layer; the document handler closes only the dialog-stack top.
   Diff +8/−4. Lane D spec: RED 5/6, fixed 6/6. Regressions:
   audit-regression 5/5, ui-browser 13/13, places 1/1.
2. **Habits archive partition (V16-TIME-05).** An archived habit
   stayed in the Active view; the Archive view stayed empty.
   Cause: the partition filtered on `h.archived`, a field no
   producer sets; producers carry `h.status`. Fix: archived iff
   `status === 'archived'`, active otherwise (a missing status
   stays visible; no record is hidden). Diff +2/−2. Regressions
   identical to the frozen baseline (ui-browser 13/13, audit 5/5,
   acceptance unchanged).
3. **Habit name/title mismatch (V16-FORM-02, V16-FORM-07).** A
   habit created through the form stored no name at all; the card
   title was blank and the edit modal showed `undefined`. Cause:
   `js/main.js` sent `name:` and read `habit.name`; the habits
   module contract is `title`. Fix: two lines in `js/main.js`
   align to `title`. No dual-write, no migration. Diff +2/−2.
   FORM-02 and FORM-07 flipped to PASS; ui-browser 13/13.
4. **Investment duplicate submit (V16-FORM-05).** Two synchronous
   submits created two records. Cause: the other forms run their
   save body synchronously at click time, so a second click dies
   on the store CAS check; `saveInvestment` queues through a Web
   Lock and re-reads post-commit state, so the second submit
   committed as a fresh create. Fix: an in-flight re-entry flag
   on the investment submit handler, cleared in `finally`.
   Diff +11/−1. FORM-05 flipped to PASS; two deliberate sequential
   creates of identical data still create two records (proven
   through the real UI). Regressions: content 5/5, audit 5/5.

## Spec correction (Lane B, TIME-05 restore step)

The original TIME-05 restore step clicked Restore inside the
hidden archived container without opening the Archive tab; the
defective app masked this by leaving the card in the visible
container, and a silent fallback retargeted the click. After
repair 2 the step timed out. Correction (spec only, no assertion
changed): the step now clicks the Archive tab first and clicks
Restore only in the archived container; the fallback is removed.
The guard on the click keeps the frozen-app failure on the
partition invariants instead of a timeout. Corrected spec sha256
`516f0bcf…`: frozen app FAIL (partition invariants), fixed app
5/5 PASS.

## Candidate and coordinator gate

Candidate: `cfefa9af327a83174d38c38fe27556c3685a4294` on
`codex/v5-review` (parent `3f257bc`). Contents: the four new spec
files (byte-identical to the lane deliverables), the four repairs
assembled in order into `js/main.js` (+23/−9 in total, exactly the
sum of the four lane diffs; assembled `js/main.js` sha256
`43316e7b…`), and registration of all 23 V16 IDs in
`REQUIRED_BROWSER_IDS` in `scripts/write-browser-results.mjs`.

Coordinator gate on a fresh clone of the candidate (sandbox
Chromium 156.0.8078.4, Node v24.20.0, `QA_BROWSER=chromium`,
`node scripts/run-review-tests.mjs .`): **LOCAL GATE PASS**,
exit 0, runId `32de95bd-557d-4d93-8716-321db6740d6c`.

- Node lane tests: 19/19 PASS.
- Browser: 12 spec files, all exit 0; **56 required cases PASS**
  (57 total including the extra TEST-STORE-005); all 23 V16 cases
  PASS; zero FAIL. Evidence:
  `docs/review/evidence/v16/browser-results-v16.json`
  (sha256 `1ae592e5…`).
- Negative checks: 17/17 (`scripts/run-negative-checks.mjs`,
  exit 0).
- Exact staging: `package-static-assets.mjs --stage` PASS,
  exactly 21 files, manifest exact, every local reference
  resolves.

The four "FAIL:" lines in the gate log's packager-test section
are the expected refusal messages the V15B negative cases assert
(exit 2 with the named reason); the packager test file itself
passes 19/19 inside the Node phase.

## Release-prep (document/patch only)

`docs/review/evidence/v16/release-prep-v16.md`: the V15 pages
workflow patch applies cleanly in check-only mode; the branch
file is unchanged and still unsafe; applying it needs a human
with workflows permission (GitHub API 403 stands). Staged
manifest at the base: 21 files, checker PASS. `git diff
29d43ff..HEAD -- LICENSE` is empty. Six host items remain NOT
RUN (hosted auth, Workers/D1 behavior, Free CPU limits,
unattended scheduled updates, hosted workflow/Pages behavior,
release approval), each with its closing evidence named.

## State after V16

- Local complete-app acceptance: the V16 candidate passes the
  full local gate. Codex reruns on installed Chrome.
- Host acceptance: NOT RUN. Release approval: none. The
  shippable claim withdrawn on 2026-10-20 stays withdrawn.
- PR #2 remains draft. Nothing merged, nothing deployed.
- The old GitHub Pages workflow on the branch is unchanged.
