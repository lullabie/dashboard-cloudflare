// audit-regression.spec.mjs — Lane E QA, dashboard V15.
// Run: node qa/v4/audit-regression.spec.mjs [--tree <path>]
//        [--results-out <path>]
// Real-browser regression cases for the Codex V15 deployment-prep
// audit defects (at 433842b), one case per defect family:
//
//   V15-AUDIT-01  Jobs producer/adoption mismatch (audit defect 1):
//     a job created through the ACTUAL Add Job form (company/role, no
//     title field exists) must render, survive reload, and round-trip
//     through export and import into a clean context.
//   V15-AUDIT-02  Stale modal edit (defect 2): tab A opens the job
//     edit modal; tab B saves new notes; A adopts them; A edits only
//     the role and submits. The submit must be blocked with an
//     explicit conflict, the modal must stay open with A's draft
//     intact, and B's notes must survive on disk.
//   V15-AUDIT-03  Imported markup (defect 3): a goal whose target is
//     a markup string is imported; the card must render the value as
//     inert text (no element is created from it) with a finite
//     numeric fallback, and the stored value stays verbatim.
//   V15-AUDIT-04  Malformed habit (defect 4): a habit with an invalid
//     createdAt is imported; the card must render the UNKNOWN
//     eligibility safe state with no page error, value verbatim.
//   V15-AUDIT-05  Chart honesty (defect 7): the indicators view has
//     no never-drawn canvas and no alt text claiming FX trends.
//
// No store mocks. The spec serves a static tree from a local
// temporary origin and drives the real app (index.html) and the real
// form/import paths in a Chromium-family browser (QA_BROWSER).
// Invented records only. No personal data.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
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

const CASE_IDS = ['V15-AUDIT-01', 'V15-AUDIT-02', 'V15-AUDIT-03', 'V15-AUDIT-04', 'V15-AUDIT-05'];

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
  // importData expects the export envelope and asks confirm() before
  // replacing data; accept dialogs for the duration of the import.
  const onDialog = (d) => { d.accept().catch(() => {}); };
  page.on('dialog', onDialog);
  try {
    const res = await page.evaluate(async (text) => {
      const file = new File([text], 'audit-import.json', { type: 'application/json' });
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

// --- V15-AUDIT-01: actual Jobs form lifecycle -------------------------------
await group('V15-AUDIT-01', async () => {
  const errors = [];
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await bootPage(context, origin, errors);
    await page.click('.nav-btn[data-view="jobs"]');
    await page.click('#btn-create-job');
    await page.fill('#job-company', 'Audit Co');
    await page.fill('#job-role', 'Audit Role');
    await page.selectOption('#job-status', 'applied');
    await page.selectOption('#job-location', 'toronto');
    await page.fill('#job-notes', 'created by the real form');
    await page.click('#job-form button[type="submit"]');
    await page.waitForFunction(() => {
      const cards = document.querySelectorAll('#jobs-container .card');
      return [...cards].some((c) => c.textContent.includes('Audit Co'));
    }, null, { timeout: 8000 });
    const before = await page.evaluate(async () => {
      window.__jobs = await import('/js/jobs.js');
      return window.__jobs.getJobs();
    });
    assert.equal(before.length, 1, 'one job after form create');
    assert.equal(before[0].company, 'Audit Co');
    assert.equal(before[0].role, 'Audit Role');
    assert.ok(!('title' in before[0]) || !before[0].title, 'form job carries no title (the audit defect shape)');

    await page.reload({ waitUntil: 'load' });
    await grabStore(page);
    await page.click('.nav-btn[data-view="jobs"]');
    await page.waitForFunction(() => {
      const cards = document.querySelectorAll('#jobs-container .card');
      return [...cards].some((c) => c.textContent.includes('Audit Co'));
    }, null, { timeout: 8000 });
    const after = await page.evaluate(async () => {
      window.__jobs = await import('/js/jobs.js');
      return window.__jobs.getJobs();
    });
    assert.equal(after.length, 1, 'job still present after reload (adoption keeps the producer shape)');
    assert.equal(after[0].company, 'Audit Co');

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 8000 }),
      page.evaluate(() => window.__store.exportData()),
    ]);
    const exportedText = readFileSync(await download.path(), 'utf8');

    const errors2 = [];
    const context2 = await browser.newContext({ acceptDownloads: true });
    try {
      const page2 = await bootPage(context2, origin, errors2);
      await importInPage(page2, JSON.parse(exportedText).data);
      await page2.click('.nav-btn[data-view="jobs"]');
      await page2.waitForFunction(() => {
        const cards = document.querySelectorAll('#jobs-container .card');
        return [...cards].some((c) => c.textContent.includes('Audit Co'));
      }, null, { timeout: 8000 });
      assert.equal(errors2.length, 0, `no page errors in the import context: ${errors2.join(' | ')}`);
    } finally {
      await context2.close();
    }
    assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
    return 'job created through the actual form (company/role, no title) rendered, survived reload, and round-tripped through export and import into a clean context';
  } finally {
    await context.close();
  }
});

// --- V15-AUDIT-02: two-tab stale modal conflict -----------------------------
await group('V15-AUDIT-02', async () => {
  const errorsA = []; const errorsB = [];
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const pageA = await bootPage(context, origin, errorsA);
    const pageB = await bootPage(context, origin, errorsB);
    const jobId = await pageA.evaluate(async () => {
      window.__jobs = await import('/js/jobs.js');
      const res = await window.__jobs.saveJob({
        id: null, company: 'Conflict Co', role: 'Original Role', status: 'applied',
        location: 'toronto', date: '2026-10-01', notes: 'original',
      });
      const jobs = window.__jobs.getJobs();
      return jobs[jobs.length - 1].id;
    });
    await pageB.waitForFunction((id) => {
      return window.__store?.getData().jobs.some((j) => j.id === id);
    }, jobId, { timeout: 8000 });

    await pageA.click('.nav-btn[data-view="jobs"]');
    await pageA.waitForFunction(() => {
      const cards = document.querySelectorAll('#jobs-container .card');
      return [...cards].some((c) => c.textContent.includes('Conflict Co'));
    }, null, { timeout: 8000 });
    await pageA.locator('#jobs-container .card', { hasText: 'Conflict Co' }).locator('button', { hasText: 'Edit' }).click();
    await pageA.waitForFunction(() => !document.getElementById('job-modal').classList.contains('hidden'), null, { timeout: 5000 });
    const notesAtOpen = await pageA.inputValue('#job-notes');
    assert.equal(notesAtOpen, 'original', 'modal opened with the original notes');

    await pageB.evaluate(async (id) => {
      window.__jobs = await import('/js/jobs.js');
      const job = window.__jobs.getJobs().find((j) => j.id === id);
      await window.__jobs.saveJob({ ...job, notes: 'newnote' });
    }, jobId);
    await pageA.waitForFunction((id) => {
      const job = window.__store?.getData().jobs.find((j) => j.id === id);
      return job && job.notes === 'newnote';
    }, jobId, { timeout: 8000 });

    let dialogMessage = null;
    pageA.once('dialog', (d) => { dialogMessage = d.message(); d.dismiss().catch(() => {}); });
    await pageA.fill('#job-role', 'A Edited Role');
    await pageA.click('#job-form button[type="submit"]');
    await pageA.waitForTimeout(1200);

    assert.ok(dialogMessage && dialogMessage.includes('changed in another tab'),
      `explicit conflict dialog shown (got: ${dialogMessage})`);
    const modalStillOpen = await pageA.evaluate(() => !document.getElementById('job-modal').classList.contains('hidden'));
    assert.ok(modalStillOpen, 'modal stays open after the blocked submit');
    const draftRole = await pageA.inputValue('#job-role');
    assert.equal(draftRole, 'A Edited Role', 'draft retained in the form');
    const durable = await pageA.evaluate((id) => window.__store.getData().jobs.find((j) => j.id === id), jobId);
    assert.equal(durable.notes, 'newnote', "B's notes survive A's stale submit");
    assert.equal(durable.role, 'Original Role', "A's stale role edit was not saved");
    return 'stale modal submit blocked with an explicit conflict; modal stayed open with the draft intact; the other tab\'s notes and the original role are durable';
  } finally {
    await context.close();
  }
});

// --- V15-AUDIT-03: imported markup goal renders as literal text -------------
await group('V15-AUDIT-03', async () => {
  const errors = [];
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await bootPage(context, origin, errors);
    const payload = importPayload({
      goals: [{
        id: 'goal_audit_markup', title: 'Markup Goal', notes: '', showNotes: false,
        target: '<b id="audit-markup-marker">Invented markup</b>',
        status: 'active', history: [], occurrences: {}, checkIns: [],
        createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
      }],
    });
    await importInPage(page, payload);
    const stored = await page.evaluate(() => window.__store.getData().goals[0]);
    assert.equal(stored.target, '<b id="audit-markup-marker">Invented markup</b>',
      'malformed target retained verbatim in the data (recoverable, per contract)');
    await page.click('.nav-btn[data-view="goals"]');
    await page.waitForFunction(() => {
      const cards = document.querySelectorAll('#active-goals-container .card');
      return [...cards].some((c) => c.textContent.includes('Markup Goal'));
    }, null, { timeout: 8000 });
    const probe = await page.evaluate(() => {
      const marker = document.querySelector('#audit-markup-marker');
      const card = [...document.querySelectorAll('#active-goals-container .card')]
        .find((c) => c.textContent.includes('Markup Goal'));
      return { markerExists: !!marker, cardHtml: card ? card.innerHTML : '', cardText: card ? card.textContent : '' };
    });
    assert.equal(probe.markerExists, false, 'no element was created from the imported markup string');
    assert.ok(!probe.cardHtml.includes('<b id="audit-markup-marker">'), 'card HTML carries no raw markup target');
    assert.ok(probe.cardText.includes('0 / 1 done'), `finite fallback target rendered (card text: ${probe.cardText.slice(0, 120)})`);
    assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
    return 'imported markup target created no DOM element, rendered with the finite fallback (0 / 1 done), and stayed verbatim in the data';
  } finally {
    await context.close();
  }
});

// --- V15-AUDIT-04: malformed habit safe state -------------------------------
await group('V15-AUDIT-04', async () => {
  const errors = [];
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await bootPage(context, origin, errors);
    const payload = importPayload({
      habits: [{
        id: 'habit_audit_bad_date', title: 'Bad Date Habit', schedule: 'daily',
        status: 'active', createdAt: 'invalid', updatedAt: '2026-10-01T00:00:00.000Z',
        history: [], occurrences: {},
      }],
    });
    await importInPage(page, payload);
    const stored = await page.evaluate(() => window.__store.getData().habits[0]);
    assert.equal(stored.createdAt, 'invalid', 'invalid createdAt retained verbatim');
    await page.click('.nav-btn[data-view="habits"]');
    await page.waitForFunction(() => {
      const cards = document.querySelectorAll('#active-habits-container .card');
      return [...cards].some((c) => c.textContent.includes('Bad Date Habit'));
    }, null, { timeout: 8000 });
    const cardText = await page.evaluate(() => {
      const card = [...document.querySelectorAll('#active-habits-container .card')]
        .find((c) => c.textContent.includes('Bad Date Habit'));
      return card ? card.textContent : '';
    });
    assert.ok(cardText.includes('Eligible: UNKNOWN'), `UNKNOWN eligibility safe state rendered (card: ${cardText.slice(0, 120)})`);
    assert.equal(errors.length, 0, `no page errors (the pre-fix RangeError): ${errors.join(' | ')}`);
    return 'habit with invalid createdAt rendered the UNKNOWN eligibility safe state with no page error; value retained verbatim';
  } finally {
    await context.close();
  }
});

// --- V15-AUDIT-05: chart honesty --------------------------------------------
await group('V15-AUDIT-05', async () => {
  const errors = [];
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await bootPage(context, origin, errors);
    const probe = await page.evaluate(() => ({
      canvas: !!document.getElementById('indicators-chart'),
      alt: !!document.getElementById('indicators-chart-alt'),
      container: !!document.getElementById('indicators-container'),
      pageText: document.body.textContent.includes('Line chart showing FX trends'),
    }));
    assert.equal(probe.canvas, false, 'no never-drawn indicators canvas');
    assert.equal(probe.alt, false, 'no indicators chart alt element');
    assert.equal(probe.pageText, false, 'no FX-trend claim in the page text');
    assert.equal(probe.container, true, 'indicators cards container retained');
    return 'indicators view carries no blank canvas and no FX-trend claim; the cards container is retained';
  } finally {
    await context.close();
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
