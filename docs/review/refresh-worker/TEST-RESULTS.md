# Test results — refresh-worker review package

- Run: 2026-10-23, coordinator sandbox, Node v24.22.1, `node --test`
- Command: `node --test docs/review/refresh-worker/test/refresh.test.mjs`
- Result: **10 pass, 0 fail** (duration ~226 ms). KV and fetch are fakes;
  no network, no Cloudflare account touched.

| # | Test | Contract claim proved |
|---|---|---|
| 1 | successful refresh stores parsed, bounded items | §5 success path; tag stripping + entity decoding |
| 2 | item cap and title truncation hold | §7 bounds (20 items, 300 chars) |
| 3 | failed fetch cannot replace last-good data | §5 last-good retention: items + `fetched_at` byte-identical after a network failure; attempt metadata moves only |
| 4 | malformed body cannot replace last-good data | §5: non-RSS body = error, last-good kept |
| 5 | HTTP error and oversize body cannot replace last-good data | §5/§7: `http 500`, 512 KiB cap enforced |
| 6 | failure before any success yields the empty-state envelope | §4 empty state |
| 7 | UI reads the cache: GET /api/news returns the stored envelope with freshness | §2/§4: read path returns exactly the stored items; `age_seconds`/`stale` computed at read; stale at 31 min |
| 8 | scheduled execution is distinguishable from manual invocation | §6: cron handler stores `attempt_trigger: "scheduled"` + `attempt_cron: "*/15 * * * *"`; manual stores `trigger: "manual"`, `cron: null` |
| 9 | overlap: a fresh lock makes the attempt a no-op | §5.1: no fetch, envelope untouched, outcome `skipped-overlap` |
| 10 | parseRss rejects non-feeds and items without http links | §5.3 usable-item rule |

Local CPU proxy (not a Workers measurement): `parseRss` on a 512,906-byte
body took ~2.15 ms in Node; the capped read took ~1.49 ms. The binding
10 ms Workers CPU gate remains an M3 build-time measurement (CONTRACT §9).
