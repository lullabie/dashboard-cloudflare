# Integration Plan V4 — Track C Assembly

Bundle: CODEX-DASHBOARD-PHASES-V4-20261021 (issue #1 comment 6314947152)
Base commit: 29d43ff04a6abb257b5046c85f2fcba6f0bb679d
Assembly tree: hidden_files/codex-v4-20261021/assembly/tree (local clone of integration-build, detached at base commit; no remote writes made by Track C)

## Assembly order and state

Done in this assembly, in order. Each lane patch was applied with `git apply --include` limited to that lane's production paths. Lane test files, MANIFEST files and helper patches were excluded.

1. Base clone at 29d43ff. LICENSE verified byte-identical to the base blob after all steps.
2. MAIN correction patch (sha256 00b6939d…) — 10 production files applied: index.html, css/app.css, css/visual-upgrade.css (new), js/main.js, js/goals.js, js/college.js, js/jobs.js, js/maps.js, js/investments.js (new), js/visuals/chart-explorer.js (new). Skipped: test-main-v3.js.
3. HABITS patch (sha256 67d9ab66…) — js/habits.js (new) applied. Skipped: habits-v3.test.js.
4. PROGRESS correction patch (sha256 ee317ac5…) — js/visuals/progress-summary.js (new) applied. Skipped: progress-v3-test.js, progress-summary.patch (helper).

Pending, in this order when each owner delivery passes its own acceptance:

5. STORE (Track A, session 9588111654717985252): replace js/store.js with the lifecycle-repaired owner source. Current owner source line: STORE correction 2, js/store.js LF sha256 b600175c…, 21,197 bytes; the v4 lifecycle repair supersedes it. The base store.js now in the tree is a placeholder only. Integration check on arrival: js/main.js imports `exportDraft` from ./store.js — absent in the base store, present in the owner source line (verified in the correction 2 patch). Re-run the export-agreement check after replacement.
6. FEEDS (Track B, replacement session 4127150129426703516): insert the delivered js/feeds.js. Starting-point baseline recorded in the manifest as a reference only (Source Packet v2, LF sha256 8f712a05…); it is not in the tree and is not the unavailable v3 artifact. The old session 10139058434333404787 and branch codex-feeds-fix-10139058434333404787 stay parked as evidence. On arrival: verify the 10 named exports js/main.js imports, then re-run import closure.
7. Unresolved modules (no v4 owner assigned; coordinator decision needed before freeze): js/visuals/charts.js, js/visuals/deadline-timeline.js, js/chart.umd.js. Do not delete the imports or the index.html script tag to hide these gaps.

## Checks run on this partial assembly

- Import closure: 26 local references checked (static imports, dynamic import() — none found, index.html src/href, CSS @import/url() — none found). 22 resolved, 4 unresolved: js/chart.umd.js (from index.html), js/feeds.js, js/visuals/charts.js, js/visuals/deadline-timeline.js (all from js/main.js).
- Export agreement: 1 mismatch, js/main.js → `exportDraft` from the placeholder base js/store.js. Expected; resolves at step 5.
- Syntax: node --check on .mjs copies — all 12 production JS files PASS.
- Seed scan: patterns 1289, student number, personal names, college/Gmail domains, fee figures — no hits in any assembled production file.
- LICENSE: byte-identical to base (sha256 a09138d2…).

These are static/mock-boundary results on a partial tree. They do not establish startup or acceptance: the module graph cannot load while js/feeds.js, js/visuals/charts.js and js/visuals/deadline-timeline.js are absent.

## Freeze criteria for Phase 2

All must hold before the assembler freezes one complete review commit:

- [ ] STORE final source integrated; export-agreement check clean, including `exportDraft`.
- [ ] FEEDS replacement source integrated; import closure re-run with zero unresolved module imports.
- [ ] charts.js, deadline-timeline.js and chart.umd.js resolved by an owner decision (delivered file or an explicit, recorded scope change by Codex/user — never by silent removal).
- [ ] SOURCE-MANIFEST-V4.json regenerated on the frozen tree; every production file has a full SHA-256, byte count, origin and status; LICENSE still byte-identical.
- [ ] Syntax pass re-run on the frozen tree (all production JS, ESM check).
- [ ] Seed scan re-run on the frozen tree with no hits.
- [ ] Frozen commit hash recorded in the manifest and handed to Track D QA and Codex with the Track D test-point map. Phase 2 browser acceptance runs only on that frozen commit.
- [ ] Any post-freeze production change returns to its owner lane, produces a new frozen commit, and re-runs the affected checks. The frozen tree is never patched in place.

## Remaining gaps (explicit)

1. js/store.js — PENDING_OWNER_UPDATE (Track A lifecycle repair in flight).
2. js/feeds.js — MISSING_PENDING_OWNER (Track B replacement in flight).
3. js/visuals/charts.js — MISSING_UNRESOLVED, no v4 owner.
4. js/visuals/deadline-timeline.js — MISSING_UNRESOLVED, no v4 owner.
5. js/chart.umd.js — MISSING_UNRESOLVED asset referenced by index.html; no CDN fallback tag exists in the assembled index.html.
6. Progress-summary/history-schema assumption from v3 (STATUS_CHANGE events with a `to` field) is a Phase 2 acceptance item, not verified by this static assembly.
7. Lane B open flags from v3 (goals pure-UTC date arithmetic vs saved-zone brief; goals doneDays occurrence counting) remain Phase 2 verification items for QA/Codex.
