# Muse research: Cloudflare plans deep dive

Read in the Muse project on 2026-10-16. The complete report text below is preserved as partner research, with formatting normalized. Its labels, assertions and recommendations are Muse's, not new Astra verification or user authorization. The underlying 61-entry ledger and appeal files were not inspected or imported. No personal chat content is included.

## Astra disposition

- The proposed Workers Static Assets / Worker / D1 / Cron stack matches the completed Plan B research.
- Keep the $0 boundary. The report's instruction to flip to Paid is not accepted. Cloudflare R2 object storage is not part of the baseline.
- Usage estimates and a platform-wide average CPU figure do not prove this application fits. Actual CPU, D1 atomicity/counters and unattended feed tests remain required.
- The 12,000 writes/day arithmetic omits possible index/checkpoint/amplification costs. Use measured counters. The 500-row / 25-statement example depends on bound parameters per row and does not budget all other invocation work.
- A daily quota can reset at midnight UTC; CPU and storage failures do not become valid merely by waiting for that reset. The report's general hard-stop sentence must not erase that distinction.
- Claims about alternative vendors are retained as attributed research only; they are not needed to select this design and were not re-investigated here.
- On 2026-10-16 Muse confirmed read access to the new repository at initial commit 33360347 and supplied the source links below. It acknowledged the no-paid/R2 boundary and host-test gates.

## Primary links supplied by Muse

[D1 limits](https://developers.cloudflare.com/d1/platform/limits/) · [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) · [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) · [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

These are provenance links supplied with the report, not a claim of fresh source verification by this import. Recheck the relevant behavior during implementation.

## Preserved report text

> Cloudflare Plans Deep Dive — 2026-10-16
> 
> Verdict (full court, appeal 3-0 UPHOLD, confidence MEDIUM): Workers Free at $0/month covers the whole dashboard stack. Workers Paid ($5/mo) is the documented escape hatch. Reject Render free and Turso.
> 
> Trial record: ~/workspace/court-trials/cloudflare-plans/ (charge sheet, briefs A2/B2, 61-entry evidence ledger, lawyer filings, verdict, 3 appeal rulings).
> 
> The $0 stack
> Frontend: Workers Static Assets — requests free and unlimited, 20,000 files per version (Verified, pricing page)
> API: one Worker — 100,000 requests/day, 10 ms CPU per invocation; network waits (fetch, D1 queries) do not count toward CPU; average Worker uses ~2.2 ms (Verified)
> Database: D1 — 5M rows read / 100K rows written per day, 500 MB max per database, 10 databases, 50 queries per invocation; rows read = rows scanned, so indexes are mandatory (Verified)
> Scheduled feeds: one Cron Trigger (5 allowed on Free) — 10 ms CPU per invocation, 15-minute wall time (Verified)
> Files: R2 — 10 GB-month/mo, 1M Class A + 10M Class B ops/mo, egress free (Verified)
> Headroom for a single-user dashboard (Inferred, stated assumptions: 10 feeds x 50 items/hour)
> Page requests: 100-500/day vs 100K cap — ~200x headroom
> Cron invocations: 24/day vs 100K cap — negligible
> D1 writes: ~12,000/day vs 100K cap — ~8x headroom (tightest meter)
> 10x feed growth breaks the D1 write cap — the scaling boundary is known
> Binding constraints (design around these)
> 10 ms CPU per cron invocation is the binding technical constraint. Keep the hourly feed job lean: fetch waits are free, parsing burns CPU. Error 1102 on exceed.
> 500 MB per database — design a bounded retention window for feed items. Not the 5 GB account total.
> Free limits are hard stops until the 00:00 UTC reset. No grace.
> KV is unusable as a feed store — only 1,000 writes/day on Free. Config only.
> 50 queries per Worker invocation counts statements, not batch calls — batch multi-row INSERTs (500 rows fit in ~25 statements).
> Escape hatch
> 
> Workers Paid: $5/mo minimum — 10M requests + 30M CPU-ms included, 15-minute cron CPU on hourly intervals, 250 cron triggers. Flip to this if the 10 ms cron CPU cap or daily meters bind. No code changes needed.
> 
> Rejected alternatives
> Render free: web services spin down after 15 idle minutes (Render's own docs confirm); sleeping containers kill internal timers (practitioner, Oct 2026); free Postgres expires 30 days after creation. Sleep directly breaks the hourly-cron requirement.
> Turso: free-tier figures are single-source and predate October; Supabase announced the Turso acquisition on Oct 2, 2026 with no pricing-continuity commitment and close undisclosed. Second vendor, acquisition risk, zero needed capacity gain. Re-check turso.tech/pricing at build time if curious.
> Caveats (honestly graded)
> Every primary figure traces to one corporate origin: Cloudflare's own docs. "Verified" here means dual-page confirmation, not two independent origins. If Cloudflare's docs are wrong, the figures fail together. Confidence is MEDIUM, not HIGH, for this reason.
> Usage projections are Inferred on stated assumptions, not measured.
> Figures observed 2026-10-16 on live docs (Workers pricing page updated 2026-10-02, Workers limits 2026-10-12, D1 limits 2026-04-21, R2 pricing 2026-10-01, KV 2026-04-21, Cron Triggers 2026-09-04). Re-verify at build time; free tiers change.
> Discrepancies the debate caught and fixed
> "Free has no Durable Objects" — struck as false; Free gets SQLite-backed DOs (100K req/day, 13,000 GB-s/day).
> "Cron invocations count against the request limit" was over-graded as Verified; the linkage is Inferred. Immaterial at 24/day.
> "Years of rows fit in 5 GB" used the wrong boundary; the binding limit is 500 MB per database.
> "Supabase acquired Turso" overstated; the evidence is an announced acquisition, close undisclosed.
> Static-assets sentence was misattributed to the limits page; it lives on the pricing page.
