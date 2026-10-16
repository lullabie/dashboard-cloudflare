# Dashboard tool policy

Updated: 2026-10-16. Check current session availability before use.

Use a relevant installed capability when it improves the task. Inspect
permissions before declaring an integration unavailable. Discover a missing
skill when needed and within the $0 limit; do not install duplicates. A
skill is an instruction set, not a test pass or runtime capability.

| Capability | Recorded status and use |
|---|---|
| GitHub connector | New private-repository access verified for this handoff. Use reviewed file scopes and read back published changes. Connector authentication does not prove Git CLI authentication. |
| Superpowers skills | Available for design, planning, review, debugging and evidence checks. Apply relevant workflows without repeated review loops that add no changed testable result. |
| Cloudflare / Workers skills | Installed from official `cloudflare/skills` at `be9f5e1e940fcf8567ff723cc03b8a8448c4082f`, with Apache-2.0 provenance. Installation created no product CLI, account, service or deployment. |
| Browser / Playwright / browser-qa | Available for permitted browser interaction and later isolated UI verification. Availability does not demonstrate this app's behavior. |
| click-path-audit / Ponytail | Available for state-flow and code review when code exists. Preserve their upstream notices. |
| Security review skills | Available; apply their task triggers and review actual code/configuration. No security certification is implied. |
| Jules | Previously connected for bounded Interactive plan work. No new implementation dispatch is authorized. |

Detailed historical installation provenance remains in
[the prior tool record](https://github.com/lullabie/dashboard/blob/c261da2cb8d56a3a5a219042c8503add416a900f/docs/TOOLING.md).
Do not copy its superseded Muse-host workflow into this project.

No Cloudflare product toolchain or application dependencies were installed
by the research. Select and pin one supported compatible toolchain during
authorized implementation, then verify assets, D1 migration and runtime-test
commands. The research records `cf` as beta and Wrangler as still supported
for its configured projects; neither is a tested project installation.

No paid products, new accounts, credentials, automatic deployment workflow
or private connector ingestion are authorized by tool availability. Never
print temporary download tokens or other credentials in logs or documents.

## Jules API option checked 2026-10-16

The user asked about an API key after enabling Jules GitHub access and selecting
this repository. The official [API quickstart](https://jules.google/docs/api/reference/)
and [session reference](https://jules.google/docs/api/reference/sessions) confirm
source listing, session creation, status/activities, messages and plan approval.
The API is alpha. It can reduce browser coordination overhead; no coding-speed
or reliability result is claimed. It still uses the connected GitHub sources.

For later authorized API tasks, set `requirePlanApproval: true` explicitly;
omission auto-approves the plan. Leave automatic PR creation off unless the
task authorizes it. Read the returned source ID rather than inventing it. Keep
the API key in a local secret store or excluded environment file, never in
source, chat, screenshots, request logs or exception output. Use the documented
`X-Goog-Api-Key` header. No key was requested, collected or used by this handoff;
no API task was started. Browser coordination remains available.
