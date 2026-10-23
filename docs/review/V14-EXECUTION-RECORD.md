# V14 Execution Record — Transactional Repair Authority for Place-ID Adoption

Branch: `codex/v5-review`
Base commit: `41776d95239300443291a1b98a46fd2ade7a6803` (head after the V13 record)
Frozen commit: `0c2d779b610c3a143642571e4df3c13c5b3d4ee0`
Frozen gate: local gate PASS (see Gate section). Host acceptance: NOT RUN.
Release status: NOT shippable. No merge, no deploy. PR #2 remains draft.

## Why this bundle exists — and a claim withdrawn

Codex's V14 review reproduced, 3/3 in installed Chrome 155 with
native IndexedDB/BroadcastChannel and no mocks, a real cross-tab
race in the V13 repair at 41776d9: two tabs adopt the same poisoned
record simultaneously and independently mint DIFFERENT place ids
under the same generation/revision; the disk settles on one winner,
but a tracked snapshot captured from the losing tab during adoption
then saves with committed success and overwrites the winner's
identity.

The coordinator's V13 record stated the CAS invariant as proven.
That claim is WITHDRAWN for simultaneous adopters. The justification
it rested on — "every holder of the token already holds repaired
data" — is true but insufficient: two holders of one token hold
DIFFERENT repairs, and same-revision CAS cannot distinguish them.
The V13 stale-snapshot test also never exercised the race, because
it changed the revision before snapshotting. V14 makes the
invariant true by construction instead of by assumption.

## Defect

- Trigger: a raw disk record whose `places` contains an entry with
  no id (Codex's fixture: `[{title:"Race", lat:43, lng:-79}]`,
  revision incremented) is delivered to two loaded tabs by
  BroadcastChannel sync.
- V13 behavior: each tab's adoption mints its own id; the guarded
  persistence settles the disk on one tab's mint, but the other
  tab's tracked snapshot carries the same generation/revision
  token, so its later `saveData` CAS-succeeds and silently
  replaces the winner's id.
- Reproduced independently by the QA lane in Chromium (below).

## Repair (js/store.js, one owner)

`persistAdoptionRepair` is replaced by `claimAdoptionRepair`,
fired from `syncFromRecord` whenever an adoption mints place ids:

1. Transactional claim. In ONE readwrite transaction the tab
   re-reads the record. If the disk record is still the exact
   adopted record (same generation AND revision), it writes the
   repaired record with the revision ADVANCED BY 1 — a repair
   changes persisted data, so it advances the CAS identity — and
   then adopts exactly what it wrote as its canonical state. If
   the disk record has advanced, it writes nothing and adopts the
   disk record through the normal funnel (if that record still
   needs repair, its adoption claims in turn).
2. Speculative exposure control. Until the claim settles, the tab
   keeps the adopted record's revision, so every `getData()`
   snapshot captured in the window carries the pre-claim token.
   Once a winner lands, the disk revision has advanced, so every
   competing speculative snapshot CAS-fails in `saveData` and
   conflict-adopts the canonical winner. No token ever pairs a
   speculative mint with the post-repair revision.
3. Serialization. Readwrite transactions on the same store
   serialize, so exactly one claim observes the adopted revision
   and wins; the loser adopts the winner. Provenance converges:
   both tabs mint the identical `{path:'places', index, value}`
   entry for the same original object, quarantine merge dedupes
   by key, and the canonical record carries each entry once.
4. Initial load needs no claim: `initStore` reads and repairs
   inside the SAME readwrite transaction, so simultaneous inits
   serialize and a later init reads the first init's repaired
   record; no speculative state exists, and the record keeps its
   revision.
5. Residual window, analyzed and accepted: a speculative snapshot
   saved BEFORE any claim lands (disk still at the adopted
   revision) commits as an ordinary CAS save; that save becomes
   the canonical state and the other tab's claim then adopts it.
   No established winner exists at that moment, so nothing
   canonical is overwritten and convergence is preserved. Any
   save after a claim lands CAS-fails; any claim after a save
   lands adopts the saved record.
6. One designed consequence, named plainly: a snapshot captured
   inside the claim window — including the adopting tab's own —
   CAS-fails once the claim lands, even in the single-adopter
   case. The conflict path preserves the draft and a
   fresh-snapshot retry commits (proven in the tests). Rebinding
   outstanding snapshots to the new token was rejected: snapshots
   are mutable user drafts, and rebinding would let an edited
   draft overwrite a canonical record without the conflict check.
7. Scope boundary (pre-existing, unchanged): the CAS contract
   covers store-mediated writers; a raw writer that forges a
   duplicate generation/revision pair with a different body is
   outside it.

Preserved: the sync `getData()` tracked-snapshot contract,
pending-save and degraded-mode gates, all validation, import
behavior, valid ids, provenance, unknown extras keys, and the
nonblocking post-claim BroadcastChannel notification (the
canonical record mints nothing, so the claim cannot loop).

Four pre-existing test assertions were adapted to the new revision
semantics, each justified in a test comment: section 19 lets the
conflict adoption's claim settle before the follow-up snapshot;
section 20 expects disk revision 3 (the claim advanced 2 → 3)
after the stale-save rejection; section 21 expects the revision
advanced by exactly 1 with the exactly-once write count unchanged;
section 23 now expects a superseded claim to adopt the
authoritative disk record — V13's memory-keeps-divergent-repair
semantics are exactly what V14 removes — with the disk-untouched
assertion unchanged.

## Tests

- `__tests__/store-v10-adoption.test.mjs` (+166/−3, sections
  through 24): RED against the unmodified 41776d9 store — 110
  passed / 12 failed, the failures exactly the V14 semantics,
  including the defect itself (the losing tab's window snapshot
  save committed and overwrote the winner). GREEN on the repaired
  store: 122/122, stable across 3 runs; full `__tests__`
  directory 14/14 files; ESM check via
  `node --input-type=module --check` plus a real import.
  New checks cover: different mints pre-settle; snapshots captured
  from both instances in the window; one canonical winner; disk
  revision advanced by exactly 1; provenance exactly once; loser
  window save rejected with the disk byte-unchanged; loser adopted
  the winner; the winner's own window snapshot also CAS-fails;
  loser edit retried on a fresh snapshot commits preserving the
  winner id and provenance; winner post-settle save commits;
  reload keeps canonical ids on both tabs.
- `qa/v4/places-browser.spec.mjs` (+303/−2): case
  `V13-PLACES-01` extended in place with phases 6–8 (no new case
  ID, so no registration change). Two pages share one browser
  context (native IndexedDB + BroadcastChannel); in-page barriers
  capture each page's minted id and a tracked snapshot the tick
  the race place first appears; the settle, loser-save,
  disk-verification, edit-retry, reload, and export assertions
  follow Codex's ordered list. RED on the V13 store (runId
  `v14-laneB-red-1792684072`, Chromium 156.0.8078.4): the barriers
  captured two different mints under the shared token; the loser
  save resolved `{committed:true, conflict:false}` and the
  durable id became the loser's mint `place_1792684081009_…` over
  the canonical `place_1792684081011_…` — the exact Codex defect.
  GREEN on the repaired store (runId `v14-laneB-green-1792684130`):
  PASS, all 8 phases. Pre-existing phases 1–5 collected no defects
  in either run.

## Published commits (each read back and sha256-verified)

- `f8074d8` — js/store.js — sha256
  `7f77e9effc6556c1e27e995da5db3835bb6da40564241cad7a7a669a5578dd95`
  (+113/−30)
- `ab32335` — __tests__/store-v10-adoption.test.mjs — sha256
  `0fc536e12d8f11f2304c0cb24ea512668f3018776f4d2b555f905485b8ff0d85`
  (+166/−3)
- `0c2d779` — qa/v4/places-browser.spec.mjs — sha256
  `fdac26b3bc3e4f4b0528593bdc3671eb2a5a90fd182a329b8a44c3bf0fded52e`
  (+303/−2) — FROZEN COMMIT

## Gate (frozen commit 0c2d779, fresh clone)

- Command: `QA_BROWSER=chromium node scripts/run-review-tests.mjs`
  plus `node scripts/run-negative-checks.mjs`.
- Node lane: 14/14 files PASS.
- Browser: 29 total cases, 28 required — all PASS, including the
  extended `V13-PLACES-01`.
- Negative checks: 17/17.
- Report: schemaVersion 2, runId
  `a1e5562e-97a1-475a-a10c-fc70a920a199`, generatedAt
  `2026-10-22T16:03:22.095Z`, runtime `node v24.20.0; browser
  Chromium 156.0.8078.4 (QA_BROWSER=chromium)`.
- This sandbox has no installed Chrome binary; the gate above ran
  on the QA Chromium build. Codex's independent gate on installed
  Chrome remains the installed-Chrome evidence for this bundle,
  as in prior bundles.
- Raw gate artifacts (sha256): gate output
  `0a308697afcd078658bb26806e13a8821499b632d6d97080c299712d723758ad`,
  browser results
  `0491ad5cc15a6e6c28a1bdd2ade5f32d1109ac7e3efbab6bf82203b6ffdcc198`,
  negative output
  `3341619adef33810076a293fc8434ab032c4b12c6949d92316a8f8cfc1e157af`.
  (Retained in the coordinator's V14 working set; publication
  under `docs/review/evidence/v14/` can follow the V13 pattern.)

## Also published in this bundle (Codex's concurrent evidence item)

The raw V13 gate artifacts under `docs/review/evidence/v13/`,
byte-identical to the V13 record's values (each read back and
sha256-verified): `gate-output-v13.txt` (`a61056f7…`),
`browser-results-v13.json` (`2827a0eb…`), `negative-v13.txt`
(`44606e23…`). The browser-results header confirms testedCommit
`32894b36…` and runId `0447a66c…`.
