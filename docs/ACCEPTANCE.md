# Dashboard Cloudflare acceptance map

Updated: 2026-10-16. Every new-host case below is **NOT RUN**.
This is a gate map for later authorized work, not permission to provision,
deploy, enable schedules or release. The [design](plan-b/DESIGN-2026-10-16.md)
defines proposed behavior; material choices still need review.

Use the relevant invariants from the
[historical S2 register](https://github.com/lullabie/dashboard/blob/c261da2cb8d56a3a5a219042c8503add416a900f/docs/ACCEPTANCE.md).
Historical Muse-host stage ordering and builder instructions do not govern
Plan B. Record any deliberate contract change explicitly before acceptance;
do not call an incompatible replacement an unchanged invariant.

| Gate | Required result | Historical mapping | Status |
|---|---|---|---|
| Owner and transport | Deny unauthenticated/non-owner direct access to private reads, writes, receipt lookup, export and restore. Prove OAuth state replay denial, Origin/CSRF checks, durable expiry/revocation and logout clearing across tabs/resume. | S2-08, 09, 25 | NOT RUN |
| Atomic mutation | Strict validation, generation/record/version assertions, zero-row failure and whole-batch rollback including receipt insertion. No fixture/fault endpoint in production configuration. | S2-03, 18, 19, 26, 27 | NOT RUN |
| Concurrency and replay | Actual simultaneous duplicate/conflicting requests; one semantic mutation and version advance. Reject changed semantic content under the same ID. Preserve the reviewed different-record concurrency rule. Frozen retries resolve lost responses; receipt expiry/capacity cannot cause re-execution. | S2-04, 05, 06, 07, 14, 20 | NOT RUN |
| Coherent client state | Authoritative reload persistence and consistent snapshots. Historical receipts or delayed queries cannot replace newer state. Preserve drafts through conflicts and unknown outcomes. | S2-02, 14, 22 | NOT RUN |
| Recovery and capacity | Complete coherent export; strict size/shape validation; owner/digest/live-version-bound restore preview and confirmation; atomic replacement into a fresh generation. Preserve receipts and later edits on retries. Test capacity races and the maximum admitted restore body. | S2-11, 12, 13, 16, 17, 21, 23, 24 | NOT RUN |
| Database recovery | Isolated recovery rehearsal with session-epoch rotation outside restored D1 state. Restored rows cannot revive revoked sessions. Code rollback is not a data restore. | New Cloudflare case | NOT RUN |
| Real Updates | Permitted Bank of Canada adapter with attribution, actual per-series observation dates and freshness. Preserve cache on malformed/oversized/failed inputs. Prove fencing, duplicate ticks, conditional requests and a later unattended scheduled update with AI chats closed. | Historical public-feed gate, adapted | NOT RUN |
| Usable R1 | Today, working Goals and actual Updates on one address; create/edit/archive/reopen, notes display, error/empty/stale states, keyboard/focus, narrow layout and text labels on color states. No daily-history or news completion claim for indicators/manual progress. | S2-02, 10, 15 plus new feed UI | NOT RUN |
| Free host fit | Actual HTTP/Cron CPU, scanned/written rows, isolated binding, auth/read/write/conflict/export and worst admitted valid/invalid feed input. No automatic paid fallback when a limit fails. | S2-16 plus new host cases | NOT RUN |
| R2 daily history | Occurrence-bound Done; next local midnight; partial start, pause/resume, 23/25-hour days, zone transitions, units/target changes, late entries/corrections and archive/reopen. Distinct closed eligible occurrences define adherence. Cron absence cannot erase missed days. | Extended S2-10 plus new history cases | NOT RUN |
| R2 news | Separate permitted headline source with actual story dates, link, permitted excerpt, deduplication and a genuine scheduled story update. Rates do not satisfy news. | New source case | NOT RUN |

Each executed result must name its exact commit, runtime/tool versions,
adapter and isolated binding; give the command or reproducible steps,
invented inputs, expected result, observed result and PASS/FAIL/NOT RUN.
Record failures even if a later run passes. Partial coverage does not pass
a full gate. Use separate concurrent requests for concurrency evidence.
Compare all affected tables for rollback and nonmutation cases.

No production dataset may be reset for testing. Preview authentication does
not establish database isolation. Exclude bodies, credentials and private
records from logs and reports. A configured Cron or manual trigger does not
prove an unattended update. A local runtime/model pass does not establish
host CPU or D1 behavior. A download click does not prove a durable backup.

Release requires the reviewed scope, applicable R1 gates, independent diff
review and explicit release authorization. R2 and later modules keep their
own unrun gates until implemented and tested. Retain the full backlog; do
not use deferred work to label the initial release complete for that scope.
