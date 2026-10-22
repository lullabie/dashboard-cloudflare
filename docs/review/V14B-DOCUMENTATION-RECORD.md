# V14B documentation record

Date: 2026-10-22. Owner: coordinator (sole assembler for this bundle).
Scope: documentation and PR metadata only. No app source changed.
No merge, no deployment.

## Trigger

Codex completed the independent V14B verification at branch head
`1696d372e3ce6bf0fc9d875c31747d65d7b22cdb`: installed Chrome
155.0.8059.85, Node 24.19, isolated native IndexedDB/BroadcastChannel,
invented records, no source substitutions. Full gate exit 0: 28
required browser cases PASS (29 total), 14 Node files, negative
17/17, runId `efb3274d-f662-4b8e-9c36-5c82f899c06d`. A separate places
run also passed with a real stale proof: distinct captured ids at
token revision 2, winner revision 3, disk proof under hold showing
the id-less record at revision 2; the stale save was rejected with
the disk unchanged; fresh commit and retry verified. The production
STORE/FEEDS diff from `96ed586` is empty. Codex closes the V14B
Chrome local regression; host acceptance stays NOT RUN and no
release approval is given.

## Changes in this bundle

1. PR #2 title and body updated from the stale V5/V6 text to the
   current V14B outcome: exact commits, both gate runs, evidence
   locations, and the remaining gates. The PR stays draft.
2. `docs/ACCEPTANCE.md` audited against the executed required-case
   coverage (frozen gate at `4883425`, runId `735ae833`; Codex rerun
   at `1696d37`, runId `efb3274d`):
   - All ten registry IDs (TEST-UI-001, TEST-STORE-001..004,
     TEST-FEEDS-001..003, TEST-HABITS-001, TEST-UI-002 with all ten
     subcases) moved from NOT RUN to PASS with the executed evidence
     named per row.
   - Coverage-map rows updated only where an executed case backs the
     change. Partial coverage stays NOT RUN and says so: every-form
     matrix, goals/habits time matrix, maps UI CRUD, keyboard
     import control, nested modal/Escape.
   - Rows with no executed case stay NOT RUN: college markup,
     investments round-trip, populated explorers, chart CDN
     fallback, exact release asset manifest.
   - Zero LICENSE changes now verified at branch level
     (`git diff 29d43ff..1696d37 -- LICENSE` is empty).
   - A post-V14B section lists the concrete remaining complete-app
     acceptance gaps, including host acceptance NOT RUN and the
     withdrawn shippable claim.
3. `PROJECT-STATUS.md` updated to the V14B state: branch head,
   frozen commit, current store/feeds hashes, both gate results,
   and the open-gaps pointer. The v3/v4 lane sections are superseded;
   their records remain under docs/review/.
4. Raw V14B frozen-gate evidence published under
   `docs/review/evidence/v14b/` with hashes and sanitization
   provenance in its PROVENANCE.md. The gate output is sanitized
   (local tree path prefix → `<tree>`, 14 occurrences, round-trip
   verified); the browser results and negative output are
   byte-identical to the raw gate artifacts.

## Standing state after this bundle

- Release status: NOT shippable. The 2026-10-20 withdrawal stands.
- Host acceptance: NOT RUN. Backend: UNACCEPTED.
- PR #2: draft. No merge, no deployment.
- Immutable records (V7–V14B execution records) and app source are
  untouched by this bundle.
