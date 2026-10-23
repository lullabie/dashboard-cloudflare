# Dashboard tooling

Updated: 2026-10-21 (v4 bundle). Records the runtimes and commands that
actually run today. Check availability in the current session before
claiming a tool is missing; add no duplicate framework or paid service.

## Runtimes

| Runtime | Recorded state |
|---|---|
| Node.js | v24.19.0 (used by coordinator and Codex checks). Lane tests and review scripts run under Node. |
| Browser | A real browser (Firefox via Playwright) is required for Phase 2 acceptance. Browser checks cannot read the page console; label "no console errors" as Inferred, never Verified. |
| Git | Local clones/worktrees of the repository. The coordinator has no direct push credentials; repo writes go through the authorized connector path. |

## The single review test command

```sh
node scripts/run-review-tests.mjs <assembled-tree-path>
```

Contract:

- Discovers the actual lane test files in the assembled tree
  (`__tests__/` plus any `*test*.js` / `*test*.mjs` file outside
  `.git` and `node_modules`).
- Runs each file with Node from the tree root and enumerates it by
  name with its PASS/FAIL result. A file that prints success strings
  without executing cases still counts only by its exit code.
- Exits nonzero if any discovered test fails or if no tests are found.
- Special case: `__tests__/store_validation.test.js` is the legacy
  store acceptance runner and **requires the store.js path as an
  argument**. The runner supplies it:
  `node __tests__/store_validation.test.js js/store.js`.
  Run bare, it prints a usage line and proves nothing.

Individual lane suites may also be run directly from the tree root,
for example:

```sh
node __tests__/store-v3-validation.test.js
node __tests__/store-v3-bc-validation.test.js
node __tests__/store-v3-degraded-save.test.js
```

Run lane tests with the working directory set to the tree root; some
suites resolve fixture paths relative to it.

## Syntax checks (ES modules)

Node 24 quirk: bare `node --check file.js` is **unreliable** for ESM
syntax — it can pass code that is a genuine SyntaxError inside a
module. Use one of these instead:

```sh
cp file.js /tmp/check.mjs && node --check /tmp/check.mjs
# or
node --input-type=module --check < file.js
```

## Asset packaging check (preparation only)

```sh
node scripts/package-static-assets.mjs <assembled-tree-path>
```

Lists the files that would ship under the allowlist in
`docs/review/DEPLOYMENT-ASSETS-V4.txt` and fails if a file appears
that is neither allowlisted nor explicitly excluded (docs, qa, tests,
helper patches, ledgers, credentials). This script prepares evidence;
it deploys nothing and changes no hosting workflow.

## Boundaries

- No test framework is installed for this project; lane tests are
  self-contained Node scripts with explicit doubles. Do not add one
  without a coordinator decision.
- Test CI (`.github/workflows/review-tests.yml`) runs the review test
  command on `codex/` review branches only. It has no deploy step and
  no push-to-main trigger. The old Pages workflow
  (`.github/workflows/pages.yml`) is unchanged and remains a named
  packaging gate until reviewed.
- Backend tooling (Wrangler, D1) is not installed and not authorized;
  the backend is UNACCEPTED (see PROJECT-STATUS.md).
