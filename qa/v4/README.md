# qa/v4 — browser QA specs

Real-browser specs for the dashboard. Each case runs in a Chromium-family
browser (Chrome, Brave, or Chromium, selected with `QA_BROWSER`) through
Playwright against one tree served from a local temporary origin.
Data is invented only. A PASS here is browser evidence for the named
tree only. It is not release acceptance and not host acceptance.

## Setup (the documented route)

```sh
cd qa/v4
npm ci
npx playwright install chromium
```

`npm ci` installs from `package-lock.json`. The install is
reproducible: the lockfile pins `playwright` to 1.64.1 ($0, official
package). Do not use `npm install` as the documented route; it can
change the lockfile. `npm ci` creates `node_modules/` in this
directory. Do not commit `node_modules/`.

All four specs launch through one shared helper,
`qa/v4/browser-launch.mjs`. The helper resolves Playwright in this order:

1. `PLAYWRIGHT_MODULE` env.
2. Bare `playwright` / `playwright-core` import. This resolves the pinned
   install above.
3. `qa/v4/node_modules/playwright-core`, then
   `qa/v4/node_modules/playwright`.
4. The Python Playwright driver package under
   `~/.local/lib/python*/site-packages/playwright/driver/package`.
5. The npx cache under `~/.npm/_npx/*/node_modules/playwright-core`.

A cache hit is never the sole reproducible setup.

## Browser selection

`QA_BROWSER` selects the browser: `chrome`, `brave`, or `chromium`
(case-insensitive). The default is `chromium`. The helper launches through
the Playwright chromium launcher only: kind `chrome` uses channel
`chrome`, kind `brave` uses channel `brave`, and kind `chromium` uses the
Playwright Chromium build from the setup step.

Executable override: set `QA_BROWSER_EXECUTABLE_PATH` (alias
`QA_BROWSER_EXECUTABLE`) to an installed executable. Examples:

```sh
QA_BROWSER=chrome QA_BROWSER_EXECUTABLE_PATH=/usr/bin/google-chrome node qa/v4/jobs-browser.spec.mjs
QA_BROWSER=brave QA_BROWSER_EXECUTABLE_PATH=/usr/bin/brave node qa/v4/jobs-browser.spec.mjs
```

Contexts are isolated: each spec creates contexts with
`browser.newContext()`. No normal user profile is used.

There is no fallback. An unsupported `QA_BROWSER` value, a missing
Playwright module, or an unlaunchable selection makes every owned case
report NOT RUN and the spec exits nonzero.

## Run

Gate route (the evidence route). Run from the repo root:

```sh
node scripts/run-review-tests.mjs --commit <full-commit-sha>
```

`<full-commit-sha>` is the exact frozen commit under test. The runner
runs each `qa/v4/*.spec.mjs` in this directory and produces the
machine report described below. Exit code is nonzero when any required
case is FAIL or NOT RUN, or when the report does not validate.

Single-spec route (diagnosis only):

```sh
node qa/v4/ui-browser.spec.mjs [--tree <path>] [--cases <id,id>]
node qa/v4/storage-browser.spec.mjs [--tree <path>]
node qa/v4/feeds-browser.spec.mjs [--tree <path>]
node qa/v4/jobs-browser.spec.mjs [--tree <path>]
```

Tree under test, first match wins: `--tree`, `DASH_TREE` (UI spec),
`QA_TREE_ROOT`, then the checkout that contains the spec (this directory
is `<repo>/qa/v4/`, so the default tree is the repo root).
Each spec prints the tree path. The report writer computes the SHA-256
of `js/store.js` and `js/feeds.js` from that tree (see Machine
results). No hash is pinned. No source is substituted. No patch is
applied.

Exit code: nonzero when any case is FAIL or NOT RUN. When no Playwright
or no browser resolves, every required case reports NOT RUN and the
process exits nonzero.

## Machine results

One file carries browser results: `qa/v4/browser-results.json` in the
tested tree. The contract is `qa/v4/result-schema.md`; the machine form
is `qa/v4/result-schema.json`. The report is schema version 2:

```json
{
  "schemaVersion": 2,
  "testedCommit": "<7-40 hex chars>",
  "storeSha256": "<64 lower hex>",
  "feedsSha256": "<64 lower hex>",
  "runtime": "<string: node version plus the actual browser name and version, e.g. node v24.20.0; browser Chromium 141.0.7390.0 (QA_BROWSER=chromium)>",
  "runId": "<string, the QA_RUN_ID of the producing run>",
  "generatedAt": "<ISO 8601 timestamp>",
  "cases": [
    { "id": "TEST-UI-001", "status": "PASS", "boundary": "REAL-BROWSER",
      "detail": "<what was observed>" }
  ]
}
```

One writer creates the file: `scripts/write-browser-results.mjs` at
the repo root. No spec writes the file by hand. No spec invents a
second format.

How a run works:

1. The runner (`scripts/run-review-tests.mjs`, repo root) deletes any
   existing `qa/v4/browser-results.json`. A pre-existing file is never
   evidence.
2. The runner sets these environment variables and runs each spec:
   - `QA_RUN_ID` — unique id of this run.
   - `QA_RESULTS_FILE` — absolute path of the result file.
   - `QA_TREE_ROOT` and `DASH_TREE` — the tested tree.
   - `QA_TESTED_COMMIT` — the frozen commit under test.
   - `QA_RUNTIME` — base runtime string for the report header. Each spec
     extends it with the actual browser name and version recorded through
     the shared helper (for example `; browser Google Chrome 155.0.0.0
     (QA_BROWSER=chrome)`). When launch fails, the runtime names the
     requested selection as not launched.
   - `QA_BROWSER`, `QA_BROWSER_EXECUTABLE_PATH` — optional browser
     selection; the runner passes its environment through to the specs.
3. Each spec collects its cases and calls the writer once at the end.
   The writer computes `storeSha256` and `feedsSha256` from the tree.
   A spec cannot state hashes.
4. Calls with the same `runId`, tested commit and hashes merge cases
   by `id`. One call per spec is the normal shape: the UI spec, the
   storage spec and the feeds spec aggregate into one report.
5. A spec that cannot obtain a browser still calls the writer with
   every one of its cases at `NOT RUN` and exits nonzero.

Gate rules for the report:

- `schemaVersion` must equal `2`.
- `testedCommit` must equal the exact frozen commit passed to the
  runner with `--commit`. A mismatch is a stale-commit defect.
- `runId` must equal the `QA_RUN_ID` of the validating run. A report
  from an earlier run is a stale-report defect.
- `generatedAt` must not be in the future and must be at most 120
  minutes old at gate time.
- `cases` has no duplicate `id`. Each entry has `id`, `status`,
  `boundary` and `detail`. `status` is exactly `PASS`, `FAIL` or
  `NOT RUN`.
- A `PASS` on a required id counts only with boundary `REAL-BROWSER`.
  A mock or static pass does not satisfy the gate.
- The required set is 25 ids: the standing acceptance ids and the five
  V5 regression ids listed in `qa/v4/result-schema.md`. Extra ids are
  allowed and ignored by the gate (warning only).

A gate pass is a local result on one commit in one browser run. It is
not release approval. It is not host acceptance. It proves nothing
about Workers, D1 or any hosted behavior.

## Files

| File | Role |
|---|---|
| `ui-browser.spec.mjs` | TEST-UI-001, TEST-UI-002a–j, V5-STORE-02 |
| `storage-browser.spec.mjs` | TEST-STORE-001–005, V5-STORE-01 |
| `feeds-browser.spec.mjs` | TEST-FEEDS-001–003, V5-FEEDS-01–03 |
| `jobs-browser.spec.mjs` | V8-JOBS-OTHER |
| `browser-launch.mjs` | Shared Chromium-family launch helper: selection (`QA_BROWSER`), executable override, Playwright resolution, actual browser name/version |
| `acceptance.spec.mjs` | Harness skeleton: fixture shape and fault/response primitive checks; browser-required cases report NOT RUN. Not integrated acceptance |
| `feed-responses.mjs` | Repo-local fixture builders (RSS, oversize, malformed) imported by the feeds spec |
| `storage-faults.mjs` | Fault hooks for the acceptance skeleton |
| `dashboard-invented.json` | Invented fixture records only |
| `package.json` | Pinned Playwright dependency for this directory |
| `package-lock.json` | Lockfile for the reproducible `npm ci` install |
| `result-schema.md` | Text contract for the schema version 2 browser report |
| `result-schema.json` | Machine form of the same contract |
| `TEST-POINTS.md` | Harness map from files to TEST-IDs. Not an acceptance registry |
| `browser-results.json` | Output only. Written by `scripts/write-browser-results.mjs` during a runner run. Not source |

Repo-root files used by this directory (not in `qa/v4/`):

| File | Role |
|---|---|
| `scripts/run-review-tests.mjs` | Runner: deletes any old report, sets the `QA_*` environment, runs each spec, validates the report |
| `scripts/write-browser-results.mjs` | The one writer of `browser-results.json`; computes the store and feeds hashes from the tree |
