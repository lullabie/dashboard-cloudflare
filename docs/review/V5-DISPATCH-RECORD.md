# V5 dispatch record — codex/v5-review

Marker: CODEX-DASHBOARD-PHASES-V5-20261021. Base: main 29d43ff04a6abb257b5046c85f2fcba6f0bb679d.
This branch is a retrievable draft candidate. It is NOT shippable. Acceptance gates are listed at the end.

## Selected lane outputs on this branch

- STORE session 9588111654717985252: patch SHA256 777d74ceddcc8bf76d3c3cfcb510d122a32820613bf490b16d05af0aeaecddc4; js/store.js LF SHA256 d613cf1890995fa09b56fd3f7cb3f2b0638b79098429b572dd74ec9ed501d6e4.
- FEEDS replacement session 4127150129426703516: patch SHA256 2b44a190e684736285921676f4b2c9761c76c0ab9b26032c09240831007b72ab; js/feeds.js LF SHA256 aaa6ea7dbb0214c7a348e962779a65d5392bd5add8f4ae4867af52995a1334e9.
- MAIN session 15054498843384471465: patch SHA256 00b6939d970fb9b46ff8d6c3effc04a53b658562dd97ee721b3428dc13c3e5c1.
- HABITS session 13401192992339391577: patch SHA256 67d9ab66e4527fcfd30c6cb55009f4e3817f0e3d678e989352c79844ae265431.
- PROGRESS session 12388674487520618663: patch SHA256 ee317ac5b5037f600d3750a1308caae37c803cf4cfcf13a35b78868b70fb8bcb.
- Legacy FEEDS session 10139058434333404787: parked, reference only. Not on this branch.
- QA preparation files under qa/v4/ and tooling/docs/scripts from the v4 Track D and Track E deliveries.

Excluded: MANIFEST.txt files, progress-summary.patch, helper patches, result dumps, credentials. LICENSE is byte-identical to base.

## V5 fix lanes in flight (not on this branch yet)

- Lane A, STORE session 9588111654717985252, sole writer js/store.js plus its existing store test files: V5-STORE-01 (first-open legacy place migration), V5-STORE-02 (import settle exactly once on every terminal path), old store_validation mock ordering repair.
- Lane B, FEEDS session 4127150129426703516, sole writer js/feeds.js plus __tests__/feeds-v4-contract.test.mjs and __tests__/feeds-v4-ordering.test.mjs: V5-FEEDS-01 (15 second deadline through full body), V5-FEEDS-02 (fence full source config), V5-FEEDS-03 (http/https protocol allowlist, unsafe links inert).
- Lane C, coordinator: sole review-branch writer. Corrected A and B integrate sequentially after Codex review, with patch and source hashes and commit IDs recorded here.
- Lane D, browser QA: qa/v4/ui-browser.spec.mjs, qa/v4/storage-browser.spec.mjs, qa/v4/feeds-browser.spec.mjs, one writer per file. The QA coordinator owns qa/v4/acceptance.spec.mjs and shared fixtures.
- Lane E, runner/docs/assets: scripts/run-review-tests.mjs, scripts/package-static-assets.mjs, docs, .github/workflows/review-tests.yml.
- Watcher: the minutely driver watches both the STORE session and the FEEDS replacement session, verify-only. The coordinator is the sole Jules sender.

## Open gates (explicit)

- Browser acceptance: NOT RUN. All mock results are source-level only.
- Import closure gap: js/main.js imports ./visuals/charts.js. No verified file exists. index.html loads js/chart.umd.js. No verified file exists. Both stay unresolved until Codex designates an owner or a source.
- Five v5 findings stay open until lanes A and B deliver and Codex reviews the patches.
- Backend (Workers/D1) stays UNACCEPTED. No deployment trigger exists on this branch.

## Publication addendum — 2026-10-21 20:05 IST

- Branch codex/v5-review created from main 29d43ff. All 35 candidate paths published by per-file commits, except .github/workflows/review-tests.yml: BLOCKED, 403 on write (the GitHub App lacks the workflows permission). The file stays staged locally in the Track E delivery.
- Lane D delivered three real-browser specs, now on this branch under qa/v4/: ui-browser.spec.mjs, storage-browser.spec.mjs, feeds-browser.spec.mjs. Prep runs against the selected pre-fix sources (Firefox, real IndexedDB): UI 11 PASS / 1 FAIL (V5-STORE-02); storage 5 PASS / 1 FAIL (V5-STORE-01); feeds 3 PASS / 3 FAIL (V5-FEEDS-01, V5-FEEDS-02, V5-FEEDS-03). All five v5 findings reproduce in a real browser. These prep runs are not Phase 2 acceptance; final results must name the fixed assembled commit.
- Lane E delivered the fixed runner, now on this branch: scripts/run-review-tests.mjs requires qa/v4/browser-results.json with all registry browser IDs at PASS before any release PASS. The v4 runner exited 0 with zero browser cases run; that hole is closed.
- Snapshot push route (push_files) is blocked: 403 at tree creation. Per-file writes are the working route on this branch.
