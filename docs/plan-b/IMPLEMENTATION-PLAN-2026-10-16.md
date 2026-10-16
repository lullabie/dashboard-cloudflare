# Dashboard Plan B implementation plan

Date: 2026-10-16. Proposed, not started. Read the [design](DESIGN-2026-10-16.md) first.
Use the executing-plans skill for later inline execution, task by task. No agent or Jules dispatch is authorized by this plan.

**Goal:** Deliver durable Today, Goals and real Updates, then daily history and news.
**Architecture:** React Static Assets, one TypeScript Worker, D1 and bounded Cron on one origin.
**Stack:** TypeScript, React, Cloudflare runtime tests and browser tests. Select and pin `cf` plus compatible build/test dependencies in task 1; verify required commands against that exact version. No toolchain was installed for this plan.

## Constraints and working files

Required additional service cost stays $0. Invented records only. Design approval precedes app work. Account/resource creation, OAuth registration, hosted deployment and schedules each remain outside the present authorization; prepare concrete configuration before requesting the necessary host scope. No automatic deployment workflow.

Work in `implementation/cloudflare-dashboard/` in the new private `lullabie/dashboard-cloudflare` repository on an isolated `codex/` branch from verified remote main. Its initial commit is `33360347acada8af00d08e4c85d06c536197cdbf`; use the later verified context commit when executing. Keep old packages outside new build inputs. Copy reviewed files individually from the exact old-repository refs in the design, retaining provenance/notices. Do not bulk-add or push the old local workspace.

Proposed paths within that package:

- `shared/contracts.ts`: strict DTOs and limits.
- `worker/index.ts`, `worker/auth.ts`: routing and owner sessions.
- `worker/store.ts`, `worker/receipts.ts`, `migrations/0001_core.sql`: D1 state and atomic operations.
- `worker/feeds/runner.ts`, `worker/feeds/bank-of-canada.ts`: bounded ingestion.
- `worker/recovery.ts`: coherent export and guarded restore.
- `client/src/{App,Today,Goals,Updates}.tsx`, `client/src/api.ts`: UI and recovery states.
- `shared/occurrences.ts`, `worker/history.ts`, `migrations/0002_history.sql`: R2 daily contract.
- `tests/{auth,store,feeds,recovery,history}.test.ts`, `tests/browser.spec.ts`: focused evidence.
- `package.json`, lockfile, `cloudflare.config.ts`: pinned runtime/build configuration; no enabled remote schedule until authorized.

Define package scripts `check` (types), `test` (runtime tests), `build` (client/Worker build), `test:browser` and `test:host` (explicit isolated-target integration). The last script must refuse production bindings. Commands below are the required future script interface, not existing commands or claimed results.

## Ordered tasks

### 1. Prove auth and D1 correctness before UI expansion

- [ ] After design approval, inspect exact reusable source, pin the toolchain and implement the package scripts. Verify local assets, D1 migrations and runtime-test support before accepting the selected CLI version; report a blocking compatibility issue rather than silently switching tools.
- [ ] In `shared/contracts.ts`, define `MutationRequest`, `MutationResult` and `Snapshot` with server-issued operation ID/ticket, full semantic digest, generation, record revision, restore version and strict limits from the design. In `worker/store.ts`, expose `mutate(request, owner): Promise<MutationResult>` and `readSnapshot(owner): Promise<Snapshot>`; in `worker/auth.ts`, expose `requireOwner(request, env): Promise<Owner>`.
- [ ] First write failing `auth.test.ts`/`store.test.ts` cases: unauthenticated/non-owner denial, callback state replay, wrong Origin/CSRF, expired/revoked sessions, zero-row write, mid-batch failure, two concurrent identical operations, changed payload/precondition under one ID, same-record conflict, two different-record edits surviving internal version races, expired ticket without receipt, attempted old-ID ticket renewal, receipt capacity race and lost-response replay. Assert one mutation/version advance per successful operation or none, never partial success.
- [ ] Implement Worker routing, D1 migrations, signed tickets, receipts and consistent reads. Run `npm run check`, `npm test -- tests/auth.test.ts tests/store.test.ts`, then `npm run build`; require zero failures.
- [ ] Prepare an invented-data host proof with distinct D1 and auth configuration. Obtain only the still-required resource/deployment authorization. Run `npm run test:host -- --suite auth-store` after that authorization; record actual CPU and D1 counters, cold/warm behavior, commit and binding isolation. Stop if Free CPU or atomicity fails. Commit only reviewed task files.

### 2. Prove a real bounded source update

- [ ] Verify Bank of Canada terms, attribution, response size, observation dates and conditional-request behavior at implementation. Record the source URL and review date beside the adapter; do not ask the user to repeat the source preference.
- [ ] Define `runDueSource(env, now): Promise<JobResult>` and `parseBankOfCanada(bytes): SourceBatch`. Write failing `feeds.test.ts` cases for decoded overflow, invalid body, redirects, timeout, 304 with/without cache, mixed observation dates, duplicate ticks and an expired lease racing a newer worker. Assert old cache survives every failed batch.
- [ ] Implement the design's one-source/25-change limits, fenced commit, backoff and source status. Run `npm test -- tests/feeds.test.ts`; require zero failures. Measure the largest admitted valid and invalid inputs on the isolated host.
- [ ] Under separately authorized schedule scope, demonstrate a later scheduled fetch changes D1 and appears after browser reload while AI chats are closed. Record attempt/success timestamps and source evidence; a manual trigger alone fails this acceptance case. Commit the adapter and evidence.

### 3. Deliver and review R1 Today / Goals / Updates

- [ ] Implement the four UI components using the approved black/lime and expansion controls. Goals call task 1; Updates reads task 2. Keep notes hidden without deleting them. Show manual progress as manual and indicators as indicators.
- [ ] Add browser cases for create/edit/archive/reopen, date ordering, reload persistence, concurrent-tab conflict, lost response, late historical response, draft recovery, logout clearing across tabs, empty source, stale source and full keyboard operation. Include narrow mobile layout, focus return after expansion and text labels on color states.
- [ ] Run `npm run check`, `npm test`, `npm run build`, `npm run test:browser`. Review the complete R1 diff and host evidence once. Any requested fix gets its affected checks rerun. No news or daily-history completion claim is permitted.

### 4. Make recovery and capacity release-ready

- [ ] Expose `exportSnapshot(owner): Promise<ExportEnvelope>`, `previewRestore(owner, bytes): Promise<RestorePreview>` and `confirmRestore(owner, request): Promise<MutationResult>` from `worker/recovery.ts`. Use the receipt protocol; preserve old results across user-data restoration.
- [ ] Write `recovery.test.ts` cases for the explicit restore transport exception (5 MiB export data plus 8 KiB metadata), ordinary 32 KiB rejection, decoded overflow, Unicode/escaping overhead, concurrent near-capacity writes, changed preview bytes/version, lost restore response followed by a later edit, and old-generation retry. Assert exact original receipt and preservation of the later edit.
- [ ] Run `npm test -- tests/recovery.test.ts` and `npm run test:host -- --suite recovery` on the authorized isolated target. Measure maximum admitted export/restore CPU and row counts. Rehearse database recovery with external session-epoch rotation; assert every old session fails. Reduce admission bounds and retest if necessary.
- [ ] R1 release gate: tasks 1–4 evidence plus source/terms review and design acceptance. Map S2-08, S2-19–27 and applicable earlier save/export cases to actual new-host results; preserve NOT RUN elsewhere. Present the tested candidate for release approval. Do not merge/deploy production under this planning task.

### 5. Implement R2 history, then the separate news adapter

- [ ] Define `resolveOccurrence(scheduleVersion, localDate): Occurrence` in `shared/occurrences.ts`; extend DTOs with explicit occurrence identity, activity time, receive time and quantity/unit. Implement immutable schedule segments and append-only corrections in the R2 files.
- [ ] Write `history.test.ts` for start/end inclusion, partial start, next-day pause, midnight receive/retry, 23/25-hour days, zone-transition gap, late corrections, target change, early quantity finish, invalid measured Done and archived/reopened goals. Assert distinct-occurrence adherence never exceeds 100%, current open days are excluded, past missed days never disappear after edits and no future quantity/check-in is invented.
- [ ] Run `npm test -- tests/history.test.ts`, browser history cases and isolated host midnight/concurrency cases. Prove missing-day history works with Cron disabled. Extend export/restore tests to all new records before enabling daily tracking.
- [ ] Select one permitted news source on technical/source terms; verify actual adapter behavior and reuse task 2's bounds/tests. Add source/date/link/excerpt cards. Mark news delivered only after a genuine scheduled story update; retain the remaining backlog in the design for later bounded increments.

## Review focus and stop conditions

Five practical failures have explicit owners: callback replay (task 1), receipts lost to cleanup (task 1), stale workers overwriting a good feed (task 2), history responses replacing a newer tab state (task 3), and restored sessions regaining access (task 4). R2 adds midnight and travel cases in task 5.

Each task ends with reviewed scoped files and recorded commands/results. Historical 87 checks/seven browser cases are source references only. No app tests were run during this documentation task. If account eligibility, Free CPU, source permission or D1 guarantees fail, record the actionable issue on GitHub and revise the smallest affected design. Do not resume the Muse validator, dispatch Jules, change billing or add a new service as a workaround.
