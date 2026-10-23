# V12 Execution Record — Adoption Eligibility Aligned With Strict Import (Jobs)

Date: 2026-10-22. Branch: `codex/v5-review` (draft PR #2). Base: V11 head
`2eaa5268afc91d13df872bb709dec8179e9f2f94`. Frozen commit:
`93f67619db53bd43f1b10a81d4bbfad772caa807`.

Preliminary: Codex's source review at the base 2eaa5268 confirmed the V11
block: the original native Chrome repro (BC null -> export-before-save ->
exact reimport) now passes — jobs partitioned, quarantine retained,
`committed:true`. Codex's full independent Chrome gate on V11 was still
running when this bundle was issued. The same review found the defect
below; this record is its correction.

## The defect (Codex V12 review, native Chrome repro)

Raw disk `jobs=[{id:"orphan"}]`, revision++, BroadcastChannel sync.
`getData().jobs` kept the orphan and export kept it, but the exact
downloaded file failed reimport: `committed:false`,
`Invalid import: jobs[0] missing required fields.` The adoption
partition (`isAdoptableEntry`) checked only non-null non-array object
shape, while strict import additionally requires truthy `id` and `title`
for jobs entries. An adoption-repaired backup was therefore still not
roundtrippable for object-shape failures. Native repro/log retained by
Codex.

## A. STORE — shared jobs predicate (js/store.js)

- Fix (+17/−5, sha256
  bfe637b3a17a776b19e2724a49fa8c8e8140ae4cb22979eb3eb56cdc9e39f567).
  One shared pure predicate, `isValidJobEntry(entry)` (truthy `id` and
  truthy `title` — the only per-entry invariant beyond object shape in
  the accepted import contract), is now used by both
  `validateImportData`'s jobs loop and the adoption partition.
  `assertRecordArray` still runs first in validation and the error
  message is byte-identical; import validation was NOT loosened and its
  behavior is unchanged. `isAdoptableEntry(entry, path)` is path-aware:
  object shape first, then for `path === 'jobs'` it additionally
  requires `isValidJobEntry`. Rejected job objects land in quarantine
  verbatim as `{path:'jobs', index, value}` via the existing
  `mergeQuarantine` path. No new domain constraints were added to any
  other collection; no payload mutation was introduced for validation.
- Tests: `__tests__/store-v10-adoption.test.mjs` extended (+150/−0,
  sha256 ae750891fc3429a592bd3df2fc1660b0db334dae89d63fd5a6914e5d993a0f3c)
  with V12 sections 12–15 (21 new checks): initial load (missing title,
  missing id, empty-string title, empty-string id — verbatim quarantine
  at the original indices, valid neighbours and order, prior quarantine
  and unknown extras survive); BroadcastChannel adoption +
  export-before-save (no disk write) + exact-export strict import
  committed + clean reimport + survival through an unrelated
  save/reload/second export; save/conflict adoption (conflict rejection
  unchanged, partition on adoption, quarantine survives the next save
  verbatim); latest-disk-record export selection (V11 behavior retained,
  newer data partitioned, prior quarantine merged) + exact export
  reimport committed.
- RED on the base store.js: 55 passed / 15 failed — all 49 pre-existing
  checks passed; the 15 failures are exactly the new V12 checks, and the
  RED import failures reproduced the exact Codex error
  (`Invalid import: 'jobs[1]' missing required fields.`).
- GREEN after the fix: adoption file 70 passed / 0 failed; full
  `__tests__` set 14/14 files PASS in the lane clone; ESM check via
  `node --input-type=module --check` and a real dynamic `import()` both
  pass.

## B. QA — V11-RECOVERY-02 extended (qa/v4/recovery-browser.spec.mjs)

- Extension (+151/−25, sha256
  03a579e5fb11a2aa22b21b0053220effd9b61cba4bde67fe021acbe28a81c985).
  The case ID is unchanged, so no registration change was needed.
  `V10-RECOVERY-01` is untouched and Phase 2 (disk-newer-than-cache) is
  unchanged. Phase 1's poisoned disk record now carries, by original
  index: 0 = valid neighbour one, 1 = `null`, 2 = an object missing
  `title`, 3 = an object missing `id`, 4 = valid neighbour two.
- Sequence preserved: BroadcastChannel adoption first (adopted jobs must
  be exactly the two valid neighbours in order), export BEFORE any save
  or re-init, exported quarantine exactly
  `[{jobs,1,null},{jobs,2,<missing-title object>},{jobs,3,<missing-id object>}]`
  with original values. The exact export imports into an isolated clean
  context (`committed:true`, data/order match, disk-record quarantine
  deep-equal); there an unrelated save, a reload, and a second export
  must all preserve the valid data and the full quarantine, and the
  second export re-imports `committed:true` into a third isolated clean
  context. Zero-pageerror assertions kept in every context.
- RED on base 2eaa5268 (standalone spec, exit 1; runtime node v24.20.0,
  Chromium 156.0.8078.4, runId v12-laneB-red-1792673622):
  `V10-RECOVERY-01` PASS; `V11-RECOVERY-02` FAIL — adopted and exported
  jobs retained the malformed objects, and the exact-export import
  returned `committed:false` with
  `Invalid import: 'jobs[1]' missing required fields.`
- GREEN with the repaired store overlaid temporarily (standalone spec,
  exit 0, runId v12-laneB-green-1792673660): both cases PASS. The overlay
  was reverted afterwards; the lane clone's only modification is the
  spec file.

## C. Read-only contract audit (no repo writes)

- A boundary matrix was executed against the real `js/store.js` at
  2eaa5268 (Node v24.20.0, V10 harness mocks): 158 probes, 0 harness
  throws. For each case, strict import acceptance, stored-record
  adoption outcome, and the exact export -> import roundtrip were
  compared across all 13 collection paths (goals, places, jobs,
  investments, habits, indicators, college.timetable/assignments/
  exams/fees, news.sources/cache/manual), both group values, the root
  `data` value, and `metadata`. Export wrote to disk in 0/158 probes.
- Result: exactly ONE roundtrip-failure class — jobs entries failing
  the id/title invariant (11 probes, all variants: missing id, missing
  title, `{}`, empty-string/null/zero id or title, orphan beside a
  valid neighbour, and via the BroadcastChannel adoption entry point).
  That class is the defect fixed in section A. No other path produced
  a roundtrip failure.
- Four acceptance gaps were recorded (report-only; every affected
  roundtrip still commits, so none is a roundtrip failure and none was
  fixed in V12): AG-1 `goals.history` — import coerces a non-array or
  missing history to `[]` while adoption preserves the raw value, so a
  roundtrip silently rewrites it; AG-2 `places` ids — import runs
  `migratePlaces` (legacy init and import only) and mints a generated
  id, while adoption/export keep the raw id, so a restore can change a
  place's id; AG-3 `metadata` — a non-object metadata value commits to
  disk verbatim on import while memory already shows the repaired
  `{}`, so the disk record is only repaired on the next reload; AG-4
  sparse records (minor) — adoption defaults missing collections in
  memory but export omits the keys until import materialises them.
  One extras-only note (N-1): adoption adds a `metadata` quarantine
  entry for `metadata:null` that the import path never creates.
  91 probes were by-design repairs (import rejects outright, adoption
  partitions to quarantine, repaired export re-imports and commits);
  22 probes were full agreements. Investments, habits, indicators and
  all seven college/news subcollections showed no disagreement beyond
  by-design repair.
- Audit deliverables are held by the coordinator (script, report, and
  results JSON under `codex-v12-20261022/audit/`; report sha256
  a383e6a1bd792dbdd74eba9d41938237125fab8150888d9a046f1df7cd1c9a81).
  The audit clone was verified unmodified. Scope limits: the legacy
  localStorage branch was cited from source only, save-conflict
  adoption was not separately executed (same `syncFromRecord` funnel
  as the two executed entry points), and the audit ran under Node
  mocks — host acceptance remains NOT RUN.

## Frozen gate (fresh clone at 93f6761, local)

- All three published file hashes verified in the clone before the run.
- Setup: `npm ci` in `qa/v4`. Command:
  `node scripts/run-review-tests.mjs <frozen> --commit 93f67619db53bd43f1b10a81d4bbfad772caa807`.
- Gate exit 0. Lane tests 14/14 files PASS. Browser report
  (schemaVersion 2, runId ada71efc-37c2-4fde-b4e3-b5b54f7db91c,
  generatedAt 2026-10-22T13:02:45.741Z, runtime
  `node v24.20.0; browser Chromium 156.0.8078.4 (QA_BROWSER=chromium)`):
  28/28 cases PASS — the 27 required (including the extended
  `V11-RECOVERY-02`) plus extra `TEST-STORE-005`.
- Negative checks: 17/17, exit 0.
- Coordinator-held evidence under `codex-v12-20261022/gate/`:
  `gate-output-v12.txt` sha256
  bc328e7ae33e46392bf78517ab65cb325fce6892c514e9d744d4c7edaf14e2d0;
  `browser-results-v12.json` sha256
  626a1d54e3f9b31a1c5378aca8d047a30a9138272858f74ec99b3964a7f70159;
  `negative-v12.txt` sha256
  2365a3055fdc06b1f83dce49f5e7d6337b45cda661d6ac0ef50380f9e5760f30.
- The assembly-tree gate before publication also passed (exit 0, 14/14
  lane files, 28/28 browser cases, 17/17 negative, runId
  79d8058e-e924-492f-8a78-e6d8726408e4).

## Status

- V12 is a local frozen correction only. It is NOT independent
  acceptance: Codex inspection of `93f6761` is the next gate, and Codex's
  full independent Chrome gate on V11 was still running when this
  bundle was issued.
- Host acceptance: NOT RUN. PR #2 remains draft. No merge, no deploy.
- The prior passes (V10 independent PASS, V11 local PASS, the original
  V11 repro now passing) and the RED evidence above are preserved as
  historical.
- Remaining known items, unchanged: the acceptance gaps AG-1..AG-4 and
  note N-1 from the contract audit (report-only in V12); the backend
  delete-vs-wire decision (user); FEEDS-v3 session
  10139058434333404787 stays parked as evidence.
