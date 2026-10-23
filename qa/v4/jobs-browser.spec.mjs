// jobs-browser.spec.mjs — QA owner browser spec for V8-JOBS-OTHER.
// Run: node qa/v4/jobs-browser.spec.mjs [--tree <path>] [--results-out <path>]
//
// One real-browser case: V8-JOBS-OTHER. The case seeds invented jobs through
// the legacy localStorage path, opens the Jobs view in a Chromium-family
// browser (Chrome/Brave/Chromium via QA_BROWSER) through
// Playwright, clicks the actual jobs chart Other bar on the canvas, and
// verifies the status filter, the visible list, location narrowing, and the
// All reset. Data is invented only.
//
// Tree under test: --tree, else QA_TREE_ROOT, else DASH_TREE, else the
// checkout that contains this spec (qa/v4/ -> repo root, two levels up).
// The spec serves that tree as-is. It applies no patch, substitutes no
// source, and pins no hash. Machine results go through the one shared
// writer (scripts/write-browser-results.mjs), schema version 2.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeBrowserResults } from '../../scripts/write-browser-results.mjs';
import { launchSelectedBrowser } from './browser-launch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
function argValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}
const TREE = path.resolve(
  argValue('--tree') ?? process.env.QA_TREE_ROOT ?? process.env.DASH_TREE ??
    path.resolve(here, '..', '..'),
);

function sha256File(file) {
  return existsSync(file)
    ? createHash('sha256').update(readFileSync(file)).digest('hex')
    : 'MISSING';
}
const STORE_SHA256 = sha256File(path.join(TREE, 'js', 'store.js'));
const FEEDS_SHA256 = sha256File(path.join(TREE, 'js', 'feeds.js'));
const MAIN_SHA256 = sha256File(path.join(TREE, 'js', 'main.js'));

console.log(
  `REAL-BROWSER — tree under test: ${TREE}; js/store.js SHA-256 ${STORE_SHA256}; ` +
  `js/feeds.js SHA-256 ${FEEDS_SHA256}; js/main.js SHA-256 ${MAIN_SHA256}. ` +
  'Hashes are read from the tested tree at run time. No source is pinned or substituted.',
);
console.log('');

const CASE_IDS = ['V8-JOBS-OTHER'];
let browserInfo = null;
const attemptedKind = String(process.env.QA_BROWSER ?? 'chromium').trim().toLowerCase() || 'chromium';
function currentRuntime() {
  const base = process.env.QA_RUNTIME ?? `node ${process.version}`;
  return browserInfo
    ? `${base}; browser ${browserInfo.actualName} ${browserInfo.version} (QA_BROWSER=${browserInfo.selection.kind})`
    : `${base}; browser ${attemptedKind} not launched`;
}

const results = [];

function record(id, boundary, status, detail) {
  results.push({ id, boundary, status, detail });
  console.log(`${status.padEnd(7)} ${id} [${boundary}] ${detail}`);
}

function notRunAll(blocker) {
  for (const id of CASE_IDS) record(id, 'REAL-BROWSER', 'NOT RUN', `Blocker: ${blocker}`);
  summarize();
}

function emitResults() {
  const out = process.env.QA_RESULTS_FILE ?? argValue('--results-out') ?? process.env.QA_RESULTS_OUT ??
    path.join(here, 'browser-results.json');
  try {
    writeBrowserResults({
      outFile: path.resolve(out),
      tree: TREE,
      testedCommit: process.env.QA_TESTED_COMMIT ?? 'working-tree',
      runtime: currentRuntime(),
      runId: process.env.QA_RUN_ID,
      cases: results,
    });
    console.log(`Machine results written: ${out}`);
  } catch (error) {
    console.error(`Machine results NOT written: ${error.message}`);
    process.exitCode = 1;
  }
}

function summarize() {
  const counts = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log('');
  console.log(`Summary: PASS ${counts.PASS ?? 0}; NOT RUN ${counts['NOT RUN'] ?? 0}; FAIL ${counts.FAIL ?? 0}`);
  console.log('Boundary rule: PASS here means the case ran in a real browser against the tree named in the source label.');
  if ((counts.FAIL ?? 0) > 0 || (counts['NOT RUN'] ?? 0) > 0) process.exitCode = 1;
  emitResults();
}

async function runCase(id, fn) {
  try {
    const detail = await fn();
    record(id, 'REAL-BROWSER', 'PASS', detail);
  } catch (error) {
    record(id, 'REAL-BROWSER', 'FAIL', (error?.stack ?? String(error)).split('\n').slice(0, 3).join(' | '));
  }
}

// --- Static file server on a local temporary origin. ---

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function createStaticServer(appDir) {
  return http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const file = path.join(appDir, rel);
    if (!file.startsWith(appDir) || !existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(readFileSync(file));
  });
}

// --- Invented seed jobs. One known status, three Other-group statuses.
// A missing-status record is not seeded here: js/jobs.js createJobCard
// reads job.status.charAt, so a missing status cannot render a card; the
// missing-status predicate is covered by __tests__/jobs-filter.test.mjs.

const SEED_JOBS = [
  { id: 'job_v8_applied', title: 'AppliedCo', company: 'AppliedCo', role: 'Engineer', status: 'applied', location: 'toronto', date: '2026-10-01', notes: '' },
  { id: 'job_v8_other', title: 'ExplicitOtherCo', company: 'ExplicitOtherCo', role: 'Engineer', status: 'other', location: 'toronto', date: '2026-10-02', notes: '' },
  { id: 'job_v8_pending', title: 'PendingCo', company: 'PendingCo', role: 'Engineer', status: 'pending', location: 'vancouver', date: '2026-10-03', notes: '' },
  { id: 'job_v8_blank', title: 'BlankCo', company: 'BlankCo', role: 'Engineer', status: '', location: 'toronto', date: '2026-10-04', notes: '' },
];

async function visibleCompanies(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('#jobs-container .card h3')].map((el) => el.textContent),
  );
}

async function caseJobsOther(browser, origin) {
  const context = await browser.newContext();
  await context.addInitScript((jobs) => {
    localStorage.setItem('dashboard_data', JSON.stringify({
      goals: [], places: [], jobs, investments: [], habits: [], indicators: [],
      college: { timetable: [], assignments: [], exams: [], fees: [] },
    }));
  }, SEED_JOBS);
  const page = await context.newPage();
  const pageerrors = [];
  page.on('pageerror', (error) => pageerrors.push(String(error?.message ?? error)));
  try {
    await page.goto(`${origin}/index.html`, { waitUntil: 'load', timeout: 20000 });
    await page.waitForFunction(
      () => document.querySelectorAll('.nav-btn').length === 9 &&
        !document.getElementById('view-today')?.classList.contains('hidden'),
      null,
      { timeout: 12000 },
    );
    await page.click('.nav-btn[data-view="jobs"]');
    await page.waitForFunction(
      () => !document.getElementById('view-jobs')?.classList.contains('hidden'),
      null,
      { timeout: 5000 },
    );
    // All four seeded jobs render before any filtering.
    await page.waitForFunction(
      () => document.querySelectorAll('#jobs-container .card').length === 4,
      null,
      { timeout: 8000 },
    );
    const before = await visibleCompanies(page);
    assert.deepEqual([...before].sort(), ['AppliedCo', 'BlankCo', 'ExplicitOtherCo', 'PendingCo'],
      `seed render mismatch: ${before.join(', ')}`);

    // Click the actual chart Other bar. The jobs chart is a horizontal bar
    // chart; category order is Applied, Interview, Offer, Rejected, Other,
    // so Other is the fifth row. Try the row center first, then nearby
    // points on the same row, until the app reacts.
    const canvas = page.locator('canvas#jobs-chart');
    await canvas.waitFor({ timeout: 8000 });
    const box = await canvas.boundingBox();
    assert.ok(box, 'jobs chart canvas has no bounding box');
    let clickedAt = null;
    for (const fy of [0.86, 0.83, 0.89, 0.80, 0.92]) {
      for (const fx of [0.5, 0.35, 0.65]) {
        await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
        try {
          await page.waitForFunction(
            () => document.getElementById('job-status-filter')?.value === 'other',
            null,
            { timeout: 1500 },
          );
          clickedAt = `${fx},${fy}`;
          break;
        } catch { /* try the next point on the Other row */ }
      }
      if (clickedAt) break;
    }
    assert.ok(clickedAt, 'clicking the chart Other bar never set the status filter to other');
    const selectedLabel = await page.evaluate(() => {
      const sel = document.getElementById('job-status-filter');
      return sel.options[sel.selectedIndex]?.textContent;
    });
    assert.equal(selectedLabel, 'Other', `selected option label is ${selectedLabel}, expected Other`);

    await page.waitForFunction(
      () => document.querySelectorAll('#jobs-container .card').length === 3,
      null,
      { timeout: 5000 },
    );
    const otherList = await visibleCompanies(page);
    assert.deepEqual([...otherList].sort(), ['BlankCo', 'ExplicitOtherCo', 'PendingCo'],
      `Other list mismatch: ${otherList.join(', ')}`);

    // Location conjunction: Other + Toronto keeps only the Toronto members.
    await page.selectOption('#job-location-filter', 'toronto');
    await page.waitForFunction(
      () => document.querySelectorAll('#jobs-container .card').length === 2,
      null,
      { timeout: 5000 },
    );
    const narrowed = await visibleCompanies(page);
    assert.deepEqual([...narrowed].sort(), ['BlankCo', 'ExplicitOtherCo'],
      `Other+Toronto list mismatch: ${narrowed.join(', ')}`);

    // All reset restores the full seeded list.
    await page.selectOption('#job-location-filter', 'all');
    await page.selectOption('#job-status-filter', 'all');
    await page.waitForFunction(
      () => document.querySelectorAll('#jobs-container .card').length === 4,
      null,
      { timeout: 5000 },
    );
    assert.deepEqual(pageerrors, [], `uncaught page errors: ${pageerrors.join(' | ')}`);
    return `clicked the real chart Other bar at canvas fraction ${clickedAt}; filter value 'other' with label 'Other'; ` +
      'list showed ExplicitOtherCo + PendingCo + BlankCo (3); Other+Toronto narrowed to 2; All reset restored 4; zero page errors';
  } finally {
    await context.close();
  }
}

// --- Runner ---

let browser;
try {
  browserInfo = await launchSelectedBrowser();
  browser = browserInfo.browser;
} catch (error) {
  notRunAll(`Browser launch failed: ${error.message.split('\n')[0]}. Documented route: the pinned install in qa/v4/README.md.`);
  process.exit(1);
}

for (const required of ['index.html', path.join('js', 'main.js'), path.join('js', 'store.js')]) {
  if (!existsSync(path.join(TREE, required))) {
    await browser.close();
    notRunAll(`tree under test lacks ${required}: ${TREE}`);
    process.exit(1);
  }
}

const server = createStaticServer(TREE);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

await runCase('V8-JOBS-OTHER', () => caseJobsOther(browser, origin));

await browser.close();
server.close();
summarize();
