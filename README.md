# Dashboard

Private repository for the Cloudflare Plan B design and the next Dashboard build.
Current stage: design review and context transfer. No application or Cloudflare
deployment is delivered by this repository setup.

Read in this order:

1. [Project status](PROJECT-STATUS.md) for authority, current work and open decisions.
2. [Project context](docs/CONTEXT.md) for decisions, retained scope and source history.
3. [Clean handoff](docs/plan-b/NEW-CHAT-HANDOFF.md).
4. [Design](docs/plan-b/DESIGN-2026-10-16.md) and
   [implementation plan](docs/plan-b/IMPLEMENTATION-PLAN-2026-10-16.md).

The proposed stack is Workers Static Assets, a TypeScript Worker API, D1 and
bounded Cron. Today opens first; working Goals and a real Updates source form
the first release surface. Keep the black/lime appearance, expandable details
and complete later backlog. Required additional service cost stays **$0**.

Use [working instructions](AGENTS.md), [collaboration rules](docs/COLLABORATION.md),
[tool policy](docs/TOOLING.md) and [acceptance gates](docs/ACCEPTANCE.md).
The first implementation requires review of the concrete design and the
remaining material choices. Repository creation is not deployment permission.

[The earlier repository](https://github.com/lullabie/dashboard) remains the
historical source and evidence record. Do not copy its whole workspace or
resume the old Muse validator cycle. Exact references are in the context file.

This repository contains generic project material only. Personal context,
credentials, private connector records, databases and raw partner packets
remain excluded. No application redistribution licence is asserted here.
