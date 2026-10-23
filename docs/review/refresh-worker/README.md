# refresh-worker — design review package

Status: **DESIGN REVIEW ONLY — nothing here is deployed or scheduled.**

- `CONTRACT.md` — the concrete contract: routes, 15-minute schedule, fixed
  approved source, KV/cache shape, last-good retention, bounds,
  error/freshness metadata, overlap behavior, $0 budget.
- `src/refresh.js` — the refresh core (zero dependencies; runs under Node
  for tests and under Workers via the entry below).
- `src/worker.js` — Worker entry wiring (`fetch` + `scheduled` handlers).
- `test/refresh.test.mjs` — contract tests; run with
  `node --test docs/review/refresh-worker/test/refresh.test.mjs`.
- `TEST-RESULTS.md` — the recorded local run (10/10 pass, 2026-10-23).
- `wrangler.example.jsonc` — config sketch with a placeholder KV id.
  Not a deployable config.

No KV namespace, Worker, or cron trigger exists for this package.
Creation and activation wait for design review + user confirmation (M3).
No credentials or private source data appear anywhere in this package;
the only source is a public RSS feed.
