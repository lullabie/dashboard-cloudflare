# V8 execution record — V8-JOBS-OTHER (2026-10-22)

Bundle: Codex review of V7 head 9f97846d + V8-JOBS-OTHER defect order,
relayed by the user. Scope: bounded corrections only. No merge, no deploy,
no resources, no billing. PR #2 remains draft. Host acceptance: NOT RUN.

## Defect

At cae2cd5f: js/visuals/charts.js groups every status outside
applied/interview/offer/rejected under Other and its click sends
rawKeys[index] (undefined for an out-of-range index). index.html
#job-status-filter had no Other option, so main.js assigning 'other'
produced an empty select value; the jobs filter then compared
j.status === '' (strict equality at the old main.js filter). Clicking the
chart Other bar broke the jobs list.

## Ownership and changes

MAIN lane (Jules session 15054498843384471465, reused; session COMPLETED
2026-10-22T08:49:00Z before coordinator work started — no duplicate
prompt, no reopened owner): patch 7,282 B, sha256
7e0254125b511f60de9028caac1c8c5e4d3b763c5a3092e6623951afb83fabea —
index.html Other option, isOtherJobStatus + createChartJobFilterHandler
in js/main.js, __tests__/jobs-filter.test.mjs.

Coordinator correction (ownership transfer, user order): the Jules patch
wired its handler to window.handleChartJobFilter, which nothing calls;
the chart uses the closure handleChartJobFilter (old main.js line 523).
The coordinator ported the fix to the branch tree and deleted the dead
window assignment (it was never published):

- js/main.js sha256 28136737e45b57bdd669fd9739464b391b5c4a52bc1b625b5aab0a71a211e325 —
  exported isOtherJobStatus (status outside the four known keys, matching
  the chart grouping exactly, including explicit 'other', unknown,
  blank, missing) and createChartJobFilterHandler (guard: values outside
  applied/interview/offer/rejected/other are ignored with no select
  change and no refresh; valid values keep the original change-only
  semantics). Line 523 closure is now
  createChartJobFilterHandler(jobStatusFilter, refreshUI) — the handler
  renderJobsChart receives is the factory product the mock test
  exercises. Jobs filter: 'other' selects isOtherJobStatus(j.status);
  known statuses keep strict equality; 'all' unchanged; location filter
  conjunction unchanged. No charts.js writes.
- index.html sha256 5bec01e69d77c79d1e63caf7d17fa11afe24a63a4bbd859bbe3dd689067b851a —
  one added line: <option value="other">Other</option> in
  #job-status-filter.
- __tests__/jobs-filter.test.mjs sha256 2b15ec25dda1d1f5b8698a4c006cc810ab3c07592d849eb8bef0592d8acc3036 —
  Jules test as delivered (predicate, filter integration over invented
  jobs incl. missing status, callback guard).

QA owner (separate file): qa/v4/jobs-browser.spec.mjs sha256
23a1f5f2aad3d2c1e2c667a7fe964088bf519f1007f38fbdf7e31d5b93a2a5a6 —
one case V8-JOBS-OTHER: seeds invented jobs (applied, explicit other,
legacy pending, blank status) through the legacy localStorage path,
clicks the actual chart Other bar on the canvas, verifies selected label
and count/list, location narrowing, and All reset. A missing-status
record is not seeded in the browser case: js/jobs.js createJobCard reads
job.status.charAt, so a missing status cannot render a card; the
missing-status predicate is covered by the mock test.

Lane E (registration only): scripts/write-browser-results.mjs sha256
8d7fd0708407db1293175e7c8e4ccbe1ce646c468b938f6ee4371cd6d4705dc0 and
qa/v4/result-schema.json sha256 497bf0825b57266470fe79934cf2f59a486ef2908338bb5331e9245108b5af0f
and qa/v4/result-schema.md sha256 7c4f33a8e7e160ecfb7e170ed1240f6d7bb6ee77b8795cfa1b8fd20dd4af4c20 —
V8-JOBS-OTHER added to REQUIRED_BROWSER_IDS; required set is now 25 ids.
A PASS extra case would not have satisfied the gate.

Docs owner: qa/v4/README.md sha256 eccd5a3409e90ffb6b0c10a6ab7c094b3e9fce16c39f80582bb041669df91842 —
stale interim-shape text removed; documents the actual schema 2 writer
(scripts/write-browser-results.mjs), the runner command
(node scripts/run-review-tests.mjs --commit <full-sha>), lockfile
reproducible setup (npm ci, playwright 1.64.1), and the jobs spec.

Lane E tooling publication: scripts/run-negative-checks.mjs sha256
40a688c25930966c61190ffff6a52f7a8668f724fbc498c781f3a9afcac6d4be —
the negative-check runner previously held only locally (Lane E v6),
published with repo-layout paths. Reproducible on a clean checkout:
node scripts/run-negative-checks.mjs → 14/14 behaved as required
(verified in the frozen clone below; the positive control now covers 25
required ids). The V7 D/E evidence narrative remains in the V7 record.

## Red-green (real Firefox, Playwright 1.64.1, node v24.20.0)

- RED on cae2cd5f (tree codex-v7-20261022/frozen2): V8-JOBS-OTHER FAIL —
  "clicking the chart Other bar never set the status filter to other".
  Mock test on the same tree: FAIL (helpers absent).
- GREEN on the v8 tree: V8-JOBS-OTHER PASS — clicked at canvas fraction
  0.5,0.86 on the first attempt; list 3 (ExplicitOtherCo, PendingCo,
  BlankCo); Other+Toronto 2; All reset 4; zero page errors.
  Mock test 3/3 PASS. Charts suite unchanged: 18/18 PASS [MOCK].

## Frozen gate

Frozen commit: 5c9fba30ddab57667bc652ea8532d64bba197614 (branch
codex/v5-review head after the v8 publishes; fresh clone).
Command: npm ci in qa/v4, then
node scripts/run-review-tests.mjs --commit 5c9fba30ddab57667bc652ea8532d64bba197614
Runtime: node v24.20.0, Playwright 1.64.1, real Firefox 157.0, local
temporary origin http://127.0.0.1, isolated profiles, invented records.
Result: gate exit 0 — lane tests 11/11 files PASS; browser report
schemaVersion 2, runId e07d7c3e-a001-4a2d-8f97-c9fcc6138d7e, 26 cases,
26 PASS (25 required ids incl. V8-JOBS-OTHER + extra TEST-STORE-005,
ignored by the gate with a warning). Report identity: store
aa505bf99d91a8ce…, feeds b0fe9d6b31ca….
Raw evidence (coordinator-held, hashes for independent comparison):
browser-results JSON sha256 bf44be296d5945dd1284a778358cc6c66c40b2e5f1d0f4a1e78d993ee652b952;
gate log sha256 9eedf9a6bed8c3be4127caa95abaa91562ef38954942f1290f7310c30e0058e3.
This is a local gate pass on one commit. It is not release approval and
not host acceptance.

## Independent verification status

Codex rerun at 9f97846d (Windows, Node 24.19.0, npm ci, Playwright
1.64.1, official Firefox 157 build 1555): lane tests 10/10 PASS; all 25
browser cases NOT RUN — minimal firefox.launch({headless:true}) also
fails with spawn UNKNOWN on that machine, a local browser-launch
blocker, not app evidence. The V7 25/25 is NOT independently reproduced
and is not quoted as such. Host acceptance remains NOT RUN.

## Ponytail click-path audit (read-only, parallel)

Report-only; no fixes in this bundle. Three concrete repros at cae2cd5f:
(1) Map: a place with out-of-range coordinates (form checks shape, not
range) blanks the whole map when selected — getMapEmbedUrl returns null
after the container was emptied. (2) One null record in places,
investments, or college arrays aborts refreshUI mid-render (IndexedDB
records are adopted without entry validation), leaving later sections
stale. (3) College card shows the literal text "NaN days left" for a
missing or invalid date. College and investments charts register no
onClick; no second instance of the jobs-chart failure mode exists there.

## Remaining host gates

Codex independent inspection of 5c9fba30 + this record. Merge/deploy
only with Codex acceptance + host acceptance + user approval. PR #2
draft.
