# V10 Execution Record — Native-IDB Adoption Partition + Strict Coordinates + Recovery Regression

Date: 2026-10-22. Branch: `codex/v5-review` (draft PR #2). Base: V9 head
`2cb168ac24a9f7ba245622a108b25854bccb6a51`. Frozen commit:
`5b874ee8e085ee67fea9e01b72eff20a17f0d741`.

V10 executes Codex bundle CODEX-V10-20261022: (A) repairs the P1 native
IndexedDB adoption crash traced in V9 section B3, (B) repairs the P2 maps
coordinate validator, (C) adds a dedicated native Chrome regression for the
poisoned-record scenario, and (D) registers that regression in the gate.
The bundle's third finding (Brave launcher selection) is DEFERRED by the
user's 2026-10-22 scope update: Chrome only for current acceptance. The V9
Chromium-family helper work is preserved unchanged; no rollback.

## A. STORE — partition at adoption (js/store.js)

- Repro on base: a raw stored record with `data.goals=[null]` is adopted
  verbatim by `syncFromRecord`; reload throws Chrome pageerror
  `Cannot read properties of null (reading 'status')`.
- Repair (+146/−4, sha256
  2b1f24d47c61e3ee661430d7f638e85f7f649de11c276427f9a60ffa881fa8ba):
  `syncFromRecord` is the single adoption funnel (initial IndexedDB load,
  BroadcastChannel refresh, save/import conflict adoption) and now
  partitions at adoption using the import entry-shape predicate — an entry
  is valid only when it is a non-null, non-array object. Valid entries keep
  order and are the only entries exposed in the `getData()` snapshot;
  `getData()` itself never filters. Every malformed entry is preserved as
  `{path, index, value}` in `envelopeExtras.quarantine` (`index: -1` means
  the collection value itself was malformed/non-array; that collection is
  exposed as empty). Nested paths are covered, including college sub-arrays
  and news arrays. A malformed root record recovers to the default empty
  dataset with the raw value quarantined at path `data`. Initial-load
  adoption repairs the durable record inside the same readwrite
  transaction. Saves merge in-memory extras over disk extras; export merges
  live extras over disk extras. Unknown extras keys and
  `envelopeExtras.legacyOriginalRaw` survive; quarantine survives save,
  export, reload, and conflict adoption. Generation/revision/CAS behaviour
  and the tracked-snapshot contract are unchanged. Filtering at `getData()`
  was not used: the first subsequent save would silently destroy the
  quarantined entries.
- Tests: new `__tests__/store-v10-adoption.test.mjs` (sha256
  e030ed12a515987d6ba76d88b5706b2a9f7f3342d261ccc84212968e50af6bbc).
  RED on the unedited store.js: 8 passed / 17 failed, failures exactly in
  partition/quarantine behaviour. GREEN: 30/30 PASS; full `__tests__` set
  in the lane clone 13/13 files PASS.

## B. Maps — strict coordinate parsing (js/maps.js)

- Repro on base: `isValidCoordinate("43junk","-79garbage")` returned `true`
  (parseFloat-style prefix parsing), and junk-string coordinates were
  saved by `savePlace`.
- Repair (+14/−2, sha256
  eb8f1b9e60125c25a34a8a2111e23aaf7ba9c1acf8e3604b42a589046a0b4104):
  an internal `parseCoordinate` passes numbers through; strings are
  trimmed and must match decimal notation
  `/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/` before `Number()`
  conversion; other types become NaN. This rejects `"43junk"`,
  `"-79garbage"`, blank/whitespace-only, `Infinity`, `NaN`, and
  hex/binary/octal-prefixed strings such as `0x10`. Finite and inclusive
  range checks are unchanged (latitude −90..90, longitude −180..180).
  Caller input is not mutated. `savePlace` validates before `getData()` on
  both create and update paths; rejected input leaves the dataset
  untouched and does not call `saveData`. V9 behaviours remain: stored
  invalid places stay visible with raw values and correctable by edit; an
  invalid active place falls back to the valid-places map.
- Tests: `__tests__/maps-validation.test.mjs` extended (+67 lines, sha256
  db0175a61a17a9bd8e2e872ec3df1024311870c50cbd4508c14e934a858bae6e).
  RED against the unedited maps.js: 12 passed / 2 failed. GREEN: 14/14
  PASS; full `__tests__` set in the lane clone 13/13 files PASS; ESM check
  PASS.

## C. Recovery browser regression (qa/v4/recovery-browser.spec.mjs)

- New file, sha256
  1a4fd6fa7f16a51539c66d8ecfd15e7a4c71d33e5bb584e7e050b57f9f928918.
  Records exactly one case, `V10-RECOVERY-01`, through the shared results
  writer. Uses `qa/v4/browser-launch.mjs` unchanged, a local temporary
  origin, an isolated context, and the storage spec's cross-tab pattern.
  It seeds a raw IndexedDB record directly with `goals: [null, validGoal]`
  and `jobs: [validJob, null]` and asserts: poisoned load with zero
  pageerrors; valid goal and valid job render; snapshot contains no null
  entries and keeps the valid entries; cross-tab adoption of an unrelated
  save without pageerror; export keeps the valid entries and the unrelated
  save, excludes nulls from exported data, and preserves both malformed
  entries as quarantine metadata with path/index/value (`goals` index 0,
  `jobs` index 1); reload plus a second export retain the same result.
- RED on unmodified base in real Chromium, exit 1:
  `poisoned load produced pageerror(s): Cannot read properties of null
  (reading 'status')`.
- Correction of record: the first integrated run (with Lane A's fixed
  store) failed one assertion — the valid job did not render — because
  the app boots on the Today view and job cards render only in the Jobs
  view, whose text a hidden view does not expose. That was a spec defect,
  not an app defect. The spec now activates the Jobs view through the
  app's own UI (the jobs-browser.spec.mjs pattern) before the job-render
  assertion; assertion text, scenario order, all other assertions, and
  the single case are unchanged. The corrected spec was re-proven in both
  directions: GREEN with the fixed store (exit 0), RED on the base store
  with the original pageerror (exit 1).

## D. Gate registration

- `scripts/write-browser-results.mjs` (sha256
  80666b0fc7a9b2f0f48bc538da22c36b9e05b89c0d819be2aa8d29e491164dff):
  `V10-RECOVERY-01` added to `REQUIRED_BROWSER_IDS`, 25 → 26.
- `qa/v4/result-schema.json` (sha256
  46b5ba0617a593151accf4a150d9fdaa4347ed64db81c1933c0e71a5b74c6bf4):
  `requiredIds` now 26, including `V10-RECOVERY-01`.
- `qa/v4/result-schema.md` (sha256
  132a7db7535f2ee4f6777574b8fe1de35dd9dd3f57973dfe6f76944c2ecf5705):
  heading updated to 26 ids; new V10 section describes the native-IDB
  poisoned-record regression.
- Writer and schema required-ID sets are identical in order and content;
  no stale "25 required ids" references remain in the owned files.

## Assembly gate — local, uncommitted tree on the base label

- Command run against base commit label
  `2cb168ac24a9f7ba245622a108b25854bccb6a51` with the 8 V10 files copied
  into the assembly tree. Result: exit 0. Lane tests 14/14 files PASS.
  Browser report runId 57261b26-216a-4134-8270-954d1481df60: 27 cases, 27
  PASS. Negative checks 17/17. This run is integration evidence only,
  not frozen-commit evidence.

## Frozen gate — local, Chromium

- Fresh clone of the branch head; frozen commit
  `5b874ee8e085ee67fea9e01b72eff20a17f0d741`. All 8 published V10 files
  verified by sha256 in the clone before the run.
- Setup: `npm ci` in qa/v4. Command:
  `node scripts/run-review-tests.mjs --commit 5b874ee8e085ee67fea9e01b72eff20a17f0d741`
  with the default selection (QA_BROWSER unset → chromium).
- Runtime: Node v24.20.0, Playwright 1.64.1, Chromium 156.0.8078.4
  (headless shell), local temporary origin http://127.0.0.1, isolated
  contexts, invented records.
- Result: gate exit 0. Lane tests 14/14 files PASS. Browser report
  schemaVersion 2, runId 83cd6e0c-3f68-4f46-b991-49987dd13895, generatedAt
  2026-10-22T11:41:00.773Z: 27 cases, 27 PASS — the 26 required IDs
  (including `V10-RECOVERY-01`) plus extra TEST-STORE-005, which the gate
  ignores. The report runtime reads
  `node v24.20.0; browser Chromium 156.0.8078.4 (QA_BROWSER=chromium)`.
- Negative checks in the frozen clone: 17/17 behaved as required.
- Coordinator-held local evidence (sha256): gate output
  518835877b42c2535fd4afd99f8b1736869b1cd93d106860204ad9e57166dee9,
  browser results
  fe0b92d3190df9e14f8b5ad26800a092978e397e7afe8ada5a77b2c8f763e77e,
  negative checks
  59feb22f579a54de5e839811b58918bc993f8f6ef4265ee97f4514c5d8ec3a50.
- This is a local gate pass. It is not release approval and is not host
  acceptance; the gate output states this itself.

## Not in V10

- Brave launcher lane: deferred by the user's 2026-10-22 scope update
  (Chrome only). No Brave work is required for current acceptance.
- No merge, no deploy. PR #2 remains draft. Host acceptance remains NOT
  RUN. Codex independent inspection of this frozen commit (installed
  Chrome, isolated contexts, actual runtime recorded) is the next gate.
