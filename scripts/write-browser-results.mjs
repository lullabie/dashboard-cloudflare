#!/usr/bin/env node
// write-browser-results.mjs — the ONE writer and validator for browser results.
//
// Lane D specs MUST use this module. No spec writes qa/v4/browser-results.json
// by hand and no spec invents its own format. The contract is
// qa/v4/result-schema.md; this file is its executable form.
//
// Library use (from a spec in qa/v4/):
//   import { writeBrowserResults } from '../../scripts/write-browser-results.mjs';
//   await writeBrowserResults({
//     outFile: process.env.QA_RESULTS_FILE,
//     tree: process.env.QA_TREE_ROOT,
//     testedCommit: process.env.QA_TESTED_COMMIT,
//     runtime: process.env.QA_RUNTIME,
//     runId: process.env.QA_RUN_ID,
//     cases: [{ id, status, boundary, detail }, ...],
//   });
// The runner sets the QA_* variables. The writer computes js/store.js and
// js/feeds.js SHA-256 from the tree itself; a spec cannot state hashes.
// Repeated calls with the same runId/commit/hashes merge cases by id
// (aggregation across the UI, storage and feeds specs of one run).
//
// CLI use (fixture tools, debugging):
//   node scripts/write-browser-results.mjs --tree <path> --commit <sha>
//     --runtime "<string>" --run-id <id> --cases <cases.json> --out <file>
// cases.json is a JSON array of {id, status, boundary, detail}.

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RESULT_SCHEMA_VERSION = 2;
export const RESULT_STATUSES = ['PASS', 'FAIL', 'NOT RUN'];

// Required browser case IDs. Source registry: docs/ACCEPTANCE.md plus the
// v5 bundle regression list. TEST-UI-002 is required as its ten subcases;
// a bare "TEST-UI-002" entry does not satisfy any subcase.
export const REQUIRED_BROWSER_IDS = [
  'TEST-UI-001',
  'TEST-UI-002a', 'TEST-UI-002b', 'TEST-UI-002c', 'TEST-UI-002d', 'TEST-UI-002e',
  'TEST-UI-002f', 'TEST-UI-002g', 'TEST-UI-002h', 'TEST-UI-002i', 'TEST-UI-002j',
  'TEST-STORE-001', 'TEST-STORE-002', 'TEST-STORE-003', 'TEST-STORE-004',
  'TEST-FEEDS-001', 'TEST-FEEDS-002', 'TEST-FEEDS-003',
  'TEST-HABITS-001',
  'V5-STORE-01', 'V5-STORE-02',
  'V5-FEEDS-01', 'V5-FEEDS-02', 'V5-FEEDS-03',
  'V8-JOBS-OTHER',
];

const SHA256_RE = /^[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{7,40}$/;

export function sha256File(path) {
  if (!existsSync(path)) return null;
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function treeSourceHashes(tree) {
  return {
    storeSha256: sha256File(join(tree, 'js', 'store.js')),
    feedsSha256: sha256File(join(tree, 'js', 'feeds.js')),
  };
}

function checkCaseShape(c, where) {
  const problems = [];
  if (!c || typeof c !== 'object' || Array.isArray(c)) return [`${where}: entry is not an object`];
  if (typeof c.id !== 'string' || c.id.length === 0) problems.push(`${where}: id missing or not a string`);
  if (!RESULT_STATUSES.includes(c.status)) problems.push(`${where} (${c.id ?? '?'}): status "${c.status}" is not PASS, FAIL or NOT RUN`);
  if (typeof c.boundary !== 'string' || c.boundary.length === 0) problems.push(`${where} (${c.id ?? '?'}): boundary missing`);
  if (typeof c.detail !== 'string' || c.detail.length === 0) problems.push(`${where} (${c.id ?? '?'}): detail missing or empty`);
  return problems;
}

// validateBrowserResults(report, expected) -> { problems, warnings }
// expected: { testedCommit, storeSha256, feedsSha256, runId?, maxAgeMin?, now? }
// Every problem names the defect. An empty problems list means the report is
// a complete, current, identity-matched PASS set. Nothing else may pass.
export function validateBrowserResults(report, expected = {}) {
  const problems = [];
  const warnings = [];
  const now = expected.now ? new Date(expected.now) : new Date();
  const maxAgeMin = expected.maxAgeMin ?? 120;

  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return { problems: ['browser-not-run: result report is missing or is not a JSON object'], warnings };
  }
  if (report.schemaVersion !== RESULT_SCHEMA_VERSION) {
    problems.push(`malformed report: schemaVersion is ${JSON.stringify(report.schemaVersion)}, expected ${RESULT_SCHEMA_VERSION}`);
  }
  if (typeof report.testedCommit !== 'string' || !COMMIT_RE.test(report.testedCommit)) {
    problems.push(`malformed report: testedCommit "${report.testedCommit}" is not a commit hash`);
  } else if (expected.testedCommit && report.testedCommit !== expected.testedCommit) {
    problems.push(`stale commit: report testedCommit ${report.testedCommit} does not match tested commit ${expected.testedCommit}`);
  }
  for (const field of ['storeSha256', 'feedsSha256']) {
    if (typeof report[field] !== 'string' || !SHA256_RE.test(report[field])) {
      problems.push(`malformed report: ${field} is not a SHA-256 hex string`);
    } else if (expected[field] && report[field] !== expected[field]) {
      problems.push(`source hash mismatch: report ${field} ${report[field]} does not match tree value ${expected[field]}`);
    }
  }
  if (typeof report.runtime !== 'string' || report.runtime.length === 0) {
    problems.push('malformed report: runtime missing');
  }
  if (typeof report.runId !== 'string' || report.runId.length === 0) {
    problems.push('malformed report: runId missing; report cannot be tied to a run');
  } else if (expected.runId && report.runId !== expected.runId) {
    problems.push(`stale report: runId ${report.runId} does not match this run ${expected.runId}; report was not produced by this run`);
  }
  const generatedAt = new Date(report.generatedAt);
  if (Number.isNaN(generatedAt.getTime())) {
    problems.push(`malformed report: generatedAt "${report.generatedAt}" is not a timestamp`);
  } else {
    const ageMin = (now - generatedAt) / 60000;
    if (ageMin < -5) problems.push(`stale report: generatedAt ${report.generatedAt} is in the future`);
    if (ageMin > maxAgeMin) problems.push(`stale report: generatedAt ${report.generatedAt} is ${Math.round(ageMin)} min old; limit is ${maxAgeMin} min`);
  }
  if (!Array.isArray(report.cases)) {
    problems.push('malformed report: cases is not an array');
    return { problems, warnings };
  }
  const seen = new Map();
  report.cases.forEach((c, i) => {
    problems.push(...checkCaseShape(c, `cases[${i}]`));
    if (c && typeof c.id === 'string') {
      if (seen.has(c.id)) problems.push(`duplicate case: ${c.id} appears more than once`);
      seen.set(c.id, c);
    }
  });
  for (const id of REQUIRED_BROWSER_IDS) {
    const c = seen.get(id);
    if (!c) { problems.push(`omitted case: ${id} has no result in this run`); continue; }
    if (c.status === 'FAIL') problems.push(`failed case: ${id} is FAIL — ${c.detail}`);
    else if (c.status === 'NOT RUN') problems.push(`browser case not run: ${id} is NOT RUN — ${c.detail}`);
    else if (c.status !== 'PASS') problems.push(`malformed report: ${id} has status "${c.status}"`);
    if (c.status === 'PASS' && c.boundary !== 'REAL-BROWSER') {
      problems.push(`wrong boundary: ${id} PASS carries boundary "${c.boundary}"; release cases require REAL-BROWSER`);
    }
  }
  for (const id of seen.keys()) {
    if (!REQUIRED_BROWSER_IDS.includes(id)) warnings.push(`extra case ignored by the gate: ${id}`);
  }
  return { problems, warnings };
}

// loadBrowserResults(file) -> { report, problems }
// A missing file means the browser suites did not run in this run.
// A file that does not parse is a malformed-report defect, never a pass.
export function loadBrowserResults(file) {
  if (!existsSync(file)) {
    return { report: null, problems: ['browser-not-run: no result file was produced by this run'] };
  }
  try {
    return { report: JSON.parse(readFileSync(file, 'utf8')), problems: [] };
  } catch (error) {
    return { report: null, problems: [`malformed report: result file does not parse as JSON (${error.message})`] };
  }
}

// The single aggregation writer. See the header for the call contract.
export function writeBrowserResults({ outFile, tree, testedCommit, runtime, runId, cases }) {
  if (!outFile) throw new Error('writeBrowserResults: outFile is required (QA_RESULTS_FILE)');
  if (!Array.isArray(cases) || cases.length === 0) throw new Error('writeBrowserResults: cases must be a non-empty array');
  cases.forEach((c, i) => {
    const p = checkCaseShape(c, `cases[${i}]`);
    if (p.length > 0) throw new Error(`writeBrowserResults: refusing to write invalid case: ${p.join('; ')}`);
  });
  const { storeSha256, feedsSha256 } = treeSourceHashes(resolve(tree));
  if (!storeSha256 || !feedsSha256) throw new Error('writeBrowserResults: js/store.js or js/feeds.js missing in tree; hashes cannot be recorded');
  const header = {
    schemaVersion: RESULT_SCHEMA_VERSION,
    testedCommit,
    storeSha256,
    feedsSha256,
    runtime: runtime ?? `node ${process.version}`,
    runId: runId ?? randomUUID(),
  };
  let merged = cases;
  if (existsSync(outFile)) {
    try {
      const prev = JSON.parse(readFileSync(outFile, 'utf8'));
      const sameRun = prev && prev.runId === header.runId && prev.testedCommit === header.testedCommit
        && prev.storeSha256 === header.storeSha256 && prev.feedsSha256 === header.feedsSha256
        && Array.isArray(prev.cases);
      if (sameRun) {
        const byId = new Map(prev.cases.map((c) => [c.id, c]));
        for (const c of cases) byId.set(c.id, c);
        merged = [...byId.values()];
      }
    } catch { /* unreadable prior file: start fresh; the gate judges the new file */ }
  }
  const report = { ...header, generatedAt: new Date().toISOString(), cases: merged };
  const tmp = join(dirname(outFile), `.browser-results.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  renameSync(tmp, outFile);
  return report;
}

// CLI
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  try {
    const cases = JSON.parse(readFileSync(opt('--cases'), 'utf8'));
    const report = writeBrowserResults({
      outFile: resolve(opt('--out')),
      tree: resolve(opt('--tree')),
      testedCommit: opt('--commit'),
      runtime: opt('--runtime'),
      runId: opt('--run-id'),
      cases,
    });
    console.log(`Wrote ${report.cases.length} case(s) to ${opt('--out')} (runId ${report.runId})`);
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exit(1);
  }
}
