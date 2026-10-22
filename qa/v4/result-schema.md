# Browser result schema — the contract (v6)

Owner: Lane E. Consumer: Lane D (UI, storage, feeds specs) and Lane C
(assembly). Executable form: `scripts/write-browser-results.mjs`.
Machine form: `qa/v4/result-schema.json` (same constants).

One file carries browser results: `qa/v4/browser-results.json` in the
tested tree. One writer creates it: `scripts/write-browser-results.mjs`.
No spec writes the file by hand. No spec invents a second format.

## How a run works

1. The runner (`scripts/run-review-tests.mjs`) deletes any existing
   `qa/v4/browser-results.json`. A pre-existing file is never evidence.
2. The runner sets environment variables and runs each `qa/v4/*.spec.mjs`:
   - `QA_RUN_ID` — unique id of this run.
   - `QA_RESULTS_FILE` — absolute path of the result file.
   - `QA_TREE_ROOT` and `DASH_TREE` — the tested tree.
   - `QA_TESTED_COMMIT` — the frozen commit under test.
   - `QA_RUNTIME` — runtime string for the report header.
3. Each spec collects its cases and, at the end, calls the writer once:

```js
import { writeBrowserResults } from '../../scripts/write-browser-results.mjs';
writeBrowserResults({
  outFile: process.env.QA_RESULTS_FILE,
  tree: process.env.QA_TREE_ROOT,
  testedCommit: process.env.QA_TESTED_COMMIT,
  runtime: process.env.QA_RUNTIME,
  runId: process.env.QA_RUN_ID,
  cases, // [{ id, status, boundary, detail }, ...]
});
```

4. The writer computes `js/store.js` and `js/feeds.js` SHA-256 from the
   tree. A spec cannot state hashes. Calls with the same runId, commit
   and hashes merge cases by id. One call per spec is the normal shape:
   UI spec, storage spec and feeds spec aggregate into one report.
5. A spec that cannot obtain a browser MUST still call the writer with
   every one of its cases at `NOT RUN` and exit nonzero. Silence is a
   defect: the runner reports `browser-not-run`.

## Report shape

```json
{
  "schemaVersion": 2,
  "testedCommit": "<7-40 hex chars>",
  "storeSha256": "<64 lower hex>",
  "feedsSha256": "<64 lower hex>",
  "runtime": "<string: node version plus actual browser name/version, e.g. node v24.20.0; browser Chromium 141.0.7390.0 (QA_BROWSER=chromium)>",
  "runId": "<string, the QA_RUN_ID of the producing run>",
  "generatedAt": "<ISO 8601 timestamp>",
  "cases": [
    { "id": "TEST-UI-001", "status": "PASS", "boundary": "REAL-BROWSER", "detail": "<what was observed>" }
  ]
}
```

Field rules:

| Field | Rule |
|---|---|
| `schemaVersion` | Must equal `2`. Any other value is malformed. |
| `testedCommit` | The frozen commit under test. Must equal the runner's commit. A mismatch is a stale-commit defect. |
| `storeSha256` | SHA-256 of `js/store.js` in the tested tree, computed by the writer. Must equal the tree value at gate time. |
| `feedsSha256` | SHA-256 of `js/feeds.js` in the tested tree, computed by the writer. Must equal the tree value at gate time. |
| `runtime` | Non-empty string. Names the node version AND the actual browser name and version recorded via the shared helper `qa/v4/browser-launch.mjs` (for example `node v24.20.0; browser Chromium 141.0.7390.0 (QA_BROWSER=chromium)`). A hardcoded browser label is a defect: the name and version must come from the launched browser. When launch fails, the string names the requested selection as not launched. |
| `runId` | Must equal the `QA_RUN_ID` of the validating run. A report from an earlier run is a stale-report defect. |
| `generatedAt` | ISO 8601. Must not be in the future and must be at most 120 min old at gate time (runner flag `--max-age-min`). |
| `cases` | Array. No duplicate `id`. Each entry needs `id`, `status`, `boundary`, `detail`. |

Case rules:

| Field | Rule |
|---|---|
| `id` | One case id. See the required set below. Extra ids are allowed and ignored by the gate (warning only). |
| `status` | Exactly `PASS`, `FAIL` or `NOT RUN`. |
| `boundary` | Provenance label. A `PASS` on a required id counts only with boundary `REAL-BROWSER`. A mock or static pass does not satisfy the gate. |
| `detail` | Non-empty string. Names the observed result. For `FAIL` and `NOT RUN` it names the failure or the missing precondition. |

## Required case set (27 ids)

Standing acceptance ids (registry: `docs/ACCEPTANCE.md`):

- `TEST-UI-001`
- `TEST-UI-002a` … `TEST-UI-002j` (ten subcases; a bare `TEST-UI-002`
  entry satisfies nothing)
- `TEST-STORE-001`, `TEST-STORE-002`, `TEST-STORE-003`, `TEST-STORE-004`
- `TEST-FEEDS-001`, `TEST-FEEDS-002`, `TEST-FEEDS-003`
- `TEST-HABITS-001`

V5 regression ids (bundle CODEX-DASHBOARD-PHASES-V5-20261021):

- `V5-STORE-01`, `V5-STORE-02`
- `V5-FEEDS-01`, `V5-FEEDS-02`, `V5-FEEDS-03`

V8 regression ids (bundle V8-JOBS-OTHER, 2026-10-22):

- `V8-JOBS-OTHER` (owner: qa/v4/jobs-browser.spec.mjs)

V10 regression ids (bundle CODEX-V10-20261022):

- `V10-RECOVERY-01` (owner: qa/v4/recovery-browser.spec.mjs) — native
  IndexedDB poisoned-record adoption: a record with malformed collection
  entries loads without a page error, the poisoned record is adopted
  across tabs, and quarantined entries survive an unrelated save,
  export and reload.

V11 regression ids (bundle CODEX-V11-20261022):

- `V11-RECOVERY-02` (owner: qa/v4/recovery-browser.spec.mjs) — native
  IndexedDB export-consistency regression: the disk record is poisoned
  after a clean boot and adopted via BroadcastChannel; an export taken
  before any save or re-init must contain the partitioned (cleaned) data
  with the exact quarantine, and that exact export must import
  successfully into a clean context. Includes the export scenario where
  the disk record is newer than the current cache.

Gate rule: every required id present, at `PASS`, boundary
`REAL-BROWSER`, in a report whose commit, hashes, runId and timestamp
all validate. Any `FAIL`, any `NOT RUN`, any omitted id, any duplicate,
any identity mismatch: gate exits nonzero and names each defect.

## What Lane D must change in the specs

- Remove all reads of files outside the checkout (no `hidden_files`
  paths, no re-application of old patches, no pinned old source hashes
  as the tree identity). Default tree: the checkout that contains the
  spec; explicit override stays allowed.
- Replace hand-built result objects and console-only summaries with the
  writer call above. Console lines may stay; the file is the evidence.
- Emit one entry per required id the spec owns, including the
  `TEST-UI-002a`–`j` subcases as separate entries and the five V5 ids.
- On a missing browser, emit `NOT RUN` for every owned id through the
  writer and exit nonzero.

## Non-claims

A gate pass is a local result on one commit in one browser run. It is
not release approval. It is not host acceptance. It proves nothing
about Workers, D1 or any hosted behavior.
