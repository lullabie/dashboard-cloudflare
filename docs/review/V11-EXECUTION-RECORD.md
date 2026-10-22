# V11 Execution Record — Export Snapshot Consistency

Date: 2026-10-22. Branch: `codex/v5-review` (draft PR #2). Base: V10 head
`c28b5019d62d2dd10fa94e06fcceb2e3b9ff0285`. Frozen commit:
`28d5ceb305d223448002f744da510d4431d506a7`.

Preliminary: Codex's independent full gate at the base c28b5019 PASSED
(installed Chrome 155.0.8059.85, Node 24.19.0: 14 Node files, 27 browser
cases including the 26 required, 17 negative checks). The prefix-coordinate
and poisoned-initial-load repros are independently fixed. That is local
suite acceptance for V10 only. The same review found the defect below;
this record is its correction.

## The defect (Codex V11 review, native Chrome repro)

After an initial clean boot, a raw IDB write sets `jobs=[null]` and bumps
the revision; a BroadcastChannel sync adopts the record. `getData().jobs`
becomes `[]` with the correct quarantine. But `exportData()` (js/store.js)
exported `record.data` — the RAW disk data, `jobs=[null]` — paired with
the merged in-memory extras carrying the correct quarantine. The backup
was internally inconsistent, and importing that exact file failed:
`committed:false`, `Invalid import: jobs[0] must be an object`. A recovery
backup could not restore. The V10 suite did not cover it: it saves before
export, and the save rewrites the disk record partitioned, masking the
raw-disk divergence.

## A. STORE — one selected snapshot, partitioned as a unit (js/store.js)

- Fix (+22/−5, sha256
  247b5206f9b1707ab634226aeb398a5d8e49dae56f60b5e81ebc3f2ac84a9e4b),
  one block inside `exportData` only. When a disk record is readable,
  that record — and only that record — is the selected snapshot: it is
  passed through the existing `repairAdoptedRecord`, which partitions
  its data with the adoption policy and merges the resulting quarantine
  into that same record's own extras (dedupe via the existing
  `mergeQuarantine`/`quarantineKey` helpers; raw rejected values and
  unknown extras keys preserved). If nothing needs partitioning, the
  record is used as-is. Exported data and exported extras therefore
  always come from one record at one revision — never raw disk data
  paired with in-memory extras, and never in-memory data paired with
  disk extras.
- Export writes nothing to disk and mutates neither the disk record,
  `currentData`, nor `envelopeExtras`; the partition works on the copy
  `repairAdoptedRecord` returns. A disk record newer than the page cache
  is exported as the latest valid disk data plus its quarantine.
- When no disk record can be read, the fallback is unchanged:
  `getData()` plus the in-memory `envelopeExtras`. Envelope shape,
  filename pattern, and strict import validation are untouched. Import
  validation was NOT loosened.
- Tests: `__tests__/store-v10-adoption.test.mjs` extended (+123 lines,
  sha256
  30cb89a423af8e5d4c3be920d1b1e9c1055db8852f67596bba87def8db9e4341)
  reusing the V10 harness (a FileReader mock was added so the exact
  export can be fed to the app's own import). New V11 sections cover:
  export with no intervening save after adoption; the exact export
  importing successfully and round-tripping data, order, and quarantine;
  disk-newer-than-cache selection; unknown-extras survival; no disk write
  during export; no-record fallback.
- RED on the base store.js: 44 passed / 5 failed — all 30 pre-existing
  V10 checks passed; the 5 failures are exactly the new V11 checks (raw
  null/42 exported; import of the exact export rejected; quarantine
  never landed on disk; newer disk data exported raw; exported
  quarantine was the stale in-memory one). GREEN after the fix: 49/49.
  Full `__tests__` set in the lane clone: 14/14 files PASS. ESM check and
  a real dynamic `import()` pass.

## B. QA — V11-RECOVERY-02 (qa/v4/recovery-browser.spec.mjs)

- Extended (+326/−4, sha256
  8ed7749b5506cd6712b076dc958536ea26f425306b9c4750b322b9d1d9b54d7f).
  `V10-RECOVERY-01` is unchanged. The new case has two phases:
  - Phase 1: clean boot; valid data committed; raw disk write
    `jobs=[job1, null, job2]` with revision bump; BroadcastChannel sync;
    adoption asserted (getData jobs exactly [job1, job2], zero
    pageerrors); export BEFORE any save or re-init; the exported file
    must carry the partitioned neighbours in order, no malformed entry
    in any collection, and quarantine exactly
    `[{path:'jobs', index:1, value:null}]`; the exact file is imported
    into a second isolated clean context — committed:true, data and
    order match, disk-record quarantine identical, and the quarantine
    survives reload and a second export.
  - Phase 2: a third context commits dataset D1, then the disk record is
    advanced to a newer-revision D2 (`goals=[null, validGoal]`, distinct
    jobs) with NO sync notification, so the page cache still holds D1;
    the export must carry D2 partitioned with quarantine exactly
    `[{path:'goals', index:0, value:null}]` — not the cached D1.
- RED on base c28b5019 (standalone, exit 1), failing only on the
  export-consistency assertions: phase 1 exported jobs contained the raw
  null; the exact-export import failed with
  `Invalid import: 'jobs[1]' must be an object.`; phase 2 exported the
  newer disk data raw (`[null, validGoal]`). All mechanics (adoption,
  download capture, stale-cache setup) passed before those assertions.
  `V10-RECOVERY-01` PASS in the same run.

## C. Gate registration

- `scripts/write-browser-results.mjs` (sha256
  54771865c01c37dea34b212bccd1a3397b3c70388fdda94ec54b1ebe41e5ba2a),
  `qa/v4/result-schema.json` (sha256
  30b8eb1cd711b05fce38de45e0f99bbc307aad80e5569ebc7f45b19691e560dd),
  `qa/v4/result-schema.md` (sha256
  7f9cf2294e39e02bde633e6c607c7f86f8ff2d5052259b363df447ccaff75c2a):
  `V11-RECOVERY-02` is required case 27, immediately after
  `V10-RECOVERY-01`. Writer and schema sets identical in order and
  content (programmatically verified). Negative checks in the lane
  clone: 17/17.

## Assembly gate — local, uncommitted tree on the base label

- Exit 0. Lane tests 14/14 files PASS. Browser report runId
  a49fdee5-1591-431d-91a4-5a07e1bf5edc: 28 cases, 28 PASS. Negative
  checks 17/17. Integration evidence only, not frozen-commit evidence.

## Frozen gate — local, Chromium

- Fresh clone of the branch head; frozen commit
  `28d5ceb305d223448002f744da510d4431d506a7`. All 6 published V11 files
  verified by sha256 in the clone before the run.
- Setup: `npm ci` in qa/v4. Command:
  `node scripts/run-review-tests.mjs --commit 28d5ceb305d223448002f744da510d4431d506a7`
  with the default selection (QA_BROWSER unset → chromium).
- Runtime: Node v24.20.0, Playwright 1.64.1, Chromium 156.0.8078.4
  (headless shell), local temporary origin http://127.0.0.1, isolated
  contexts, invented records.
- Result: gate exit 0. Lane tests 14/14 files PASS. Browser report
  schemaVersion 2, runId 69075362-2fc8-4204-8c3b-d4be7e4c99bb,
  generatedAt 2026-10-22T12:11:33.524Z: 28 cases, 28 PASS — the 27
  required IDs (including `V11-RECOVERY-02`) plus extra TEST-STORE-005,
  which the gate ignores. The report runtime reads
  `node v24.20.0; browser Chromium 156.0.8078.4 (QA_BROWSER=chromium)`.
- Negative checks in the frozen clone: 17/17 behaved as required.
- Coordinator-held local evidence (sha256): gate output
  4b97e726e725e008bfa7d6414aa0c2d6ece9bd510334b941c6593b86fdebfc4a,
  browser results
  6b8a4a7ce9e55893681170fb79c2c67141be2ea0a4070788ede21718dc812520,
  negative checks
  7e0902c5d2cd533eee38900c4238410735be2acf1c067fa0ddcf4f2ac11bf6b0.
- This is a local gate pass. It is not release approval and is not host
  acceptance; the gate output states this itself. The previous 27-case
  PASS set and the 17 negative checks at earlier commits remain
  historical evidence for those commits, not for this one.

## Not in V11

- No merge, no deploy. PR #2 remains draft. Host acceptance remains NOT
  RUN. Codex independent inspection of this frozen commit (installed
  Chrome, isolated contexts, actual runtime recorded) is the next gate.
