# V15 data contract — jobs schema and malformed-entry eligibility

Owner: Lane A (contract). Status: published for Lane B/C/E dependency
use, 2026-10-22. Scope: `js/store.js`, `js/jobs.js`. No other lane
edits these files in V15.

## Why this contract exists

The Codex V15 deployment-prep audit (at `433842b`) proved a producer
mismatch: the actual Jobs Add form writes
`{ id, company, role, status, location, date, notes }` — it has no
title field — while the store's shared job invariant required a
truthy `title`. A form-created job saved, the modal closed with no
error, and the entry then failed the adoption partition after
reload, so the job silently vanished from `getJobs()`.

## Jobs schema (aligned across producer, import, adoption)

A jobs entry is valid when all of these hold:

1. It is a non-null, non-array object.
2. `id` is truthy.
3. At least one identifying field is truthy: `company`, `role`, or
   `title`.

Field notes:

- `company` and `role` are the current producer fields (the form
  requires both; the card renders both as text).
- `title` is the legacy identifying field from older exports. A
  legacy entry that carries only `title` stays valid and renders
  with the title in the card's company position. Legacy records are
  supported, not migrated silently and not dropped.
- An entry with an `id` but no identifying field is not a record
  the app can render or edit. Import rejects the file with the
  existing "missing required fields" error; adoption moves the
  entry to quarantine with provenance (never a silent drop).
- All other fields (`status`, `location`, `date`, `notes`, and any
  unknown fields) are carried verbatim. No field is rewritten by
  validation, import, or adoption.

The single shared predicate is `isValidJobEntry` in `js/store.js`,
used by both `validateImportData` and the adoption partition
(`isAdoptableEntry`), so an adoption-repaired backup stays
importable.

## Goals and habits: malformed-field eligibility

Eligibility for goals and habits is shape-only, shared by import
and adoption via `isValidGoalEntry` / `isValidHabitEntry`:

- A non-null, non-array object entry is eligible as-is.
- Field-level malformation does NOT change eligibility and is never
  rewritten at the store layer. In particular:
  - a goal with a non-numeric `target` (for example an imported
    markup string) stays in `goals` with the value verbatim;
  - a habit with an invalid `createdAt` stays in `habits` with the
    value verbatim.
- Only shape failures (null, primitives, arrays) leave the
  collection at adoption, and they go to quarantine with
  provenance, as before. Nothing is silently lost.

## Renderer obligations (Lane B dependency)

Because malformed field values remain in the data by design, the
renderers must treat every field as untrusted:

- Render values as text or closed enums only; never interpolate a
  raw field into `innerHTML` or an attribute.
- Coerce numeric fields (`goal.target`) to a finite number with a
  stated fallback before display or arithmetic.
- Treat an invalid date (`habit.createdAt`) as a safe state (the
  existing unknown-eligibility state), never an exception.

## Stale-edit boundary (Lane C dependency)

The store's CAS token guards record-level writes. It does not know
that a modal form was opened against an older copy of a record.
Form-baseline comparison is a UI-layer duty (Lane C): a submit that
would overwrite fields changed since the form opened must surface
an explicit conflict and retain the draft, not attach the stale
form to the fresh token.
