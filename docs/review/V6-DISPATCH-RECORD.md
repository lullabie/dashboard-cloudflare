# V6 dispatch record — codex/v5-review

Marker: CODEX-DASHBOARD-PHASES-V6-20261022. Issue record: issue #1 comment 6323664685.
Base: main 29d43ff04a6abb257b5046c85f2fcba6f0bb679d. Branch head before v6: 433d6305b6e8508bbb8994c59a1cb5f6ec4a93d6.
This branch is a draft review candidate. It is NOT shippable. Publication is draft review, not release approval. PR #2 stays draft.

## Lane C — STORE correction published (ownership: Muse)

STORE ownership transferred to Muse per the v6 bundle. The Jules STORE session is not reopened.
Provenance: the lane delivered byte-identical js/store.js in two correction rounds (sha256 444fa8c8decec84351c95e0ea7550baeafc88bf81464c6872b85ed5f8221e5de). The coordinator applied the three remaining fixes surgically (malformed legacy recovery, cancel settle exactly once, reader error/abort handlers) and extended the tests. That corrected patch is bf6f0239da86fc82ce7167756b7d37cac4aea4e522d80927619d3b9ac8ef5970. Excluded from publication, per the bundle: MANIFEST.txt, gen_patch.sh, store_v5_final.patch (embedded helper artifacts).

Published files (each read back from the branch and hash-verified):

- js/store.js — first publish sha256 c7908375f6f6a3db1ff51af5bfaeee026b9e5b2f090d09f9eab5b4aa93b789a0, commit 970a42c078552f79adaecf94e9da572e56e5e10e.
- __tests__/store-v5.test.js — b82567a1e981eca139597e3a9b60c78aa22c35b2f2eed740148305cfb6160514, commit 50500cfcef6498eda94de36c61ba5c3d039d8603.
- __tests__/store-v3-bc-validation.test.js — f85bc28308b9…, commit 8dc00881462c.
- __tests__/store-v3-degraded-save.test.js — ff50b7e1a21d…, commit fe4d0f8e1d43.
- __tests__/store-v3-validation.test.js — 388d57d19fb4…, commit df97da950657.
- __tests__/store-v4-lifecycle.test.js — 072396a30338…, commit c0081cd34dac.
- __tests__/store-v4-notification.test.js — 5697812e9bdc…, commit 694817df714c.
- __tests__/store_validation.test.js — b2346078cbf0…, commit 4831480b4e9f.

### V6 coordinator correction on the published STORE bytes

Found during v6 focused-diff preparation, before Codex review: in c7908375…, `lastNormalizeRecovery` was reset inside the field loop, so the durable recovery record named at most one field and in the common case none. No original bytes were kept in the durable record. Fix, applied by the coordinator as STORE owner:

- The reset moves before the loop. The record names every repaired field.
- On a malformed recovery, envelopeExtras also stores `legacyOriginalRaw`, the exact original localStorage string. localStorage itself is never mutated by init. Recovery is explicit and reversible, not silent destruction.
- Test added: the durable record envelopeExtras names both repaired fields (places, goals) and legacyOriginalRaw equals the exact original string.

Republished files:

- js/store.js — sha256 aa505bf99d91a8ce6e86e37d0618bf58f8d82bdfe7f7dc49f44a466651bec719, commit 9116c9f5070b.
- __tests__/store-v5.test.js — sha256 972e92e7d3899e38e404dba08f63c9039478a81a9944f925da33bf25de32d7c1, commit 35c7dc85cd80.

Local verification [MOCK], Node v24, same run: store-v5 9/9 PASS; store-v3-bc-validation 3/3; store-v3-degraded-save 7/7; store-v3-validation 4/4; store-v4-lifecycle 3/3; store-v4-notification 2/2; store_validation 7/7. ESM check PASS. Mock results are mock results; browser proof is Lane D Phase 2 work.

Focused diff (branch js/store.js, v5 source d613cf18… → aa505bf9…): the legacy path migrates place IDs before the first durable put, validates the repaired shape, records the recovery; normalizeImportData coerces non-array list fields to [] with the recovery record; import settles exactly once on committed, conflict, error, reader error, reader abort, and cancel paths, with the caller callback invoked outside the persistence error catch.

## Lane C — FEEDS integrated (accepted for draft integration)

- js/feeds.js — sha256 fca33d7a2d1f2a2aeb2904bfa7d5683471b9bf20ed5855acdefdd2c9365bbc36, commit 722d0c939302. Source patch dc2dec20b00bf5bcfddb743b935f6b5c3e05a6ae6005001d327e073c012ec3ab, accepted by Codex for draft integration (comment 6323664685).
- __tests__/feeds-v4-contract.test.mjs — c3ae4d48abac…, commit 5d1c897766b4. PASS [MOCK] locally.
- __tests__/feeds-v4-ordering.test.mjs — fe4e72cf5998…, commit 1b1d14bac1d2. PASS [MOCK] locally.

LICENSE byte-identical to base. No other production files changed by Lane C in v6.

## Parallel lanes in flight (preparation parallel, integration ordered)

- Lane D (three browser QA owners, one writer per spec): portability fixes — checkout-relative default tree via fileURLToPath/pathToFileURL, repo-local fixtures, no hidden_files reads, no patch re-application, no pinned hashes, actual hashes reported, NOT RUN exits nonzero when no Playwright resolves. Lane D consumes Lane E's result schema after E defines it.
- Lane E (runner owner): run the real browser suites, collect machine results from that run, require all standing acceptance IDs AND the five V5 IDs, exact tested commit and store/feeds hashes, complete cases, no FAIL or NOT RUN. Reject stale, mismatched, malformed, partial reports. Focused negative checks: stale commit, failed V5 regression, omitted case, browser-not-run.
- Lane F (bounded chart owner, only js/visuals/charts.js, js/chart.umd.js, chart tests): provenance inspection first, then the three-export contract renderJobsChart/renderCollegeChart/renderInvestmentsChart against actual call sites, accessible empty/zero/malformed cases, jobs filter callback preserved. No shared main/index writes from F; an index.html script change, if needed, goes through Lane C after a verified full-tree usage search.

## Open gates (explicit)

- Codex source review of the actual STORE bytes (aa505bf9…) is pending. This record does not claim it.
- Browser acceptance on a frozen assembled commit: NOT RUN. The five V5 findings flip only on real-browser results against the frozen commit.
- Hosted CI unavailable: .github/workflows/review-tests.yml stays staged locally; the GitHub App lacks the workflows permission (403). App permissions are not broadened.
- Backend delete-vs-wire: no deletion, no expansion in this bundle. Workers/D1 host acceptance is unimplemented and listed separately; browser-local acceptance is not Workers/D1 proof.
- No merge. No deploy.
