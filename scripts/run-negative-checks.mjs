#!/usr/bin/env node
// run-negative-checks.mjs — Lane E v6 negative checks for the release gate.
//
// Each check builds an input that MUST be rejected and proves the gate
// rejects it and names the defect. A positive control proves the same
// validator and runner accept a complete valid run, so the checks are
// not vacuous. No check needs a real browser: the browser-not-run path
// is exercised with absent and silent specs.
//
// Published location: scripts/run-negative-checks.mjs (Lane E).
// Run from the repo root: node scripts/run-negative-checks.mjs
// Exit 0: every check behaved as required. Exit 1: a check failed.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_BROWSER_IDS,
  loadBrowserResults,
  validateBrowserResults,
  writeBrowserResults,
} from './write-browser-results.mjs';
import { resolveBrowserSelection } from '../qa/v4/browser-launch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, 'run-review-tests.mjs');
const COMMIT = '433d6305b6e8508bbb8994c59a1cb5f6ec4a93d6';
const OTHER_COMMIT = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const STORE_SHA = 'c'.repeat(64);
const FEEDS_SHA = 'd'.repeat(64);
const EXPECTED = { testedCommit: COMMIT, storeSha256: STORE_SHA, feedsSha256: FEEDS_SHA };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`CHECK ${name}: ${ok ? 'PASS' : 'FAIL'} — ${detail}`);
}
function validReport(overrides = {}) {
  return {
    schemaVersion: 2,
    testedCommit: COMMIT,
    storeSha256: STORE_SHA,
    feedsSha256: FEEDS_SHA,
    runtime: `node ${process.version}`,
    runId: 'check-run-1',
    generatedAt: new Date().toISOString(),
    cases: REQUIRED_BROWSER_IDS.map((id) => ({ id, status: 'PASS', boundary: 'REAL-BROWSER', detail: 'observed in check fixture' })),
    ...overrides,
  };
}
function expectReject(name, report, expected, needle) {
  const { problems } = validateBrowserResults(report, expected);
  const hit = problems.find((p) => p.includes(needle));
  check(name, problems.length > 0 && Boolean(hit), hit ?? `no problem named "${needle}"; problems: ${JSON.stringify(problems)}`);
}

// --- Validator-level checks ---
{
  const { problems } = validateBrowserResults(validReport(), EXPECTED);
  check('positive-control-valid-report', problems.length === 0, problems.length === 0 ? 'complete valid report accepted' : `unexpected problems: ${problems.join('; ')}`);
}
expectReject('stale-commit-rejected', validReport({ testedCommit: OTHER_COMMIT }), EXPECTED, 'stale commit');
{
  const r = validReport();
  r.cases = r.cases.map((c) => (c.id === 'V5-FEEDS-01' ? { ...c, status: 'FAIL', detail: 'timeout cleared at headers' } : c));
  expectReject('failed-v5-regression-rejected', r, EXPECTED, 'V5-FEEDS-01');
}
{
  const r = validReport();
  r.cases = r.cases.filter((c) => c.id !== 'TEST-HABITS-001');
  expectReject('omitted-case-rejected', r, EXPECTED, 'omitted case: TEST-HABITS-001');
}
{
  const r = validReport();
  r.cases = r.cases.map((c) => (c.id === 'TEST-FEEDS-002' ? { ...c, status: 'NOT RUN', detail: 'no browser resolved' } : c));
  expectReject('not-run-case-rejected', r, EXPECTED, 'browser case not run: TEST-FEEDS-002');
}
expectReject('stale-runid-rejected', validReport(), { ...EXPECTED, runId: 'a-different-run' }, 'stale report');
expectReject('source-hash-mismatch-rejected', validReport({ storeSha256: 'e'.repeat(64) }), EXPECTED, 'source hash mismatch');
expectReject('stale-timestamp-rejected', validReport({ generatedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString() }), EXPECTED, 'stale report');
{
  const r = validReport();
  r.cases = r.cases.map((c) => (c.id === 'V5-STORE-01' ? { ...c, boundary: 'MOCK' } : c));
  expectReject('mock-boundary-rejected', r, EXPECTED, 'wrong boundary: V5-STORE-01');
}
{
  const dir = mkdtempSync(join(tmpdir(), 'lane-e-neg-'));
  const bad = join(dir, 'browser-results.json');
  writeFileSync(bad, '{ this is not json', 'utf8');
  const { report, problems } = loadBrowserResults(bad);
  const hit = problems.find((p) => p.includes('malformed report'));
  check('malformed-json-rejected', report === null && Boolean(hit), hit ?? `problems: ${JSON.stringify(problems)}`);
  const missing = loadBrowserResults(join(dir, 'absent.json'));
  check('missing-file-is-browser-not-run', missing.report === null && missing.problems.some((p) => p.includes('browser-not-run')), missing.problems.join('; '));
}

// --- Runner end-to-end checks (scratch trees, no browser needed) ---
function scratchTree({ withSpec }) {
  const dir = mkdtempSync(join(tmpdir(), 'lane-e-e2e-'));
  mkdirSync(join(dir, '__tests__'), { recursive: true });
  mkdirSync(join(dir, 'js'), { recursive: true });
  mkdirSync(join(dir, 'qa', 'v4'), { recursive: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, '__tests__', 'trivial.test.mjs'), "console.log('case trivial: PASS');\n", 'utf8');
  writeFileSync(join(dir, 'js', 'store.js'), '// invented store fixture\n', 'utf8');
  writeFileSync(join(dir, 'js', 'feeds.js'), '// invented feeds fixture\n', 'utf8');
  cpSync(join(HERE, 'write-browser-results.mjs'), join(dir, 'scripts', 'write-browser-results.mjs'));
  if (withSpec === 'silent') {
    writeFileSync(join(dir, 'qa', 'v4', 'silent.spec.mjs'), "console.log('spec ran, wrote nothing');\n", 'utf8');
  }
  if (withSpec === 'good') {
    // Contract double: exercises the writer and aggregation path exactly as
    // a Lane D spec must. It proves gate plumbing only, not browser evidence.
    writeFileSync(join(dir, 'qa', 'v4', 'good.spec.mjs'), `
import { writeBrowserResults, REQUIRED_BROWSER_IDS } from '../../scripts/write-browser-results.mjs';
const cases = REQUIRED_BROWSER_IDS.map((id) => ({ id, status: 'PASS', boundary: 'REAL-BROWSER', detail: 'contract double case' }));
writeBrowserResults({ outFile: process.env.QA_RESULTS_FILE, tree: process.env.QA_TREE_ROOT, testedCommit: process.env.QA_TESTED_COMMIT, runtime: process.env.QA_RUNTIME, runId: process.env.QA_RUN_ID, cases });
console.log('wrote ' + cases.length + ' cases');
`, 'utf8');
  }
  return dir;
}
function runRunner(tree) {
  const r = spawnSync(process.execPath, [RUNNER, tree, '--commit', COMMIT], { encoding: 'utf8', timeout: 120000 });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
{
  // The Codex defect shape: trivial PASS lane test + planted PASS labels,
  // no spec files at all. The v6 runner must reject it.
  const dir = scratchTree({ withSpec: 'none' });
  const labels = {};
  for (const id of ['TEST-UI-001', 'TEST-UI-002', 'TEST-STORE-001', 'TEST-STORE-002', 'TEST-STORE-003', 'TEST-STORE-004', 'TEST-FEEDS-001', 'TEST-FEEDS-002', 'TEST-FEEDS-003', 'TEST-HABITS-001']) labels[id] = 'PASS';
  writeFileSync(join(dir, 'qa', 'v4', 'browser-results.json'), JSON.stringify(labels), 'utf8');
  const { status, out } = runRunner(dir);
  check('planted-labels-rejected-e2e', status !== 0 && out.includes('browser-not-run'), `exit ${status}; defect named: ${out.split('\n').find((l) => l.includes('browser-not-run')) ?? 'NONE'}`);
}
{
  const dir = scratchTree({ withSpec: 'silent' });
  const { status, out } = runRunner(dir);
  check('silent-spec-is-browser-not-run-e2e', status !== 0 && out.includes('browser-not-run'), `exit ${status}; defect named: ${out.split('\n').find((l) => l.includes('browser-not-run')) ?? 'NONE'}`);
}
{
  const dir = scratchTree({ withSpec: 'good' });
  const { status, out } = runRunner(dir);
  check('complete-run-passes-e2e', status === 0 && out.includes('[LOCAL GATE] PASS'), `exit ${status}; ${out.split('\n').find((l) => l.includes('LOCAL GATE')) ?? 'no gate line'}`);
}

// --- Browser-selection checks (V9: Chromium-family helper) ---
{
  const rejected = ['firefox', 'opera'].map((value) => {
    try { resolveBrowserSelection({ QA_BROWSER: value }); return false; }
    catch { return true; }
  });
  check('browser-selection-rejects-unsupported', rejected.every(Boolean),
    'QA_BROWSER=firefox and QA_BROWSER=opera both throw; no fallback selection is returned');
}
{
  const chrome = resolveBrowserSelection({ QA_BROWSER: 'Chrome' });
  const brave = resolveBrowserSelection({ QA_BROWSER: ' brave ' });
  const chromium = resolveBrowserSelection({});
  const override = resolveBrowserSelection({ QA_BROWSER: 'chrome', QA_BROWSER_EXECUTABLE_PATH: '/opt/browsers/chrome' });
  const alias = resolveBrowserSelection({ QA_BROWSER: 'brave', QA_BROWSER_EXECUTABLE: '/opt/browsers/brave' });
  const ok = chrome.kind === 'chrome' && brave.kind === 'brave' && chromium.kind === 'chromium'
    && chromium.executablePath === null
    && override.executablePath === '/opt/browsers/chrome' && alias.executablePath === '/opt/browsers/brave';
  check('browser-selection-accepts-supported', ok,
    `chrome=${chrome.kind}, brave=${brave.kind}, default=${chromium.kind}, override=${override.executablePath}, alias=${alias.executablePath}`);
}
{
  const files = ['browser-launch.mjs', 'ui-browser.spec.mjs', 'storage-browser.spec.mjs', 'feeds-browser.spec.mjs', 'jobs-browser.spec.mjs']
    .map((name) => join(HERE, '..', 'qa', 'v4', name));
  const offenders = files.filter((f) => /firefox/i.test(readFileSync(f, 'utf8')));
  check('no-legacy-browser-references', offenders.length === 0,
    offenders.length === 0 ? 'helper and all four specs contain no legacy browser reference' : `legacy reference remains in: ${offenders.join(', ')}`);
}

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(`Negative checks: ${results.length - failed.length}/${results.length} behaved as required, ${failed.length} failed.`);
process.exit(failed.length > 0 ? 1 : 0);
