# V12 Lane C — Contract audit report (read-only)

Source: dashboard repo clone `codex-v12-20261022/v12-audit` at commit
`2eaa5268afc91d13df872bb709dec8179e9f2f94` · subject `js/store.js` (736 lines) ·
executed 2026-10-22 · runtime Node v24.20.0, harness mocks copied from
`__tests__/store-v10-adoption.test.mjs` (fake IndexedDB / BroadcastChannel /
FileReader, `[MOCK]` class evidence — no real browser, no host run).

Method. One scratch script (`audit-contract.mjs`, same folder) imports the
real `js/store.js` fresh per leg (cache-busted module instances) and executes,
for every case, three behaviours against the real code:

- (a) strict import acceptance — public `importData` path on a clean record;
  observed: committed flag, error text, disk data after import, in-memory
  `getData()` after import, and both again after a reload (`initStore`).
- (b) stored-record adoption — `initStore` on a record seeded with the case
  input; observed: exposed `getData()` value, disk data after the init repair,
  disk quarantine, then `exportData()` output (exported value, exported
  quarantine, exported data keys) and a check that export wrote nothing to disk.
- (c) roundtrip — the exact exported text from (b) imported into a second
  fresh clean instance; observed: committed flag, error text, resulting data
  and disk quarantine.

Full machine-readable evidence: `audit-results.json` (same folder).

## Matrix summary — 158 probes executed, 0 harness throws

| Family | Cases | Probes |
|---|---|---|
| F1 entry shape (null / number / string / array / `{}` entry beside a valid neighbour) × 13 collection paths | 5 × 13 | 65 |
| F3 collection value (null / non-array string / missing) × 13 collection paths | 3 × 13 | 39 |
| F2 jobs required-field variants (missing / empty-string / null / zero id or title, plus truthy controls) | 11 | 11 |
| F4 goals `history` variants (string / number / null / object / missing / controls) | 7 | 7 |
| F5 college / news group value (null / string / array / missing) + non-array subcollection object | 10 | 10 |
| F6 metadata variants (missing / `{}` / null / string / number / array / true) | 7 | 7 |
| F7 root data value (null / string / array / number / missing) | 5 | 5 |
| F8 places id variants (missing / short / numeric / duplicate / controls) | 6 | 6 |
| F9 unknown extra keys (top level, college group, news group, inside a goal entry) | 4 | 4 |
| F10 sparse shapes (empty data object, empty college object, empty news object) | 3 | 3 |
| F11 BroadcastChannel adoption spot-check (jobs orphan, ready tab) | 1 | 1 |

Collection paths covered (13): `goals`, `places`, `jobs`, `investments`,
`habits`, `indicators`, `college.timetable`, `college.assignments`,
`college.exams`, `college.fees`, `news.sources`, `news.cache`, `news.manual`;
plus the `college` and `news` group values, the root `data` value, and
`metadata`.

Outcome tally (157 matrix probes + 1 BC spot-check):

- ROUNDTRIP FAILURE: 11 probes — one class, one path (`jobs`). Finding RT-1.
- ACCEPTANCE GAP: 34 probes in 4 findings (AG-1 to AG-4). One further probe
  (`metadata: null`) agrees on data and differs only in extras — note N-1;
  it is counted inside the agreement tally below, not in the 34.
- BY-DESIGN REPAIR: 91 probes. Adoption repairs what import rejects; every
  repaired export re-imported and committed. Listed briefly in section 3.
- Full agreement (import, adoption, export and roundtrip all produce the same
  relevant shape, stable across reload): 22 probes, including all controls.

Invariants observed in all 158 probes: adoption `initStore` returned `ready`;
`exportData` never wrote to disk; no probe threw outside the module's own
import-error path.

## 1. ROUNDTRIP FAILURE

### RT-1 — `jobs`: adoption keeps object entries that strict import rejects for missing/falsy `id` or `title`; the adoption-repaired export then fails its own import

- Responsible code: adoption predicate `isAdoptableEntry` (`js/store.js`
  L181) accepts any non-null, non-array object for every collection.
  `partitionAdoptedData` (L232) applies it uniformly. Strict import
  `validateImportData` (L82) adds a per-entry rule for `jobs` only, at L98:
  `if (!jobs[i].id || !jobs[i].title)` throws
  `Invalid import: 'jobs[i]' missing required fields.` No other collection
  has a required-field rule in `validateImportData`.
- Executed variants (10 matrix cases; in each, (a) import rejected with the
  error above, (b) adoption exposed the entry unchanged with no quarantine
  entry, (c) the exact export returned `committed:false` with the same error):
  - `jobs: [{id:"orphan"}]` — missing title (the Codex V12 repro input).
  - `jobs: [{title:"No Id Job"}]` — missing id.
  - `jobs: [{}]` — both missing (also reached as the F1 `{}` entry case,
    exported as `[{id:"job-ok",title:"OK Job"},{}]`, import failed at
    `jobs[1]`).
  - `jobs: [{id:"",title:"T"}]`, `jobs: [{id:"job-x",title:""}]` — empty string.
  - `jobs: [{id:null,title:"T"}]`, `jobs: [{id:"job-x",title:null}]` — null.
  - `jobs: [{id:0,title:"T"}]`, `jobs: [{id:"job-x",title:0}]` — zero.
  - `jobs: [{id:"job-ok",title:"OK Job"},{id:"orphan"}]` — valid neighbour
    does not save the export; import failed at `jobs[1]`.
- Second adoption entry point executed (F11): a ready tab adopted
  `jobs:[{id:"orphan"}]` via BroadcastChannel sync (`bc_memJobs` =
  `[{id:"orphan"}]`, exported jobs identical, exported quarantine `null`);
  the exact export then failed import with the same error. Initial load and
  BroadcastChannel adoption therefore produce the same failure, as expected
  from the single funnel `syncFromRecord` (L298).
- Boundary controls executed and in full agreement on all three behaviours:
  `jobs: [{id:123,title:"T"}]` (truthy non-string id commits everywhere) and
  `jobs: [{id:"job-x",title:"T",extra:"e"}]`. The accepted import contract is
  truthiness of `id` and `title`, not string type.
- Fix direction (one line): make the adoption predicate for `jobs` reuse the
  same truthy `id`+`title` test as `validateImportData` L98, quarantining
  failing entries with their original value, path and index.
- No other collection path produced a roundtrip failure in 157 matrix probes.
  The class is exactly: an import invariant stricter than
  `isAdoptableEntry` exists only for `jobs`.

## 2. ACCEPTANCE GAP

### AG-1 — `goals`: import coerces a non-array or missing `history` to `[]`; adoption preserves the raw value

- Responsible code: `validateImportData` L91–92 mutates each goal in place:
  `if (!Array.isArray(goals[i].history)) goals[i].history = [];`.
  `partitionAdoptedData` never touches entry fields.
- Executed evidence (5 variants: `history` = `"bad-history"`, `42`, `null`,
  `{note:"x"}`, and missing): (a) import committed with disk and memory
  history `[]`; (b) adoption exposed the raw history unchanged and exported
  it unchanged; (c) the export committed, but the re-imported goal's history
  became `[]` — the roundtrip silently rewrites the field.
- Same effect on a plain object entry: the F1 case `goals: [valid, {}]`
  roundtripped to `[valid, {history:[]}]`. Any adopted goal without an array
  `history` — including an otherwise valid one — diverges from the shape the
  import path stores.

### AG-2 — `places`: import migrates invalid, missing or duplicate ids to a generated id; adoption keeps the raw id

- Responsible code: `migratePlaces` (L270) rewrites any id that fails
  `isValidId` (string, `place_` prefix, length > 10) or duplicates an earlier
  id. It is called in exactly two places: the legacy localStorage branch of
  `initStore` (L342) and `importData` after validation (L626). It is never
  called by `syncFromRecord` (L298), `repairAdoptedRecord` (L259) or
  `exportData` (L533), so adoption and export never migrate.
- Executed evidence (4 variants + 1 entry case): (a) import committed with a
  generated `place_<timestamp>_<random>` id on disk and in memory for inputs
  `[{title:"No id place"}]`, `[{id:"short",…}]`, `[{id:12345,…}]`, and for the
  second entry of a duplicate-id pair; (b) adoption exposed and exported the
  raw ids unchanged (`"short"`, `12345`, missing, duplicated); (c) each
  export committed, but the import minted a new generated id — the stored id
  after a backup/restore differs from the id in the backup.
- Controls in full agreement: a single place with id `place_1234567890`,
  with or without an extra entry key.

### AG-3 — `metadata`: import commits truthy non-object values to disk that its own adoption funnel immediately disowns

- Responsible code: `validateImportData` contains no `metadata` check at
  all, and `normalizeImportData` L151 only replaces falsy values
  (`if (!out.metadata) out.metadata = {};`), so a truthy string, number,
  array or boolean is stored verbatim. `partitionAdoptedData` L242–247
  quarantines any non-object or array `metadata` at
  `{path:"metadata", index:-1}` and exposes `{}`.
- Executed evidence (4 variants: `"meta-string"`, `42`, `[1,2]`, `true`):
  (a) import committed; the disk record held the raw value while the
  post-import `getData()` already showed `{}` (the import's own
  `syncFromRecord` partitioned memory only); after a reload the disk was
  rewritten to `{}` and the quarantine entry appeared. (b) Pure adoption of
  the same input exposed `{}` and repaired the disk, with quarantine, at
  init. The divergence is therefore disk-level: an import-committed record
  and an adoption-repaired record for identical input differ until the next
  reload. (c) The adoption-repaired export (`metadata: {}`) committed
  cleanly, so this is a gap, not a roundtrip failure.

### AG-4 — Sparse records (minor): adoption leaves missing collections out of the disk record and the export; import materialises them

- Responsible code: `partitionAdoptedData` fills missing collections in the
  in-memory copy but reports `changed:false` when nothing was malformed, so
  `repairAdoptedRecord` returns null and neither init nor `exportData`
  writes the filled shape back. `normalizeImportData` (L139) always
  materialises missing keys on import.
- Executed evidence (19 probes: each of the 13 collection paths missing
  individually, `college` missing, `news` missing, `metadata` missing, and
  the three F10 sparse objects): (b) `getData()` showed the defaulted
  `[]` / `{}` while the exported envelope omitted the key entirely (for
  `data: {}` the exported data had zero keys); (a) import of the same sparse
  input committed with the key present on disk; (c) every sparse export
  committed and materialised the defaults. Semantically equivalent after
  normalisation, but the exported shape differs from both the in-memory
  snapshot and the import-stored shape.

### N-1 — Minor, extras only: `metadata: null`

Data agrees everywhere (`{}` in memory, on disk, in export, after
roundtrip). Adoption additionally records a quarantine entry
`{path:"metadata", index:-1, value:null}` (L244) that the import path never
creates for the same input; the entry then travels through export and
re-import. No data loss or failure observed.

## 3. BY-DESIGN REPAIR — 91 probes, no defect

Adoption repairs what strict import rejects outright; in every case the
repaired export re-imported and committed (`committed:true`). Quarantine
entries carried the original path, index and raw value. Groups:

- F1 malformed entries (52 probes): a `null`, number, string or array entry
  beside a valid neighbour, in each of the 13 collection paths. Import
  rejected with `'<path>[1]' must be an object.`; adoption quarantined the
  entry at its index and kept the neighbour; roundtrip committed.
- F3 collection values (26 probes): a collection set to `null` or to a
  non-array string, in each of the 13 paths. Import rejected
  (`top-level collections cannot be null.` / `'<path>' must be an array.` /
  the college/news null messages); adoption quarantined the raw value at
  `index:-1`, exposed `[]`, roundtrip committed.
- F5 group values (8 probes): `college` or `news` set to `null`, a string,
  an array, or a non-array object in one subcollection. Import rejected;
  adoption quarantined at the group or subcollection path and exposed empty
  arrays; roundtrip committed.
- F7 root values (5 probes): `data` = `null`, `"raw-string"`, `[1,2]`, `42`,
  or absent. Import rejected with `payload must be an object.`; adoption
  recovered to the default empty dataset and quarantined the raw value at
  `{path:"data", index:-1}` (absent root: recovery with no quarantine
  entry); roundtrip committed.

## 4. No disagreement — paths and cases executed

- `investments`, `habits`, `indicators`: all 8 executed variants each
  (5 entry shapes, 3 collection values) agree or are by-design repair; a `{}`
  entry is accepted identically by import, adoption, export and roundtrip.
  No required-field rule exists for these paths in either behaviour.
- `college.timetable`, `college.assignments`, `college.exams`, `college.fees`,
  `news.sources`, `news.cache`, `news.manual`: same result as the group
  above; no per-entry field rule exists beyond object shape, and adoption
  enforces that shape.
- `goals`: no disagreement except AG-1 (`history` handling) and the
  by-design entry/collection repairs. A goal with an array `history`
  (control `["2026-01-01"]`) agreed on all three behaviours.
- `places`: no disagreement except AG-2 (id migration). Valid-id controls
  agreed on all three behaviours.
- `jobs`: no disagreement except RT-1. Truthy-field controls, including a
  numeric id and an extra entry key, agreed on all three behaviours.
- `metadata`: object values (`{}` control) agreed; divergences are AG-3,
  AG-4 (missing) and N-1 (null) only.
- Unknown extra keys (F9, 4 probes): a top-level data key, a key inside the
  `college` group, a key inside the `news` group, and a key inside a goal
  entry were preserved identically by import, adoption, export and
  roundtrip. No disagreement.
- Root and group shapes not listed in sections 1–2 produced only the
  by-design repairs of section 3.

## 5. Scope limits

- The legacy localStorage branch of `initStore` (L342–345) was not executed;
  it is a fourth code path outside the three assigned behaviours. Its
  `migratePlaces` and `validateImportData` call sites are cited in AG-2 from
  source only.
- Save-conflict adoption was not executed as a separate entry point; it
  funnels through the same `syncFromRecord` (L298) as the two executed entry
  points (initial load, BroadcastChannel). The V10/V11 suites cover the
  conflict path itself.
- Records are JSON-shaped by construction in this harness. Circular or
  otherwise non-serialisable stored values were not probed.
- This audit ran under Node mocks, not a real browser. It makes no claim
  about host acceptance, which remains NOT RUN.
