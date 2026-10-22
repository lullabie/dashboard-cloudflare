// time-matrix-browser.spec.mjs — Lane B QA, dashboard V16.
// Run: node qa/v4/time-matrix-browser.spec.mjs [--tree <path>]
//        [--results-out <path>]
// Real-browser time matrix for the pinned America/Toronto calendar
// (Codex V16 lane B). The app pins the zone in code, not in a user
// setting: js/countdowns.js (TIMEZONE constant), js/habits.js and
// js/goals.js derive every day key with
// Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }) from
// new Date(); habit check-ins store { completedAt: <UTC ISO instant> }
// under a YYYY-MM-DD Toronto day key, and lateness compares the
// Toronto day of completedAt against the key (js/habits.js isLate).
// There is no saved-zone feature: the Settings view is data
// management only and no zone control exists in index.html or js/.
//
//   V16-TIME-01  Toronto midnight boundary: a check-in minutes
//     before Toronto midnight lands on day D; minutes after midnight
//     lands on day D+1; habit metrics, the Today progress summary
//     and a reload agree.
//   V16-TIME-02  Spring DST (Toronto spring-forward 2026-03-08):
//     check-ins on the transition day and its neighbours land on
//     the correct local days; no duplicate or skipped day in the
//     rendered 7-day history.
//   V16-TIME-03  Fall DST (Toronto fall-back 2026-11-01, repeated
//     hour): same correctness on the 25-hour day; both 01:30
//     occurrences map to the same Toronto day.
//   V16-TIME-04  Browser in Asia/Kolkata while the app pins
//     Toronto: day assignment follows Toronto, not the browser
//     zone, at an instant where the two zones disagree on the date.
//   V16-TIME-05  Habit lifecycle over time: check-in, archive,
//     restore; a legacy achievement record (occurrences stored as
//     boolean true, imported through the real import path) renders
//     and counts honestly; a late check-in counts as Late and a
//     missing day stays Missed — nothing is fabricated.
//
// Time control mechanism (verified by probe before this spec was
// written, and re-probed inside every case): the context sets
// timezoneId, and page.clock.setSystemTime(<instant>) is called
// BEFORE navigation; Playwright 1.64.1 clock then controls the
// page's Date — the app's own saveHabit createdAt equals the set
// instant — and time keeps advancing in real time afterwards.
// Every positioning step re-reads new Date() and the Toronto day
// inside the page and asserts both before acting.
//
// No store mocks. The spec serves a static tree from a local
// temporary origin and drives the real app (index.html), the real
// habits module (the same calls the habit form and timeline make)
// and the real rendered timeline/archive controls in a
// Chromium-family browser (QA_BROWSER). Isolated browser context
// per case. Invented records only. No personal data.

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

const CASE_IDS = ['V16-TIME-01', 'V16-TIME-02', 'V16-TIME-03', 'V16-TIME-04', 'V16-TIME-05'];

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
      const file = new File([text], 'time-import.json', { type: 'application/json' });
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

// --- Lane B helpers ----------------------------------------------------------

// Independent Node-side Toronto day for an instant (Node ICU), used
// to state expectations without trusting the page under test.
function torontoDayOf(iso) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

// Position the page clock at an absolute instant, then prove inside
// the page that Date and the Toronto day are the expected values
// before any app action is taken. Returns the probe.
async function setTime(page, iso, expectedTorontoDay) {
  await page.clock.setSystemTime(new Date(iso));
  const probe = await page.evaluate(() => {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
    });
    return { iso: new Date().toISOString(), toronto: fmt.format(new Date()) };
  });
  assert.ok(Math.abs(new Date(probe.iso) - new Date(iso)) < 5 * 60 * 1000,
    `page clock at the set instant (set ${iso}, page reads ${probe.iso})`);
  assert.equal(probe.toronto, expectedTorontoDay,
    `page Toronto day at ${iso} is ${expectedTorontoDay} (page reads ${probe.toronto})`);
  return probe;
}

async function openHabits(page) {
  await page.click('.nav-btn[data-view="habits"]');
  await page.waitForFunction(() => {
    const v = document.getElementById('view-habits');
    return v && !v.classList.contains('hidden');
  }, null, { timeout: 8000 });
}

async function waitCard(page, containerSel, title) {
  await page.waitForFunction(({ sel, t }) => {
    const cards = document.querySelectorAll(`${sel} .card`);
    return [...cards].some((c) => c.textContent.includes(t));
  }, { sel: containerSel, t: title }, { timeout: 8000 });
}

function cardLocator(page, containerSel, title) {
  return page.locator(`${containerSel} .card`, { hasText: title }).first();
}

// Read one habit's durable state through the real store snapshot.
async function habitState(page, id) {
  return page.evaluate((hid) => {
    const h = window.__store.getData().habits.find((x) => x.id === hid);
    return h ? JSON.parse(JSON.stringify(h)) : null;
  }, id);
}

// The rendered 7-day timeline of one card: [{ date, title }] in
// render order (oldest first, today last).
async function timelineOf(page, containerSel, title) {
  return page.evaluate(({ sel, t }) => {
    const card = [...document.querySelectorAll(`${sel} .card`)]
      .find((c) => c.textContent.includes(t));
    if (!card) return null;
    return [...card.querySelectorAll('.timeline-day')]
      .map((el) => ({ date: el.dataset.date, title: el.getAttribute('title') }));
  }, { sel: containerSel, t: title });
}

async function cardText(page, containerSel, title) {
  return page.evaluate(({ sel, t }) => {
    const card = [...document.querySelectorAll(`${sel} .card`)]
      .find((c) => c.textContent.includes(t));
    return card ? card.textContent : null;
  }, { sel: containerSel, t: title });
}

function parseMetrics(text) {
  const m = /On-time:\s*(\d+)\s*\|\s*Late:\s*(\d+)\s*\|\s*Eligible:\s*(\S+)/.exec(text ?? '');
  return m ? { done: Number(m[1]), late: Number(m[2]), eligible: m[3] } : null;
}

// Assert a rendered timeline is exactly 7 distinct, consecutive
// calendar days (UTC-noon stepping, DST-free arithmetic) ending on
// the expected Toronto today.
function assertTimelineShape(days, expectedLast, label) {
  assert.ok(Array.isArray(days), `${label}: timeline rendered`);
  assert.equal(days.length, 7, `${label}: 7 timeline days (got ${days?.length})`);
  const dates = days.map((d) => d.date);
  assert.equal(new Set(dates).size, 7, `${label}: no duplicate day in history (${dates.join(',')})`);
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1] + 'T12:00:00Z');
    prev.setUTCDate(prev.getUTCDate() + 1);
    assert.equal(dates[i], prev.toISOString().split('T')[0],
      `${label}: no skipped day in history (${dates.join(',')})`);
  }
  assert.equal(dates[6], expectedLast, `${label}: timeline ends on Toronto today ${expectedLast} (got ${dates[6]})`);
}

// Click the rendered timeline cell for a day key and wait until the
// durable occurrence for that key exists.
async function clickDayAndWait(page, containerSel, title, habitId, dateKey) {
  const card = cardLocator(page, containerSel, title);
  await card.locator(`.timeline-day[data-date="${dateKey}"]`).click();
  await page.waitForFunction(({ hid, key }) => {
    const h = window.__store?.getData().habits.find((x) => x.id === hid);
    return !!h && !!h.occurrences && key in h.occurrences;
  }, { hid: habitId, key: dateKey }, { timeout: 8000 });
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

// --- V16-TIME-01: Toronto midnight boundary --------------------------------
await group('V16-TIME-01', async () => {
  const errors = [];
  const context = await browser.newContext({ timezoneId: 'America/Toronto', acceptDownloads: true });
  try {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
    // Mechanism: clock set BEFORE navigation; create at Toronto noon.
    await page.clock.setSystemTime(new Date('2026-06-15T16:00:00.000Z')); // Jun 15 12:00 EDT
    await page.goto(origin + '/index.html', { waitUntil: 'load' });
    await grabStore(page);
    const habitId = await page.evaluate(async () => {
      const habits = await import('/js/habits.js');
      const h = await habits.saveHabit({ title: 'Midnight Habit', schedule: 'daily' });
      return h.id;
    });
    const created = await habitState(page, habitId);
    assert.equal(torontoDayOf(created.createdAt), '2026-06-15',
      'habit created on Toronto day 2026-06-15 (createdAt follows the page clock)');

    // Minutes BEFORE Toronto midnight: still day D.
    await setTime(page, '2026-06-16T03:55:00.000Z', '2026-06-15'); // Jun 15 23:55 EDT
    await openHabits(page);
    await waitCard(page, '#active-habits-container', 'Midnight Habit');
    let days = await timelineOf(page, '#active-habits-container', 'Midnight Habit');
    assert.equal(days[6].date, '2026-06-15', 'today cell is day D minutes before midnight');
    await clickDayAndWait(page, '#active-habits-container', 'Midnight Habit', habitId, '2026-06-15');
    let state = await habitState(page, habitId);
    assert.deepEqual(Object.keys(state.occurrences).sort(), ['2026-06-15'],
      'pre-midnight check-in lands on day D only');
    assert.equal(torontoDayOf(state.occurrences['2026-06-15'].completedAt), '2026-06-15',
      'pre-midnight completedAt Toronto day is D');

    // Minutes AFTER Toronto midnight: day D+1.
    await setTime(page, '2026-06-16T04:05:00.000Z', '2026-06-16'); // Jun 16 00:05 EDT
    await page.reload({ waitUntil: 'load' });
    await grabStore(page);
    await openHabits(page);
    await waitCard(page, '#active-habits-container', 'Midnight Habit');
    days = await timelineOf(page, '#active-habits-container', 'Midnight Habit');
    assert.equal(days[6].date, '2026-06-16', 'today cell is day D+1 minutes after midnight');
    await clickDayAndWait(page, '#active-habits-container', 'Midnight Habit', habitId, '2026-06-16');
    state = await habitState(page, habitId);
    assert.deepEqual(Object.keys(state.occurrences).sort(), ['2026-06-15', '2026-06-16'],
      'post-midnight check-in lands on day D+1; day D kept');
    assert.equal(torontoDayOf(state.occurrences['2026-06-16'].completedAt), '2026-06-16',
      'post-midnight completedAt Toronto day is D+1');
    const metrics = parseMetrics(await cardText(page, '#active-habits-container', 'Midnight Habit'));
    assert.deepEqual(metrics, { done: 2, late: 0, eligible: '2' },
      `habit summary counts both sides of midnight on-time (got ${JSON.stringify(metrics)})`);

    // The Today progress summary names the Toronto day and counts it.
    await page.click('.nav-btn[data-view="today"]');
    await page.waitForFunction(() => {
      const r = document.getElementById('progress-summary-root');
      return r && r.textContent.includes('Progress Summary for 2026-06-16');
    }, null, { timeout: 8000 });
    const summaryText = await page.evaluate(() => document.getElementById('progress-summary-root').textContent);
    assert.ok(summaryText.includes('Habits Completed:') && summaryText.includes('1 / 1'),
      `progress summary counts the D+1 check-in (got: ${summaryText.replace(/\s+/g, ' ').slice(0, 160)})`);

    // Reload agreement at the same instant.
    await page.reload({ waitUntil: 'load' });
    await grabStore(page);
    state = await habitState(page, habitId);
    assert.deepEqual(Object.keys(state.occurrences).sort(), ['2026-06-15', '2026-06-16'],
      'occurrence keys agree after reload');
    assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
    return 'mechanism page.clock.setSystemTime before navigation (page Date and app createdAt follow it; time advances in real time); context zone America/Toronto; check-in at Jun 15 23:55 EDT landed on 2026-06-15 and at Jun 16 00:05 EDT on 2026-06-16; metrics On-time 2 / Late 0 / Eligible 2, progress summary for 2026-06-16 counts 1/1, reload agrees';
  } finally {
    await context.close();
  }
});

// --- V16-TIME-02: spring DST --------------------------------------------------
await group('V16-TIME-02', async () => {
  const errors = [];
  const context = await browser.newContext({ timezoneId: 'America/Toronto', acceptDownloads: true });
  try {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
    await page.clock.setSystemTime(new Date('2026-03-06T17:00:00.000Z')); // Mar 6 12:00 EST
    await page.goto(origin + '/index.html', { waitUntil: 'load' });
    await grabStore(page);
    const habitId = await page.evaluate(async () => {
      const habits = await import('/js/habits.js');
      const h = await habits.saveHabit({ title: 'Spring Habit', schedule: 'daily' });
      return h.id;
    });

    // Transition-day probes: 01:30 EST exists, 02:30 does not exist,
    // 03:30 EDT follows the jump; all belong to Toronto 2026-03-08.
    await setTime(page, '2026-03-08T06:30:00.000Z', '2026-03-08');
    await setTime(page, '2026-03-08T07:30:00.000Z', '2026-03-08');

    const plan = [
      ['2026-03-06T17:00:00.000Z', '2026-03-06'], // 12:00 EST
      ['2026-03-07T17:00:00.000Z', '2026-03-07'], // 12:00 EST
      ['2026-03-08T16:00:00.000Z', '2026-03-08'], // 12:00 EDT (spring-forward day)
      ['2026-03-09T16:00:00.000Z', '2026-03-09'], // 12:00 EDT
    ];
    for (let i = 0; i < plan.length; i++) {
      const [iso, day] = plan[i];
      await setTime(page, iso, day);
      if (i > 0) { await page.reload({ waitUntil: 'load' }); await grabStore(page); }
      await openHabits(page);
      await waitCard(page, '#active-habits-container', 'Spring Habit');
      await clickDayAndWait(page, '#active-habits-container', 'Spring Habit', habitId, day);
    }
    const state = await habitState(page, habitId);
    const keys = Object.keys(state.occurrences).sort();
    assert.deepEqual(keys, ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09'],
      `one check-in per local day across spring DST (got ${keys.join(',')})`);
    for (const k of keys) {
      assert.equal(torontoDayOf(state.occurrences[k].completedAt), k,
        `check-in for ${k} is on-time (completedAt Toronto day matches its key)`);
    }
    const metrics = parseMetrics(await cardText(page, '#active-habits-container', 'Spring Habit'));
    assert.deepEqual(metrics, { done: 4, late: 0, eligible: '4' },
      `metrics count 4 eligible days with no DST distortion (got ${JSON.stringify(metrics)})`);
    assertTimelineShape(await timelineOf(page, '#active-habits-container', 'Spring Habit'), '2026-03-09', 'spring DST');
    assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
    return 'mechanism page.clock.setSystemTime before navigation, re-probed per day; context zone America/Toronto; 2026-03-08 01:30 EST and 03:30 EDT probes both map to Toronto 2026-03-08; noon check-ins on Mar 6/7/8/9 landed on exactly those keys, all on-time, Eligible 4, 7-day history distinct and consecutive ending 2026-03-09';
  } finally {
    await context.close();
  }
});

// --- V16-TIME-03: fall DST ----------------------------------------------------
await group('V16-TIME-03', async () => {
  const errors = [];
  const context = await browser.newContext({ timezoneId: 'America/Toronto', acceptDownloads: true });
  try {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
    await page.clock.setSystemTime(new Date('2026-10-30T16:00:00.000Z')); // Oct 30 12:00 EDT
    await page.goto(origin + '/index.html', { waitUntil: 'load' });
    await grabStore(page);
    const habitId = await page.evaluate(async () => {
      const habits = await import('/js/habits.js');
      const h = await habits.saveHabit({ title: 'Fall Habit', schedule: 'daily' });
      return h.id;
    });

    // Repeated hour: 01:30 EDT (05:30Z) and 01:30 EST (06:30Z) are
    // two distinct instants on the same Toronto day 2026-11-01.
    await setTime(page, '2026-11-01T05:30:00.000Z', '2026-11-01');
    await setTime(page, '2026-11-01T06:30:00.000Z', '2026-11-01');

    const plan = [
      ['2026-10-30T16:00:00.000Z', '2026-10-30'], // 12:00 EDT
      ['2026-10-31T16:00:00.000Z', '2026-10-31'], // 12:00 EDT
      ['2026-11-01T17:00:00.000Z', '2026-11-01'], // 12:00 EST (fall-back day)
      ['2026-11-02T17:00:00.000Z', '2026-11-02'], // 12:00 EST
    ];
    for (let i = 0; i < plan.length; i++) {
      const [iso, day] = plan[i];
      await setTime(page, iso, day);
      if (i > 0) { await page.reload({ waitUntil: 'load' }); await grabStore(page); }
      await openHabits(page);
      await waitCard(page, '#active-habits-container', 'Fall Habit');
      await clickDayAndWait(page, '#active-habits-container', 'Fall Habit', habitId, day);
    }
    const state = await habitState(page, habitId);
    const keys = Object.keys(state.occurrences).sort();
    assert.deepEqual(keys, ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'],
      `one check-in per local day across fall DST, repeated hour creates no second day (got ${keys.join(',')})`);
    for (const k of keys) {
      assert.equal(torontoDayOf(state.occurrences[k].completedAt), k,
        `check-in for ${k} is on-time (completedAt Toronto day matches its key)`);
    }
    const metrics = parseMetrics(await cardText(page, '#active-habits-container', 'Fall Habit'));
    assert.deepEqual(metrics, { done: 4, late: 0, eligible: '4' },
      `metrics count 4 eligible days on the 25-hour-day span (got ${JSON.stringify(metrics)})`);
    assertTimelineShape(await timelineOf(page, '#active-habits-container', 'Fall Habit'), '2026-11-02', 'fall DST');
    assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
    return 'mechanism page.clock.setSystemTime before navigation, re-probed per day; context zone America/Toronto; repeated-hour probes 01:30 EDT (05:30Z) and 01:30 EST (06:30Z) both map to Toronto 2026-11-01; noon check-ins on Oct 30/31, Nov 1/2 landed on exactly those keys, all on-time, Eligible 4, 7-day history distinct and consecutive ending 2026-11-02';
  } finally {
    await context.close();
  }
});

// --- V16-TIME-04: different browser zone, pinned Toronto ----------------------
await group('V16-TIME-04', async () => {
  const errors = [];
  const context = await browser.newContext({ timezoneId: 'Asia/Kolkata', acceptDownloads: true });
  try {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
    await page.clock.setSystemTime(new Date('2026-06-14T16:00:00.000Z')); // Toronto Jun 14 12:00 EDT; Kolkata Jun 14 21:30
    await page.goto(origin + '/index.html', { waitUntil: 'load' });
    await grabStore(page);
    const habitId = await page.evaluate(async () => {
      const habits = await import('/js/habits.js');
      const h = await habits.saveHabit({ title: 'Zone Habit', schedule: 'daily' });
      return h.id;
    });

    // Instant where the zones disagree on the calendar date:
    // Toronto Jun 15 22:00 EDT, Kolkata Jun 16 07:30 IST.
    await setTime(page, '2026-06-16T02:00:00.000Z', '2026-06-15');
    const zoneProbe = await page.evaluate(() => {
      const local = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(new Date());
      return { local, resolved: Intl.DateTimeFormat().resolvedOptions().timeZone };
    });
    assert.equal(zoneProbe.local, '2026-06-16',
      `browser default zone really is on Jun 16 at this instant (got ${zoneProbe.local}, zone ${zoneProbe.resolved})`);
    assert.ok(/Kolkata|Calcutta/.test(zoneProbe.resolved),
      `context timezoneId applied (resolved zone: ${zoneProbe.resolved})`);

    await page.reload({ waitUntil: 'load' });
    await grabStore(page);
    await openHabits(page);
    await waitCard(page, '#active-habits-container', 'Zone Habit');
    const days = await timelineOf(page, '#active-habits-container', 'Zone Habit');
    assert.equal(days[6].date, '2026-06-15',
      `today cell follows Toronto (2026-06-15), not the browser zone (2026-06-16); got ${days[6].date}`);
    assertTimelineShape(days, '2026-06-15', 'foreign-zone');
    await clickDayAndWait(page, '#active-habits-container', 'Zone Habit', habitId, '2026-06-15');
    const state = await habitState(page, habitId);
    assert.deepEqual(Object.keys(state.occurrences).sort(), ['2026-06-15'],
      'check-in key is the Toronto day under a Kolkata browser');
    assert.equal(torontoDayOf(state.occurrences['2026-06-15'].completedAt), '2026-06-15',
      'completedAt Toronto day matches the key');
    const daysLeft = await page.evaluate(async () => {
      const c = await import('/js/countdowns.js');
      return c.getTorontoMidnight('2026-06-20');
    });
    assert.equal(daysLeft, 5, `countdown days-left computed from Toronto today Jun 15 (got ${daysLeft})`);
    const metrics = parseMetrics(await cardText(page, '#active-habits-container', 'Zone Habit'));
    assert.deepEqual(metrics, { done: 1, late: 0, eligible: '2' },
      `metrics use the Toronto span Jun 14-15 (got ${JSON.stringify(metrics)})`);
    assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
    return 'mechanism page.clock.setSystemTime before navigation plus context timezoneId Asia/Kolkata (resolved Asia/Calcutta; browser default day 2026-06-16 at the probe instant while Toronto day is 2026-06-15); today cell, check-in key, metrics and countdown all follow pinned America/Toronto. Observation, not a failure: the app has no user saved-zone setting (Settings view is data management only; the zone is a code constant), so no saved-zone behaviour exists to test';
  } finally {
    await context.close();
  }
});

// --- V16-TIME-05: lifecycle, legacy record, late and missing honesty ----------
await group('V16-TIME-05', async () => {
  const errors = [];
  const context = await browser.newContext({ timezoneId: 'America/Toronto', acceptDownloads: true });
  const failures = [];
  const check = (ok, label) => { if (!ok) failures.push(label); };
  try {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
    await page.clock.setSystemTime(new Date('2026-06-12T16:00:00.000Z')); // Jun 12 12:00 EDT
    await page.goto(origin + '/index.html', { waitUntil: 'load' });
    await grabStore(page);
    await setTime(page, '2026-06-12T16:00:00.000Z', '2026-06-12');

    // Legacy + late records arrive through the real import path in
    // producer shape (the fields js/habits.js writes), except the
    // legacy habit's occurrences use the older boolean-true shape
    // that isValidCheckIn accepts as "Legacy".
    const payload = importPayload({
      habits: [
        {
          id: 'habit_v16_legacy', title: 'Legacy Habit', schedule: 'daily', status: 'active',
          createdAt: '2026-06-10T16:00:00.000Z', updatedAt: '2026-06-10T16:00:00.000Z',
          history: [{ type: 'CREATE', timestamp: '2026-06-10T16:00:00.000Z' }],
          occurrences: { '2026-06-10': true, '2026-06-11': true },
        },
        {
          id: 'habit_v16_late', title: 'Late Habit', schedule: 'daily', status: 'active',
          createdAt: '2026-06-10T16:00:00.000Z', updatedAt: '2026-06-11T15:00:00.000Z',
          history: [{ type: 'CREATE', timestamp: '2026-06-10T16:00:00.000Z' }],
          occurrences: { '2026-06-10': { completedAt: '2026-06-11T15:00:00.000Z' } },
        },
      ],
    });
    await importInPage(page, payload);
    await openHabits(page);
    await waitCard(page, '#active-habits-container', 'Legacy Habit');
    await waitCard(page, '#active-habits-container', 'Late Habit');

    const legacy = await habitState(page, 'habit_v16_legacy');
    check(legacy.occurrences['2026-06-10'] === true && legacy.occurrences['2026-06-11'] === true
      && Object.keys(legacy.occurrences).length === 2,
      'legacy occurrences retained verbatim (no rewrite, no fabricated day)');
    const legacyMetrics = parseMetrics(await cardText(page, '#active-habits-container', 'Legacy Habit'));
    check(JSON.stringify(legacyMetrics) === JSON.stringify({ done: 2, late: 0, eligible: '3' }),
      `legacy habit counts honestly On-time 2 / Late 0 / Eligible 3 (got ${JSON.stringify(legacyMetrics)})`);
    const legacyDays = await timelineOf(page, '#active-habits-container', 'Legacy Habit');
    const legacyJun10 = legacyDays?.find((d) => d.date === '2026-06-10');
    const legacyJun12 = legacyDays?.find((d) => d.date === '2026-06-12');
    check(!!legacyJun10 && legacyJun10.title.includes('Done'),
      `legacy Jun 10 cell shows Done (got ${legacyJun10?.title})`);
    check(!!legacyJun12 && legacyJun12.title.includes('Missed'),
      `missing Jun 12 stays Missed, not fabricated (got ${legacyJun12?.title})`);

    const lateMetrics = parseMetrics(await cardText(page, '#active-habits-container', 'Late Habit'));
    check(JSON.stringify(lateMetrics) === JSON.stringify({ done: 0, late: 1, eligible: '3' }),
      `late check-in counts as Late 1, not on-time (got ${JSON.stringify(lateMetrics)})`);
    const lateDays = await timelineOf(page, '#active-habits-container', 'Late Habit');
    const lateJun10 = lateDays?.find((d) => d.date === '2026-06-10');
    check(!!lateJun10 && lateJun10.title.includes('Late'),
      `late Jun 10 cell shows Late (got ${lateJun10?.title})`);

    // Lifecycle: create, check in today, archive, restore.
    const lifeId = await page.evaluate(async () => {
      const habits = await import('/js/habits.js');
      const h = await habits.saveHabit({ title: 'Lifecycle Habit', schedule: 'daily' });
      return h.id;
    });
    await page.reload({ waitUntil: 'load' });
    await grabStore(page);
    await openHabits(page);
    await waitCard(page, '#active-habits-container', 'Lifecycle Habit');
    await clickDayAndWait(page, '#active-habits-container', 'Lifecycle Habit', lifeId, '2026-06-12');
    let life = await habitState(page, lifeId);
    check(torontoDayOf(life.occurrences['2026-06-12'].completedAt) === '2026-06-12',
      'lifecycle check-in for today is on-time');

    await cardLocator(page, '#active-habits-container', 'Lifecycle Habit')
      .locator('button.archive-btn').click();
    await page.waitForFunction((hid) => {
      const h = window.__store?.getData().habits.find((x) => x.id === hid);
      return h && h.status === 'archived';
    }, lifeId, { timeout: 8000 });
    life = await habitState(page, lifeId);
    check(life.status === 'archived', 'archive sets status archived in durable data');
    const archivedText = await cardText(page, '#archived-habits-container', 'Lifecycle Habit');
    const activeTextAfterArchive = await cardText(page, '#active-habits-container', 'Lifecycle Habit');
    check(archivedText !== null, 'archived habit card is shown in the archived container');
    check(activeTextAfterArchive === null, 'archived habit card leaves the active container');

    // Restore through the real user path: open the Habits Archive
    // tab first (the archived container stays hidden until then),
    // then click Restore on the card in the archived container.
    // The archived-container click is the only restore path. When
    // the card never reached the archived container, the partition
    // failures recorded above already fail this case and there is
    // no Restore control to click.
    await page.click('#view-habits .tab-btn[data-tab="archived-habits"]');
    if (archivedText !== null) {
      await cardLocator(page, '#archived-habits-container', 'Lifecycle Habit')
        .locator('button.archive-btn').click();
      await page.waitForFunction((hid) => {
        const h = window.__store?.getData().habits.find((x) => x.id === hid);
        return h && h.status === 'active';
      }, lifeId, { timeout: 8000 });
    }
    life = await habitState(page, lifeId);
    check(life.status === 'active', 'restore sets status active in durable data');
    const activeTextAfterRestore = await cardText(page, '#active-habits-container', 'Lifecycle Habit');
    const archivedTextAfterRestore = await cardText(page, '#archived-habits-container', 'Lifecycle Habit');
    check(activeTextAfterRestore !== null, 'restored habit card is back in the active container');
    check(archivedTextAfterRestore === null, 'restored habit card leaves the archived container');

    await page.reload({ waitUntil: 'load' });
    await grabStore(page);
    life = await habitState(page, lifeId);
    check(life.status === 'active' && !!life.occurrences['2026-06-12'],
      'restored state and today check-in survive reload');
    check(errors.length === 0, `no page errors: ${errors.join(' | ')}`);

    if (failures.length > 0) {
      throw new Error(`failed invariants: ${failures.join('; ')}`);
    }
    return 'mechanism page.clock.setSystemTime before navigation (Toronto Jun 12 noon), context zone America/Toronto; legacy boolean-true occurrences imported via the real import path render Done and count On-time 2 / Eligible 3 with Jun 12 honestly Missed and the stored shape verbatim; a completedAt one Toronto day after its key counts Late 1 and renders Late; lifecycle habit checked in on-time, archived and restored through the rendered controls, state and check-in survive reload';
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
