# V8 gate evidence — raw files

Raw evidence for the V8 local gate run, published in the repository so the
result can be inspected directly instead of trusting hashes held in a local
file. Narrative record: `docs/review/V8-EXECUTION-RECORD.md`.

## Files

| File | What it is |
|---|---|
| `browser-results-v8.json` | Machine-readable browser results written by `scripts/write-browser-results.mjs` during the gate run (schemaVersion 2). Byte-exact copy of the original local evidence file. |
| `gate-output-v8.txt` | Full console log of the gate run (`node scripts/run-review-tests.mjs --commit <sha>`), path-sanitized as described below. |

## Run identity

- Frozen commit under test: `5c9fba30ddab57667bc652ea8532d64bba197614`
- Run ID: `e07d7c3e-a001-4a2d-8f97-c9fcc6138d7e`
- Generated at: 2026-10-22T09:28:32.142Z
- Runtime: Node v24.20.0, Playwright 1.64.1, real Firefox 157.0, local
  temporary origin `http://127.0.0.1`, isolated browser profiles.
- Source hashes bound in the results: `js/store.js`
  `aa505bf99d91a8ce6e86e37d0618bf58f8d82bdfe7f7dc49f44a466651bec719`;
  `js/feeds.js` `b0fe9d6b31caa11f6dbec86afae6fa38912ed7d6ff4c6f259001bd472620be88`.

## Result

- Lane tests: 11/11 files PASS.
- Browser: 26/26 cases PASS — the 25 required cases (including
  `V8-JOBS-OTHER`) plus the extra case `TEST-STORE-005`, which the gate
  reports as ignored.
- Gate exit code: 0 (local gate PASS).

## Integrity

SHA-256 of the original local evidence files:

- `browser-results-v8-final.json`:
  `bf44be296d5945dd1284a778358cc6c66c40b2e5f1d0f4a1e78d993ee652b952`
- `gate-output-v8-final.txt`:
  `9eedf9a6bed8c3be4127caa95abaa91562ef38954942f1290f7310c30e0058e3`

`browser-results-v8.json` in this folder is byte-exact: its SHA-256 equals
the original value above.

`gate-output-v8.txt` carries exactly one sanitization: every occurrence of
the local absolute path prefix
`/home/hatch/workspace/goals/personal-life-dashboard/hidden_files/codex-v8-20261022/frozen-v8`
is replaced with the token `<tree>` (10 occurrences on 10 lines). Nothing
else changes; replacing `<tree>` with the original prefix reproduces the
original file byte for byte. SHA-256 of the sanitized file as published:
`3fe55376fa2d9cd4792068a0515e31719279e052aad43603fe2d83d5ae4cfcb2`.

## Privacy

The evidence contains invented test records only: no personal data, no real
names or email addresses, no credentials, tokens, or secrets. The only URL
in the log is the local temporary origin used for the run.

## Status

This is historical V8 local-gate evidence. It is not host acceptance and it
is not current target acceptance: V9 moves the target browser family to
Chrome / Brave / Chromium, so the V8 counts stay historical and are not
re-quoted as current results.
