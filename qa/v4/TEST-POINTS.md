# TEST-POINTS — harness map only

This file maps QA harness files to TEST-IDs. It is not an acceptance registry.
Acceptance state and source-criterion references live in the existing acceptance document owned by Track E.

Snapshot label for frozen-source shape checks in this harness:

`FROZEN-SOURCE SHAPE CHECK ONLY — base 29d43ff04a6abb257b5046c85f2fcba6f0bb679d; STORE patch 8b02dce00f4cd5b3b10bcce05e74f82bec98e0b5382e3e9188ea65d2e5198193; store.js b600175c04e7100e8bb7bb6a8e5cd899f5eb0cb6663cd16f85ad64c22074be11; MAIN patch 00b6939d970fb9b46ff8d6c3effc04a53b658562dd97ee721b3428dc13c3e5c1; HABITS patch 67d9ab66e4527fcfd30c6cb55009f4e3817f0e3d678e989352c79844ae265431; PROGRESS patch ee317ac5b5037f600d3750a1308caae37c803cf4cfcf13a35b78868b70fb8bcb; FEEDS repaired source unavailable in v3/v4 at map time. NOT INTEGRATED ACCEPTANCE.`

| TEST-ID | Harness file | Entry point / group | Boundary | Required precondition |
|---|---|---|---|---|
| TEST-UI-001 | `acceptance.spec.mjs` | `TEST-UI-001` group | REAL-BROWSER required; fixture shape precheck is STATIC | Assembled frozen review commit, local server, isolated browser profile/origin, Playwright or equivalent browser runner |
| TEST-STORE-001 | `acceptance.spec.mjs`; `storage-faults.mjs` | `TEST-STORE-001` group; `installBroadcastChannelFault`, `createReadinessGate` | MOCK harness for gate shape; production case needs real store in Phase 2 | Store source snapshot identified; fault hooks injected only in test harness |
| TEST-STORE-002 | `acceptance.spec.mjs`; `storage-faults.mjs` | `TEST-STORE-002` group; readiness gate recovery model | MOCK harness; production durability needs real IndexedDB reload | Explicit successful init path; reload step for production acceptance |
| TEST-STORE-003 | `acceptance.spec.mjs`; `storage-faults.mjs` | `TEST-STORE-003` group; `CountingBroadcastChannel` | REAL-BROWSER required | Two real tabs on one isolated origin, native BroadcastChannel, real IndexedDB |
| TEST-STORE-004 | `acceptance.spec.mjs`; `storage-faults.mjs` | `TEST-STORE-004` group; `makePostCommitNotificationFailure` | MOCK harness for settlement shape; production case needs real store reload | Commit succeeds first; notification fails after commit; reload checks durable data |
| TEST-FEEDS-001 | `acceptance.spec.mjs`; `feed-responses.mjs`; `dashboard-invented.json` | `TEST-FEEDS-001` group | REAL-BROWSER / module reload required | Repaired feeds source, persisted cache/generation state, module reload, valid refresh response |
| TEST-FEEDS-002 | `acceptance.spec.mjs`; `feed-responses.mjs` | `TEST-FEEDS-002` group; response barriers | REAL-BROWSER two-tab required | Paused refresh in tab A; accepted manual/source/domain edit in tab B; both changes compared after commit |
| TEST-FEEDS-003 | `acceptance.spec.mjs`; `feed-responses.mjs` | `TEST-FEEDS-003` group; ordered fake responses, oversize body, malformed XML, timeout case | MOCK harness for response primitives; production case needs repaired feeds module | Deterministic barrier release order; byte cap and timeout constants recorded from production source when available |
| TEST-HABITS-001 | `acceptance.spec.mjs`; `dashboard-invented.json` | `TEST-HABITS-001` group | MOCK/SHAPE harness; production summary/reload needs assembled app | Habit occurrence values use `{completedAt: ISO}` objects; legacy `true` remains readable |
| TEST-UI-002 | `acceptance.spec.mjs` | `TEST-UI-002` group with subcases below | REAL-BROWSER required | Assembled app, keyboard control, 320x568 viewport, 375px viewport, reduced-motion setting |

## TEST-UI-002 subcases

| Subcase | Meaning |
|---|---|
| TEST-UI-002a | Form rejection retains input |
| TEST-UI-002b | Retry after rejection |
| TEST-UI-002c | Import cancel |
| TEST-UI-002d | Import reject |
| TEST-UI-002e | Import repeat selection of the same file |
| TEST-UI-002f | Export readback |
| TEST-UI-002g | Keyboard focus order and focus return |
| TEST-UI-002h | Layout at 320x568 |
| TEST-UI-002i | Layout at 375px width |
| TEST-UI-002j | Reduced motion |
