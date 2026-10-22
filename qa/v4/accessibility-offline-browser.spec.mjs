// accessibility-offline-browser.spec.mjs — Lane D QA, dashboard V16.
// Run: node qa/v4/accessibility-offline-browser.spec.mjs [--tree <path>]
//        [--results-out <path>]
// Accessibility and offline cases for complete-app local acceptance:
//
//   V16-ACCESS-01  Keyboard-only import: the Settings import control
//     is reached and operated by keyboard only (Tab/Enter). The Enter
//     key opens the real file chooser for #import-file (Playwright
//     filechooser event), a file is set through that chooser, the
//     import confirm is accepted, and the imported record renders.
//     No mouse input is used in this case.
//   V16-ACCESS-02  Nested modal: News -> Manage Sources opens the
//     sources-list modal (parent); Add Source inside it opens the
//     source modal (nested). Focus must move into the nested modal.
//     One Escape must close only the nested layer and return focus to
//     the parent modal. A second Escape must close the parent and
//     return focus to the invoking control (#btn-manage-sources).
//   V16-ACCESS-03  Small screens: at 360x640 the primary views stay
//     operable — nav is reachable, a goal form opens and submits, the
//     record renders, and no pageerror occurs.
//   V16-OFFLINE-01  Outside requests blocked: every non-local-origin
//     request is aborted at context level. Chart.js reaches this app
//     as the bundled local file js/chart.umd.js (a classic script tag
//     in index.html, not a CDN), so charts must still render from the
//     local bundle and the app must boot and render its views.
//   V16-OFFLINE-02  Missing-library safe state: only the Chart.js
//     request (js/chart.umd.js) is aborted. The app must reach its
//     honest fallback ("Chart library unavailable"), with no
//     pageerror, no fake chart, and non-chart views still working.
//   V16-OFFLINE-03  Staged production smoke: the V15B-hardened
//     packager stages the tree into a fresh temp dir; the STAGED
//     folder is served as the origin. Boot must produce zero
//     pageerrors and zero failed local asset requests, and the main
//     views must render.
//
// No store mocks. The spec serves a static tree from a local
// temporary origin and drives the real app (index.html) in a
// Chromium-family browser (QA_BROWSER). Invented records only.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBrowserResults } from '../../scripts/write-browser-results.mjs';
import { launchSelectedBrowser } from './browser-launch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
function argValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}
const TREE_ROOT = path.resolve(
  process.env.QA_TREE_ROOT ?? argValue('--tree') ?? process.env.DASH_TREE ??
    path.resolve(here, '..', '..'),
);

const CASE_IDS = [
  'V16-ACCESS-01', 'V16-ACCESS-02', 'V16-ACCESS-03',
  'V16-OFFLINE-01', 'V16-OFFLINE-02', 'V16-OFFLINE-03',
];

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
async function group(id, fn) {
  try {
    const detail = await fn();
    record(id, 'REAL-BROWSER', 'PASS', detail);
  } catch (error) {
    record(id, 'REAL-BROWSER', 'FAIL', (error?.stack ?? String(error)).split('\n').slice(0, 4).join(' | '));
  }
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function startServer(root) {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.join(root, urlPath);
    if (!filePath.startsWith(root) || !existsSync(filePath)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
    res.end(readFileSync(filePath));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function grabStore(page) {
  await page.evaluate(async () => {
    window.__store = await import('/js/store.js');
    await window.__store.initStore();
  });
}

async function bootPage(context, origin, pageErrors) {
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message ?? e)));
  await page.goto(origin + '/index.html', { waitUntil: 'load' });
  await grabStore(page);
  return page;
}

function importPayload(data) {
  return {
    goals: [], places: [], jobs: [], investments: [], habits: [], indicators: [],
    metadata: {},
    college: { timetable: [], assignments: [], exams: [], fees: [] },
    news: { sources: [], cache: [], manual: [] },
    ...data,
  };
}

async function importInPage(page, payload) {
  const onDialog = (d) => { d.accept().catch(() => {}); };
  page.on('dialog', onDialog);
  try {
    const res = await page.evaluate(async (text) => {
      const file = new File([text], 'v16-import.json', { type: 'application/json' });
      return await new Promise((resolve, reject) => {
        try {
          window.__store.importData(file, (r) => resolve(r ?? {}));
        } catch (e) { reject(e); }
      });
    }, JSON.stringify({
      app: 'dashboard', schemaVersion: 1,
      exportedAt: new Date().toISOString(), data: payload,
    }));
    assert.ok(res && res.committed === true,
      `import committed (got: ${JSON.stringify(res).slice(0, 200)})`);
  } finally {
    page.off('dialog', onDialog);
  }
}

const storePath = path.join(TREE_ROOT, 'js', 'store.js');
const storeSha = existsSync(storePath)
  ? createHash('sha256').update(readFileSync(storePath)).digest('hex')
  : 'MISSING';
const feedsPath = path.join(TREE_ROOT, 'js', 'feeds.js');
const feedsSha = existsSync(feedsPath)
  ? createHash('sha256').update(readFileSync(feedsPath)).digest('hex')
  : 'MISSING';
console.log(`Tree under test: ${TREE_ROOT}`);
console.log(`js/store.js SHA-256: ${storeSha}`);
console.log(`js/feeds.js SHA-256: ${feedsSha}`);

function emitResults() {
  const out = process.env.QA_RESULTS_FILE ?? argValue('--results-out') ?? process.env.QA_RESULTS_OUT ??
    path.join(here, 'browser-results.json');
  try {
    writeBrowserResults({
      outFile: path.resolve(out),
      tree: TREE_ROOT,
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

let browser;
try {
  browserInfo = await launchSelectedBrowser();
  browser = browserInfo.browser;
} catch (error) {
  console.log(`Browser launch blocker: ${error.message.split('\n')[0]}`);
  for (const id of CASE_IDS) record(id, 'REAL-BROWSER', 'NOT RUN', `Missing precondition: browser launch failed: ${error.message.split('\n')[0]}`);
  console.log(`Summary: PASS 0; NOT RUN ${CASE_IDS.length}; FAIL 0`);
  emitResults();
  process.exit(1);
}

const { server, origin } = await startServer(TREE_ROOT);
console.log(`Local temporary origin: ${origin}`);
console.log(`Browser: ${browserInfo.runtimeLabel} (QA_BROWSER=${browserInfo.selection.kind})`);
console.log('');

// Tab forward until the predicate on document.activeElement is true.
// Keyboard only: this helper presses Tab and reads focus state.
async function tabUntil(page, predicateSource, maxTabs = 80) {
  for (let i = 0; i < maxTabs; i++) {
    const hit = await page.evaluate(predicateSource);
    if (hit) return true;
    await page.keyboard.press('Tab');
  }
  return page.evaluate(predicateSource);
}

const JOB_ONE = {
  id: 'job_v16_chart', company: 'Chart Co', role: 'Chart Role', status: 'applied',
  location: 'toronto', date: '2026-10-01', notes: 'invented chart job',
};

// --- V16-ACCESS-01: keyboard-only import ------------------------------------
await group('V16-ACCESS-01', async () => {
  const errors = [];
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const scratch = mkdtempSync(path.join(os.tmpdir(), 'v16-access-'));
    const importFile = path.join(scratch, 'keyboard-import.json');
    const payload = importPayload({
      goals: [{
        id: 'goal_v16_keyboard', title: 'Keyboard Import Goal', notes: '', showNotes: false,
        target: 1, status: 'active', history: [], occurrences: {}, checkIns: [],
        createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
      }],
    });
    writeFileSync(importFile, JSON.stringify({
      app: 'dashboard', schemaVersion: 1,
      exportedAt: new Date().toISOString(), data: payload,
    }));

    const page = await bootPage(context, origin, errors);
    // Import asks confirm() and then alert(); accept both. Dialog
    // handling is the harness dialog channel, not page mouse input.
    page.on('dialog', (d) => { d.accept().catch(() => {}); });

    // Keyboard only from here: Tab to the Settings nav button, Enter.
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    const reachedSettings = await tabUntil(page,
      () => document.activeElement?.classList?.contains('nav-btn') &&
        document.activeElement?.dataset?.view === 'settings');
    assert.ok(reachedSettings, 'Tab order never reached the Settings nav button');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => document.getElementById('view-settings')?.classList.contains('active'),
      null, { timeout: 5000 });

    // Tab to the import trigger and operate it with Enter. The Enter
    // must open the real file chooser for the hidden #import-file.
    const reachedTrigger = await tabUntil(page,
      () => document.activeElement?.id === 'btn-import-trigger');
    assert.ok(reachedTrigger, 'Tab order never reached #btn-import-trigger');
    // One retry is allowed for a dropped headless chooser event: the
    // retry is the same keyboard operation on the same focused
    // control, and the case still fails if no chooser ever opens.
    let chooser = null;
    for (let attempt = 0; attempt < 2 && !chooser; attempt++) {
      const chooserPromise = page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
      await page.keyboard.press('Enter');
      chooser = await chooserPromise;
    }
    assert.ok(chooser, 'Enter on the import trigger opened no file chooser');
    await chooser.setFiles(importFile);

    await page.waitForFunction(() => {
      const goals = window.__store?.getData().goals ?? [];
      return goals.some((g) => g.title === 'Keyboard Import Goal');
    }, null, { timeout: 8000 });

    // Keyboard to the Goals view; the imported record must render.
    const reachedGoals = await tabUntil(page,
      () => document.activeElement?.classList?.contains('nav-btn') &&
        document.activeElement?.dataset?.view === 'goals', 120);
    assert.ok(reachedGoals, 'Tab order never reached the Goals nav button after import');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => {
      const cards = document.querySelectorAll('#active-goals-container .card');
      return [...cards].some((c) => c.textContent.includes('Keyboard Import Goal'));
    }, null, { timeout: 8000 });
    assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
    return 'keyboard only (Tab/Enter, no mouse): Settings nav and #btn-import-trigger reached by Tab, Enter opened the real #import-file chooser, the file set through the chooser imported, and Keyboard Import Goal rendered in the Goals view';
  } finally {
    await context.close();
  }
});

// --- V16-ACCESS-02: nested modal focus and Escape layering ------------------
await group('V16-ACCESS-02', async () => {
  const errors = [];
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await bootPage(context, origin, errors);
    await page.click('.nav-btn[data-view="news"]');
    await page.click('#btn-manage-sources');
    await page.waitForFunction(
      () => !document.getElementById('news-sources-list-modal').classList.contains('hidden'),
      null, { timeout: 5000 });
    // Nested layer: Add Source inside the parent list modal opens the
    // source modal on top of it.
    await page.click('#btn-add-source');
    await page.waitForFunction(
      () => !document.getElementById('news-source-modal').classList.contains('hidden'),
      null, { timeout: 5000 });
    const nestedProbe = await page.evaluate(() => ({
      parentVisible: !document.getElementById('news-sources-list-modal').classList.contains('hidden'),
      nestedVisible: !document.getElementById('news-source-modal').classList.contains('hidden'),
      activeId: document.activeElement?.id ?? '',
      parentInert: document.getElementById('news-sources-list-modal').hasAttribute('inert'),
    }));
    assert.ok(nestedProbe.nestedVisible && nestedProbe.parentVisible,
      `both modal layers visible after Add Source (got: ${JSON.stringify(nestedProbe)})`);
    assert.equal(nestedProbe.activeId, 'news-source-name',
      `focus moved into the nested modal (active element: "${nestedProbe.activeId}", expected news-source-name)`);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const afterFirst = await page.evaluate(() => ({
      parentVisible: !document.getElementById('news-sources-list-modal').classList.contains('hidden'),
      nestedVisible: !document.getElementById('news-source-modal').classList.contains('hidden'),
      activeId: document.activeElement?.id ?? '',
    }));
    assert.ok(!afterFirst.nestedVisible && afterFirst.parentVisible && afterFirst.activeId === 'btn-add-source',
      `first Escape must close ONLY the nested layer and return focus to the parent modal's Add Source control (got: ${JSON.stringify(afterFirst)})`);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const afterSecond = await page.evaluate(() => ({
      parentVisible: !document.getElementById('news-sources-list-modal').classList.contains('hidden'),
      activeId: document.activeElement?.id ?? '',
    }));
    assert.ok(!afterSecond.parentVisible && afterSecond.activeId === 'btn-manage-sources',
      `second Escape must close the parent and return focus to #btn-manage-sources (got: ${JSON.stringify(afterSecond)})`);
    assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
    return 'nested stack used: news-sources-list-modal (parent) -> news-source-modal (nested); focus entered the nested modal, Escape closed only the nested layer and returned focus to the parent, second Escape closed the parent and returned focus to #btn-manage-sources';
  } finally {
    await context.close();
  }
});

// --- V16-ACCESS-03: small-screen operability smoke --------------------------
await group('V16-ACCESS-03', async () => {
  const errors = [];
  const context = await browser.newContext({
    acceptDownloads: true, viewport: { width: 360, height: 640 },
  });
  try {
    const page = await bootPage(context, origin, errors);
    await page.click('.nav-btn[data-view="goals"]');
    await page.waitForFunction(
      () => document.getElementById('view-goals')?.classList.contains('active'),
      null, { timeout: 5000 });
    await page.click('#btn-create-goal');
    await page.waitForFunction(
      () => !document.getElementById('goal-modal').classList.contains('hidden'),
      null, { timeout: 5000 });
    await page.fill('#goal-title', 'Small Screen Goal');
    await page.click('#goal-form button[type="submit"]');
    await page.waitForFunction(() => {
      const cards = document.querySelectorAll('#active-goals-container .card');
      return [...cards].some((c) => c.textContent.includes('Small Screen Goal'));
    }, null, { timeout: 8000 });
    // Nav stays reachable at this size: switch to Settings and back.
    await page.click('.nav-btn[data-view="settings"]');
    await page.waitForFunction(
      () => document.getElementById('view-settings')?.classList.contains('active'),
      null, { timeout: 5000 });
    assert.equal(errors.length, 0, `no page errors at 360x640: ${errors.join(' | ')}`);
    return 'at 360x640: nav reachable, goal form opened and submitted, Small Screen Goal rendered, Settings view opened, zero pageerrors';
  } finally {
    await context.close();
  }
});

// --- V16-OFFLINE-01: all outside requests blocked ---------------------------
await group('V16-OFFLINE-01', async () => {
  const errors = [];
  const context = await browser.newContext({ acceptDownloads: true });
  const blockedExternal = [];
  try {
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) {
        await route.continue();
      } else {
        blockedExternal.push(url);
        await route.abort();
      }
    });
    const page = await bootPage(context, origin, errors);
    await importInPage(page, importPayload({ jobs: [JOB_ONE] }));
    await page.click('.nav-btn[data-view="jobs"]');
    await page.waitForFunction(() => {
      const cards = document.querySelectorAll('#jobs-container .card');
      return [...cards].some((c) => c.textContent.includes('Chart Co'));
    }, null, { timeout: 8000 });
    await page.waitForTimeout(600);
    const probe = await page.evaluate(() => {
      const host = document.querySelector('[data-chart-host="jobs-chart"]');
      return {
        chartType: typeof Chart,
        canvas: !!document.querySelector('#jobs-chart'),
        hostText: host ? host.textContent.trim().slice(0, 120) : '',
        alt: document.getElementById('jobs-chart-alt')?.textContent ?? '',
      };
    });
    assert.equal(probe.chartType, 'function',
      `bundled Chart.js loaded from the local origin with outside requests blocked (typeof Chart: ${probe.chartType})`);
    assert.ok(probe.canvas, 'jobs chart canvas rendered from the bundled local Chart.js');
    assert.ok(!probe.hostText.includes('Chart library unavailable'),
      `chart host shows the unavailable fallback instead of a render: ${probe.hostText}`);
    assert.ok(probe.alt.includes('Applied: 1'),
      `chart alt text reports the real data (got: ${probe.alt.slice(0, 120)})`);
    assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
    return `all non-local requests aborted at context level (${blockedExternal.length} external request(s) blocked); app booted, views rendered, and the jobs chart rendered from the bundled local js/chart.umd.js (canvas present, alt reports Applied: 1)`;
  } finally {
    await context.close();
  }
});

// --- V16-OFFLINE-02: Chart.js request aborted, safe state -------------------
await group('V16-OFFLINE-02', async () => {
  const errors = [];
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    // Mechanism: abort only the Chart.js request at context level.
    await context.route('**/js/chart.umd.js', async (route) => { await route.abort(); });
    const page = await bootPage(context, origin, errors);
    await importInPage(page, importPayload({ jobs: [JOB_ONE] }));
    await page.click('.nav-btn[data-view="jobs"]');
    await page.waitForFunction(() => {
      const cards = document.querySelectorAll('#jobs-container .card');
      return [...cards].some((c) => c.textContent.includes('Chart Co'));
    }, null, { timeout: 8000 });
    await page.waitForTimeout(600);
    const probe = await page.evaluate(() => {
      const host = document.querySelector('[data-chart-host="jobs-chart"]');
      return {
        chartType: typeof Chart,
        canvas: !!document.querySelector('#jobs-chart'),
        hostText: host ? host.textContent.trim().slice(0, 160) : '',
        alt: document.getElementById('jobs-chart-alt')?.textContent ?? '',
      };
    });
    assert.equal(probe.chartType, 'undefined',
      `Chart.js is unavailable in this case (typeof Chart: ${probe.chartType})`);
    assert.ok(probe.hostText.includes('Chart library unavailable'),
      `honest missing-library state shown in the chart host (got: ${probe.hostText})`);
    assert.ok(probe.alt.includes('Chart library unavailable'),
      `chart alt text states the library is unavailable (got: ${probe.alt.slice(0, 120)})`);
    assert.equal(probe.canvas, false, 'no fake chart canvas is presented');
    // Non-chart views still work: create a goal through the real form.
    await page.click('.nav-btn[data-view="goals"]');
    await page.click('#btn-create-goal');
    await page.fill('#goal-title', 'No Chart Goal');
    await page.click('#goal-form button[type="submit"]');
    await page.waitForFunction(() => {
      const cards = document.querySelectorAll('#active-goals-container .card');
      return [...cards].some((c) => c.textContent.includes('No Chart Goal'));
    }, null, { timeout: 8000 });
    assert.equal(errors.length, 0, `no page errors with Chart.js missing: ${errors.join(' | ')}`);
    return 'mechanism: context route aborted only **/js/chart.umd.js; jobs view showed the honest "Chart library unavailable" state with matching alt text and no canvas, and the goals form still created a record with zero pageerrors';
  } finally {
    await context.close();
  }
});

// --- V16-OFFLINE-03: staged production smoke --------------------------------
await group('V16-OFFLINE-03', async () => {
  const stageParent = mkdtempSync(path.join(os.tmpdir(), 'v16-stage-'));
  const stagedDir = path.join(stageParent, 'staged');
  let stageOutput = '';
  try {
    stageOutput = execFileSync(process.execPath, [
      path.join(TREE_ROOT, 'scripts', 'package-static-assets.mjs'),
      '--stage', TREE_ROOT, stagedDir,
    ], { encoding: 'utf8' });
  } catch (error) {
    assert.fail(`packager --stage failed (exit ${error.status}): ${String(error.stdout ?? '')} ${String(error.stderr ?? '')}`.split('\n').slice(0, 3).join(' '));
  }
  assert.ok(existsSync(path.join(stagedDir, 'index.html')), 'staged folder contains index.html');
  const staged = await startServer(stagedDir);
  const errors = [];
  const failedLocal = [];
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
    page.on('requestfailed', (req) => {
      if (req.url().startsWith(staged.origin)) {
        failedLocal.push(`${req.url()} (${req.failure()?.errorText ?? 'failed'})`);
      }
    });
    page.on('response', (res) => {
      if (res.url().startsWith(staged.origin) && res.status() >= 400) {
        failedLocal.push(`${res.url()} (HTTP ${res.status()})`);
      }
    });
    await page.goto(staged.origin + '/index.html', { waitUntil: 'load' });
    await grabStore(page);
    for (const view of ['goals', 'jobs', 'investments', 'college', 'settings', 'today']) {
      await page.click(`.nav-btn[data-view="${view}"]`);
      await page.waitForFunction((v) => {
        return document.getElementById(`view-${v}`)?.classList.contains('active');
      }, view, { timeout: 5000 });
    }
    assert.deepEqual(failedLocal, [], `failed local asset requests from the staged folder: ${failedLocal.join(' | ')}`);
    assert.deepEqual(errors, [], `pageerrors from the staged folder: ${errors.join(' | ')}`);
    return `packager --stage into a fresh temp dir passed; the staged folder served as origin booted with zero pageerrors and zero failed local asset requests; views goals/jobs/investments/college/settings/today all rendered`;
  } finally {
    await context.close();
    staged.server.close();
  }
});

await browser.close();
server.close();

const passed = results.filter((r) => r.status === 'PASS').length;
const notRun = results.filter((r) => r.status === 'NOT RUN').length;
const failed = results.filter((r) => r.status === 'FAIL').length;
console.log('');
console.log(`Summary: PASS ${passed}; NOT RUN ${notRun}; FAIL ${failed}`);
emitResults();
if (failed > 0) process.exitCode = 1;
