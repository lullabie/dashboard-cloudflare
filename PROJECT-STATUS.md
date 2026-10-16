# Dashboard project status

Updated: 2026-10-16. Stage: new private repository; design review pending.

The user requested a new repository and a clean project context, and asked
that Muse and Jules be told. The repository is
[dashboard-cloudflare](https://github.com/lullabie/dashboard-cloudflare), with
initial main commit `33360347acada8af00d08e4c85d06c536197cdbf`. This authorization
does not extend to app implementation, Cloudflare resources or release.
Muse and Jules were notified in their existing project conversations; no
implementation was dispatched. Jules acknowledged the handoff and preserved the
old task. The user confirmed enabling all-repository GitHub access for Jules and
selecting this repository; checkout/read execution remains to be verified in a
later approved task. Muse confirmed read access at the initial
commit. Later-commit review and write access remain separate evidence. Use
the verified [coordination issue #1](https://github.com/lullabie/dashboard-cloudflare/issues/1).

The earlier repository and PRs stay intact. This is a reviewed context
transfer, not a full source migration. See [context and provenance](docs/CONTEXT.md).
Cloudflare research is complete; reuse it. The old Muse hosting requirement
is superseded. Muse is optional support, not a hosting or approval dependency.
Do not restart the prior validator repair or dispatch Jules.

The proposed build uses Workers Static Assets, a TypeScript Worker API, D1
and bounded Cron at a free workers.dev address. Normal use must work with
all AI chats closed. The main technical gate is measured compliance with
the Free CPU allowance, plus actual D1 atomicity, durable owner login and
unattended source updates. No host proof is claimed.

Read the [design](docs/plan-b/DESIGN-2026-10-16.md),
[plan](docs/plan-b/IMPLEMENTATION-PLAN-2026-10-16.md),
[completed research](docs/plan-b/CLOUDFLARE-RESEARCH-2026-10-16.md) and
[Muse research disposition](docs/research/MUSE-CLOUDFLARE-2026-10-16.md).
Research suggestions for R2 storage, paid tiers or other services are not
approved scope. Required additional service cost remains $0.

Before implementation, settle only the material design choices:

- Single-owner GitHub OAuth or Cloudflare Access under its documented onboarding condition.
- Generic public shell with private APIs, or authenticated HTML/assets too.
- The proposed first-release boundary and specific occurrence/history rules.

GitHub OAuth and a generic public shell are proposals, not recorded user
choices. Retain the black/lime expandable design and Bank of Canada first
source; rates alone do not complete news. Calendar days end at the next local
midnight. Keep late records and missed check-ins honest.

Next: review the concrete design, resolve those choices and authorize a bounded
implementation scope. Account creation, database/OAuth setup, schedules,
deployment, private-data transfer, billing changes and merges remain outside
the current scope. All new-host acceptance cases are **NOT RUN**.
