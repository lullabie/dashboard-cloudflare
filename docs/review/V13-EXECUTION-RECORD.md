# V13 Execution Record — AG-2 places runtime defect repair

Bundle: CODEX V13 (issue #1 comment 6342745526). Base: b99a1aa9 (V12 + evidence).
Frozen commit: 32894b36824470f4f3ba7be7d086fa34cf418a4b on codex/v5-review.
Status: local frozen gate PASS. Host acceptance NOT RUN. No merge, no deploy. PR #2 stays draft.

## Defect

Codex reproduced in installed Chrome on V12 code: a native disk place with no
id is adopted unchanged; a later savePlace edit of that place creates a second
record (count 1 -> 2). The earlier AG-2 classification ("intended
normalization", based on the source deliberately minting ids at import) is
superseded: behavior is not product intent merely because the source performs
it deliberately. Lane B's RED added one more consequence: delete by a
duplicated id removes every record sharing that id, including a valid
neighbour.

## Lane A — STORE (js/store.js +131/-6, sha256 113e97ed…)

- partitionAdoptedData now runs the existing migratePlaces on the partitioned
  places (repairAdoptedPlaceIds): ids failing isValidId and later duplicates
  are minted in the existing format; valid unique ids, count, order, and all
  other fields untouched. The migration runs on copies; the adopted record's
  objects are not mutated (export stays read-only).
- Provenance: each replaced id appends { path:'places', index:<raw index>,
  value:<original object verbatim> } to the quarantine via the existing
  mergeQuarantine helpers; prior quarantine and unknown extras preserved.
- Durable persistence: initial load persists inside the init transaction as
  before. BroadcastChannel/conflict adoption has no transaction, so when an
  adoption minted ids, persistAdoptionRepair writes the adopted partition
  exactly once, guarded: inside a readwrite transaction it re-reads the record
  and writes only if the disk record is still the exact adopted record (same
  generation and revision, both kept). A newer writer's record is never
  clobbered. The repaired record mints nothing on later adoptions, so the
  write cannot loop. Revision is kept (restorative write, not a new user
  revision; every holder of the token already holds repaired data).
- CAS invariant: currentData is populated only through the repairing funnel,
  so no getData() snapshot carries a malformed place id; a snapshot minted
  before a repair adoption holds the pre-adoption token and saveData's CAS
  rejects it. Proven in tests, including the Codex edit-as-create repro and
  the persisted-repair path.
- Import behavior unchanged. migratePlaces, isValidId, the mint format, and
  all validation unchanged.

Tests (__tests__/store-v10-adoption.test.mjs +319/-0, sha256 52e3bbf1…,
sections 16–23, 38 new checks): RED vs base store 84 passed / 24 failed (all
failures the V13 checks); RED vs repair-only store (persist hook disabled —
the configuration Lane B's phases 4–5 caught) 103/5, failures exactly the
durability/stability checks; GREEN final 108/0, stable across 3 runs; full
__tests__ 14/14 files; ESM check via node --input-type=module --check and a
real dynamic import PASS.

## Lane B — QA (qa/v4/places-browser.spec.mjs, new, 661 lines, sha256 f2b26f8b…)

Case V13-PLACES-01: poisoned load (valid neighbour, missing id, duplicate id,
invalid short id) repaired at adoption with exactly three provenance entries
on the durable record; edit of the formerly id-less place updates one record;
delete by repaired id removes exactly that record; a cross-tab raw poisoned
append is adopted repaired, persisted, and provenance merged; after reload the
ids are byte-identical, export carries them, and the exact export imports
committed:true into a clean context with the same ids and provenance on disk.

RED on the V12 store (runId v13-laneB-red-1792678658): unrepaired ids, edit
count 4 -> 5, delete by duplicate id also removed the valid neighbour, no
provenance. GREEN attempt on the repair-only store: phases 1–3 PASS, phases
4–5 FAIL (BC repair not persisted; reload re-minted a different id) — the
evidence that produced Lane A Part 2. Final GREEN on the frozen store: PASS.

## Lane E — registration (27 -> 28 required ids)

'V13-PLACES-01' added after 'V11-RECOVERY-02' in
scripts/write-browser-results.mjs (sha256 5f5c09eb…),
qa/v4/result-schema.json (0e700f2e…), and qa/v4/result-schema.md (3bf5077e…)
with a V13 section. Writer/schema sets program-verified identical in content
and order (28/28). Negative checks in the lane clone: 17/17.

## Assembly and frozen gate

Assembly gate on the uncommitted tree (base label b99a1aa9): exit 0, lane
14/14, 28 required browser cases PASS, negative 17/17. Published file-by-file
(six commits: f0487f1 store, 15ea84b tests, 8b4ff66 spec, 7d2615a writer,
7202c39 schema json, 32894b3 schema doc), every read-back sha256 matched.

Frozen gate, fresh clone at 32894b36824470f4f3ba7be7d086fa34cf418a4b:
exit 0; lane tests 14/14 files; browser 29 total / 28 required PASS
(V13-PLACES-01 PASS); negative checks 17/17. Browser report: schemaVersion 2,
runId 0447a66c-cb1f-4a73-9718-bf6fe20c2690, generatedAt
2026-10-22T14:35:59.227Z, runtime "node v24.20.0; browser Chromium
156.0.8078.4 (QA_BROWSER=chromium)". Gate evidence retained with the
coordinator (gate-output-v13.txt sha256 a61056f7…, browser-results-v13.json
2827a0eb…, negative-v13.txt 44606e23…).

## Scope notes

AG-1 (goals.history coercion) and AG-3 (metadata representation) stay
report-only; no blanket normalization rewrite. AG-4 is not a repair target.
No merge, deploy, resources, billing, features, or schedule changes.
