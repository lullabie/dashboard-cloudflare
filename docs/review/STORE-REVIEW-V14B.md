# STORE Review V14B — Early-User-Save Ordering in the V14 Repair-Claim Window

Lane: STORE owner, read-only review. No source file was modified.
Reviewed source: `js/store.js` at `96ed58620c957df61ac42b7baeecf7790f8b4551`
(branch `codex/v5-review`, clone `codex-v14b-20261022/v15-store`, git status
clean at delivery). Probe evidence: `/tmp/probe-v14b.mjs` (throwaway, outside
the repo tree; mock IDB/BC harness in the style of
`__tests__/store-v10-adoption.test.mjs`, plus a per-open delay/fail hook so a
claim transaction can be held back deterministically while user saves run).

## Headline verdict

The early-user-save ordering is SAFE. Every interleaving of {tab A save,
tab B save, tab A claim, tab B claim} in the window converges on exactly
one canonical record at revision r+1. No established canonical state is
overwritten, no place id forks, and provenance for each repaired id
appears exactly once on disk. **Source change required: none** (see the
final section).

## The structural fact the ordering reduces to

A claim write and a window save are the SAME compare-and-swap transition:

- `claimAdoptionRepair` (store.js:416) writes only when the disk record
  still equals the adopted record (same generation AND revision), and
  writes at `revision + 1`.
- `saveData` (store.js:602) with a window snapshot (token = adopted
  generation/revision) writes only when the disk record still equals
  that token, and writes at `revision + 1`.
- `importData` (store.js:777) checks its pre-confirm baseline token
  against the disk inside its own transaction the same way.

All four contending operations are readwrite transactions on the same
object store; IndexedDB serializes them. Exactly ONE of them can observe
the disk at the adopted (generation, revision) and take the r → r+1
transition. Every later transaction observes the advanced disk and takes
a non-writing branch: a claim supersedes (adopts the disk record), a save
or import conflicts (adopts the disk record, exports its draft, rejects).
So the 24 permutations collapse into four classes, by which transaction
runs first. "First" below means first to execute its in-transaction read
against the adopted record, which is the only ordering that matters.

Setup for all classes: tabs A and B have both adopted the same poisoned
record at (g, r) via BroadcastChannel sync. A holds speculative mint
`mintA`, B holds `mintB`, `mintA ≠ mintB`, under the shared token (g, r).
Each tab's repair claim is in flight.

## Interleaving table

| # | First transaction | Canonical record at r+1 | Remaining events, any order | Verdict |
|---|---|---|---|---|
| 1 | Claim A (symmetric: Claim B) | A's repair payload: `mintA`, no user edit, A's provenance | Claim B supersede-adopts it. Save A (window snapshot) CAS-fails against A's own claim; conflict, draft exported. Save B CAS-fails; conflict-adopts canonical; draft exported. Fresh-snapshot retries commit. | Holds |
| 2 | Save A (symmetric: Save B) | A's snapshot payload: `mintA` PLUS A's user edit (any collection) | Claim A: supersede branch, settle guard blocks adoption — no write, no revert. Claim B supersede-adopts A's payload. Save B CAS-fails; conflict-adopts; draft holds B's edit + `mintB`; retry on fresh snapshot commits with `mintA` preserved. | Holds |
| 3 | Save A, then Save B, claims last (either claim order) | A's payload (first save wins the transition) | Save B already conflicted in class-2 fashion. Both claims then observe r+1: winner's claim is a guarded no-op, loser's claim supersede-adopts (already adopted via its conflict, so idempotent). No further writes. | Holds |
| 4 | Save A, then Claim B, then Save B, then Claim A | A's payload | Claim B supersede-adopts A's payload before B's save; B's window snapshot still carries token (g, r), so its save CAS-fails and conflict-adopts the same record. Claim A settles as a guarded no-op. | Holds |

Classes 1's save-after-claim behavior is proven by existing evidence
(adoption test section 24 at 96ed586: loser window save rejected, disk
byte-unchanged, winner window save also CAS-fails, retries commit).
Classes 2–4 are proven by probes P1 and P2 below. Permutations not listed
separately are orderings of the same non-writing branches after the one
transition, and reach the same end state.

## Special cases

### A save that edits a DIFFERENT collection (probe P1)

A window snapshot carries the whole dataset, so a goals-only edit saved
during the window persists the speculative places mint as a side effect:
the save writes the entire snapshot at r+1. Probe P1 forced this order
(both claims held back 90 ms at `indexedDB.open`; the save ran first):

- The save committed `{committed:true, conflict:false}`; disk revision
  went 11 → 12 (exactly one transition).
- Disk places carry `mintA`; the goals edit is present; provenance for
  the raced place appears exactly once, with the original poisoned
  object as its value; the unknown extras key on the adopted record
  survived.
- After both claims settled, the disk was byte-identical (neither claim
  wrote). B converged on A's payload (mint + goals edit) by
  supersede-adoption. B's next save committed and provenance was STILL
  exactly once: on supersede-adoption the tab's envelope extras are
  taken from the adopted record, so B's duplicate speculative
  provenance entry (identical {path, index, value}) is discarded, not
  merged a second time.

Verdict: safe. Which mint becomes canonical is timing-dependent, but ids
are opaque, both mints are valid and unique inside the record, and
exactly one survives. The mint is made canonical by an authorized CAS
write at a unique revision — not by a repair write under a shared token.

### A save from the tab whose claim later loses (probe P2)

Two sub-cases, both safe:

- Its save runs BEFORE the winning transition: then its save IS the
  winning transition (class 2/3). Its claim does not "lose" in any
  harmful sense; it settles as a guarded no-op.
- Its save runs AFTER the winning transition: the save's in-transaction
  CAS check fails, `saveData` adopts the authoritative disk record into
  memory, records the conflict, downloads the user's edited snapshot as
  a draft file, and rejects with the Conflict error. Probe P2 (both
  claims held back, both tabs saved): exactly one save committed; the
  loser was rejected; the disk held only the winner's mint and title;
  the downloaded draft carried the loser's edit AND the loser's mint,
  and none of it was merged into the disk. The loser then retried the
  same edit from a fresh snapshot: it committed, and the disk kept the
  WINNER's id with provenance still exactly once.

The user's edit is never silently dropped and never silently merged:
it is either committed as the canonical payload, or preserved verbatim
in the downloaded draft plus the in-memory `unsavedDraft`, with a
Conflict rejection the caller must handle.

One observation, not a violation: the loser's downloaded draft contains
the loser's speculative mint ids. If the user later imports that draft,
import replaces the whole dataset under a new generation (with the
existing confirm dialog), and the draft's ids are valid-format, so they
survive import migration. That is a deliberate, user-confirmed wholesale
replace — it cannot fork the live record.

### Import during the window (probes P3, P4)

`importData` captures its baseline from a fresh `getData()` snapshot
(during the window: token (g, r)), then checks that baseline against the
disk inside its write transaction.

- Import's transaction runs first (probe P3, claims held back): the
  import commits a NEW generation at r+1 with the imported data. Both
  outstanding claims then observe a disk that differs in generation and
  revision: they write nothing. The importing tab's own claim settle is
  blocked by the guard (its generation has moved), so it is not
  reverted to its speculative state; the other tab supersede-adopts the
  import record. Disk byte-identical after both claims settled.
- Disk advances between baseline capture and the import transaction
  (probe P4: an authoritative advance to r+1′ landed inside the confirm
  step): the import aborts on the CAS check, adopts the disk record,
  reports `{conflict:true, committed:false}`, and downloads the import
  payload as a draft. The disk record the import opposed is untouched.
  Note the import may be the user's newest intent and still lose to a
  repair claim that landed first — a freshness annoyance, not a safety
  defect: nothing is overwritten and the payload is preserved.

### Degraded and pending gates during the window

- `storeStatus` transitions only inside `initStore`. The claim path
  never touches it. A claim failure (probe P5: the claim's `openDB`
  rejected) is caught, logged once, and leaves the store `ready` with
  the in-memory repair standing and the disk still poisoned at r. A
  subsequent user save then commits the speculative mint at r+1 — the
  early save is the durability fallback when the claim cannot run, and
  it makes that mint canonical by the class-2 route. Provenance exactly
  once after the fallback save.
- A degraded tab never opens this window: the BroadcastChannel adoption
  listener is registered inside `initStore`'s try block, and the
  degraded path returns before any BC adoption can be received. The
  degraded gates in `saveData`/`importData` (throw / reject before any
  token check) are unchanged by the claim mechanism.
- There is no pending-save mutex or flag in this source. Concurrency
  control is the token WeakMap plus IndexedDB transaction
  serialization. Two `saveData` calls from the SAME tab with the same
  window token behave like any same-token pair: the first commits, the
  second takes the conflict path (self-conflict; draft exported).
  Pre-existing, window-independent; noted for completeness.

### The claim's extras write

When a claim wins, it writes `envelopeExtras: claimExtras`, replacing
the disk extras rather than merging. That is safe only because the
claim writes exclusively when the disk still equals the adopted record,
and `claimExtras` was derived at adoption time from that same record's
extras plus the new provenance. (The save path merges,
`{...diskExtras, ...envelopeExtras}`.) No extras key can be lost by a
claim write under store-mediated writers.

## Scope item 4: the settle guard (`stillOnAdopted`)

The guard (store.js:454) re-checks, after the claim transaction, that the
tab still sits on the adopted (generation, revision) before adopting
either the written record or the superseding record.

Hard case — tab advances via its own successful save while its claim is
in flight: probe P1 is exactly this case. A's save committed at r+1
while A's claim was still held back. When A's claim transaction finally
ran, it observed the advanced disk (its own saved record), took the
supersede branch, and the guard — current revision r+1 ≠ adopted r —
blocked the settle adoption. A's memory kept its edit and mint; the disk
was byte-identical after settle. **The claim cannot revert a tab that
advanced via its own save.** Probe-verified.

The remaining branch (claim WROTE, then the tab advanced before settle)
is not reachable, by construction: the settle continuation runs as a
promise microtask immediately after the claim transaction completes,
and every advance path available to the tab (save CAS, import CAS,
BroadcastChannel adoption) requires at least one IndexedDB round trip —
a macrotask — so none can interleave between the transaction's
completion and the settle check. Additionally, in that interval the
tab's in-memory token is still the adopted (g, r) while the disk is
already at r+1, so any save attempted then CAS-fails rather than
advancing the tab. If the guard were somehow bypassed in this branch,
the settle would adopt `wroteRecord` — the tab's own claim payload,
which differs from an intervening state only if one existed; none can.
The guard is correct defense-in-depth; keep it.

## Probe evidence

Command: `node /tmp/probe-v14b.mjs` (Node v24.20.0), run three times,
identical result each time: **35 passed, 0 failed**, exit 0. (The run
also prints the store's own `console.warn` for the forced claim failure
in P5 and `console.error` for the expected import conflict in P4 —
those log lines are the evidence those branches executed.)

- P1 (10 checks): save-wins class with a goals-only edit — see above.
- P2 (9 checks): both-saves race — exactly one commit; loser Conflict
  rejection; disk = winner payload at r+1; draft preservation;
  claims wrote nothing afterwards; retry commits with winner id and
  provenance intact.
- P3 (6 checks): import wins during the window; both claims supersede;
  no revert of the importing tab; other tab converged on the import.
- P4 (6 checks): import loses to a mid-confirm disk advance; conflict
  reported; disk untouched; import payload preserved as a draft;
  importing tab adopted the authoritative record.
- P5 (4 checks): claim `openDB` failure writes nothing, in-memory
  repair stands, store stays usable, user save becomes canonical.

Method note: interleavings were made deterministic by queuing per-call
delays/failures at `indexedDB.open` (claims held 90 ms while saves ran;
claim open failed once in P5). The mock's transaction shape matches the
repo's adoption-test harness; the mock serializes get/put with timers
rather than true IDB transaction scheduling, so the probes prove the
store's branch behavior per ordering class, while the serialization
premise itself rests on the IndexedDB specification (readwrite
transactions on one store execute in creation order without
interleaving) — the same premise Codex's native-Chrome V14 diagnostic
exercised.

## Boundaries (unchanged, restated for completeness)

- The claim's disk-identity check is generation + revision equality.
  A raw writer that forges the same generation/revision pair with a
  different body is outside the CAS contract — the pre-existing scope
  boundary already stated in the store's policy comment (point 4).
  Nothing in the early-save ordering widens or narrows it.
- This review covers two tabs that adopted the same record. A tab that
  has not yet adopted the poisoned record has no window; its first
  adoption reads whatever canonical record the transition produced.

## Final section

**Source change required: none.**

No concrete violating sequence was found. Every interleaving of the two
window saves and the two claims converges on one canonical record;
established canonical state is never overwritten (the only writes are
the single r → r+1 transition and later fresh-token writes); place ids
never fork on disk; provenance survives exactly once per repaired id;
user edits in losing operations are preserved as drafts with an
explicit Conflict outcome; the settle guard provably prevents a late
claim from reverting a tab that advanced via its own save or import.
The V14 record's residual-window statement stands as written.
