#!/usr/bin/env node
// run-review-tests.mjs — the single review test command (Track E, v6).
//
// Usage: node scripts/run-review-tests.mjs <assembled-tree-path> [--commit <sha>] [--max-age-min <n>]
//
// What runs, in order:
//   1. Lane tests: every *.test.js / *.test.mjs under __tests__/ plus any
//      *test*.js / *test*.mjs file in the tree (excluding .git, node_modules).
//      Special case: __tests__/store_validation.test.js takes the store.js
//      path as an argument (legacy runner contract, unchanged).
//   2. Browser suites: every qa/v4/*.spec.mjs file, executed with Node in
//      this same run. A tree with no spec files fails the gate. The runner
//      never reads a pre-existing result file as evidence: it deletes
//      qa/v4/browser-results.json before the specs run and sets QA_RUN_ID,
//      QA_RESULTS_FILE, QA_TREE_ROOT, QA_TESTED_COMMIT and QA_RUNTIME in
//      the spec environment. Specs record results only through
//      scripts/write-browser-results.mjs (contract: qa/v4/result-schema.md).
//   3. Local gate: the result file produced by THIS run is validated with
//      the shared validator from scripts/write-browser-results.mjs.
//
// Exit 0 requires ALL of: every lane test passed; every spec file exited 0;
// the fresh result report is complete and valid — every standing acceptance
// ID (TEST-UI-001, TEST-UI-002a..j, TEST-STORE-001..004, TEST-FEEDS-001..003,
// TEST-HABITS-001) and every v5 regression ID (V5-STORE-01, V5-STORE-02,
// V5-FEEDS-01..03) present at PASS with boundary REAL-BROWSER; testedCommit,
// js/store.js and js/feeds.js hashes equal to this tree; report runId equal
// to this run; report fresh. Any stale, mismatched, malformed, partial or
// missing report exits nonzero and names each defect.
//
// Exit 0 prints LOCAL GATE PASS. A local gate pass is not release approval
// and is not host acceptance. Hosted behavior stays unverified.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { join, relative, basename, resolve } from 'node:path';
import {
  REQUIRED_BROWSER_IDS,
  loadBrowserResults,
  treeSourceHashes,
  validateBrowserResults,
} from './write-browser-results.mjs';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const positional = argv.filter((a, i) => !a.startsWith('--') && (i === 0 || !argv[i - 1].startsWith('--')));
const tree = positional[0] ? resolve(positional[0]) : process.cwd();
if (!existsSync(tree) || !statSync(tree).isDirectory()) {
  console.error(`FAIL: assembled tree not found: ${tree}`);
  process.exit(2);
}
const maxAgeMin = Number(opt('--max-age-min') ?? 120);

// Tested commit identity: --commit, else the tree's git HEAD. No identity
// means no gate pass; a result file cannot invent one after the fact.
let testedCommit = opt('--commit') ?? null;
if (!testedCommit) {
  const git = spawnSync('git', ['-C', tree, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (git.status === 0) testedCommit = git.stdout.trim();
}
const { storeSha256, feedsSha256 } = treeSourceHashes(tree);
const runId = randomUUID();
const runtime = `node ${process.version}`;
console.log(`Tree: ${tree}`);
console.log(`Run: ${runId}`);
console.log(`Tested commit: ${testedCommit ?? 'UNKNOWN'}`);
console.log(`js/store.js sha256: ${storeSha256 ?? 'MISSING'}`);
console.log(`js/feeds.js sha256: ${feedsSha256 ?? 'MISSING'}`);

const SKIP_DIRS = new Set(['.git', 'node_modules']);
function walk(dir, pred, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), pred, out);
    } else if (entry.isFile() && pred(entry, join(dir, entry.name))) out.push(join(dir, entry.name));
  }
  return out;
}

// --- 1. Lane tests (discovery and reporting unchanged from v4/v5) ---
const laneTests = [...new Set(walk(tree, (entry, p) => {
  const rel = relative(tree, p);
  const inTestsDir = rel.split(/[\\/]/).includes('__tests__');
  return (inTestsDir && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')))
    || entry.name.endsWith('.test.js') || entry.name.endsWith('.test.mjs');
}))].sort();
if (laneTests.length === 0) {
  console.error(`FAIL: no test files discovered under ${tree}`);
  process.exit(1);
}
console.log(`\nReview tests: ${laneTests.length} file(s) under ${tree}`);
let laneFailed = 0;
for (const file of laneTests) {
  const rel = relative(tree, file);
  const args = [file];
  if (basename(file) === 'store_validation.test.js') args.push(join(tree, 'js', 'store.js'));
  const r = spawnSync(process.execPath, args, { cwd: tree, encoding: 'utf8', timeout: 180000 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  console.log(`\n[TEST] ${rel}`);
  for (const line of out.split('\n').filter((l) => /\b(PASS|FAIL)\b/.test(l))) console.log(`  ${line.trim()}`);
  const ok = r.status === 0;
  if (!ok) laneFailed += 1;
  console.log(`[RESULT] ${rel}: ${ok ? 'PASS' : `FAIL (exit ${r.status ?? 'signal ' + r.signal})`}`);
}
console.log(`\nSummary: ${laneTests.length - laneFailed}/${laneTests.length} test file(s) passed, ${laneFailed} failed.`);

// --- 2. Browser suites, executed in this run ---
const specDir = join(tree, 'qa', 'v4');
const specFiles = existsSync(specDir)
  ? walk(specDir, (entry) => entry.name.endsWith('.spec.mjs')).sort()
  : [];
const resultsPath = join(specDir, 'browser-results.json');
const gateProblems = [];
if (!testedCommit) gateProblems.push('tested commit unknown: pass --commit <sha> or run in a git checkout; the gate cannot bind results to a commit');
if (!storeSha256) gateProblems.push('source identity missing: js/store.js not found in tree');
if (!feedsSha256) gateProblems.push('source identity missing: js/feeds.js not found in tree');

if (specFiles.length === 0) {
  gateProblems.push('browser-not-run: no qa/v4/*.spec.mjs files found; no browser suite can run');
} else {
  if (existsSync(resultsPath)) {
    rmSync(resultsPath);
    console.log('\n[GATE] Discarded pre-existing qa/v4/browser-results.json; only results from this run count.');
  }
  const specEnv = {
    ...process.env,
    QA_RUN_ID: runId,
    QA_RESULTS_FILE: resultsPath,
    QA_TREE_ROOT: tree,
    DASH_TREE: tree,
    QA_TESTED_COMMIT: testedCommit ?? '',
    QA_RUNTIME: runtime,
  };
  console.log(`\nBrowser suites: ${specFiles.length} file(s)`);
  for (const file of specFiles) {
    const rel = relative(tree, file);
    const r = spawnSync(process.execPath, [file], { cwd: tree, env: specEnv, encoding: 'utf8', timeout: 600000 });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    console.log(`\n[SPEC] ${rel}`);
    for (const line of out.split('\n').filter((l) => /\S/.test(l))) console.log(`  ${line.trimEnd()}`);
    if (r.status !== 0) gateProblems.push(`browser suite failed: ${rel} exited ${r.status ?? 'signal ' + r.signal}`);
    console.log(`[SPEC RESULT] ${rel}: ${r.status === 0 ? 'exit 0' : `exit ${r.status ?? 'signal ' + r.signal}`}`);
  }
}

// --- 3. Validate the fresh report from this run ---
if (specFiles.length > 0) {
  const { report, problems: loadProblems } = loadBrowserResults(resultsPath);
  if (loadProblems.length > 0) {
    gateProblems.push(...loadProblems);
  } else {
    const { problems, warnings } = validateBrowserResults(report, {
      testedCommit, storeSha256, feedsSha256, runId, maxAgeMin,
    });
    gateProblems.push(...problems);
    for (const w of warnings) console.log(`[GATE] warning: ${w}`);
  }
}

if (gateProblems.length > 0) {
  console.log('\n[LOCAL GATE] NOT PASS — defects:');
  for (const p of gateProblems) console.log(`  - ${p}`);
} else {
  console.log(`\n[LOCAL GATE] PASS — ${REQUIRED_BROWSER_IDS.length} required browser cases PASS in this run on commit ${testedCommit}.`);
  console.log('This local gate pass is not release approval and is not host acceptance.');
}
process.exit(laneFailed > 0 || gateProblems.length > 0 ? 1 : 0);
