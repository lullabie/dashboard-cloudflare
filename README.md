# Dashboard

Public repository for the Dashboard personal web app: a single-user,
local-first personal dashboard (Today, Goals, Habits, Updates/feeds,
Countdowns, College, Jobs, Maps, Investments and visual explorers).

## Actual stack (current)

- Vanilla JavaScript, ES modules. No build step. No framework. No TypeScript.
- Data lives in the browser: an IndexedDB store with a tracked-snapshot
  contract (`getData()` snapshots; `saveData()` accepts only tracked
  snapshots and rejects untracked or stale input).
- Cross-tab updates use BroadcastChannel; concurrent writes use Web Locks
  where available, with compare-and-swap rejection otherwise.
- JSON export/import is the durability and recovery layer.
- Hosting is static files only (index.html, css/, js/, LICENSE).

## Historical plan (not current)

The Cloudflare Workers + D1 + React/TypeScript backend design in
`docs/plan-b/` (2026-10-16) is historical. It was never accepted or deployed.
Backend status: **UNACCEPTED**. No Worker, D1 database, OAuth app or
scheduled update is part of the current product. See
[PROJECT-STATUS.md](PROJECT-STATUS.md).

## Read in this order

1. [Project status](PROJECT-STATUS.md) for authority, current work and open decisions.
2. [Project context](docs/CONTEXT.md) for crew roles, file ownership and rules.
3. [Collaboration](docs/COLLABORATION.md) for coordinator rules.
4. [Tooling](docs/TOOLING.md) for runtimes and the single review test command.
5. [Acceptance registry](docs/ACCEPTANCE.md) for gate status (single registry).
6. [Build blueprint](docs/BUILD-PLAN.md) and [roadmap](docs/ROADMAP.md) for product scope history.
