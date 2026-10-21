#!/usr/bin/env node
// run-review-tests.mjs — the single review test command (Track E, v4; v5 release gate added).
//
// Usage: node scripts/run-review-tests.mjs <assembled-tree-path>
//
// Discovers the actual lane test files in the assembled tree, runs each
// one with Node from the tree root, enumerates it by name with its
// result, and exits nonzero if any required test fails or none are
// found. Nothing here prints a success claim without executing the file.
//
// Discovery: every *.test.js / *.test.mjs under __tests__/, plus any
// file whose name matches *test*.js / *test*.mjs elsewhere in the tree
// (excluding .git and node_modules).
// Special case: __tests__/store_validation.test.js is the legacy store
// acceptance runner and requires the store.js path as an argument.
//
// V5 RELEASE GATE: exit 0 means release PASS. Lane tests alone cannot
// produce it. The gate also requires every real-browser TEST-ID in
// docs/ACCEPTANCE.md to be recorded as PASS in the tree at
// qa/v4/browser-results.json (JSON object: TEST-ID -> "PASS"). A
// missing file, a missing ID, or any status other than PASS (for
// example "NOT RUN" or "FAIL") makes the gate fail and the exit
// nonzero. Lane-test output and wording are unchanged from v4.

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, relative, basename, resolve } from 'node:path';

const tree = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
if (!existsSync(tree) || !statSync(tree).isDirectory()) {
  console.error(`FAIL: assembled tree not found: ${tree}`);
  process.exit(2);
}

const SKIP_DIRS = new Set(['.git', 'node_modules']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out);
    } else if (entry.isFile()) {
      const p = join(dir, entry.name);
      const rel = relative(tree, p);
      const inTestsDir = rel.split(/[\\/]/).includes('__tests__');
      if ((inTestsDir && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')))
          || entry.name.endsWith('.test.js') || entry.name.endsWith('.test.mjs')) {
        out.push(p);
      }
    }
  }
  return out;
}

const tests = [...new Set(walk(tree))].sort();
if (tests.length === 0) {
  console.error(`FAIL: no test files discovered under ${tree}`);
  process.exit(1);
}

console.log(`Review tests: ${tests.length} file(s) under ${tree}`);
let failed = 0;
for (const file of tests) {
  const rel = relative(tree, file);
  const args = [file];
  if (basename(file) === 'store_validation.test.js') {
    args.push(join(tree, 'js', 'store.js')); // legacy runner requires the store.js path
  }
  const r = spawnSync(process.execPath, args, { cwd: tree, encoding: 'utf8', timeout: 180000 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const caseLines = out.split('\n').filter((l) => /\b(PASS|FAIL)\b/.test(l));
  console.log(`\n[TEST] ${rel}`);
  for (const line of caseLines) console.log(`  ${line.trim()}`);
  const ok = r.status === 0;
  if (!ok) failed += 1;
  console.log(`[RESULT] ${rel}: ${ok ? 'PASS' : `FAIL (exit ${r.status ?? 'signal ' + r.signal})`}`);
}

console.log(`\nSummary: ${tests.length - failed}/${tests.length} test file(s) passed, ${failed} failed.`);

// V5 release gate: required real-browser cases (docs/ACCEPTANCE.md).
const REQUIRED_BROWSER_IDS = [
  'TEST-UI-001', 'TEST-UI-002',
  'TEST-STORE-001', 'TEST-STORE-002', 'TEST-STORE-003', 'TEST-STORE-004',
  'TEST-FEEDS-001', 'TEST-FEEDS-002', 'TEST-FEEDS-003',
  'TEST-HABITS-001',
];
const resultsPath = join(tree, 'qa', 'v4', 'browser-results.json');
let browserResults = null;
if (existsSync(resultsPath)) {
  try { browserResults = JSON.parse(readFileSync(resultsPath, 'utf8')); }
  catch { browserResults = null; }
}
const gateProblems = [];
for (const id of REQUIRED_BROWSER_IDS) {
  const status = browserResults ? browserResults[id] : undefined;
  if (status !== 'PASS') gateProblems.push(`${id}: ${status === undefined ? 'no result recorded' : status}`);
}
if (gateProblems.length > 0) {
  console.log(`\n[RELEASE GATE] NOT PASS — required browser cases have not passed:`);
  for (const p of gateProblems) console.log(`  ${p}`);
  if (!existsSync(resultsPath)) console.log(`  (missing file: qa/v4/browser-results.json)`);
} else {
  console.log(`\n[RELEASE GATE] PASS — all ${REQUIRED_BROWSER_IDS.length} required browser cases recorded PASS.`);
}
process.exit(failed > 0 || gateProblems.length > 0 ? 1 : 0);
