# qa/v4 — Track D QA preparation

This directory is QA preparation only. It does not change production files and it is not an acceptance registry.
The existing acceptance document remains the single registry for state and source-criterion references.
`TEST-POINTS.md` in this directory is only the harness-to-TEST-ID map.

## Run

From a repo checkout that contains this directory:

```sh
node qa/v4/acceptance.spec.mjs
```

From the current workspace staging location:

```sh
node ~/workspace/goals/personal-life-dashboard/hidden_files/codex-v4-20261021/qa-v4/acceptance.spec.mjs
```

Expected skeleton behavior:

- Harness/shape groups can PASS under their stated MOCK or SHAPE boundary.
- Browser-required groups report `NOT RUN` with the missing precondition.
- A `PASS` in this skeleton is not integrated acceptance.

## Files

| File | Role |
|---|---|
| `TEST-POINTS.md` | Harness-to-TEST-ID map only |
| `acceptance.spec.mjs` | Node-runnable spec skeleton; one assertion group per TEST-ID |
| `storage-faults.mjs` | Test-only fault hooks: BroadcastChannel construction failure, post-commit notification failure, IndexedDB abort/denial/quota doubles, readiness-gate model |
| `feed-responses.mjs` | Deterministic fake feed responses with barriers, oversize body, malformed XML and timeout support |
| `dashboard-invented.json` | Invented fixture records only; fake names and `example.com` domains |
| `README.md` | This inventory and evidence rules |

## Existing lane-test inventory

Inventory source: patch-carried test files found under `hidden_files/codex-v3-20261021/` and `hidden_files/codex-v4-20261021/` on 2026-10-21.
Boundary labels: `STATIC` = source/text assertions only; `MOCK` = executed with Node, VM, IndexedDB or DOM doubles; `REAL-BROWSER` = real browser evidence.

| Source patch | Test file | Boundary | Notes |
|---|---|---|---|
| `store-v3-20261021-completed.patch` | `__tests__/store-v3-validation.test.js` | MOCK | Store v3 validation under Node doubles |
| `store-v3-20261021-completed.patch` | `__tests__/store_validation.test.js` | MOCK | Legacy store acceptance runner; requires the store.js path argument |
| `store-v3-correction-20261021-1622.patch` | `__tests__/store-v3-bc-validation.test.js` | MOCK | BroadcastChannel listener validation under doubles |
| `store-v3-correction-20261021-1622.patch` | `__tests__/store-v3-validation.test.js` | MOCK | Store v3 validation under Node doubles |
| `store-v3-correction-20261021-1622.patch` | `__tests__/store_validation.test.js` | MOCK | Legacy store acceptance runner; requires the store.js path argument |
| `store-v3-correction2-20261021-1657.patch` | `__tests__/store-v3-bc-validation.test.js` | MOCK | BroadcastChannel listener validation under doubles |
| `store-v3-correction2-20261021-1657.patch` | `__tests__/store-v3-degraded-save.test.js` | MOCK | Degraded/recovery suite under Node doubles; Codex rerun reported 7/7 mock pass for the new storage degraded/recovery suite |
| `store-v3-correction2-20261021-1657.patch` | `__tests__/store-v3-validation.test.js` | MOCK | Store v3 validation under Node doubles |
| `store-v3-correction2-20261021-1657.patch` | `__tests__/store_validation.test.js` | MOCK | Legacy store acceptance runner; requires the store.js path argument |
| `main-v3-20261021-completed.patch` | `test-main-v3.js` | STATIC | Static source assertions; unsupported accessibility/motion pass strings were later corrected |
| `main-v3-correction-20261021-1617.patch` | `test-main-v3.js` | STATIC | Static source assertions; accessibility/motion cases read `NOT EXECUTED`, not PASS |
| `habits-v3-20261021-completed.patch` | `habits-v3.test.js` | MOCK / STATIC | Habits v3 checks: one static case and executed Node-mock cases were reported for the lane |
| `progress-v3-20261021-completed.patch` | `progress-v3-test.js` | MOCK | Progress summary checks under Node/DOM doubles |
| `progress-v3-correction-20261021-1619.patch` | `progress-v3-test.js` | MOCK | Progress habit-contract correction checks under Node/DOM doubles |
| `feeds-v3-20261021-completed.patch` | `test_refresh_persistence.js` | MOCK | Stale pre-v3 API artifact in the old FEEDS session output; it is not the unavailable repaired v3 file and not v4 evidence |
| `codex-v4-20261021/` at inventory time | none found | — | The v4 folder held briefs, the dispatch record and a session-create response; no patch-carried lane test files were present yet |

No lane test in this inventory is labeled `REAL-BROWSER`. Real-browser evidence remains a Phase 2 item on the frozen assembled commit.

## Evidence rules

- Keep generated screenshots and logs in external versioned evidence storage. Do not commit them to the repo.
- For each executed case, record: commit, source hash where relevant, exact command or steps, runner/browser versions, origin and database isolation, boundary (`STATIC`, `MOCK` or `REAL-BROWSER`), expected result, observed result and `PASS` / `FAIL` / `NOT RUN`.
- Preserve prior failed results. Do not overwrite a failed run with a later pass.
- Do not relabel a mock, static or harness result as browser acceptance.
- Do not use the stale FEEDS API patch or the stale published FEEDS branch as repaired v3/v4 source.
- Use invented records only. Keep credentials and private payloads out of source, tests, screenshots and messages.
