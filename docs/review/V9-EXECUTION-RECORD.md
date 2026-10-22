# V9 Execution Record — Browser Correction + Bounded Repair

Date: 2026-10-22. Branch: `codex/v5-review` (draft PR #2). Base: V8 head
`b3f23fad483bf72c756a3de1faea6404cf0db057`. Frozen commit:
`636955b89f36d2c6a1be018d2302236fdc3c0508`.

V9 does three things: (A) replaces the Firefox-based QA browser tooling with a
Chromium-family helper (the user uses only Brave/Chrome; Codex's independent
Chrome run at the V8 head is the acceptance direction), (A2) fixes the
V5-STORE-02 download race in the UI spec, and (B) repairs two of the three
ponytail click-path audit findings (map coordinate validation, college invalid
date). Finding 2 (null record adopted from IndexedDB aborting refreshUI) was
traced read-only; its repair is NOT in V9 (see "Not in V9").

## A. QA tooling — shared Chromium-family launch helper

- New `qa/v4/browser-launch.mjs`
  (sha256 559d57b0824e7153c3f32237588a0642d6ad36bd7effada659ca137a4096c5f7).
  `QA_BROWSER` accepts chrome | brave | chromium (default chromium),
  trimmed and case-insensitive. Any other value (including firefox, opera)
  throws naming the supported values — there is no fallback.
  `QA_BROWSER_EXECUTABLE_PATH` (alias `QA_BROWSER_EXECUTABLE`) overrides the
  executable. Launch uses the Playwright chromium launcher only, headless,
  isolated `browser.newContext()` per spec — no persistent context, no normal
  user profile.
- All four specs (ui, storage, feeds, jobs) use the helper; their local
  Firefox launch blocks are deleted. Every case, assertion, required ID,
  server and writer behaviour is preserved. After launch the results writer
  records the ACTUAL launched browser name and version; after a failed
  launch the runtime records the browser as not launched, all owned cases
  are NOT RUN, exit nonzero. A hardcoded browser label is a defect
  (qa/v4/result-schema.md).
- `scripts/run-review-tests.mjs` logs the requested selection.
  `scripts/run-negative-checks.mjs` keeps its 14 checks and adds 3:
  unsupported values rejected with no fallback; supported values and the
  executable override accepted; source scan — no legacy browser reference in
  the helper or specs.
- qa/v4/README.md documents selection, override, `npx playwright install
  chromium`, the no-fallback rule, and the actual runtime string.

## A2. V5-STORE-02 download race — test fix, assertions unchanged

- Red of record: Codex's independent Chrome run at b3f23fa — expected 1
  recovery download, saw 0. Root cause in the spec: the page download
  handler awaited `download.saveAs` BEFORE recording the download, and the
  case sliced the downloads array immediately after the terminal alert.
  Codex's scratch diagnostic (bounded polling before the same assertion)
  showed the download arriving after the early check. That diagnostic is
  evidence of a test race, not a full independent PASS, and is not claimed
  as one.
- Fix (ui spec only): the download event is armed with
  `page.waitForEvent('download', { timeout: 15000 })` BEFORE the dialog is
  accepted; the handler records the download immediately and stores any
  saveAs error on the entry (never swallowed); an `awaitDownloads` helper
  waits bounded for completion and throws a stored saveAs error. The
  assertions are unchanged: exactly 1 download, name starts with
  `dashboard-draft-`, and all UI-refresh / data-preservation checks stand.

## B1. Maps — invalid coordinates (js/maps.js only)

- Repro on b3f23fa: `getMapEmbedUrl` with an out-of-range active place
  returned null (whole map blanked); `savePlace` accepted lat 999 on both
  create and update (update overwrote a valid record); stored non-numeric
  coordinates rendered as "NaN".
- Repair (+11/−7, sha256
  3180603181de041efd6c0a2a58235bee1d0d733a56da87477730000ac716057a):
  `savePlace` validates first — invalid coordinates reject with a clear
  error, the dataset is untouched, `saveData` is never called (the existing
  caller alerts `Could not save: …`, modal stays open, input preserved).
  An invalid active place is treated as no active place: the map renders
  the valid places' bounds with no marker; all-invalid still yields null.
  Valid-active URLs are byte-identical to before. Invalid stored places
  stay visible in the list with their raw coordinates.
- Tests: `__tests__/maps-validation.test.mjs` — 9 cases [MOCK]; RED on the
  unedited file (6 fail / 3 pass, the passes being the unchanged-behaviour
  guards), GREEN 9/9 after the repair.

## B2. College — invalid/missing date (js/college.js only)

- Repro on b3f23fa with the real card renderer: `date: 'not-a-date'` and a
  missing date both rendered "NaN days left", width "NaN%", and a literal
  "Date: undefined".
- Repair (+8/−4, sha256
  d2aeb5ea96aaf92c4478debbcc06158024434ff0a5330cc277330d500632a66a): an
  invalid or missing date renders "Date not set", 0% progress, and the raw
  stored value (or "No date set") in the date line — never "undefined",
  never NaN. The card is never dropped. Valid future / today / overdue
  behaviour is unchanged.
- Tests: `__tests__/college-date.test.mjs` — 5 cases [MOCK]; RED before
  (2 fail, exactly the invalid/missing cases), GREEN 5/5 after.

## B3. Null-record trace — read-only, NOT repaired in V9

A null entry inside an existing IndexedDB record is adopted verbatim by
`syncFromRecord` (js/store.js) on initial load, cross-tab re-read, and
conflict adoption, and then throws inside `refreshUI` section renders,
aborting the rest of the refresh. Legacy localStorage and file-import
payloads are NOT sources — import validation already rejects null entries.
Recommended contract (for a future bundle, STORE owner only): partition at
adoption — valid entries untouched and in order; invalid entries quarantined
in envelope extras, included in every export, re-attached on every save so
no unrelated save can silently delete them. Filtering at `getData()` was
rejected: the first subsequent save would silently destroy the entries.

## C. V8 evidence published

`docs/review/evidence/v8/` now holds the V8 gate evidence in retrievable
form: `browser-results-v8.json` (byte-identical copy of the coordinator-held
original, sha256 bf44be296d5945dd1284a778358cc6c66c40b2e5f1d0f4a1e78d993ee652b952),
`gate-output-v8.txt` (path-sanitized copy — tree prefix only; round-trip
substitution reproduces the original byte-for-byte), and a README indexing
both with the frozen V8 commit, runId, runtime, and the status note:
historical V8 local-gate evidence — NOT host acceptance, NOT current target
acceptance.

## Frozen gate — local, Chromium

- Fresh clone of the branch head; frozen commit
  `636955b89f36d2c6a1be018d2302236fdc3c0508`. All 16 published V9 files
  verified by sha256 in the clone before the run.
- Setup: `npm ci` in qa/v4. Command:
  `node scripts/run-review-tests.mjs --commit 636955b89f36d2c6a1be018d2302236fdc3c0508`
  with the default selection (QA_BROWSER unset → chromium).
- Runtime: Node v24.20.0, Playwright 1.64.1, Chromium 156.0.8078.4
  (headless shell), local temporary origin http://127.0.0.1, isolated
  profiles, invented records.
- Result: gate exit 0. Lane tests 13/13 files PASS. Browser report
  schemaVersion 2, runId 7e33f438-b316-4417-a9da-5590f3cf60a2, generatedAt
  2026-10-22T11:02:33.122Z: 26 cases, 26 PASS — the 25 required IDs
  (including V8-JOBS-OTHER and V5-STORE-02 with its original assertions)
  plus extra TEST-STORE-005, which the gate ignores. The report runtime
  reads `node v24.20.0; browser Chromium 156.0.8078.4 (QA_BROWSER=chromium)`.
- Negative checks in the frozen clone: 17/17 behaved as required.
- This is a local gate pass. It is not release approval and not host
  acceptance; the gate output states this itself.

## Not in V9

- The null-record quarantine repair (B3 recommendation) — needs its own
  bundle; STORE owner allowlist: js/store.js + a new dedicated test.
- No merge, no deploy. PR #2 remains draft. Host acceptance remains NOT
  RUN. Codex independent inspection of this frozen commit is the next gate.
