# Dashboard context and provenance

Updated: 2026-10-16. This is generic project history, not a personal profile.
Current authority is in [project status](../PROJECT-STATUS.md). The design
contains the full retained product backlog and proposed behavior.

## Decisions and reasons

| State | Project context |
|---|---|
| Selected | Cloudflare Plan B replaces Muse hosting. Normal pages, login, saves and public updates must work while all AI chats are closed. |
| Selected | A fresh private repository holds the clean context and future build. The old repository remains evidence; its length does not justify deleting history. |
| Selected | Required additional service cost is $0. No paid fallback, automatic upgrade or required inference API. |
| Selected | Title Dashboard; Today first; Goals and Updates one view change away; compact black surfaces, lime accents, labeled visuals and expandable cards. |
| Selected | Show notes on card is a display control. Hidden notes are retained. |
| Selected | Daily windows use a saved zone and end at the next local midnight. Preferred time does not change the cutoff. Achievement, adherence and elapsed time are separate. |
| Selected | Preserve honest late records, missed check-ins and correction history. A missing on-time record does not prove the activity did not occur. |
| Selected | Retain Bank of Canada as the first-source candidate. Verify current terms and adapter behavior during implementation. Indicators do not complete news. |
| Proposed | Workers Static Assets, TypeScript Worker, D1, bounded Cron and workers.dev. Actual Free CPU, D1 and unattended operation still need host proof. |
| Proposed | Single-owner GitHub OAuth, generic public shell, private authenticated APIs and the design's R1/R2 split. These await user review. |
| Deferred | Private connectors, private relevance, paid services and optional AI features. Prior research or repository access does not authorize them. |

The first usable surface is Today, working Goals and a real Updates source.
The later scope remains Today/calendar; daily goals and full history; global
and country news; public immigration updates; finance/economy and banking;
investment research without trade execution; jobs and opportunities;
education; offers/deals and price history; weekly reviews with explicit
proposal confirmation; and an importance-led Quick Feed with expandable
stories. See the [design](plan-b/DESIGN-2026-10-16.md) for detail. A placeholder
or a renamed goal history is not a completed Updates module.

## Evidence that must remain available

| Source | Exact reference and disposition |
|---|---|
| Published clean research | [Research at c261da2](https://github.com/lullabie/dashboard/blob/c261da2cb8d56a3a5a219042c8503add416a900f/docs/plan-b/CLOUDFLARE-RESEARCH-2026-10-16.md). Vendor documentation, source review and illustrative arithmetic; not hosted acceptance. |
| Portable reuse candidate | [PR #18](https://github.com/lullabie/dashboard/pull/18), [source at b029cc0](https://github.com/lullabie/dashboard/tree/b029cc002dcbe8b91e39b3c32137dffcd05d93b4/implementation/portable-dashboard). Retain validated-contract, retry, conflict, cache-ordering and recovery invariants; adapt Node/libSQL boundaries to Workers/D1. |
| Portable historical results | 87 checks and seven browser cases were reported on Node/local libSQL. No rerun or Cloudflare pass is implied. Updates and daily occurrence/history DTOs were not implemented by that package. |
| Exact Muse source | [Source at 9eaf20d](https://github.com/lullabie/dashboard/tree/9eaf20de6b7770ce82671385b545bac31de72d0d/audit/source). Presentation/helper reference only. Do not adopt its backend or browser token/draft persistence as accepted behavior. |
| Preserved validator work | [PR #22](https://github.com/lullabie/dashboard/pull/22), last recorded head `e98f08b41188db4a2a422da7b184253cb87f3ba4`, plus unpublished local repair. Preserve; finishing it is not a Plan B prerequisite. |
| Old acceptance contract | [S2 register at c261da2](https://github.com/lullabie/dashboard/blob/c261da2cb8d56a3a5a219042c8503add416a900f/docs/ACCEPTANCE.md). Reuse relevant invariants through the [new acceptance map](ACCEPTANCE.md); old host/stage instructions do not govern Plan B. |
| Historical coordination | [Old issue #1](https://github.com/lullabie/dashboard/issues/1). Preserve as the record for earlier work. |
| Muse Plan B research | [Research and disposition](research/MUSE-CLOUDFLARE-2026-10-16.md). Additional reference; proposals and estimates remain separate from user choices and measured results. |

Known reasons for selective reuse: the portable source uses host-specific
Node/libSQL boundaries and its receipt growth needs explicit bounds. The
Muse backend can record success after a zero-row write, and its check-in
request does not bind a resolved occurrence. Old feed code needs bounded
bodies, valid-document checks, per-series dates and durable job deduplication.
These defects are not erased by moving repositories.

## Transfer boundary

Carry only reviewed generic documents now. Later source reuse needs an exact
file allowlist and retained notices. Do not import old Git metadata, private
data, credentials, database files, recordings, screenshots, raw partner
packets, generated output or dependencies. Keep current instructions short;
link historical evidence instead of copying obsolete hosting authority.

The fresh repository is an organizational change. It does not grant app,
deployment, resource-creation, schedule, merge or private-data permission.
No historical failure becomes a pass through this transfer.
