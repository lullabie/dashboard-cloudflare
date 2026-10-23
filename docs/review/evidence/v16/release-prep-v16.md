# RELEASE-PREP-V16 — document and patch check only

- Scope: release-prep read-check for repo `lullabie/dashboard-cloudflare`.
- Tree checked: `~/workspace/goals/personal-life-dashboard/hidden_files/codex-v16-20261023/assembly`.
- Branch: `codex/v5-review`.
- Head: `3f257bcc2b20bd24608bbf8ea6c63f7cb97eed8c`.
- Runtime for the checks in this report: Node `v24.20.0`.
- Method: read-only. No commit. No push. No file change in the clone.
- Command: `git status --porcelain`
- Result: no output before the checks and no output after the checks. The clone stayed clean.
- This report does not apply the workflow patch.
- This report does not create a host, a resource, or an account.
- This report does not merge, deploy, or change billing.

## 1. Workflow patch read-check

### 1.1 File on the branch today

- Command: `sha256sum .github/workflows/pages.yml`
- Result: `435590687720d8e0bbd7d57ef97f3c2665797fa0b58706a0eaf4003d2cc490b0`, size 695 B.
- Name: `Deploy static content to Pages`.
- Trigger 1: `push` on branches `["main"]`.
- Trigger 2: `workflow_dispatch`.
- Permissions: `contents: read`, `pages: write`, `id-token: write`.
- Concurrency: group `pages`, `cancel-in-progress: false`.
- Job: `deploy`. Environment: `github-pages`. Runner: `ubuntu-latest`.
- Step 1: `Checkout`, `actions/checkout@v4`.
- Step 2: `Setup Pages`, `actions/configure-pages@v4`.
- Step 3: `Upload artifact`, `actions/upload-pages-artifact@v3`, `path: '.'`.
- Step 4: `Deploy to GitHub Pages`, `actions/deploy-pages@v4`, id `deployment`.
- Fact: a push to `main` starts a deploy.
- Fact: the upload path is the repo root, `.`.
- Fact: no manifest check step exists in the branch file.
- Fact: no staging step exists in the branch file.

### 1.2 Patch file

- File: `docs/review/V15-PAGES-WORKFLOW.patch`.
- Command: `sha256sum docs/review/V15-PAGES-WORKFLOW.patch`
- Result: `e8aef1d701fab60b12f184d1c02841cf49c73ddcbb2d8ca31730f4b90d1b1868`, size 1027 B.
- Command: `git apply --stat docs/review/V15-PAGES-WORKFLOW.patch`
- Result: ` .github/workflows/pages.yml |   14 ++++++++++----`
- Result: ` 1 file changed, 10 insertions(+), 4 deletions(-)`

### 1.3 Patch changes, hunk by hunk

- Hunk 1: header, `@@ -1,7 +1,7 @@`.
- Change: add two comment lines after the workflow name.
- Comment text states: no push trigger; deploy runs only by manual dispatch; only the exact staged asset folder is uploaded, never the repo root.
- Change: delete the `push` trigger block, `branches: ["main"]`.
- No change: `workflow_dispatch` stays.
- No change in this hunk: `permissions` block stays.
- Hunk 2: steps, `@@ -19,12 +19,18 @@`.
- Change: add step `Setup Node`, `actions/setup-node@v4`, `node-version: 24`.
- Change: add step `Stage exact asset manifest`.
- Stage command in the patch: `node scripts/package-static-assets.mjs --stage . dist-staged`.
- Change: rename step `Upload artifact` to `Upload staged artifact`.
- Change: upload `path` changes from `'.'` to `'dist-staged'`.
- No change: `Checkout`, `Setup Pages`, and `Deploy to GitHub Pages` steps stay.
- No change: concurrency, environment, and runner stay.

### 1.4 Check-only apply test

- Exact commands run:

```text
mkdir -p /tmp/v16-rp-scratch/.github/workflows
cp ~/workspace/goals/personal-life-dashboard/hidden_files/codex-v16-20261023/assembly/.github/workflows/pages.yml /tmp/v16-rp-scratch/.github/workflows/pages.yml
cd /tmp/v16-rp-scratch
git apply --check -v ~/workspace/goals/personal-life-dashboard/hidden_files/codex-v16-20261023/assembly/docs/review/V15-PAGES-WORKFLOW.patch
```

- Result: exit 0.
- Output on stderr: `Checking patch .github/workflows/pages.yml...`
- Command after the check: `sha256sum .github/workflows/pages.yml` in the scratch copy.
- Result: `435590687720d8e0bbd7d57ef97f3c2665797fa0b58706a0eaf4003d2cc490b0`.
- Fact: the check did not change the scratch file.
- Fact: the patch applies cleanly in check-only mode against a scratch copy of the current branch file.
- Fact: no apply ran against the clone. No apply ran against the remote branch.

### 1.5 Explicit status statement

- The branch file `.github/workflows/pages.yml` is unchanged.
- The branch file still carries the unsafe state that Codex named in the V15 audit, defect 5.
- Unsafe state, exact form: push trigger on `main` plus upload of the repo root with no gate.
- Source for defect 5: `docs/review/V15-EXECUTION-RECORD.md`, section "Defect dispositions", item 5.
- The same record states the apply blocker: `403 Resource not accessible by integration`.
- The GitHub API 403 for the `.github/workflows/` path stands.
- A human with workflows permission must apply the patch.
- No bypass was attempted in this phase.

## 2. Exact staged manifest

### 2.1 Packager contract checked

- File checked: `scripts/package-static-assets.mjs`, the V15B-hardened version on this tree.
- Use form 1, check mode: `node scripts/package-static-assets.mjs <source-tree> <staged-dir>`.
- Use form 2, stage mode: `node scripts/package-static-assets.mjs --stage <source-tree> <staged-dir>`.
- Exit codes in the script: 0 pass, 1 fail, 2 usage or refusal.
- Rule order in the script: exclusions run before ship rules.
- Rule: the staged folder must match the expected ship set exactly. A missing file fails. An extra file fails.
- Required files in the script: `index.html`, `LICENSE`, `THIRD-PARTY-NOTICES.txt`, `js/main.js`, `js/store.js`, `js/chart.umd.js`, `css/app.css`.
- Ship rule for the notices file: `^THIRD-PARTY-NOTICES\.txt$`.
- Ship rule for the license file: `^LICENSE$`.
- Rule: forbidden files never ship. Pattern covers credentials, secrets, `.env`, api keys, and tokens.
- Stage safety in the script: source validation runs before any output change; stage equal to source is refused with exit 2; stage as an ancestor of source is refused with exit 2; a pre-existing non-empty target with no valid ownership marker is refused with no change.

### 2.2 Commands run

- Stage command run from the assembly root:

```text
node scripts/package-static-assets.mjs --stage . /tmp/v16-rp-staged
```

- Result: exit 0.
- Check command run from the assembly root after the stage run:

```text
node scripts/package-static-assets.mjs . /tmp/v16-rp-staged
```

- Result: exit 0.

### 2.3 Checker verdict output, verbatim — stage run

```text
Asset manifest check
  source: /home/hatch/workspace/goals/personal-life-dashboard/hidden_files/codex-v16-20261023/assembly
  staged: /tmp/v16-rp-staged (staged by this run)
  expected ship set: 21 files
    LICENSE (1079 B)
    THIRD-PARTY-NOTICES.txt (2735 B)
    css/app.css (10146 B)
    css/visual-upgrade.css (1934 B)
    index.html (24388 B)
    js/chart.umd.js (208518 B)
    js/college.js (4480 B)
    js/countdowns.js (5926 B)
    js/feeds.js (17138 B)
    js/goals.js (11495 B)
    js/habits.js (14275 B)
    js/indicators.js (7263 B)
    js/investments.js (5053 B)
    js/jobs.js (5436 B)
    js/main.js (60178 B)
    js/maps.js (6571 B)
    js/store.js (42319 B)
    js/visuals/chart-explorer.js (7681 B)
    js/visuals/charts.js (14812 B)
    js/visuals/deadline-timeline.js (9125 B)
    js/visuals/progress-summary.js (6212 B)

Result: PASS — staged folder matches the exact manifest and every local reference resolves.
```

### 2.4 Checker verdict output, verbatim — check run

```text
Asset manifest check
  source: /home/hatch/workspace/goals/personal-life-dashboard/hidden_files/codex-v16-20261023/assembly
  staged: /tmp/v16-rp-staged
  expected ship set: 21 files
    LICENSE (1079 B)
    THIRD-PARTY-NOTICES.txt (2735 B)
    css/app.css (10146 B)
    css/visual-upgrade.css (1934 B)
    index.html (24388 B)
    js/chart.umd.js (208518 B)
    js/college.js (4480 B)
    js/countdowns.js (5926 B)
    js/feeds.js (17138 B)
    js/goals.js (11495 B)
    js/habits.js (14275 B)
    js/indicators.js (7263 B)
    js/investments.js (5053 B)
    js/jobs.js (5436 B)
    js/main.js (60178 B)
    js/maps.js (6571 B)
    js/store.js (42319 B)
    js/visuals/chart-explorer.js (7681 B)
    js/visuals/charts.js (14812 B)
    js/visuals/deadline-timeline.js (9125 B)
    js/visuals/progress-summary.js (6212 B)

Result: PASS — staged folder matches the exact manifest and every local reference resolves.
```

### 2.5 Every staged file, sha256 and size

- Command: `find . -type f` in `/tmp/v16-rp-staged`, then `sha256sum` and `wc -c` per file.
- Staged file count: 21.
- Total staged size: 466764 B.

| File | Bytes | SHA-256 |
|---|---|---|
| `LICENSE` | 1079 | `a09138d2168be64783ee7185c1a36bb03297c4302039d4062f19861ba4972648` |
| `THIRD-PARTY-NOTICES.txt` | 2735 | `d64682fb8b01bc8c5e205ed34af94105ca46ecafd2ddaeae72a1986e658ab6ce` |
| `css/app.css` | 10146 | `53c3fc28744bfaf34be84ea708fec9a05c53401e2b5d2efb9d9cb77fa07f9e3a` |
| `css/visual-upgrade.css` | 1934 | `f31249152a7083ded13e987728795369429e05fab32cc20c9d81c14ad876b1b8` |
| `index.html` | 24388 | `3cae857aedc424ccb8e646af82ade26ce9a95c6a5536b6b5910ec1ebbdcc3216` |
| `js/chart.umd.js` | 208518 | `ecc3cd1eeb8c34d2178e3f59fd63ec5a3d84358c11730af0b9958dc886d7652a` |
| `js/college.js` | 4480 | `d2aeb5ea96aaf92c4478debbcc06158024434ff0a5330cc277330d500632a66a` |
| `js/countdowns.js` | 5926 | `8c85af558b24e38eb4f48529aa39a981233e2d43cda4ccb581b07cb5565f2713` |
| `js/feeds.js` | 17138 | `b0fe9d6b31caa11f6dbec86afae6fa38912ed7d6ff4c6f259001bd472620be88` |
| `js/goals.js` | 11495 | `275274982c74e39de649da809a5168c77cc2531a4cd043cc0424381a913c4533` |
| `js/habits.js` | 14275 | `2531e84bf44432b91544a9772d8ca6e97fc68231890bd51de7be9cbce4f8c413` |
| `js/indicators.js` | 7263 | `ff0146db804deb004fe2f05b2e1353b20f78123f3b34eca2930936b8cfc56b73` |
| `js/investments.js` | 5053 | `e7d9668eba3a4204b48286b7c0101d4a7d3584799bff39922204dea48dc03f05` |
| `js/jobs.js` | 5436 | `4a74bf4077abad0a652c333b506d97ff784d9dde6201f9a5eec59a283ab2b9cb` |
| `js/main.js` | 60178 | `5eece9b35efad3ad6ce9aefe1230e233b60d7a2680c16265e68e8c4117eb2f9b` |
| `js/maps.js` | 6571 | `eb8f1b9e60125c25a34a8a2111e23aaf7ba9c1acf8e3604b42a589046a0b4104` |
| `js/store.js` | 42319 | `3d96eee79e7e34405d78049117a0741e7b7b09a0e6b7f5bb260dc32ea839e35c` |
| `js/visuals/chart-explorer.js` | 7681 | `5b3f7afffa3d2f165dea1233df72d55fe8a983015b1a426f6618c35562a2e2b5` |
| `js/visuals/charts.js` | 14812 | `7ee5cf1fef3fb0a211a847fd94d15b33f5386e07eb73a721d6c822804ba5404a` |
| `js/visuals/deadline-timeline.js` | 9125 | `8621f8a611a86bb6f9b6ed80f4d87d8aff6cfc2def1d00ef63709500277e3871` |
| `js/visuals/progress-summary.js` | 6212 | `e2bb90a7eae48404bbd9378ab2d996f849729c464140028cb2ca7745c6166b7a` |

- Note: the stage run also wrote a sibling marker file, `/tmp/v16-rp-staged.pkg-owned.json`.
- Fact: the marker file sits outside the staged folder. The marker file is not a staged file.
- Fact: the marker lists the same 21 files. The check run counted only the 21 files inside the staged folder.

### 2.6 LICENSE and THIRD-PARTY-NOTICES.txt handling

- `THIRD-PARTY-NOTICES.txt`: staged. Status: required file in the checker.
- Command: `cmp THIRD-PARTY-NOTICES.txt /tmp/v16-rp-staged/THIRD-PARTY-NOTICES.txt`
- Result: exit 0, no output. The staged copy is byte-identical to the source file.
- Content check: the file carries the full MIT texts for Chart.js v4.5.1 and @kurkle/color v0.3.2.
- Source for that content claim: `docs/review/V15-EXECUTION-RECORD.md`, defect 8, and the file head read in this phase.
- `LICENSE`: staged. Status: required file in the checker.
- Command: `cmp LICENSE /tmp/v16-rp-staged/LICENSE`
- Result: exit 0, no output. The staged copy is byte-identical to the source file.
- Command: `git diff 29d43ff04a6abb257b5046c85f2fcba6f0bb679d..HEAD -- LICENSE`
- Result: no output. Exit 0.
- Command: `git diff --stat 29d43ff04a6abb257b5046c85f2fcba6f0bb679d..HEAD -- LICENSE`
- Result: no output.
- Fact: LICENSE has zero change between base `29d43ff` and head `3f257bc` on this tree.
- Fact: no file in the staged set is excluded by the checker rules. Each staged file matches a ship rule and no exclusion rule.

## 3. Remaining host smoke list

- Source: `docs/ACCEPTANCE.md`, section "Remaining complete-app acceptance gaps", items 1 and 11, and section "Unresolved host requirements".
- Registry statement in that source: host acceptance is NOT RUN; hosted authentication, Workers/D1 behavior, Free CPU limits, and unattended scheduled updates are UNVERIFIED; the backend is UNACCEPTED.
- Host item count in this list: 6.

- [ ] H1 — Hosted authentication. Status: NOT RUN.
  Evidence to close: a run on the real host with the real auth path; sign-in and sign-out pass; a blocked request from a signed-out session is on record; the record names host, account type, commit, and date. Invented records only.
- [ ] H2 — Cloudflare Workers and D1 behavior. Status: NOT RUN.
  Evidence to close: a run on the real Worker and the real D1 database; read and write pass; error paths return the stated results; local results do not count; the record names the Worker, the database binding, the commit, and the date.
- [ ] H3 — Free plan CPU limits. Status: NOT RUN.
  Evidence to close: a load run on the Free plan that hits the normal request path and the scheduled path; CPU time per request is on record; no request fails from a CPU limit in the stated load; the record names the plan, the load, and the date.
- [ ] H4 — Unattended scheduled updates. Status: NOT RUN.
  Evidence to close: the schedule runs with no manual start for the stated period; each run result is on record; a failed run is visible and does not corrupt data; the record names the schedule, the period, and each run result.
- [ ] H5 — Hosted workflow and Pages behavior. Status: NOT RUN.
  Evidence to close: a human with workflows permission applies `docs/review/V15-PAGES-WORKFLOW.patch`; the branch file then has no push trigger; a manual dispatch stages the exact manifest with `scripts/package-static-assets.mjs --stage . dist-staged`; the upload contains only the staged folder; the deployed site loads with no page error and every local asset resolves; the record names the run, the commit, and the deployed URL.
- [ ] H6 — Release approval. Status: none exists.
  Evidence to close: Codex acceptance of the frozen candidate, host acceptance H1 to H5 on record, and an explicit user approval for merge and deploy. Each item must be on record before a shippable claim.

### 3.1 Plain status

- Host: NOT RUN.
- Release approval: none.
- PR #2: draft.
- Merge: none.
- Deploy: none.
- The shippable claim withdrawn on 2026-10-20 stays withdrawn.
- Source for the withdrawal and the draft state: `docs/review/V15-EXECUTION-RECORD.md` and `PROJECT-STATUS.md` on this tree.
