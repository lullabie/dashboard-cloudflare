# Contract — unattended public news refresh (`dashboard-api`)

- Date: 2026-10-23
- Status: **DESIGN REVIEW ONLY.** This contract, its source (`src/`), and its
  tests (`test/`) are published on the review branch for Codex review.
  **No KV namespace, no Worker, and no cron trigger have been created.**
  Resource creation and schedule activation happen only after this review
  passes and the user confirms (M3).
- Design origin: `WORKER-REFRESH-API-BRIEF-2026-10-23` (coordinator brief,
  2026-10-23), hardened into a concrete contract per the Codex check of
  2026-10-23.
- Explicitly not claimed: the M1 static deployment at
  `dashboard.mnoamanhussain.workers.dev` is **not** scheduled-refresh
  acceptance. It fetches in the browser only.

## 1. Shape

One additional Worker, `dashboard-api`, separate from the assets-only
`dashboard` Worker. The static launch stays untouched.

| Piece | Value |
|---|---|
| Worker | `dashboard-api` (new, not yet created) |
| Source (fixed, approved) | CBC News — Top Stories RSS, `https://www.cbc.ca/webfeed/rss/rss-topstories` — public, no key, no account |
| Schedule | Cron `*/15 * * * *` (every 15 min, 96 invocations/day, 1 of 5 free cron triggers) |
| Store | One KV namespace `dashboard_cache` (not yet created), two keys (§3) |
| Out of scope v1 | D1, queues, extra routes, extra sources, private/authenticated sources, inference APIs, user data |

## 2. Routes

| Method + route | Behavior |
|---|---|
| `GET /api/news` | Read-only. Returns the stored envelope plus computed `age_seconds` and `stale` (§4). Never triggers a fetch. Headers: `Content-Type: application/json`, `Cache-Control: public, max-age=300`, `Access-Control-Allow-Origin: https://dashboard.mnoamanhussain.workers.dev` (only). |
| `POST /api/refresh` | Manual refresh. Same code path as the cron handler with `trigger: "manual"`, `cron: null`. Returns `{outcome}` (200, or 502 on `outcome: "error"`). |
| anything else | `404 {"error":"not found"}` |

## 3. KV / cache shape

Namespace `dashboard_cache`, keys:

| Key | Value | Lifetime |
|---|---|---|
| `news:topstories` | The envelope (§4), JSON | Persistent; only ever replaced per §5 |
| `news:refresh-lock` | `{"started_at": ISO, "trigger": "scheduled"\|"manual"}` | `expirationTtl` 600 s; deleted at the end of every attempt |

## 4. Envelope and freshness metadata

Stored value of `news:topstories`:

```json
{
  "source": "cbc-topstories",
  "source_url": "https://www.cbc.ca/webfeed/rss/rss-topstories",
  "fetched_at": "<ISO of last SUCCESS, or null>",
  "last_attempt_at": "<ISO of most recent attempt>",
  "status": "ok | error",
  "error": "<short string ≤200 chars, or null>",
  "trigger": "scheduled | manual | null (producer of the stored items)",
  "cron": "\"*/15 * * * *\" | null (set iff trigger = scheduled)",
  "attempt_trigger": "<only after a failed attempt: who tried>",
  "attempt_cron": "<only after a failed attempt: cron expr or null>",
  "items": [ { "title": "≤300 chars, tags stripped", "link": "http(s) URL", "published": "as published" } ]
}
```

Read-time computed fields on `GET /api/news`:

- `age_seconds`: now − `fetched_at` (null when no success yet).
- `stale`: `true` when `age_seconds` is null or > 1800 (30 min = two missed cycles).

Empty state: before the first success, the read returns the envelope shape
with `items: []`, `status: "error"`, `error: "no successful fetch yet"`,
`stale: true`. The frontend renders its existing empty/error state; no
special case.

## 5. Refresh algorithm and last-good retention

1. **Overlap check.** If `news:refresh-lock` exists and is younger than
   600 s, the attempt ends as `skipped-overlap`: **no fetch, no envelope
   write**. Otherwise the lock is written (TTL 600 s).
2. Fetch `source_url` with `AbortSignal.timeout(8000)`.
3. Validate in order: HTTP status must be ok → body read with a hard
   512 KiB cap (declared `Content-Length` checked first; streamed reads
   abort past the cap; oversize is an error, never a partial parse) →
   body must parse as RSS with ≥ 1 usable item (title non-empty, link
   http(s)); items are capped at 20, titles at 300 chars, HTML stripped.
4. **Success:** the envelope is replaced wholesale; `fetched_at` =
   `last_attempt_at` = now, `status: "ok"`, `error: null`, `trigger` and
   `cron` record the producer.
5. **Any failure** (timeout, HTTP error, oversize, parse error, zero
   items): the previous envelope is written back with **items and
   `fetched_at` byte-identical**; only `last_attempt_at`, `status:
   "error"`, `error`, `attempt_trigger`, `attempt_cron` move. Last-good
   data survives every failure, indefinitely.
6. The lock is deleted in a `finally` block.

## 6. Scheduled vs manual — distinguishable in the data

- The cron handler passes `trigger: "scheduled"` and `cron: event.cron`.
  Both are stored on success (`trigger`, `cron`) and on failure
  (`attempt_trigger`, `attempt_cron`).
- `POST /api/refresh` passes `trigger: "manual"`, `cron: null`.
- Therefore any stored envelope proves how its items (or its last failed
  attempt) were produced. A test asserts both directions
  (`test/refresh.test.mjs`, "scheduled execution is distinguishable…").

## 7. Bounds summary

| Bound | Value |
|---|---|
| Fetch timeout | 8 s |
| Response body cap | 512 KiB |
| Items kept | 20 |
| Title length | 300 chars |
| Error string | 200 chars |
| Cron interval | 15 min (96 runs/day) |
| Stale threshold | 30 min |
| Lock TTL | 600 s |
| KV keys | 2 (1 data + 1 lock) |

## 8. $0 budget (Workers/KV Free, platform record 2026-10-23)

| Resource | Free limit | This design |
|---|---|---|
| Worker requests | 100,000/day | 96 cron invocations/day + single-user `GET /api/news` reads |
| Cron triggers | 5 | 1 |
| KV reads | 100,000/day | ≤ 2 per refresh (lock + last-good on failure) + 1 per `GET` |
| KV writes | 1,000/day | ≤ 3 per refresh (lock put, envelope put, lock delete) = ≤ 288/day |
| KV storage | 1 GB | 1 envelope, ≤ ~30 KiB |
| CPU | 10 ms/invocation | **Open measurement gate (§9).** Local proxy only: Node parsed a 512 KiB body in ~2.2 ms (2026-10-23, `parseRss` benchmark, this package). That is not a Workers CPU measurement. |

Workers Paid ($5/mo) remains the recorded escape hatch, not a plan step.

## 9. Acceptance gates for M3 (build time, not waived by this review)

- Measured Workers CPU per cron invocation recorded against the 10 ms
  limit. If parsing exceeds it, the fallback is a smaller body cap —
  decided at review, never silently.
- Kill the source (block the URL) → `GET /api/news` still returns
  last-good items with `status: "error"` and a populated `error`.
- Two missed cycles → `stale: true` at read time.
- Oversize test body → rejected, last-good preserved.
- The tests in `test/` pass (they already pass locally against this
  source: 10/10, Node v24, 2026-10-23 — see `TEST-RESULTS.md`).

## 10. Frontend change (M3 only, not in this package)

The news section requests `GET /api/news` for this one source instead of
fetching the RSS URL in the browser, and renders `stale`/`error` from the
envelope using the dashboard's existing stale-badge pattern. All other
sections and feed URLs keep the M1 browser-fetch behavior.
