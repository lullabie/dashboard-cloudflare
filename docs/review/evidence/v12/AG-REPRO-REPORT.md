# AG Reproduction Report — V12 Contract Audit Gaps AG-1, AG-2, AG-3

Independent read-only QA reproduction. No source edits were made anywhere.

- Subject: `js/store.js` in scratch clone `v12-ag-repro`, checked out at the
  exact audit base `2eaa5268afc91d13df872bb709dec8179e9f2f94`
  (branch `codex/v5-review` head at clone time, detached at the base).
- Runtime: Node v24.20.0. Harness mocks (fake IndexedDB / BroadcastChannel /
  FileReader) copied from `__tests__/store-v10-adoption.test.mjs`, the same
  pattern Lane C used. All evidence is `[MOCK]`-class: the real module code
  executed, no real browser, no host run.
- Method per variant, on fresh module instances:
  - Leg A (import): `importData` of the case payload on a clean store.
    Observed: committed flag, disk record field, in-memory `getData()` field,
    disk quarantine. AG-3 adds an export immediately after import, then a
    reload (`initStore` again).
  - Leg B (adoption): `initStore` on a stored record seeded with the case
    data. Observed: `getData()` field, disk record after the init repair,
    disk quarantine, and the `exportData()` envelope (export performed no
    disk write in any variant: `exportWroteToDisk: false` throughout).
  - Leg C (roundtrip): the exact leg-B export imported into a fresh clean
    store. Observed: committed flag, disk record field and quarantine,
    `getData()` field, and whether the original raw value is present
    anywhere in the post-roundtrip disk record.
- Deliverables in this folder: `repro-ag.mjs` (runnable script, sha256
  d3a65938bc080bd24ee1337fc6c128b4cf6fa919b9ae027825222e2a404b9840),
  `raw-output.log` (full raw execution output, sha256
  5a967c4536ceed40f65b245e413d19cd37ee11383f703d4c6bee6baddb72db69),
  `repro-results.json` (same evidence, machine-readable).
- All three gaps reproduced as the audit described. Verdicts use only the
  three assigned classes; no gap is labelled a blocker.

---

## AG-1 — `goals.history`: import coerces a non-array or missing `history` to `[]`; adoption preserves the raw value

Deciding code:

- `validateImportData`, `js/store.js` L82; the coercion is L92:
  `if (!Array.isArray(goals[i].history)) goals[i].history = [];` — it runs
  inside validation, in place, before any disk write (`importData` calls it
  at L624, ahead of `normalizeImportData` and the record put).
- `partitionAdoptedData` (L232) partitions collection entries by shape only
  and never inspects entry fields, so adoption keeps a goal's raw `history`.
- No quarantine or recovery entry is created for `history` on any path
  (contrast AG-3, where the partition does quarantine).

Executed evidence (field shown is `goals[0].history`):

| Variant | Leg A import: committed / disk / memory | Leg B adoption: memory / disk / export | Leg C roundtrip: committed / disk / memory |
|---|---|---|---|
| `history: "bad-history"` | true / `[]` / `[]` | `"bad-history"` / `"bad-history"` / `"bad-history"` | true / `[]` / `[]` |
| `history: 42` | true / `[]` / `[]` | `42` / `42` / `42` | true / `[]` / `[]` |
| `history` missing | true / `[]` / `[]` | missing / missing / missing | true / `[]` / `[]` |

Recoverability. After the roundtrip import completes, the raw value
(`"bad-history"`, `42`) is absent from the post-roundtrip disk record —
data, extras and quarantine alike (`rawValueInPostRoundtripDiskRecord:
false`). No quarantine entry records it at any point
(`diskQuarantine: null` in every leg). The raw value survives only outside
the store: in the backup file that was fed to the roundtrip
(`rawValueInSourceExportFile: true`) and in the pre-import disk record,
which the import replaced. Inside the store, the rewrite is silent and
unrecorded.

**Verdict: INTENDED NORMALIZATION.** The coercion is not an adoption-side
accident; it is the import contract's own rule, executed inside
`validateImportData` (L92) on every import, before the record is written —
leg A shows an imported non-array history already stored as `[]` on disk
and in memory, so a non-array `history` can never exist as stored data
that arrived through the contract's own gate. The roundtrip rewrite is
that same rule applying to adopted data; adoption is the outlier that
temporarily preserves a shape the contract never stores. Nothing valid
is lost: `history`'s contract shape is an array of entries, and a string,
number or missing value carries no entries any consumer could read as
history. One observation, not part of the verdict: unlike AG-3's
`metadata`, the replaced value gets no quarantine or recovery record, so
the normalization is invisible after the fact.

---

## AG-2 — `places` ids: import mints a generated id for missing, invalid or duplicate ids; adoption and export keep the raw id

Deciding code:

- `isValidId`, L66–68: an id is valid only when it is a string, starts with
  `place_`, and has length > 10.
- `migratePlaces`, L270–285: rewrites in place any id that fails
  `isValidId` or duplicates an earlier entry's id, minting
  `place_<Date.now()>_<random>`.
- Call sites are only the legacy localStorage branch of `initStore`
  (L342) and `importData` (L626, after validation and normalisation).
  `syncFromRecord` (L298), `repairAdoptedRecord` (L259) and `exportData`
  (L533) never call it, so adoption and export never migrate.

Executed evidence (field shown is the list of `places[].id`):

| Variant (input ids) | Leg A import: disk / memory | Leg B adoption: memory / disk / export | Leg C roundtrip: disk / memory |
|---|---|---|---|
| missing | `["place_1792675343637_hrfslx09o"]` (minted) | missing / missing / missing | `["place_1792675343718_fxdd7cf64"]` (minted again, different) |
| `"short"` | `["place_1792675343762_ka48ckhiy"]` | `"short"` throughout | `["place_1792675343845_dzg25hjyr"]` |
| `12345` | `["place_1792675343888_f5p0395ip"]` | `12345` throughout | `["place_1792675343966_4hj2l4zal"]` |
| duplicate pair `place_1234567890` ×2 | `["place_1234567890", "place_1792675344009_f7nilo3lm"]` — first kept, second minted | both `place_1234567890` throughout | `["place_1234567890", "place_1792675344091_4hsvfe4tm"]` |

All legs committed (`committed: true`); no quarantine entry is created on
any path (`diskQuarantine: null` throughout).

Recoverability. The replaced id (`"short"`, `12345`) is absent from the
post-roundtrip disk record (`rawValueInPostRoundtripDiskRecord: false`)
and from every post-import artifact the store produces; it survives only
in the source backup file (`rawValueInSourceExportFile: true`). The
minted replacement is random per import: legs A and C minted different
ids for the same input, so restoring the same backup twice does not
reproduce the same place identity. The duplicate case loses less: the
shared id itself remains on the first entry; only the second entry's
claim to it is replaced. Substantive place fields (title and all other
keys) are untouched in every variant.

**Verdict: INTENDED NORMALIZATION.** The replacement is a deliberate,
named part of the import contract itself: `migratePlaces` (comment header
"legacy null/duplicate place-ID migration") runs on both sanctioned entry
paths for external data — import (L626) and legacy upgrade (L342) — and
the values it replaces cannot be valid identifiers under the contract's
own definition (`isValidId`, L66–68, plus the uniqueness the migration's
seen-set enforces; a valid-and-unique control id, `place_1234567890`
alone, passes every leg unchanged). A place's data is fully preserved;
only an identifier that fails the contract is exchanged for one that
satisfies it. Two properties are recorded as observations, not as loss
of valid data: the minting is silent (no quarantine or recovery record),
and because the minted id is random, place identity is not stable across
a backup/restore cycle.

---

## AG-3 — `metadata`: import commits a truthy non-object value to disk while its own in-memory state already shows the repaired `{}`

Deciding code:

- `validateImportData` (L82) contains no `metadata` check at all.
- `normalizeImportData` (L139), L151: `if (!out.metadata) out.metadata = {};`
  — only falsy values are replaced, so a truthy string, number, array or
  boolean is stored verbatim by `importData` (record put inside
  `importData`, L593ff).
- `partitionAdoptedData` (L232), L242–247: any non-object or array
  `metadata` is quarantined as `{path: "metadata", index: -1, value}` and
  exposed as `{}`. `syncFromRecord` (L298) applies this on the import's
  own post-write adoption, which is why memory diverges from disk
  immediately. The disk record is repaired later by `repairAdoptedRecord`
  (L259) when `initStore` next reads it.

Executed evidence (field shown is `data.metadata`), variant
`metadata: "meta-string"`:

- Leg A, immediately after import (`committed: true`): **disk record
  holds `"meta-string"` verbatim; in-memory `getData()` already shows
  `{}`**; disk quarantine `null` (the quarantine exists only in memory at
  this point). This is the disk-vs-memory divergence, executed.
- Leg A, export taken immediately after import (before any reload):
  exported `metadata` is `{}`, and the exported quarantine already
  carries `{path: "metadata", index: -1, value: "meta-string"}` — the
  export path repairs from the disk record via `repairAdoptedRecord`.
- Leg A, after a subsequent reload (`initStore`): disk `metadata`
  rewritten to `{}`, and the disk record's `envelopeExtras.quarantine`
  now holds `{path: "metadata", index: -1, value: "meta-string"}`;
  memory `{}`. `rawValueInDiskRecordAfterReload: true`,
  `rawValueInQuarantineAfterReload: true` — the raw value is preserved
  on disk, in the quarantine.
- Leg B (pure adoption of the same stored record): memory `{}`, disk
  repaired to `{}` at init, disk quarantine holds the same entry;
  export carries `{}` plus that quarantine entry.
- Leg C (roundtrip of the leg-B export): `committed: true`; disk and
  memory `metadata` `{}`; disk quarantine still holds
  `{path: "metadata", index: -1, value: "meta-string"}`;
  `rawValueInPostRoundtripDiskRecord: true`.

The `metadata: [1, 2]` variant executed identically in shape: disk
`[1, 2]` verbatim after import, memory `{}`, quarantine value `[1, 2]`
after export and after reload, roundtrip committed with the quarantine
intact. (The log's `rawValueInSourceExportFile: false` for this variant
is a check artifact: the export text pretty-prints arrays across lines,
so the compact substring `[1,2]` does not appear; the value's presence
in the export is proven by leg C, whose imported disk quarantine
contains `[1, 2]` — it could only have come from that file's extras.)

Recoverability. The raw metadata value is recoverable after every stage:
from the in-memory quarantine immediately after import, from any export
taken after import, and from the disk record's `envelopeExtras.quarantine`
after the next reload — and it survives the export → import roundtrip in
that quarantine. It is not recoverable from `data.metadata` itself after
the reload repair; the named place it survives is
`envelopeExtras.quarantine` at `{path: "metadata", index: -1}`.

**Verdict: DIVERGENCE-ONLY.** The two contract paths genuinely disagree
about the durable record for identical input: the import path as executed
accepts and commits the raw truthy value to disk (no validation rule
rejects it; normalisation replaces only falsy values), while the
adoption partition — including the import's own post-write
`syncFromRecord` — disowns it in memory at once, and the disk record is
only brought into line by the next reload's init repair. That is a real
disk-vs-memory divergence, not merely two routes to one stored shape.
But the defining condition for irreversible loss is absent: the rejected
value is preserved verbatim in `envelopeExtras.quarantine` at every
stage after adoption touches the record, and it travels through export
and re-import. The paths disagree; the value survives in a named place.

---

## Summary

| Gap | Reproduced | Verdict |
|---|---|---|
| AG-1 `goals.history` coercion | Yes — import stores `[]`; adoption preserves raw; roundtrip rewrites to `[]` silently, no quarantine | INTENDED NORMALIZATION |
| AG-2 `places` id change on import/restore | Yes — missing/short/numeric/duplicate ids minted on import only; adoption/export keep raw; minted id random per import; no quarantine | INTENDED NORMALIZATION |
| AG-3 `metadata` divergence | Yes — import commits raw value to disk while memory shows `{}`; disk repaired on reload; raw value preserved in `envelopeExtras.quarantine` throughout | DIVERGENCE-ONLY |

Scope notes: AG-4 was excluded as instructed. Evidence class is Node
harness `[MOCK]`, matching Lane C's audit class; no claim is made about
host or real-browser behaviour. The scratch clone `v12-ag-repro` was
verified unmodified after the runs (`git status` clean, HEAD
`2eaa5268afc91d13df872bb709dec8179e9f2f94`); all deliverables live in
this `ag-repro/` folder, outside the clone.
