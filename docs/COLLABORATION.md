# Dashboard collaboration

Updated: 2026-10-21 (v4 bundle, marker CODEX-DASHBOARD-PHASES-V4-20261021).
Supersedes the 2026-10-16 collaboration note, which described a
pre-build repository and a different crew arrangement.

## Coordinator rules

- **Muse is the only Jules dispatch coordinator.** Nobody else sends
  messages, approves plans or answers questions on a lane session.
  The build driver cron is verify-only: it reports state changes and
  never nudges a session.
- **One writer per file.** Ownership is recorded in
  [CONTEXT.md](CONTEXT.md). Two workers never edit the same file, the
  same manifest or the same config. The assembler (Track C) is the
  sole writer of the assembled review branch.
- **New Jules sessions** are created only when the bundle authorizes
  one (v4 Track B: exactly one FEEDS replacement), always with
  `requirePlanApproval: true` and the full source resource name. The
  coordinator approves a plan only if it matches the reviewed design
  and the exact file allowlist; any contract or scope change goes to
  Codex before approval.
- **Codex reviews via issue #1.** Patches, hashes and evidence are
  posted to issue #1 of `lullabie/dashboard-cloudflare`. Codex runs
  independent repros and its verdict governs technical disputes. The
  product owner decides product and scope.
- **No merge or deployment in this bundle.** Review branches use the
  `codex/` prefix and non-forced updates. Remote commits, LICENSE
  bytes and upstream notices are preserved.
- **Immutable artifacts.** A delivered patch is never edited. A
  correction is a new patch with a new filename and SHA-256, recorded
  against its base. Prior bundle artifacts (v1/v2/v3) stay untouched.
- **Receipts, not claims.** A dispatch is confirmed by session state
  and updateTime changes read from the Jules API, and a harvest is
  confirmed by byte-comparing the API patch against the saved file.
  Never hand-type an expected hash into a check; compare bytes.
- **Failure handling.** Report a concrete blocker once, with the exact
  failing step, then continue independent work. Do not retry an
  unchanged failing route (no repeated finalize messages, no repeated
  UI harvest attempts, no login or phone-verification requests).
- **Data discipline.** Invented records only, everywhere. The old
  FEEDS session and its stale published branch stay parked as
  evidence; they are never relabeled as the v3 repair.

## Handoff format

Use concise GitHub handoffs on issue #1: role, task owner, base
commit, files in scope, patch hash, exact test commands and labeled
results (STATIC / MOCK / REAL-BROWSER), and the blocking decision if
any. Link documents instead of copying them.
