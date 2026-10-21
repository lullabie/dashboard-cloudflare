# Dashboard context

Updated: 2026-10-21 (v4 bundle). This file records crew roles, file
ownership and standing rules. Current state lives in
[PROJECT-STATUS.md](../PROJECT-STATUS.md); gate status lives in
[ACCEPTANCE.md](ACCEPTANCE.md) (the single registry).

## Product in one paragraph

A single-user, local-first personal dashboard written in vanilla
JavaScript ES modules with no build step. Data is stored in the
browser's IndexedDB through a tracked-snapshot store; tabs stay in sync
through BroadcastChannel. The app ships empty; the owner enters their
own records. Required additional service cost: $0.

## Crew roles

| Role | Who | Authority |
|---|---|---|
| Owner | The user | Product and scope decisions; merge and deployment approval (neither is in the v4 bundle). |
| Coordinator | Muse | Sole Jules dispatch coordinator. Assembles owned files (Track C). Edits docs/CI/packaging only outside lane ownership. |
| Code lanes | Jules sessions | One session per production area; each writes only its allowlisted files. |
| Independent review | Codex | Reviews patches and evidence via issue #1; decides technical disputes; runs independent repros. |
| Design and repo writes | Astra (ChatGPT) | Design seat; GitHub connector writes when a push is authorized. |

Coordination channel: GitHub issue #1 of `lullabie/dashboard-cloudflare`.
A sent message is not an acknowledgement; receipts are verified from
session state and update times.

## File ownership (v4 bundle)

| Files | Owner |
|---|---|
| `js/store.js`, storage tests | STORE session 9588111654717985252 (Track A) |
| `js/feeds.js`, feeds v4 contract/ordering tests | Replacement FEEDS session (Track B, one session, plan approval required) |
| `js/main.js`, `index.html`, `js/goals.js`, `js/college.js`, `js/jobs.js`, `js/maps.js`, `js/investments.js`, `js/visuals/chart-explorer.js`, `css/app.css`, `css/visual-upgrade.css` | MAIN session (idle unless a concrete failure reopens it) |
| `js/habits.js`, habits tests | HABITS session (idle unless reopened) |
| `js/visuals/progress-summary.js`, progress tests | PROGRESS session (idle unless reopened) |
| Assembled review branch, `docs/review/SOURCE-MANIFEST-V4.json`, `docs/review/OWNERSHIP-V4.json`, `docs/review/INTEGRATION-PLAN-V4.md` | Muse assembler (Track C), sole writer |
| `qa/v4/*` | QA worker (Track D), no production edits |
| `README.md`, `PROJECT-STATUS.md`, `docs/CONTEXT.md`, `docs/TOOLING.md`, `docs/COLLABORATION.md`, `docs/ACCEPTANCE.md`, `scripts/run-review-tests.mjs`, `scripts/package-static-assets.mjs`, `.github/workflows/review-tests.yml`, `docs/review/DEPLOYMENT-ASSETS-V4.txt` | Tooling/docs worker (Track E) |
| `LICENSE` | Nobody. Byte-identical in every patch and branch. |

One writer per file. A fix for another owner's file goes back to that
owner as a brief; the coordinator never hand-edits an active lane's
production code.

## Standing rules

- **$0 constraint.** No new account, Cloudflare resource, OAuth app,
  paid fallback or enabled product schedule without separate owner
  approval.
- **Invented-data rule.** Source, tests, fixtures and screenshots use
  invented records only. No credentials, private payloads or personal
  context in code, tests, messages or issue comments.
- **Immutable artifacts.** Delivered lane patches and prior bundle
  records (v1/v2/v3) are never edited in place. A correction is a new
  patch with a new hash.
- **Evidence labels.** Results are labeled STATIC, MOCK or
  REAL-BROWSER. A mock pass, a syntax check or a source hash never
  establishes complete-app acceptance.
- **Historical plan.** The Workers/D1 backend design in `docs/plan-b/`
  is historical and UNACCEPTED. Do not present it as the current stack.
