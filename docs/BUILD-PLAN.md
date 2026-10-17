# Dashboard — Build Blueprint (R1)

Date: 2026-10-17. Status: Weekend 1 in progress (Jules session 14215467299765901227).
Supersedes: docs/plan-b/IMPLEMENTATION-PLAN-2026-10-16.md (React/TypeScript/Workers plan — rejected by build-plan trial 2026-10-16).

## What we are building

"Dashboard" — a private single-user personal dashboard web app. R1 scope only.
Required additional service cost: $0.

## Architecture (binding)

- Vanilla JavaScript, ES modules. No build step. No framework. No TypeScript.
- ~15 files. Static site. No backend, no database, no auth, no sync.
- Data lives ONLY in the browser's localStorage (5 MiB budget). Zero personal data in the repo, URLs, logs, or commits. The repo ships with empty seed state.
- JSON export/import is the durability layer: envelope `{app:"dashboard", schemaVersion, exportedAt, data}`. Import shows restore preview, asks confirmation, rejects unknown schema versions loudly, preserves history.

## Hosting

- Primary: Cloudflare Pages Free (private repos supported, no card required).
- Fallback used by Weekend 1: GitHub Pages via `.github/workflows/pages.yml` (requires public repo).
- Repo visibility: public (owner decision 2026-10-17) — privacy means data-only.

## R1 scope

Weekend 1 (vertical slice, shippable):
1. Deploy pipeline live.
2. Today view — goals/priorities, overdue/upcoming, honest empty states (never invent activity).
3. Goals CRUD — create, edit, archive, restore; notes with "show notes on card"; manual achievement; immutable history (corrections append).
4. Countdown tiles with progress bars (VE1) — fee balance 2026-11-25, visa docs 2026-12-15, intake 2027-01-11. Timezone pinned: date + explicit IANA zone (America/Toronto), days-left rendered against that zone, labeled.
5. One-click JSON export/import (envelope versioned).
6. Black theme, lime accents, compact cards, expandable detail (measurements, freshness, source, connection status). Mobile-readable. Keyboard operable.

Weekend 2:
- Deadline radar (VE2 — urgency color list).
- Bank of Canada indicator tiles (VE3 — value, change, "as of" date, source link; Valet API, cached daily, stale badge on failure, never blocks load).
- Checklist progress rings (VE4).
- Polish: empty/error states, keyboard pass.

Visual explainers (binding condition 3) = exactly VE1–VE4 above. Nothing else.

## Non-goals (frozen)

Scraping (myCentennial, Gmail, Job Bank) frozen until after 2027-01-11 intake. No chart library unless the roadmap-tools trial mandates it. No auth/multi-user/sync, no notifications, no service worker, no custom domain, no AI features in-app, no i18n, no extra themes, no backend.

## AI lanes (owner-assigned 2026-10-16)

- Codex (ChatGPT Plus, noamanhssn@gmail.com) — code implementation.
- Jules (secretunder69@gmail.com, REST API) — repo-level build tasks.
- Gemini Pro (Google AI Pro, secretunder69@gmail.com) — research/analysis only.

Hard constraint: ZERO of the owner's personal context crosses into ChatGPT, Gemini, Jules, or any third-party relay. Generic technical work only.

## Owner rulings (2026-10-16)

1. Privacy scope: data-only (data stays private; code may be public).
2. "Visual explainers" locked to the four items above.

## Two-weekend cap

Weekend 1 ships the vertical slice above or the build stops. Weekend 2 adds indicators, radar, polish. R2 (maps, college portal, jobs, investments, news, habits) is separate and not started.

## Methods and tweaks

- Smallest complete diff per change; reuse existing repo patterns.
- Verify the active account (email from account menu) before reporting any sign-in status.
- Never overwrite a delivered file in place; read back every published change.
- Claim discipline: label load-bearing claims (verified / inferred / single-source); never ship "verified" without reproducible evidence.
- Tooling policy: docs/TOOLING.md. Cloudflare research: docs/research/MUSE-CLOUDFLARE-2026-10-16.md and docs/plan-b/CLOUDFLARE-RESEARCH-2026-10-16.md.
