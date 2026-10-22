# qa/v4 — browser QA specs

Real-browser specs for the dashboard. Each case runs in Firefox through
Playwright against one tree served from a local temporary origin.
Data is invented only. A PASS here is browser evidence for the named
tree only. It is not release acceptance and not host acceptance.

## Setup (the documented route)

```sh
cd qa/v4
npm install
npx playwright install firefox
```

`package.json` pins `playwright` to 1.64.1 ($0, official package).
`npm install` creates `node_modules/` in this directory. Do not commit
`node_modules/`.

Specs resolve Playwright in this order:

1. `PLAYWRIGHT_MODULE` env (storage spec also reads `QA_PLAYWRIGHT_CORE`).
2. Bare `playwright` / `playwright-core` import. This resolves the pinned
   install above.
3. Fallbacks only: a repo-local `node_modules/playwright-core`, the Python
   Playwright driver package, the npx cache, a cached Firefox binary
   under `~/.cache/ms-playwright`. A cache hit is never the sole
   reproducible setup.

## Run

```sh
node qa/v4/ui-browser.spec.mjs [--tree <path>] [--cases <id,id>]
node qa/v4/storage-browser.spec.mjs [--tree <path>]
node qa/v4/feeds-browser.spec.mjs [--tree <path>]
```

Tree under test, first match wins: `--tree`, `DASH_TREE` (UI spec),
`QA_TREE_ROOT`, then the checkout that contains the spec (this directory
is `<repo>/qa/v4/`, so the default tree is the repo root).
Each spec prints the tree path and the actual SHA-256 of `js/store.js`
and `js/feeds.js` read from that tree. No hash is pinned. No source is
substituted. No patch is applied.

Exit code: nonzero when any case is FAIL or NOT RUN. When no Playwright
or no browser resolves, every required case reports NOT RUN and the
process exits nonzero.

## Machine results

Each spec writes `browser-results.json` next to itself, or the path
named by `--results-out` / `QA_RESULTS_OUT`. Interim shape:

```json
{ "testedTree": "<abs path>", "storeSha256": "<hex|MISSING>",
  "feedsSha256": "<hex|MISSING>",
  "results": [ { "id": "...", "status": "PASS|FAIL|NOT RUN",
                 "boundary": "REAL-BROWSER", "detail": "..." } ] }
```

One file holds one spec run. Run each spec with its own
`--results-out` path until Lane E lands. Lane E's shared schema and
aggregation writer supersede this interim shape.

## Files

| File | Role |
|---|---|
| `ui-browser.spec.mjs` | TEST-UI-001, TEST-UI-002a–j, V5-STORE-02 |
| `storage-browser.spec.mjs` | TEST-STORE-001–005, V5-STORE-01 |
| `feeds-browser.spec.mjs` | TEST-FEEDS-001–003, V5-FEEDS-01–03 |
| `feed-responses.mjs` | Repo-local fixture builders (RSS, oversize, malformed) imported by the feeds spec |
| `storage-faults.mjs` | Fault hooks for the acceptance skeleton |
| `dashboard-invented.json` | Invented fixture records only |
| `package.json` | Pinned Playwright dependency for this directory |
