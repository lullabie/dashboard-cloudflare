// forms-matrix-browser.spec.mjs — Lane A QA, dashboard V16.
// Run: node qa/v4/forms-matrix-browser.spec.mjs [--tree <path>]
//        [--results-out <path>]
// Complete-app local acceptance: the ACTUAL form lifecycle for each
// form kind in the app, driven through the real UI forms only.
//
//   V16-FORM-01  goal form lifecycle
//   V16-FORM-02  habit form lifecycle
//   V16-FORM-03  place form lifecycle
//   V16-FORM-04  job form lifecycle
//   V16-FORM-05  investment form lifecycle
//   V16-FORM-06  college form lifecycle
//   V16-FORM-07  two-tab held-modal baseline conflicts for the modal
//                kinds V15-AUDIT-02 did not cover (goal, habit,
//                place, investment; V15-AUDIT-02 covered job)
//
// Each V16-FORM-01..06 case covers, where the form supports it:
// create, edit, delete (or archive, the removal path the card
// actually offers); rejection by the form's own validation (native
// required-field validation, or the place coordinate range check in
// savePlace); retained draft (the draft survives the rejection in
// the still-open modal); retry (the corrected submit succeeds);
// duplicate click (two synchronous submit clicks while the first
// async IndexedDB save is still in flight must create exactly one
// record — the delayed-commit exercise for this lane: the second
// submit lands before the first save resolves, on the app's real
// CAS / Web Lock path, with no store mock). Sub-behaviors with no UI
// path for a kind are stated in the case detail, not faked.
//
// No direct store writes create records in V16-FORM-01..06. In
// V16-FORM-07 the goal, place and investment records are created
// through the real forms in tab A; the habit record is seeded
// through the app's real import path (stated in the case detail)
// because the case needs a pre-existing titled habit before tab A
// opens its edit modal. Assertions read the store through
// window.__store.getData() only.
//
// No store mocks. The spec serves a static tree from a local
// temporary origin and drives the real app (index.html) in a
// Chromium-family browser (QA_BROWSER). Each case runs in its own
// browser context with a fresh IndexedDB. Invented records only.
// No personal data.

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

const CASE_IDS = ['V16-FORM-01', 'V16-FORM-02', 'V16-FORM-03', 'V16-FORM-04', 'V16-FORM-05', 'V16-FORM-06', 'V16-FORM-07'];

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
      const file = new File([text], 'forms-import.json', { type: 'application/json' });
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

// --- Shared form helpers ----------------------------------------------------

// Collect sub-check failures instead of aborting at the first one, so
// a case reports every broken sub-behavior in one run. The case
// throws at the end if the list is non-empty.
function checker(failures) {
  return (label, cond, evidence = '') => {
    if (!cond) failures.push(evidence ? `${label}: ${evidence}` : label);
  };
}
function finish(failures) {
  if (failures.length > 0) throw new Error(`sub-check failures (${failures.length}): ${failures.join(' ; ')}`);
}

// Accept every dialog (alerts, delete confirms, conflict notices) and
// keep the messages as evidence.
function collectDialogs(page) {
  const messages = [];
  page.on('dialog', (d) => { messages.push(d.message()); d.accept().catch(() => {}); });
  return messages;
}

async function getData(page) {
  return page.evaluate(() => window.__store.getData());
}
async function collection(page, key) {
  const data = await getData(page);
  return data[key] || [];
}
async function collegeCollection(page, type) {
  const data = await getData(page);
  return (data.college && data.college[type]) || [];
}
async function modalOpen(page, modalId) {
  return page.evaluate((id) => !document.getElementById(id).classList.contains('hidden'), modalId);
}
async function waitModal(page, modalId, open, timeout = 8000) {
  await page.waitForFunction(
    ([id, want]) => document.getElementById(id).classList.contains('hidden') === !want,
    [modalId, open], { timeout },
  ).catch(() => {});
}
async function waitCount(page, key, n, timeout = 8000) {
  await page.waitForFunction(
    ([k, want]) => (window.__store?.getData()?.[k] || []).length === want,
    [key, n], { timeout },
  ).catch(() => {});
}
async function waitCollegeCount(page, type, n, timeout = 8000) {
  await page.waitForFunction(
    ([t, want]) => (window.__store?.getData()?.college?.[t] || []).length === want,
    [type, n], { timeout },
  ).catch(() => {});
}
// Two synchronous clicks on the submit button: the second lands while
// the first save is still in flight on the app's real async path.
async function doubleSubmit(page, formId) {
  await page.evaluate((fid) => {
    const btn = document.querySelector(`#${fid} button[type="submit"]`);
    btn.click();
    btn.click();
  }, formId);
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

// --- V16-FORM-01: goal form lifecycle ---------------------------------------
await group('V16-FORM-01', async () => {
  const failures = [];
  const check = checker(failures);
  const errors = [];
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await bootPage(context, origin, errors);
    collectDialogs(page);
    await page.click('.nav-btn[data-view="goals"]');

    // Rejection + retained draft: title is required; notes and
    // target are the draft that must survive the blocked submit.
    await page.click('#btn-create-goal');
    await page.fill('#goal-notes', 'Goal01 draft notes');
    await page.fill('#goal-target', '3');
    await page.check('#goal-show-notes');
    await page.click('#goal-form button[type="submit"]');
    await page.waitForTimeout(600);
    check('rejection keeps the goal modal open', await modalOpen(page, 'goal-modal'));
    check('rejection creates no goal', (await collection(page, 'goals')).length === 0);
    check('draft notes retained after rejection', (await page.inputValue('#goal-notes')) === 'Goal01 draft notes',
      `notes=${await page.inputValue('#goal-notes')}`);
    check('draft target retained after rejection', (await page.inputValue('#goal-target')) === '3',
      `target=${await page.inputValue('#goal-target')}`);

    // Retry: the corrected submit succeeds with the retained draft.
    await page.fill('#goal-title', 'Goal01 Alpha');
    await page.click('#goal-form button[type="submit"]');
    await waitModal(page, 'goal-modal', false);
    await waitCount(page, 'goals', 1);
    let goals = await collection(page, 'goals');
    check('retry creates exactly one goal', goals.length === 1, `count=${goals.length}`);
    if (goals.length >= 1) {
      check('created goal title', goals[0].title === 'Goal01 Alpha', `title=${goals[0].title}`);
      check('created goal notes', goals[0].notes === 'Goal01 draft notes', `notes=${goals[0].notes}`);
      check('created goal target', goals[0].target === 3, `target=${goals[0].target}`);
      check('created goal showNotes', goals[0].showNotes === true, `showNotes=${goals[0].showNotes}`);
    }
    const cardText1 = await page.textContent('#active-goals-container');
    check('created goal rendered', !!cardText1 && cardText1.includes('Goal01 Alpha'));

    // Reload: the created goal is durable.
    await page.reload({ waitUntil: 'load' });
    await grabStore(page);
    await page.click('.nav-btn[data-view="goals"]');
    await waitCount(page, 'goals', 1, 5000);
    goals = await collection(page, 'goals');
    check('goal durable across reload', goals.length === 1 && goals[0].title === 'Goal01 Alpha',
      `after reload: ${JSON.stringify(goals.map((g) => g.title))}`);

    // Edit: the modal populates the current record; the edit saves.
    await page.locator('#active-goals-container .card', { hasText: 'Goal01 Alpha' })
      .locator('button', { hasText: 'Edit' }).click();
    await waitModal(page, 'goal-modal', true, 5000);
    check('edit modal populates the goal title', (await page.inputValue('#goal-title')) === 'Goal01 Alpha',
      `title input=${await page.inputValue('#goal-title')}`);
    await page.fill('#goal-title', 'Goal01 Edited');
    await page.fill('#goal-target', '4');
    await page.click('#goal-form button[type="submit"]');
    await waitModal(page, 'goal-modal', false);
    goals = await collection(page, 'goals');
    check('edit saves the new title', goals.length === 1 && goals[0].title === 'Goal01 Edited',
      `goals=${JSON.stringify(goals.map((g) => g.title))}`);
    check('edit saves the new target', goals.length === 1 && goals[0].target === 4,
      `target=${goals[0]?.target}`);

    // Duplicate click during the in-flight save: exactly one record.
    await page.click('#btn-create-goal');
    await page.fill('#goal-title', 'Goal01 Dup');
    await doubleSubmit(page, 'goal-form');
    await page.waitForTimeout(1500);
    goals = await collection(page, 'goals');
    const dups = goals.filter((g) => g.title === 'Goal01 Dup');
    check('duplicate submit creates exactly one goal', dups.length === 1 && goals.length === 2,
      `dup count=${dups.length}, total=${goals.length}`);

    // Removal path: the goal card offers Archive, not Delete.
    await page.locator('#active-goals-container .card', { hasText: 'Goal01 Edited' })
      .locator('button', { hasText: 'Archive' }).click();
    await page.waitForTimeout(800);
    goals = await collection(page, 'goals');
    const archived = goals.find((g) => g.title === 'Goal01 Edited');
    check('archive marks the goal archived', !!archived && archived.status === 'archived',
      `status=${archived?.status}`);
    const activeText = await page.textContent('#active-goals-container');
    check('archived goal leaves the active list', !!activeText && !activeText.includes('Goal01 Edited'));

    check('no page errors', errors.length === 0, errors.join(' | '));
    finish(failures);
    return 'goal: native rejection kept the modal open with notes/target draft retained and no record; retry created one goal with the retained draft; reload durable; edit populated and saved; duplicate submit during the in-flight save created exactly one record; removal path is Archive (the goal card has no Delete control — delete not supported for this kind)';
  } finally {
    await context.close();
  }
});

// --- V16-FORM-02: habit form lifecycle --------------------------------------
await group('V16-FORM-02', async () => {
  const failures = [];
  const check = checker(failures);
  const errors = [];
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await bootPage(context, origin, errors);
    collectDialogs(page);
    await page.click('.nav-btn[data-view="habits"]');

    // Rejection: the only field (name) is required, so the draft
    // that must survive is the open modal itself; no record is made.
    await page.click('#btn-create-habit');
    await page.click('#habit-form button[type="submit"]');
    await page.waitForTimeout(600);
    check('rejection keeps the habit modal open', await modalOpen(page, 'habit-modal'));
    check('rejection creates no habit', (await collection(page, 'habits')).length === 0);

    // Retry / create.
    await page.fill('#habit-name', 'Habit01 Alpha');
    await page.click('#habit-form button[type="submit"]');
    await waitModal(page, 'habit-modal', false);
    await waitCount(page, 'habits', 1);
    let habits = await collection(page, 'habits');
    check('retry creates exactly one habit', habits.length === 1, `count=${habits.length}`);
    if (habits.length >= 1) {
      check('created habit keeps the entered name', habits[0].title === 'Habit01 Alpha' || habits[0].name === 'Habit01 Alpha',
        `stored record=${JSON.stringify(habits[0])}`);
    }
    const cardText1 = await page.textContent('#active-habits-container');
    check('created habit rendered with its name', !!cardText1 && cardText1.includes('Habit01 Alpha'),
      `card text=${(cardText1 || '').replace(/\s+/g, ' ').slice(0, 160)}`);

    // Reload: the created habit is durable.
    await page.reload({ waitUntil: 'load' });
    await grabStore(page);
    await page.click('.nav-btn[data-view="habits"]');
    await waitCount(page, 'habits', 1, 5000);
    habits = await collection(page, 'habits');
    check('habit durable across reload', habits.length === 1, `count=${habits.length}`);

    // Edit: the modal must populate the current name; the edit saves.
    await page.locator('#active-habits-container .card').first()
      .locator('button', { hasText: 'Edit' }).click();
    await waitModal(page, 'habit-modal', true, 5000);
    const editValue = await page.inputValue('#habit-name');
    check('edit modal populates the current habit name', editValue === 'Habit01 Alpha', `name input=${editValue}`);
    await page.fill('#habit-name', 'Habit01 Edited');
    await page.click('#habit-form button[type="submit"]');
    await waitModal(page, 'habit-modal', false);
    habits = await collection(page, 'habits');
    check('edit saves the new habit name',
      habits.length === 1 && (habits[0].title === 'Habit01 Edited' || habits[0].name === 'Habit01 Edited'),
      `stored record=${JSON.stringify(habits[0])}`);

    // Duplicate click during the in-flight save: exactly one record.
    await page.click('#btn-create-habit');
    await page.fill('#habit-name', 'Habit01 Dup');
    await doubleSubmit(page, 'habit-form');
    await page.waitForTimeout(1500);
    habits = await collection(page, 'habits');
    check('duplicate submit creates exactly one habit', habits.length === 2, `total=${habits.length}`);

    // Removal path: the habit card offers Archive, not Delete.
    await page.locator('#active-habits-container .card').first()
      .locator('button', { hasText: 'Archive' }).click();
    await page.waitForTimeout(800);
    habits = await collection(page, 'habits');
    check('archive marks one habit archived', habits.filter((h) => h.status === 'archived').length === 1,
      `statuses=${JSON.stringify(habits.map((h) => h.status))}`);

    check('no page errors', errors.length === 0, errors.join(' | '));
    finish(failures);
    return 'habit: native rejection kept the modal open with no record; retry created one habit; reload durable; edit populated and saved; duplicate submit during the in-flight save created exactly one record; removal path is Archive (the habit card has no Delete control — delete not supported for this kind)';
  } finally {
    await context.close();
  }
});

// --- V16-FORM-03: place form lifecycle --------------------------------------
await group('V16-FORM-03', async () => {
  const failures = [];
  const check = checker(failures);
  const errors = [];
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await bootPage(context, origin, errors);
    const dialogs = collectDialogs(page);
    await page.click('.nav-btn[data-view="maps"]');

    // Rejection + retained draft: latitude 999 passes the form
    // pattern but fails the savePlace range check; runMutation
    // surfaces the rejection and the modal stays open.
    await page.click('#btn-create-place');
    await page.fill('#place-name', 'Place01 Alpha');
    await page.fill('#place-lat', '999');
    await page.fill('#place-lng', '-79.347');
    await page.click('#place-form button[type="submit"]');
    await page.waitForTimeout(1000);
    check('range rejection is surfaced as an alert', dialogs.some((m) => m.includes('Invalid coordinates')),
      `dialogs=${JSON.stringify(dialogs)}`);
    check('rejection keeps the place modal open', await modalOpen(page, 'place-modal'));
    check('rejection creates no place', (await collection(page, 'places')).length === 0);
    check('draft name retained after rejection', (await page.inputValue('#place-name')) === 'Place01 Alpha',
      `name=${await page.inputValue('#place-name')}`);
    check('draft latitude retained after rejection', (await page.inputValue('#place-lat')) === '999',
      `lat=${await page.inputValue('#place-lat')}`);

    // Retry: the corrected submit succeeds.
    await page.fill('#place-lat', '43.651');
    await page.click('#place-form button[type="submit"]');
    await waitModal(page, 'place-modal', false);
    await waitCount(page, 'places', 1);
    let places = await collection(page, 'places');
    check('retry creates exactly one place', places.length === 1, `count=${places.length}`);
    if (places.length >= 1) {
      check('created place name', places[0].name === 'Place01 Alpha', `name=${places[0].name}`);
      check('created place latitude', places[0].lat === 43.651, `lat=${places[0].lat}`);
      check('created place longitude', places[0].lng === -79.347, `lng=${places[0].lng}`);
    }
    const listText1 = await page.textContent('#places-list');
    check('created place rendered', !!listText1 && listText1.includes('Place01 Alpha'));

    // Reload: the created place is durable.
    await page.reload({ waitUntil: 'load' });
    await grabStore(page);
    await page.click('.nav-btn[data-view="maps"]');
    await waitCount(page, 'places', 1, 5000);
    places = await collection(page, 'places');
    check('place durable across reload', places.length === 1 && places[0].name === 'Place01 Alpha',
      `after reload: ${JSON.stringify(places.map((p) => p.name))}`);

    // Edit.
    await page.locator('#places-list .place-item', { hasText: 'Place01 Alpha' })
      .locator('button[title="Edit"]').click();
    await waitModal(page, 'place-modal', true, 5000);
    check('edit modal populates the place name', (await page.inputValue('#place-name')) === 'Place01 Alpha',
      `name input=${await page.inputValue('#place-name')}`);
    await page.fill('#place-name', 'Place01 Edited');
    await page.fill('#place-lat', '43.700');
    await page.click('#place-form button[type="submit"]');
    await waitModal(page, 'place-modal', false);
    places = await collection(page, 'places');
    check('edit saves the new name', places.length === 1 && places[0].name === 'Place01 Edited',
      `places=${JSON.stringify(places.map((p) => p.name))}`);
    check('edit saves the new latitude', places.length === 1 && places[0].lat === 43.7,
      `lat=${places[0]?.lat}`);

    // Duplicate click during the in-flight save: exactly one record.
    await page.click('#btn-create-place');
    await page.fill('#place-name', 'Place01 Dup');
    await page.fill('#place-lat', '43.100');
    await page.fill('#place-lng', '-79.100');
    await doubleSubmit(page, 'place-form');
    await page.waitForTimeout(1500);
    places = await collection(page, 'places');
    const dups = places.filter((p) => p.name === 'Place01 Dup');
    check('duplicate submit creates exactly one place', dups.length === 1 && places.length === 2,
      `dup count=${dups.length}, total=${places.length}`);

    // Delete (confirm accepted by the dialog collector).
    await page.locator('#places-list .place-item', { hasText: 'Place01 Edited' })
      .locator('button[title="Delete"]').click();
    await page.waitForTimeout(800);
    places = await collection(page, 'places');
    check('delete removes only the intended place',
      places.length === 1 && places[0].name === 'Place01 Dup',
      `remaining=${JSON.stringify(places.map((p) => p.name))}`);

    check('no page errors', errors.length === 0, errors.join(' | '));
    finish(failures);
    return 'place: out-of-range latitude rejected by savePlace with an alert, modal open, name/latitude draft retained, no record; retry created one place; reload durable; edit populated and saved; duplicate submit during the in-flight save created exactly one record; delete removed only the intended place';
  } finally {
    await context.close();
  }
});

// --- V16-FORM-04: job form lifecycle -----------------------------------------
await group('V16-FORM-04', async () => {
  const failures = [];
  const check = checker(failures);
  const errors = [];
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await bootPage(context, origin, errors);
    collectDialogs(page);
    await page.click('.nav-btn[data-view="jobs"]');

    // Rejection + retained draft: company is required; the role is
    // the draft that must survive the blocked submit.
    await page.click('#btn-create-job');
    await page.fill('#job-role', 'Job01 Role');
    await page.selectOption('#job-status', 'applied');
    await page.selectOption('#job-location', 'toronto');
    await page.fill('#job-date', '2026-10-15');
    await page.fill('#job-notes', 'Job01 draft notes');
    await page.click('#job-form button[type="submit"]');
    await page.waitForTimeout(600);
    check('rejection keeps the job modal open', await modalOpen(page, 'job-modal'));
    check('rejection creates no job', (await collection(page, 'jobs')).length === 0);
    check('draft role retained after rejection', (await page.inputValue('#job-role')) === 'Job01 Role',
      `role=${await page.inputValue('#job-role')}`);
    check('draft notes retained after rejection', (await page.inputValue('#job-notes')) === 'Job01 draft notes',
      `notes=${await page.inputValue('#job-notes')}`);

    // Retry / create through the actual form (company/role, no title).
    await page.fill('#job-company', 'Job01 Co');
    await page.click('#job-form button[type="submit"]');
    await waitModal(page, 'job-modal', false);
    await waitCount(page, 'jobs', 1);
    let jobs = await collection(page, 'jobs');
    check('retry creates exactly one job', jobs.length === 1, `count=${jobs.length}`);
    if (jobs.length >= 1) {
      check('created job company', jobs[0].company === 'Job01 Co', `company=${jobs[0].company}`);
      check('created job role', jobs[0].role === 'Job01 Role', `role=${jobs[0].role}`);
      check('created job status', jobs[0].status === 'applied', `status=${jobs[0].status}`);
      check('created job location', jobs[0].location === 'toronto', `location=${jobs[0].location}`);
      check('created job date', jobs[0].date === '2026-10-15', `date=${jobs[0].date}`);
      check('created job notes', jobs[0].notes === 'Job01 draft notes', `notes=${jobs[0].notes}`);
    }
    const cardText1 = await page.textContent('#jobs-container');
    check('created job rendered', !!cardText1 && cardText1.includes('Job01 Co'));

    // Reload: the created job is durable.
    await page.reload({ waitUntil: 'load' });
    await grabStore(page);
    await page.click('.nav-btn[data-view="jobs"]');
    await waitCount(page, 'jobs', 1, 5000);
    jobs = await collection(page, 'jobs');
    check('job durable across reload', jobs.length === 1 && jobs[0].company === 'Job01 Co',
      `after reload: ${JSON.stringify(jobs.map((j) => j.company))}`);

    // Edit.
    await page.locator('#jobs-container .card', { hasText: 'Job01 Co' })
      .locator('button', { hasText: 'Edit' }).click();
    await waitModal(page, 'job-modal', true, 5000);
    check('edit modal populates the company', (await page.inputValue('#job-company')) === 'Job01 Co',
      `company input=${await page.inputValue('#job-company')}`);
    await page.fill('#job-role', 'Job01 Role Edited');
    await page.fill('#job-notes', 'Job01 edited notes');
    await page.click('#job-form button[type="submit"]');
    await waitModal(page, 'job-modal', false);
    jobs = await collection(page, 'jobs');
    check('edit saves the new role', jobs.length === 1 && jobs[0].role === 'Job01 Role Edited',
      `role=${jobs[0]?.role}`);
    check('edit saves the new notes', jobs.length === 1 && jobs[0].notes === 'Job01 edited notes',
      `notes=${jobs[0]?.notes}`);
    check('edit keeps the company', jobs.length === 1 && jobs[0].company === 'Job01 Co',
      `company=${jobs[0]?.company}`);

    // Duplicate click during the in-flight save: exactly one record.
    await page.click('#btn-create-job');
    await page.fill('#job-company', 'Job01 DupCo');
    await page.fill('#job-role', 'Dup Role');
    await doubleSubmit(page, 'job-form');
    await page.waitForTimeout(1500);
    jobs = await collection(page, 'jobs');
    const dups = jobs.filter((j) => j.company === 'Job01 DupCo');
    check('duplicate submit creates exactly one job', dups.length === 1 && jobs.length === 2,
      `dup count=${dups.length}, total=${jobs.length}`);

    // Delete (confirm accepted by the dialog collector).
    await page.locator('#jobs-container .card', { hasText: 'Job01 Co' })
      .locator('button', { hasText: 'Del' }).click();
    await page.waitForTimeout(800);
    jobs = await collection(page, 'jobs');
    check('delete removes only the intended job',
      jobs.length === 1 && jobs[0].company === 'Job01 DupCo',
      `remaining=${JSON.stringify(jobs.map((j) => j.company))}`);

    check('no page errors', errors.length === 0, errors.join(' | '));
    finish(failures);
    return 'job: native rejection kept the modal open with role/notes draft retained and no record; retry created one job with the producer shape (company/role, no title); reload durable; edit populated and saved; duplicate submit during the in-flight save created exactly one record; delete removed only the intended job';
  } finally {
    await context.close();
  }
});

// --- V16-FORM-05: investment form lifecycle --------------------------------
await group('V16-FORM-05', async () => {
  const failures = [];
  const check = checker(failures);
  const errors = [];
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await bootPage(context, origin, errors);
    collectDialogs(page);
    await page.click('.nav-btn[data-view="investments"]');

    // Rejection + retained draft: ticker is required; the prices
    // are the draft that must survive the blocked submit.
    await page.click('#btn-create-investment');
    await page.fill('#investment-entry', '10.50');
    await page.fill('#investment-current', '11.25');
    await page.fill('#investment-notes', 'Inv01 draft notes');
    await page.click('#investment-form button[type="submit"]');
    await page.waitForTimeout(600);
    check('rejection keeps the investment modal open', await modalOpen(page, 'investment-modal'));
    check('rejection creates no investment', (await collection(page, 'investments')).length === 0);
    check('draft entry price retained after rejection', (await page.inputValue('#investment-entry')) === '10.50',
      `entry=${await page.inputValue('#investment-entry')}`);
    check('draft notes retained after rejection', (await page.inputValue('#investment-notes')) === 'Inv01 draft notes',
      `notes=${await page.inputValue('#investment-notes')}`);

    // Retry / create.
    await page.fill('#investment-ticker', 'INV01');
    await page.click('#investment-form button[type="submit"]');
    await waitModal(page, 'investment-modal', false);
    await waitCount(page, 'investments', 1);
    let investments = await collection(page, 'investments');
    check('retry creates exactly one investment', investments.length === 1, `count=${investments.length}`);
    if (investments.length >= 1) {
      check('created investment ticker', investments[0].ticker === 'INV01', `ticker=${investments[0].ticker}`);
      check('created investment entry', investments[0].entry === 10.5, `entry=${investments[0].entry}`);
      check('created investment current', investments[0].current === 11.25, `current=${investments[0].current}`);
      check('created investment notes', investments[0].notes === 'Inv01 draft notes', `notes=${investments[0].notes}`);
    }
    const cardText1 = await page.textContent('#investments-container');
    check('created investment rendered', !!cardText1 && cardText1.includes('INV01'));

    // Reload: the created investment is durable.
    await page.reload({ waitUntil: 'load' });
    await grabStore(page);
    await page.click('.nav-btn[data-view="investments"]');
    await waitCount(page, 'investments', 1, 5000);
    investments = await collection(page, 'investments');
    check('investment durable across reload', investments.length === 1 && investments[0].ticker === 'INV01',
      `after reload: ${JSON.stringify(investments.map((i) => i.ticker))}`);

    // Edit.
    await page.locator('#investments-container .card', { hasText: 'INV01' })
      .locator('button', { hasText: 'Edit' }).click();
    await waitModal(page, 'investment-modal', true, 5000);
    check('edit modal populates the ticker', (await page.inputValue('#investment-ticker')) === 'INV01',
      `ticker input=${await page.inputValue('#investment-ticker')}`);
    await page.fill('#investment-current', '99.50');
    await page.click('#investment-form button[type="submit"]');
    await waitModal(page, 'investment-modal', false);
    investments = await collection(page, 'investments');
    check('edit saves the new current price', investments.length === 1 && investments[0].current === 99.5,
      `current=${investments[0]?.current}`);

    // Duplicate click during the in-flight save: exactly one record.
    await page.click('#btn-create-investment');
    await page.fill('#investment-ticker', 'INV01DUP');
    await page.fill('#investment-entry', '1.00');
    await page.fill('#investment-current', '2.00');
    await doubleSubmit(page, 'investment-form');
    await page.waitForTimeout(1500);
    investments = await collection(page, 'investments');
    const dups = investments.filter((i) => i.ticker === 'INV01DUP');
    check('duplicate submit creates exactly one investment', dups.length === 1 && investments.length === 2,
      `dup count=${dups.length}, total=${investments.length}`);

    // Delete (the investment card deletes without a confirm dialog).
    await page.locator('#investments-container .card', { hasText: 'INV01' }).first()
      .locator('button', { hasText: 'Delete' }).click();
    await page.waitForTimeout(800);
    investments = await collection(page, 'investments');
    check('delete removes the intended investment',
      investments.every((i) => i.ticker !== 'INV01'),
      `remaining=${JSON.stringify(investments.map((i) => i.ticker))}`);

    check('no page errors', errors.length === 0, errors.join(' | '));
    finish(failures);
    return 'investment: native rejection kept the modal open with entry/notes draft retained and no record; retry created one investment with exact numeric values; reload durable; edit populated and saved; duplicate submit during the in-flight save created exactly one record; delete removed the intended investment';
  } finally {
    await context.close();
  }
});

// --- V16-FORM-06: college form lifecycle ------------------------------------
await group('V16-FORM-06', async () => {
  const failures = [];
  const check = checker(failures);
  const errors = [];
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await bootPage(context, origin, errors);
    collectDialogs(page);
    await page.click('.nav-btn[data-view="college"]');

    // Rejection + retained draft: title is required; notes and date
    // are the draft that must survive the blocked submit.
    await page.click('#btn-create-college-item');
    await page.selectOption('#college-item-type', 'assignments');
    await page.fill('#college-item-date', '2026-11-03');
    await page.fill('#college-item-notes', 'College01 draft notes');
    await page.click('#college-form button[type="submit"]');
    await page.waitForTimeout(600);
    check('rejection keeps the college modal open', await modalOpen(page, 'college-modal'));
    check('rejection creates no college item', (await collegeCollection(page, 'assignments')).length === 0);
    check('draft notes retained after rejection', (await page.inputValue('#college-item-notes')) === 'College01 draft notes',
      `notes=${await page.inputValue('#college-item-notes')}`);
    check('draft date retained after rejection', (await page.inputValue('#college-item-date')) === '2026-11-03',
      `date=${await page.inputValue('#college-item-date')}`);

    // Retry / create.
    await page.fill('#college-item-title', 'College01 Alpha');
    await page.click('#college-form button[type="submit"]');
    await waitModal(page, 'college-modal', false);
    await waitCollegeCount(page, 'assignments', 1);
    let items = await collegeCollection(page, 'assignments');
    check('retry creates exactly one college item', items.length === 1, `count=${items.length}`);
    if (items.length >= 1) {
      check('created item title', items[0].title === 'College01 Alpha', `title=${items[0].title}`);
      check('created item date', items[0].date === '2026-11-03', `date=${items[0].date}`);
      check('created item notes', items[0].notes === 'College01 draft notes', `notes=${items[0].notes}`);
    }
    await page.locator('#view-college .tab-btn[data-tab="assignments"]').click();
    const cardText1 = await page.textContent('#college-assignments-container');
    check('created item rendered', !!cardText1 && cardText1.includes('College01 Alpha'));

    // Reload: the created item is durable.
    await page.reload({ waitUntil: 'load' });
    await grabStore(page);
    await page.click('.nav-btn[data-view="college"]');
    await page.locator('#view-college .tab-btn[data-tab="assignments"]').click();
    await waitCollegeCount(page, 'assignments', 1, 5000);
    items = await collegeCollection(page, 'assignments');
    check('college item durable across reload', items.length === 1 && items[0].title === 'College01 Alpha',
      `after reload: ${JSON.stringify(items.map((i) => i.title))}`);

    // Edit: the modal populates the record; the type is locked in
    // edit (the select is disabled by the app).
    await page.locator('#college-assignments-container .card', { hasText: 'College01 Alpha' })
      .locator('.edit-btn').click();
    await waitModal(page, 'college-modal', true, 5000);
    check('edit modal populates the title', (await page.inputValue('#college-item-title')) === 'College01 Alpha',
      `title input=${await page.inputValue('#college-item-title')}`);
    const typeDisabled = await page.evaluate(() => document.getElementById('college-item-type').disabled);
    check('edit locks the item type', typeDisabled === true, `disabled=${typeDisabled}`);
    await page.fill('#college-item-title', 'College01 Edited');
    await page.click('#college-form button[type="submit"]');
    await waitModal(page, 'college-modal', false);
    items = await collegeCollection(page, 'assignments');
    check('edit saves the new title', items.length === 1 && items[0].title === 'College01 Edited',
      `items=${JSON.stringify(items.map((i) => i.title))}`);

    // Duplicate click during the in-flight save: exactly one record.
    await page.click('#btn-create-college-item');
    await page.selectOption('#college-item-type', 'assignments');
    await page.fill('#college-item-title', 'College01 Dup');
    await page.fill('#college-item-date', '2026-11-04');
    await doubleSubmit(page, 'college-form');
    await page.waitForTimeout(1500);
    items = await collegeCollection(page, 'assignments');
    const dups = items.filter((i) => i.title === 'College01 Dup');
    check('duplicate submit creates exactly one college item', dups.length === 1 && items.length === 2,
      `dup count=${dups.length}, total=${items.length}`);

    // Delete (confirm accepted by the dialog collector).
    await page.locator('#view-college .tab-btn[data-tab="assignments"]').click();
    await page.locator('#college-assignments-container .card', { hasText: 'College01 Edited' })
      .locator('.delete-btn').click();
    await page.waitForTimeout(800);
    items = await collegeCollection(page, 'assignments');
    check('delete removes only the intended college item',
      items.length === 1 && items[0].title === 'College01 Dup',
      `remaining=${JSON.stringify(items.map((i) => i.title))}`);

    check('no page errors', errors.length === 0, errors.join(' | '));
    finish(failures);
    return 'college: native rejection kept the modal open with notes/date draft retained and no record; retry created one assignment; reload durable; edit populated and saved with the type locked; duplicate submit during the in-flight save created exactly one record; delete removed only the intended item. The college form has no stale-modal baseline guard (partial-record form, out of the V15 guard scope) — stated, not tested as a guard here';
  } finally {
    await context.close();
  }
});

// --- V16-FORM-07: two-tab held-modal baseline conflicts ----------------------
// Modal kinds not covered by V15-AUDIT-02 (job): goal, habit, place,
// investment. Pattern per kind: tab A creates the record through the
// real form (habit: seeded through the real import path, stated
// below) and holds the edit modal open; tab B edits the same record
// through the real form; A adopts B's record, edits a different field
// as a draft, and submits. The V15 baseline guard must block with an
// explicit conflict, keep A's modal open, keep A's draft, and
// preserve B's record.
await group('V16-FORM-07', async () => {
  const failures = [];
  const check = checker(failures);
  const subResults = [];

  async function subcase(label, fn) {
    const before = failures.length;
    try {
      await fn();
    } catch (error) {
      failures.push(`${label}: ${(error?.message ?? String(error)).split('\n')[0]}`);
    }
    subResults.push(`${label}=${failures.length === before ? 'PASS' : 'FAIL'}`);
  }

  // Goal subcase.
  await subcase('goal', async () => {
    const errorsA = []; const errorsB = [];
    const context = await browser.newContext({ acceptDownloads: true });
    try {
      const pageA = await bootPage(context, origin, errorsA);
      const pageB = await bootPage(context, origin, errorsB);
      const dialogsA = collectDialogs(pageA);
      collectDialogs(pageB);
      await pageA.click('.nav-btn[data-view="goals"]');
      await pageA.click('#btn-create-goal');
      await pageA.fill('#goal-title', 'Goal07 Seed');
      await pageA.fill('#goal-notes', 'seed notes');
      await pageA.fill('#goal-target', '2');
      await pageA.click('#goal-form button[type="submit"]');
      await waitModal(pageA, 'goal-modal', false);
      await pageB.waitForFunction(
        () => (window.__store?.getData()?.goals || []).some((g) => g.title === 'Goal07 Seed'),
        null, { timeout: 8000 },
      );
      await pageA.locator('#active-goals-container .card', { hasText: 'Goal07 Seed' })
        .locator('button', { hasText: 'Edit' }).click();
      await waitModal(pageA, 'goal-modal', true, 5000);
      check('goal: A edit modal populates the seed title',
        (await pageA.inputValue('#goal-title')) === 'Goal07 Seed',
        `title input=${await pageA.inputValue('#goal-title')}`);
      await pageB.click('.nav-btn[data-view="goals"]');
      await pageB.locator('#active-goals-container .card', { hasText: 'Goal07 Seed' })
        .locator('button', { hasText: 'Edit' }).click();
      await waitModal(pageB, 'goal-modal', true, 5000);
      await pageB.fill('#goal-title', 'Goal07 B Title');
      await pageB.click('#goal-form button[type="submit"]');
      await waitModal(pageB, 'goal-modal', false);
      await pageA.waitForFunction(
        () => (window.__store?.getData()?.goals || []).some((g) => g.title === 'Goal07 B Title'),
        null, { timeout: 8000 },
      );
      await pageA.fill('#goal-notes', 'Goal07 A draft notes');
      await pageA.click('#goal-form button[type="submit"]');
      await pageA.waitForTimeout(1200);
      check('goal: explicit conflict dialog', dialogsA.some((m) => m.includes('changed in another tab')),
        `dialogs=${JSON.stringify(dialogsA)}`);
      check('goal: A modal stays open', await modalOpen(pageA, 'goal-modal'));
      check('goal: A draft retained', (await pageA.inputValue('#goal-notes')) === 'Goal07 A draft notes',
        `notes=${await pageA.inputValue('#goal-notes')}`);
      const durable = (await collection(pageA, 'goals'))[0];
      check('goal: B record preserved', !!durable && durable.title === 'Goal07 B Title' && durable.notes === 'seed notes',
        `durable=${JSON.stringify(durable)}`);
      check('goal: no page errors', errorsA.length === 0 && errorsB.length === 0,
        [...errorsA, ...errorsB].join(' | '));
    } finally {
      await context.close();
    }
  });

  // Habit subcase. Seed: the app's real import path (a pre-existing
  // titled habit is required before tab A opens the edit modal).
  await subcase('habit', async () => {
    const errorsA = []; const errorsB = [];
    const context = await browser.newContext({ acceptDownloads: true });
    try {
      const pageA = await bootPage(context, origin, errorsA);
      const pageB = await bootPage(context, origin, errorsB);
      const dialogsA = collectDialogs(pageA);
      collectDialogs(pageB);
      await importInPage(pageA, importPayload({
        habits: [{
          id: 'habit_form07_seed', title: 'Habit07 Seed', schedule: 'daily',
          status: 'active', createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z', history: [], occurrences: {},
        }],
      }));
      const adopted = await pageB.waitForFunction(
        () => (window.__store?.getData()?.habits || []).some((h) => h.id === 'habit_form07_seed'),
        null, { timeout: 8000 },
      ).then(() => true).catch(() => false);
      if (!adopted) {
        await pageB.reload({ waitUntil: 'load' });
        await grabStore(pageB);
      }
      await pageA.click('.nav-btn[data-view="habits"]');
      await pageA.locator('#active-habits-container .card', { hasText: 'Habit07 Seed' })
        .locator('button', { hasText: 'Edit' }).click();
      await waitModal(pageA, 'habit-modal', true, 5000);
      const aOpenValue = await pageA.inputValue('#habit-name');
      check('habit: A edit modal populates the seed name', aOpenValue === 'Habit07 Seed',
        `name input=${aOpenValue}`);
      await pageB.click('.nav-btn[data-view="habits"]');
      await pageB.locator('#active-habits-container .card', { hasText: 'Habit07 Seed' })
        .locator('button', { hasText: 'Edit' }).click();
      await waitModal(pageB, 'habit-modal', true, 5000);
      await pageB.fill('#habit-name', 'Habit07 B Name');
      await pageB.click('#habit-form button[type="submit"]');
      await waitModal(pageB, 'habit-modal', false);
      const bSnapshot = JSON.stringify((await collection(pageB, 'habits'))[0]);
      await pageA.waitForFunction(
        (seedJson) => JSON.stringify(window.__store?.getData()?.habits?.[0]) !== seedJson,
        JSON.stringify({
          id: 'habit_form07_seed', title: 'Habit07 Seed', schedule: 'daily',
          status: 'active', createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z', history: [], occurrences: {},
        }),
        { timeout: 8000 },
      ).catch(() => {});
      await pageA.fill('#habit-name', 'Habit07 A Draft');
      await pageA.click('#habit-form button[type="submit"]');
      await pageA.waitForTimeout(1200);
      check('habit: explicit conflict dialog', dialogsA.some((m) => m.includes('changed in another tab')),
        `dialogs=${JSON.stringify(dialogsA)}`);
      check('habit: A modal stays open', await modalOpen(pageA, 'habit-modal'));
      check('habit: A draft retained', (await pageA.inputValue('#habit-name')) === 'Habit07 A Draft',
        `name=${await pageA.inputValue('#habit-name')}`);
      const durableJson = JSON.stringify((await collection(pageA, 'habits'))[0]);
      check('habit: B record preserved', durableJson === bSnapshot,
        `durable=${durableJson} vs B=${bSnapshot}`);
      check('habit: no page errors', errorsA.length === 0 && errorsB.length === 0,
        [...errorsA, ...errorsB].join(' | '));
    } finally {
      await context.close();
    }
  });

  // Place subcase.
  await subcase('place', async () => {
    const errorsA = []; const errorsB = [];
    const context = await browser.newContext({ acceptDownloads: true });
    try {
      const pageA = await bootPage(context, origin, errorsA);
      const pageB = await bootPage(context, origin, errorsB);
      const dialogsA = collectDialogs(pageA);
      collectDialogs(pageB);
      await pageA.click('.nav-btn[data-view="maps"]');
      await pageA.click('#btn-create-place');
      await pageA.fill('#place-name', 'Place07 Seed');
      await pageA.fill('#place-lat', '43.600');
      await pageA.fill('#place-lng', '-79.300');
      await pageA.click('#place-form button[type="submit"]');
      await waitModal(pageA, 'place-modal', false);
      await pageB.waitForFunction(
        () => (window.__store?.getData()?.places || []).some((p) => p.name === 'Place07 Seed'),
        null, { timeout: 8000 },
      );
      await pageA.locator('#places-list .place-item', { hasText: 'Place07 Seed' })
        .locator('button[title="Edit"]').click();
      await waitModal(pageA, 'place-modal', true, 5000);
      check('place: A edit modal populates the seed name',
        (await pageA.inputValue('#place-name')) === 'Place07 Seed',
        `name input=${await pageA.inputValue('#place-name')}`);
      await pageB.click('.nav-btn[data-view="maps"]');
      await pageB.locator('#places-list .place-item', { hasText: 'Place07 Seed' })
        .locator('button[title="Edit"]').click();
      await waitModal(pageB, 'place-modal', true, 5000);
      await pageB.fill('#place-name', 'Place07 B Name');
      await pageB.click('#place-form button[type="submit"]');
      await waitModal(pageB, 'place-modal', false);
      await pageA.waitForFunction(
        () => (window.__store?.getData()?.places || []).some((p) => p.name === 'Place07 B Name'),
        null, { timeout: 8000 },
      );
      await pageA.fill('#place-name', 'Place07 A Draft');
      await pageA.click('#place-form button[type="submit"]');
      await pageA.waitForTimeout(1200);
      check('place: explicit conflict dialog', dialogsA.some((m) => m.includes('changed in another tab')),
        `dialogs=${JSON.stringify(dialogsA)}`);
      check('place: A modal stays open', await modalOpen(pageA, 'place-modal'));
      check('place: A draft retained', (await pageA.inputValue('#place-name')) === 'Place07 A Draft',
        `name=${await pageA.inputValue('#place-name')}`);
      const durable = (await collection(pageA, 'places'))[0];
      check('place: B record preserved', !!durable && durable.name === 'Place07 B Name' && durable.lat === 43.6,
        `durable=${JSON.stringify(durable)}`);
      check('place: no page errors', errorsA.length === 0 && errorsB.length === 0,
        [...errorsA, ...errorsB].join(' | '));
    } finally {
      await context.close();
    }
  });

  // Investment subcase.
  await subcase('investment', async () => {
    const errorsA = []; const errorsB = [];
    const context = await browser.newContext({ acceptDownloads: true });
    try {
      const pageA = await bootPage(context, origin, errorsA);
      const pageB = await bootPage(context, origin, errorsB);
      const dialogsA = collectDialogs(pageA);
      collectDialogs(pageB);
      await pageA.click('.nav-btn[data-view="investments"]');
      await pageA.click('#btn-create-investment');
      await pageA.fill('#investment-ticker', 'INV07');
      await pageA.fill('#investment-entry', '10.00');
      await pageA.fill('#investment-current', '11.00');
      await pageA.fill('#investment-notes', 'seed notes');
      await pageA.click('#investment-form button[type="submit"]');
      await waitModal(pageA, 'investment-modal', false);
      await pageB.waitForFunction(
        () => (window.__store?.getData()?.investments || []).some((i) => i.ticker === 'INV07'),
        null, { timeout: 8000 },
      );
      await pageA.locator('#investments-container .card', { hasText: 'INV07' })
        .locator('button', { hasText: 'Edit' }).click();
      await waitModal(pageA, 'investment-modal', true, 5000);
      check('investment: A edit modal populates the seed ticker',
        (await pageA.inputValue('#investment-ticker')) === 'INV07',
        `ticker input=${await pageA.inputValue('#investment-ticker')}`);
      await pageB.click('.nav-btn[data-view="investments"]');
      await pageB.locator('#investments-container .card', { hasText: 'INV07' })
        .locator('button', { hasText: 'Edit' }).click();
      await waitModal(pageB, 'investment-modal', true, 5000);
      await pageB.fill('#investment-current', '55.50');
      await pageB.click('#investment-form button[type="submit"]');
      await waitModal(pageB, 'investment-modal', false);
      await pageA.waitForFunction(
        () => (window.__store?.getData()?.investments || []).some((i) => i.current === 55.5),
        null, { timeout: 8000 },
      );
      await pageA.fill('#investment-notes', 'Inv07 A draft notes');
      await pageA.click('#investment-form button[type="submit"]');
      await pageA.waitForTimeout(1200);
      check('investment: explicit conflict dialog', dialogsA.some((m) => m.includes('changed in another tab')),
        `dialogs=${JSON.stringify(dialogsA)}`);
      check('investment: A modal stays open', await modalOpen(pageA, 'investment-modal'));
      check('investment: A draft retained', (await pageA.inputValue('#investment-notes')) === 'Inv07 A draft notes',
        `notes=${await pageA.inputValue('#investment-notes')}`);
      const durable = (await collection(pageA, 'investments'))[0];
      check('investment: B record preserved', !!durable && durable.current === 55.5 && durable.notes === 'seed notes',
        `durable=${JSON.stringify(durable)}`);
      check('investment: no page errors', errorsA.length === 0 && errorsB.length === 0,
        [...errorsA, ...errorsB].join(' | '));
    } finally {
      await context.close();
    }
  });

  finish(failures);
  return `two-tab held-modal baseline conflicts blocked with an explicit conflict, modal open, draft retained, and the other tab's record preserved for every kind not covered by V15-AUDIT-02 (${subResults.join(', ')}); habit seed was created through the app's real import path, all other records through the real forms in tab A; tab B edited through the real forms in every subcase`;
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
