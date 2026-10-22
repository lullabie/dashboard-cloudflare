# V15 execution record — deployment-prep audit repairs

Date: 2026-10-22. Coordinator: Muse (sole assembler). Base:
`433842b` (V14B documentation head). Contract published first at
`0900a75` (`docs/review/V15-CONTRACT.md`). Frozen candidate: local
assembly `3ef0e08`, published as remote commit
`7883921607c27f308af33c383fab74ce58371fa7` (verified byte-identical,
file set and content). Branch `codex/v5-review`. PR #2 stays draft.
No merge, no deploy. Release status: NOT SHIPPABLE — no release
approval exists; the 2026-10-20 SHIPPABLE withdrawal stands. Host
acceptance: NOT RUN.

## Input

Codex V15 deployment-prep audit at `433842b`: the standard gate
passed, but an independent broader native-Chrome audit confirmed
eight release blockers. Each was verified in source by the
coordinator before repair. A follow-up contract review at `0900a75`
added one obligation (jobs status rendering), handled under Lane A.

## Defect dispositions

1. **Jobs producer/adoption mismatch** (form writes company/role,
   store required title; saved job vanished at adoption). Lane A:
   `isValidJobEntry` now requires a truthy id plus an identifying
   field (company, role, or legacy title), shared by import and
   adoption. Contract: `docs/review/V15-CONTRACT.md`.
2. **Stale modal edit** (stale form silently overwrote the other
   tab's notes). Lane C: open-time baseline snapshot for the five
   full-record modals (goal, place, job, investment, habit); a
   submit whose record changed or was deleted since open is
   blocked with an explicit conflict message; the modal stays open
   with the draft intact.
3. **Imported markup injection** (goal target interpolated raw into
   card HTML; occurrence status raw into a title attribute). Lane B:
   target coerced to a finite positive number with a stated fallback
   before display/arithmetic and never rendered raw; occurrence
   status reduced to a closed enum; `escapeHtml` coerces non-strings.
4. **Malformed habit crash** (invalid createdAt → RangeError in
   card rendering). Lane B: missing/invalid createdAt yields the
   UNKNOWN eligibility safe state; invalid history timestamps and
   non-object history entries are skipped; non-array history is
   normalized before appends in goals/habits writers.
5. **pages.yml uploaded the repo root with no gate.** Lane D:
   replacement workflow prepared as a reviewable patch
   (`docs/review/V15-PAGES-WORKFLOW.patch`): manual dispatch only,
   stages the exact manifest, uploads only the staged folder.
   Applying it through the GitHub API returns the exact blocker
   `403 Resource not accessible by integration` — the workflows
   path is not writable by this integration. No workaround was
   attempted. The file on the branch is unchanged.
6. **Package checker passed a LICENSE-plus-fixture tree.** Lane D:
   the checker is rewritten — exclusions first, an exact staged
   manifest (missing or extra fails), required files, dependency
   closure over HTML/CSS/JS references, forbidden-file rules. The
   Codex counterexample is a permanent test case.
7. **Blank indicators chart with an FX-trend alt claim.** Lane C:
   the never-drawn canvas and the false alt text are removed from
   `index.html`; the indicator cards remain. No fabricated trend,
   no new feature.
8. **Bundled chart license notices incomplete.** Lane D: full MIT
   texts for Chart.js v4.5.1 and @kurkle/color v0.3.2 in
   `THIRD-PARTY-NOTICES.txt`, a required file in the staged
   manifest. The root LICENSE is untouched (diff-verified at freeze).

Contract-review obligation (Codex at `0900a75`): jobs fields are
carried verbatim, so `createJobCard` must not assume a string
status. Lane A: a missing or non-string status renders an honest
"Unknown" badge; the original value is never mutated. Company/role
already render through textContent; date/notes likewise. Covered by
`__tests__/jobs-v15-render.test.mjs` (form job, legacy title-only
with no status, non-string status object).

## Integration note (existing spec)

`qa/v4/recovery-browser.spec.mjs` (V11-RECOVERY-02) encoded the
pre-V15 title invariant: its malformed-job fixture carried a
company with no title and expected quarantine. Under the V15
contract that entry is a valid producer-shaped job. The fixture now
carries an id with NO identifying field (no company, role, or
title), preserving the case's intent — partition of an entry that
fails the strict contract — under the current contract. All other
assertions unchanged.

## Verification (frozen candidate 7883921)

- Local gate (sandbox Chromium 156.0.8078.4, Node v24.20.0):
  **PASS** — 33 required browser cases PASS (34 total including the
  extra TEST-STORE-005), 19 Node lane-test files, runId
  `355b1fba-ed20-4cbe-ad13-a7d5b63068a1`. Includes the five new
  required cases V15-AUDIT-01..05 (real form lifecycle, two-tab
  modal conflict, literal imported markup, malformed habit safe
  state, chart honesty) from `qa/v4/audit-regression.spec.mjs`,
  registered in `scripts/write-browser-results.mjs` after contract
  integration.
- Negative checks: 17/17. Package checker `--stage` on the frozen
  tree: PASS.
- Lane tests are also green individually: Lane A 13/13 + 10/10,
  Lane B 8/8, Lane C 20/20, Lane D 8/8. The Lane A contract test
  fails 6 checks on the pre-V15 store (RED verified).
- Evidence: `docs/review/evidence/v15/` with `PROVENANCE.md`.

## Remaining gates (unchanged discipline)

- Codex independent inspection of `7883921`: pending.
- Host acceptance: NOT RUN.
- Workflow patch application: blocked on the GitHub integration's
  workflows permission (403 above); a human with that permission
  can apply `docs/review/V15-PAGES-WORKFLOW.patch`.
- Separate acceptance-matrix cards (post-V14B gaps list in
  `docs/ACCEPTANCE.md`): unchanged except where the V15 notes say
  otherwise; the every-form matrix, time matrix, maps UI CRUD,
  college markup, investments round-trip, explorers, chart CDN
  fallback, and asset-manifest-on-host items remain NOT RUN.
- Merge/deploy: require Codex acceptance, host acceptance, and
  user approval.

## Addendum 2026-10-23 — Codex full result on 2d8a688, packager P1

Codex independent FULL result on the documentation head 2d8a688
(application and tests identical to 7883921): overall exit 1.
Browser 33 required cases PASS (34 total), negative 17/17, 21-file
stage PASS, but the Node phase ran 18/19 files: the packager test
failed on Windows. Codex runId bb1fb36e-360b-4b7c-ae56-17f9683c1975,
Node 24.19, Chrome 155. No overall gate PASS is claimed for
2d8a688; Codex's raw failed log is preserved under that runId.

Two tooling defects, same owner (Lane D), fixed in one bundle:

1. P1, scripts/package-static-assets.mjs: --stage ran
   rmSync(staged, {recursive:true}) BEFORE validating source
   problems or the source/output relationship. `--stage src src`
   deleted the source assets and then failed copyFile ENOENT;
   an ancestor output could delete the whole source tree. Codex
   reproduced this only on an explicitly resolved disposable
   fixture; the source repo was untouched.
2. __tests__/package-v15-manifest.test.mjs: repo root derived via
   new URL('..', import.meta.url).pathname (breaks on Windows:
   C:\C:\Users..., MODULE_NOT_FOUND), the child spawned as 'node',
   and the negative case accepted ANY exit 1, so the loader error
   false-passed as an expected rejection.

Fix, frozen at 6f5a74bcfca4d01f44fcc59d073563e3b6e0ff36 (parent
2d8a688; exactly two files changed; application files identical
to 7883921):

- The packager validates the source (REQUIRED, FORBIDDEN,
  UNCLASSIFIED problems) before any output mutation; an invalid
  source exits 1 with the output untouched.
- Stage target and source are compared after realpath resolution
  (deepest existing ancestor + remainder), so symlink and
  junction aliases cannot bypass the boundary. Stage == source
  and stage as an ancestor of source are refused (exit 2).
- No recursive erase of unowned folders. Ownership is a sibling
  marker (<staged>.pkg-owned.json) listing staged files. A
  pre-existing non-empty target without a valid marker is refused
  untouched. A restage deletes only marker-listed files; a user
  file placed in an owned folder survives and is reported EXTRA.
- The test uses fileURLToPath and process.execPath. Every negative
  case asserts the expected validation reason and the absence of
  loader errors. New cases: self-stage, ancestor stage, symlink
  alias, invalid source leaves target uncreated, unowned target
  refused, user-file preservation. 19/19 PASS, Node 24.20.

Coordinator gate on frozen 6f5a74b (fresh clone, sandbox Chromium
156.0.8078.4, Node v24.20.0): full runner exit 0, LOCAL GATE PASS,
33 required browser cases PASS (34 total), negative 17/17, runId
6287e6b2-849e-4182-8f4f-f9bc33fa29f0. Evidence:
docs/review/evidence/v15/packager-fix-browser-results.json
(byte-identical copy of the gate artifact, sha256 fd7c09b1...).
The normal direct stage command also passes on the frozen tree.

Standing limits, unchanged: the pages workflow replacement is
still NOT applied to the branch (GitHub API 403 on
.github/workflows), so the eight audit blockers are NOT all
repaired at branch level; host acceptance is NOT RUN; PR #2 stays
draft; no merge, no deploy, no release approval.
