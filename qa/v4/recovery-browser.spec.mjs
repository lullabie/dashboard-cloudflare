// recovery-browser.spec.mjs — Lane D independent QA, dashboard V10.
// Run: node qa/v4/recovery-browser.spec.mjs [--tree <path>]
//        [--results-out <path>]
// Real-browser regression cases for native IndexedDB adoption of a
// malformed stored record: V10-RECOVERY-01 (poisoned load, cross-tab
// adoption, quarantine retention) and V11-RECOVERY-02 (export consistency:
// an export taken after adoption, before any save or re-init, must carry
// the partitioned data with its quarantine, and must import cleanly).
// V12 extends V11-RECOVERY-02 phase 1 with malformed-object jobs: entries
// that are objects but fail the strict import contract for jobs (one
// no identifying field, one missing id). Adoption must partition those entries
// to quarantine with their original objects, exactly like null entries,
// so the exported backup stays round-trippable.
// No store mocks. The spec serves a
// static tree from a local temporary origin, opens a Chromium-family
// browser (Chrome/Brave/Chromium via QA_BROWSER) with an isolated context,
// seeds a RAW IndexedDB record whose data carries null collection entries,
// and loads the real app (index.html) against it.
//
// The case proves three things on the fixed tree: (1) the poisoned load
// renders the valid neighbours with zero pageerrors; (2) a second page
// (storage spec two-page pattern, same context/profile) adopts a later
// cross-tab save without a pageerror and keeps its valid data; (3) the
// malformed entries survive an unrelated save, export and reload as
// explicit quarantine metadata in the export envelope — they are neither
// silently deleted nor resurrected into the exported UI data.
//
// Tree under test: QA_TREE_ROOT, else --tree, else DASH_TREE, else the
// checkout that contains this spec (qa/v4/ -> repo root, two levels up).
// The header prints the tree path and the actual js/store.js and js/feeds.js
// SHA-256 read from that tree. No source hash is pinned. No source is
// substituted. Results are written through the shared Lane E writer
// (scripts/write-browser-results.mjs), never by hand.
//
// Invented records only. No personal data.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

const CASE_IDS = ['V10-RECOVERY-01', 'V11-RECOVERY-02'];

const VALID_GOAL_ID = 'goal_qa_v10_valid';
const VALID_GOAL_TITLE = 'Invented Valid Goal';
const VALID_JOB_COMPANY = 'Invented Valid Co';
const UNRELATED_PLACE_ID = 'place_qa_v10_unrelated';

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

// --- Static server (storage spec pattern; '/' serves index.html) -------------

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
    if (urlPath === '/__qa_blank.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><html><head><title>qa-blank</title></head><body>qa</body></html>');
      return;
    }
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

// --- Page-side helpers ---------------------------------------------------------

// Seeds a RAW durable record directly in the native IndexedDB, in the exact
// envelope shape js/store.js writes (id, storageFormatVersion, generation,
// revision, savedAt, data, envelopeExtras). The data is poisoned: goals
// carries a null entry ahead of one valid goal; jobs carries a null entry
// behind one valid job. Every other collection is present and empty.
const seedPoisonedRecordInPage = async () => {
  const data = {
    goals: [
      null,
      { id: 'goal_qa_v10_valid', title: 'Invented Valid Goal', status: 'active', history: [] },
    ],
    places: [],
    jobs: [
      { id: 'job_qa_v10_valid', title: 'Invented Valid Role', company: 'Invented Valid Co', status: 'applied', location: 'toronto' },
      null,
    ],
    investments: [],
    habits: [],
    indicators: [],
    metadata: {},
    college: { timetable: [], assignments: [], exams: [], fees: [] },
    news: { sources: [], cache: [], manual: [] },
  };
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('dashboard_store', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('store_records')) {
        req.result.createObjectStore('store_records', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('store_records', 'readwrite');
      tx.objectStore('store_records').put({
        id: 1,
        storageFormatVersion: 1,
        generation: 'qa-v10-generation',
        revision: 1,
        savedAt: new Date().toISOString(),
        data,
        envelopeExtras: {},
      });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    req.onerror = () => reject(req.error);
  });
};

// Polls until the valid goal renders or a pageerror lands, then settles
// briefly so a late boot error is still captured before assertions run.
async function waitForBoot(page, pageErrors) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (pageErrors.length > 0) break;
    const rendered = await page
      .evaluate((title) => document.body?.innerText?.includes(title) ?? false, VALID_GOAL_TITLE)
      .catch(() => false);
    if (rendered) break;
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(600);
}

async function grabStore(page) {
  await page.evaluate(async () => {
    window.__store = await import('/js/store.js');
  });
}

// Runs the real store exportData() in the page and returns the parsed
// backup JSON from the resulting download.
async function exportAndRead(page) {
  await grabStore(page);
  const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
  await page.evaluate(async () => { await window.__store.exportData(); });
  const download = await downloadPromise;
  assert.ok(download, 'exportData produced no download');
  const target = path.join(
    os.tmpdir(),
    `v10-recovery-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
  await download.saveAs(target);
  return JSON.parse(readFileSync(target, 'utf8'));
}

// Runs the real store exportData() in the page and returns the download
// as raw text plus parsed JSON. The import step needs the exact text.
// The capture pattern is the same as exportAndRead.
async function exportCapture(page) {
  await grabStore(page);
  const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
  await page.evaluate(async () => { await window.__store.exportData(); });
  const download = await downloadPromise;
  assert.ok(download, 'exportData produced no download');
  const target = path.join(
    os.tmpdir(),
    `v11-recovery-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
  await download.saveAs(target);
  const text = readFileSync(target, 'utf8');
  return { text, parsed: JSON.parse(text) };
}

// Reads the RAW durable record from the native IndexedDB. Page-side use.
const rawReadRecordInPage = async () => {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('dashboard_store', 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('store_records', 'readonly');
      const getReq = tx.objectStore('store_records').get(1);
      getReq.onsuccess = () => { const rec = getReq.result ?? null; db.close(); resolve(rec); };
      getReq.onerror = () => { db.close(); reject(getReq.error); };
    };
    req.onerror = () => reject(req.error);
  });
};

// Writes one RAW durable record to the native IndexedDB. Page-side use.
// The caller builds the full replacement record in Node from a raw read.
const rawWriteRecordInPage = async (replacement) => {
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('dashboard_store', 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('store_records', 'readwrite');
      tx.objectStore('store_records').put(replacement);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    req.onerror = () => reject(req.error);
  });
};

// Finds quarantine-shaped entries anywhere in the export envelope: objects
// with a string path and an integer index (the recovery metadata contract
// { path, index, value, reason }).
function findQuarantineEntries(node, out = []) {
  if (Array.isArray(node)) {
    if (
      node.length > 0 &&
      node.every((e) => e && typeof e === 'object' && typeof e.path === 'string' && Number.isInteger(e.index))
    ) {
      out.push(...node);
    }
    for (const item of node) findQuarantineEntries(item, out);
  } else if (node && typeof node === 'object') {
    for (const value of Object.values(node)) findQuarantineEntries(value, out);
  }
  return out;
}

function pathHeads(entry, name) {
  return entry.path.split(/[^A-Za-z]+/).includes(name);
}

function checkExport(parsed, label) {
  assert.equal(parsed.app, 'dashboard', `${label}: export is not a dashboard backup`);
  const { goals, jobs, places } = parsed.data ?? {};
  assert.ok(Array.isArray(goals), `${label}: exported data.goals is not an array`);
  assert.ok(!goals.includes(null), `${label}: the null goal was resurrected into the exported data`);
  assert.equal(goals.length, 1, `${label}: exported data.goals lost the valid goal (${goals.length} entries)`);
  assert.equal(goals[0]?.id, VALID_GOAL_ID, `${label}: exported valid goal changed`);
  assert.ok(Array.isArray(jobs), `${label}: exported data.jobs is not an array`);
  assert.ok(!jobs.includes(null), `${label}: the null job was resurrected into the exported data`);
  assert.equal(jobs.length, 1, `${label}: exported data.jobs lost the valid job (${jobs.length} entries)`);
  assert.ok(
    Array.isArray(places) && places.some((p) => p?.id === UNRELATED_PLACE_ID),
    `${label}: the unrelated save is missing from the export`,
  );
  const quarantine = findQuarantineEntries(parsed);
  const goalEntry = quarantine.find((e) => pathHeads(e, 'goals') && e.index === 0);
  const jobEntry = quarantine.find((e) => pathHeads(e, 'jobs') && e.index === 1);
  assert.ok(
    goalEntry,
    `${label}: no quarantine entry preserves goals[0]; quarantine-shaped entries found: ${JSON.stringify(quarantine)}`,
  );
  assert.ok(
    'value' in goalEntry && goalEntry.value === null,
    `${label}: the goals quarantine entry does not preserve the original malformed value`,
  );
  assert.ok(
    jobEntry && 'value' in jobEntry && jobEntry.value === null,
    `${label}: no quarantine entry preserves jobs[1] with its original malformed value`,
  );
}

// --- V11-RECOVERY-02 helpers ---------------------------------------------------

// Asserts that no exported collection carries a malformed entry. An entry
// is malformed when it is null, a primitive, or an array.
function assertExportCollectionsClean(data, label) {
  const groups = [];
  for (const k of ['goals', 'places', 'jobs', 'investments', 'habits', 'indicators']) {
    groups.push([k, data?.[k]]);
  }
  for (const k of ['timetable', 'assignments', 'exams', 'fees']) {
    groups.push([`college.${k}`, data?.college?.[k]]);
  }
  for (const k of ['sources', 'cache', 'manual']) {
    groups.push([`news.${k}`, data?.news?.[k]]);
  }
  for (const [name, arr] of groups) {
    assert.ok(Array.isArray(arr), `${label}: exported data.${name} is not an array`);
    for (let i = 0; i < arr.length; i++) {
      assert.ok(
        arr[i] && typeof arr[i] === 'object' && !Array.isArray(arr[i]),
        `${label}: exported data.${name}[${i}] is malformed (${JSON.stringify(arr[i])})`,
      );
    }
  }
}

// Asserts that the export quarantine is exactly the expected entry set.
// Each expected entry has the shape { path, index, value }.
function assertQuarantineExact(parsed, expected, label) {
  const found = findQuarantineEntries(parsed);
  assert.equal(
    found.length, expected.length,
    `${label}: expected exactly ${expected.length} quarantine entries, found ${JSON.stringify(found)}`,
  );
  for (const exp of expected) {
    const entry = found.find((e) => e.path === exp.path && e.index === exp.index);
    assert.ok(entry, `${label}: quarantine entry ${exp.path}[${exp.index}] is missing; found ${JSON.stringify(found)}`);
    assert.deepEqual(
      { path: entry.path, index: entry.index, value: entry.value }, exp,
      `${label}: quarantine entry ${exp.path}[${exp.index}] differs`,
    );
  }
}

const P1_GOAL = { id: 'goal_qa_v11_p1', title: 'Invented Phase One Goal', status: 'active', history: [] };
const P1_JOB_1 = { id: 'job_qa_v11_p1_one', title: 'Invented Phase One Job One', company: 'Invented Co One', status: 'applied', location: 'toronto' };
const P1_JOB_2 = { id: 'job_qa_v11_p1_two', title: 'Invented Phase One Job Two', company: 'Invented Co Two', status: 'applied', location: 'toronto' };
// V12 malformed-object jobs, updated to the V15 contract. Each entry
// is a non-null, non-array object, so the V10/V11 shape-only partition
// kept it. Each entry fails the strict import contract for jobs: the
// first has an id but no identifying field (no company, role, or
// title — the pre-V15 fixture carried a company, which the V15
// contract makes a valid producer-shaped entry); the second has no id.
const P1_JOB_NO_IDENTITY = { id: 'job_qa_v15_no_identity', status: 'applied', location: 'toronto' };
const P1_JOB_NO_ID = { title: 'Invented Phase One Job No Id', company: 'Invented Co No Id', status: 'applied', location: 'toronto' };
const P1_UNRELATED_PLACE_ID = 'place_qa_v12_unrelated';
// Phase 1 poisoned jobs, by original index: 0 valid neighbour one,
// 1 null, 2 object with no identifying field, 3 object missing id, 4 valid
// neighbour two. The expected quarantine is the full set, in order.
const P1_EXPECTED_QUARANTINE = [
  { path: 'jobs', index: 1, value: null },
  { path: 'jobs', index: 2, value: P1_JOB_NO_IDENTITY },
  { path: 'jobs', index: 3, value: P1_JOB_NO_ID },
];
const P2_GOAL_D1 = { id: 'goal_qa_v11_p2_d1', title: 'Invented Phase Two Goal D1', status: 'active', history: [] };
const P2_JOB_D1 = { id: 'job_qa_v11_p2_d1', title: 'Invented Phase Two Job D1', company: 'Invented Co D1', status: 'applied', location: 'toronto' };
const P2_GOAL_D2 = { id: 'goal_qa_v11_p2_d2', title: 'Invented Phase Two Goal D2', status: 'active', history: [] };
const P2_JOB_D2_1 = { id: 'job_qa_v11_p2_d2_one', title: 'Invented Phase Two Job D2 One', company: 'Invented Co D2', status: 'applied', location: 'toronto' };
const P2_JOB_D2_2 = { id: 'job_qa_v11_p2_d2_two', title: 'Invented Phase Two Job D2 Two', company: 'Invented Co D2', status: 'applied', location: 'toronto' };

// --- Driver --------------------------------------------------------------------

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

// V10-RECOVERY-01 — native-IDB poisoned load, cross-tab adoption, and
// quarantine retention across an unrelated save, export and reload.
await group('V10-RECOVERY-01', async () => {
  const context = await browser.newContext({ acceptDownloads: true });
  const errorsA = [];
  const errorsB = [];
  try {
    // Step 1: poisoned load through the real app entry point.
    const pageA = await context.newPage();
    pageA.on('pageerror', (error) => errorsA.push(error.message));
    await pageA.goto(`${origin}/__qa_blank.html`);
    await pageA.evaluate(seedPoisonedRecordInPage);
    await pageA.goto(`${origin}/index.html`, { waitUntil: 'load' });
    await waitForBoot(pageA, errorsA);
    assert.equal(
      errorsA.length, 0,
      `poisoned load produced pageerror(s): ${errorsA.join(' ; ')}`,
    );
    const domA = await pageA.evaluate(() => document.body.innerText);
    assert.ok(domA.includes(VALID_GOAL_TITLE), 'the valid goal did not render after the poisoned load');
    // Job cards render only in the Jobs view, which is hidden at boot, and
    // innerText excludes hidden views. Activate the Jobs view through the
    // app's own navigation (jobs spec pattern) before asserting on the card.
    await pageA.click('.nav-btn[data-view="jobs"]');
    await pageA.waitForFunction(
      () => !document.getElementById('view-jobs')?.classList.contains('hidden'),
      null,
      { timeout: 5000 },
    );
    const jobsDomA = await pageA.evaluate(() => document.body.innerText);
    assert.ok(jobsDomA.includes(VALID_JOB_COMPANY), 'the valid job neighbour did not render after the poisoned load');

    await grabStore(pageA);
    const snapshotA = await pageA.evaluate(async () => {
      const d = window.__store.getData();
      return { goals: d.goals, jobs: d.jobs };
    });
    assert.ok(
      snapshotA.goals.every((g) => g && typeof g === 'object'),
      'a null goal is still exposed in the UI snapshot after adoption',
    );
    assert.equal(snapshotA.goals.length, 1, 'the valid goal was lost during adoption');
    assert.equal(snapshotA.goals[0]?.id, VALID_GOAL_ID, 'the adopted valid goal changed');
    assert.ok(
      snapshotA.jobs.every((j) => j && typeof j === 'object'),
      'a null job is still exposed in the UI snapshot after adoption',
    );
    assert.equal(snapshotA.jobs.length, 1, 'the valid job was lost during adoption');

    // Step 2: cross-tab adoption. Second page, same context/profile — the
    // storage spec two-page pattern. Page B loads the same poisoned record,
    // then page A commits an unrelated save and page B must adopt it
    // through the native BroadcastChannel sync without a pageerror.
    const pageB = await context.newPage();
    pageB.on('pageerror', (error) => errorsB.push(error.message));
    await pageB.goto(`${origin}/index.html`, { waitUntil: 'load' });
    await waitForBoot(pageB, errorsB);
    assert.equal(
      errorsB.length, 0,
      `second-page poisoned load produced pageerror(s): ${errorsB.join(' ; ')}`,
    );
    await grabStore(pageB);

    const saved = await pageA.evaluate(async (placeId) => {
      const store = window.__store;
      const snapshot = store.getData();
      snapshot.places.push({ id: placeId, name: 'Invented Unrelated Place', lat: 43.65, lng: -79.38 });
      return store.saveData(snapshot);
    }, UNRELATED_PLACE_ID);
    assert.deepEqual(saved, { committed: true, conflict: false }, 'the unrelated save did not commit cleanly');

    await pageB.waitForFunction(
      (placeId) => window.__store.getData().places.some((p) => p.id === placeId),
      UNRELATED_PLACE_ID,
      { timeout: 8000 },
    );
    assert.equal(
      errorsB.length, 0,
      `cross-tab adoption produced pageerror(s) on page B: ${errorsB.join(' ; ')}`,
    );
    const adoptedB = await pageB.evaluate(async () => {
      const d = window.__store.getData();
      return { goals: d.goals, jobs: d.jobs };
    });
    assert.equal(adoptedB.goals.length, 1, 'page B lost the valid goal during cross-tab adoption');
    assert.equal(adoptedB.goals[0]?.id, VALID_GOAL_ID, 'page B valid goal changed during adoption');
    assert.ok(
      adoptedB.goals.every((g) => g && typeof g === 'object') &&
        adoptedB.jobs.every((j) => j && typeof j === 'object'),
      'page B exposes a null entry after cross-tab adoption',
    );

    // Step 3: retention. Export on page A: the malformed entries must be
    // present as quarantine metadata and absent from the exported data.
    // Reload and export again: quarantine must still be there.
    const export1 = await exportAndRead(pageA);
    checkExport(export1, 'first export');

    await pageA.reload({ waitUntil: 'load' });
    await waitForBoot(pageA, errorsA);
    assert.equal(
      errorsA.length, 0,
      `reload after the unrelated save produced pageerror(s): ${errorsA.join(' ; ')}`,
    );
    const domAfter = await pageA.evaluate(() => document.body.innerText);
    assert.ok(domAfter.includes(VALID_GOAL_TITLE), 'the valid goal did not render after reload');

    const export2 = await exportAndRead(pageA);
    checkExport(export2, 'second export after reload');

    return 'poisoned native-IDB record (goals[0]=null, jobs[1]=null) loaded with zero pageerrors; valid goal and job rendered; second page adopted the unrelated cross-tab save cleanly with valid data intact; both exports keep the malformed entries only as quarantine metadata (path/index/value) and the clean data plus the unrelated save intact, before and after reload';
  } finally {
    await context.close();
  }
});

// V11-RECOVERY-02 — export consistency after a BroadcastChannel adoption.
// Phase 1: the disk record is poisoned after a clean boot. Page A adopts
// the record through the sync channel. An export taken before any save and
// before any re-init must carry the partitioned data with the matching
// quarantine. That exact export must import into a clean context. V12
// adds malformed-object jobs to the phase 1 poison (no identifying field,
// missing id), an unrelated save in the import context, and a re-import
// of the second export.
// Phase 2: the disk record is newer than the page cache and no sync
// notification is sent. The export must carry the newer disk data,
// partitioned, not the stale cache.
// Adoption-partition, export and import defects are collected, not thrown
// at first sight. The case still attempts the import and phase 2 after
// an adoption or export defect. The case then fails once with every
// defect named. Download and setup defects throw at once: those are
// mechanics, not the product defect.
await group('V11-RECOVERY-02', async () => {
  const defects = [];
  // Defect text goes on one line. The results writer keeps the first
  // lines of a failure only, and a multi-line diff would hide later phases.
  const collect = (error) => defects.push(String(error.message).replace(/\s+/g, ' ').trim());
  const contexts = [];
  try {
    // --- Phase 1, step 1: clean boot. ---
    const context1 = await browser.newContext({ acceptDownloads: true });
    contexts.push(context1);
    const errors1 = [];
    const page1 = await context1.newPage();
    page1.on('pageerror', (error) => errors1.push(error.message));
    await page1.goto(`${origin}/index.html`, { waitUntil: 'load' });
    await grabStore(page1);
    await page1.evaluate(async () => { await window.__store.initStore(); });
    assert.equal(errors1.length, 0, `phase 1 clean boot produced pageerror(s): ${errors1.join(' ; ')}`);

    // --- Phase 1, step 2: seed valid data through the app. ---
    const seeded = await page1.evaluate(async ({ goal, job1, job2 }) => {
      const store = window.__store;
      const snapshot = store.getData();
      snapshot.goals = [goal];
      snapshot.jobs = [job1, job2];
      return store.saveData(snapshot);
    }, { goal: P1_GOAL, job1: P1_JOB_1, job2: P1_JOB_2 });
    assert.deepEqual(seeded, { committed: true, conflict: false }, 'phase 1 seed save did not commit');

    // --- Phase 1, step 3: poison the disk record, then notify page A. ---
    // A foreign writer puts three malformed entries between the two
    // valid jobs and increments the revision: a null entry at index 1,
    // an object with no identifying field at index 2, and an object missing id at
    // index 3. No other collection changes.
    const diskBefore = await page1.evaluate(rawReadRecordInPage);
    assert.ok(diskBefore, 'phase 1: no durable record exists after the seed save');
    const poisoned = JSON.parse(JSON.stringify(diskBefore));
    poisoned.data.jobs = [poisoned.data.jobs[0], null, P1_JOB_NO_IDENTITY, P1_JOB_NO_ID, poisoned.data.jobs[1]];
    poisoned.revision = diskBefore.revision + 1;
    poisoned.savedAt = new Date().toISOString();
    await page1.evaluate(rawWriteRecordInPage, poisoned);
    await page1.evaluate(async () => {
      const bc = new BroadcastChannel('dashboard_store_sync');
      bc.postMessage('sync');
      bc.close();
    });
    // Adoption defects are collected, not thrown. On the defect the
    // wait times out and the snapshot check fails, and the case still
    // runs the export and import steps so every defect is named once.
    try {
      await page1.waitForFunction(
        (ids) => window.__store.getData().jobs.map((j) => j.id).join(',') === ids.join(','),
        [P1_JOB_1.id, P1_JOB_2.id],
        { timeout: 8000 },
      );
    } catch (error) {
      collect(new Error(`phase 1 adoption wait: getData().jobs did not reduce to the valid neighbours only (${String(error.message).split('\n')[0]})`));
    }
    try {
      const adopted1 = await page1.evaluate(() => {
        const d = window.__store.getData();
        return { goals: d.goals.map((g) => g.id), jobs: d.jobs };
      });
      assert.deepEqual(
        adopted1.jobs.map((j) => (j && typeof j === 'object' ? j.id : j)),
        [P1_JOB_1.id, P1_JOB_2.id],
        'phase 1: adopted jobs differ from the valid neighbours in order',
      );
      assert.ok(
        adopted1.jobs.every((j) => j && typeof j === 'object' && j.id && j.title),
        `phase 1: adopted jobs carry a malformed-object entry (${JSON.stringify(adopted1.jobs)})`,
      );
      assert.deepEqual(adopted1.goals, [P1_GOAL.id], 'phase 1: adopted goals differ');
    } catch (error) {
      collect(error);
    }
    assert.equal(errors1.length, 0, `phase 1 adoption produced pageerror(s): ${errors1.join(' ; ')}`);

    // --- Phase 1, step 4: export before any save and before any re-init. ---
    // The quarantine in the export envelope is the adopted quarantine. The
    // adoption policy puts exactly three entries there, in order: jobs
    // index 1 null, index 2 the object with no identifying field, and index 3 the
    // object missing id, each with its original value.
    const export1 = await exportCapture(page1);
    try {
      assert.equal(export1.parsed.app, 'dashboard', 'phase 1 export: app field is not dashboard');
      assert.equal(export1.parsed.schemaVersion, 1, 'phase 1 export: schemaVersion is not 1');
      assert.equal(typeof export1.parsed.exportedAt, 'string', 'phase 1 export: exportedAt is missing');
      assert.deepEqual(
        (export1.parsed.data?.jobs ?? []).map((j) => (j && typeof j === 'object' ? j.id : j)),
        [P1_JOB_1.id, P1_JOB_2.id],
        'phase 1 export before save: exported data.jobs is not the partitioned neighbour pair',
      );
      assert.ok(
        (export1.parsed.data?.jobs ?? []).every((j) => j && typeof j === 'object' && j.id && j.title),
        `phase 1 export before save: an exported job is missing required fields (${JSON.stringify(export1.parsed.data?.jobs)})`,
      );
      assert.deepEqual(
        (export1.parsed.data?.goals ?? []).map((g) => (g && typeof g === 'object' ? g.id : g)),
        [P1_GOAL.id],
        'phase 1 export before save: exported data.goals differs',
      );
      assertExportCollectionsClean(export1.parsed.data, 'phase 1 export before save');
      assertQuarantineExact(export1.parsed, P1_EXPECTED_QUARANTINE, 'phase 1 export before save');
    } catch (error) {
      collect(error);
    }

    // --- Phase 1, step 5: import the exact export into a clean context. ---
    const context2 = await browser.newContext({ acceptDownloads: true });
    contexts.push(context2);
    const page2 = await context2.newPage();
    const errors2 = [];
    const dialogs2 = [];
    page2.on('pageerror', (error) => errors2.push(error.message));
    page2.on('dialog', async (dialog) => {
      dialogs2.push(`${dialog.type()}: ${dialog.message()}`);
      await dialog.accept().catch(() => {});
    });
    await page2.goto(`${origin}/index.html`, { waitUntil: 'load' });
    await grabStore(page2);
    await page2.evaluate(async () => { await window.__store.initStore(); });
    try {
      const importResult = await page2.evaluate(async (text) => new Promise((resolve) => {
        const file = new File([text], 'dashboard-backup-v11.json', { type: 'application/json' });
        window.__store.importData(file, (res) => resolve({
          committed: !!res?.committed,
          conflict: !!res?.conflict,
          cancelled: !!res?.cancelled,
          error: res?.error ? String(res.error.message ?? res.error) : null,
        }));
      }), export1.text);
      assert.equal(
        importResult.committed, true,
        `phase 1 import: the exact export did not commit in a clean context: ${JSON.stringify(importResult)}; dialogs: ${dialogs2.join(' | ')}`,
      );
      const snap2 = await page2.evaluate(() => {
        const d = window.__store.getData();
        return { goals: d.goals.map((g) => g.id), jobs: d.jobs.map((j) => j.id) };
      });
      assert.deepEqual(snap2.jobs, [P1_JOB_1.id, P1_JOB_2.id], 'phase 1 import: imported jobs differ from the exported neighbours in order');
      assert.deepEqual(snap2.goals, [P1_GOAL.id], 'phase 1 import: imported goals differ');
      const disk2 = await page2.evaluate(rawReadRecordInPage);
      assert.deepEqual(
        disk2?.envelopeExtras?.quarantine, P1_EXPECTED_QUARANTINE,
        'phase 1 import: the durable record does not carry the exact quarantine metadata',
      );
      // Unrelated save in the clean context. The quarantine and the
      // valid data must survive the save itself.
      const savedUnrelated = await page2.evaluate(async (placeId) => {
        const store = window.__store;
        const snapshot = store.getData();
        snapshot.places.push({ id: placeId, name: 'Invented V12 Unrelated Place', lat: 43.65, lng: -79.38 });
        return store.saveData(snapshot);
      }, P1_UNRELATED_PLACE_ID);
      assert.deepEqual(savedUnrelated, { committed: true, conflict: false }, 'phase 1 import: the unrelated save did not commit cleanly');
      const snap2saved = await page2.evaluate(() => {
        const d = window.__store.getData();
        return { goals: d.goals.map((g) => g.id), jobs: d.jobs.map((j) => j.id), places: d.places.map((p) => p.id) };
      });
      assert.deepEqual(snap2saved.jobs, [P1_JOB_1.id, P1_JOB_2.id], 'phase 1 import: jobs differ after the unrelated save');
      assert.deepEqual(snap2saved.goals, [P1_GOAL.id], 'phase 1 import: goals differ after the unrelated save');
      assert.deepEqual(snap2saved.places, [P1_UNRELATED_PLACE_ID], 'phase 1 import: the unrelated save is missing after the save');
      const disk2saved = await page2.evaluate(rawReadRecordInPage);
      assert.deepEqual(
        disk2saved?.envelopeExtras?.quarantine, P1_EXPECTED_QUARANTINE,
        'phase 1 import: the durable record lost quarantine entries in the unrelated save',
      );
      await page2.reload({ waitUntil: 'load' });
      await grabStore(page2);
      await page2.evaluate(async () => { await window.__store.initStore(); });
      const snap2b = await page2.evaluate(() => {
        const d = window.__store.getData();
        return { goals: d.goals.map((g) => g.id), jobs: d.jobs.map((j) => j.id), places: d.places.map((p) => p.id) };
      });
      assert.deepEqual(snap2b.jobs, [P1_JOB_1.id, P1_JOB_2.id], 'phase 1 import: jobs differ after reload');
      assert.deepEqual(snap2b.goals, [P1_GOAL.id], 'phase 1 import: goals differ after reload');
      assert.deepEqual(snap2b.places, [P1_UNRELATED_PLACE_ID], 'phase 1 import: the unrelated save is missing after reload');
      const export2 = await exportCapture(page2);
      assertExportCollectionsClean(export2.parsed.data, 'phase 1 second export');
      assert.ok(
        (export2.parsed.data?.jobs ?? []).every((j) => j && typeof j === 'object' && j.id && j.title),
        `phase 1 second export: an exported job is missing required fields (${JSON.stringify(export2.parsed.data?.jobs)})`,
      );
      assert.deepEqual(
        (export2.parsed.data?.jobs ?? []).map((j) => (j && typeof j === 'object' ? j.id : j)),
        [P1_JOB_1.id, P1_JOB_2.id],
        'phase 1 second export: exported jobs differ from the valid neighbours in order',
      );
      assert.ok(
        (export2.parsed.data?.places ?? []).some((p) => p?.id === P1_UNRELATED_PLACE_ID),
        'phase 1 second export: the unrelated save is missing from the second export',
      );
      assertQuarantineExact(export2.parsed, P1_EXPECTED_QUARANTINE, 'phase 1 second export');
      assert.equal(errors2.length, 0, `phase 1 import context produced pageerror(s): ${errors2.join(' ; ')}`);
      // Re-import the second export into a third isolated clean
      // context. The second backup must also be round-trippable.
      const context2b = await browser.newContext({ acceptDownloads: true });
      contexts.push(context2b);
      const page2b = await context2b.newPage();
      const errors2b = [];
      const dialogs2b = [];
      page2b.on('pageerror', (error) => errors2b.push(error.message));
      page2b.on('dialog', async (dialog) => {
        dialogs2b.push(`${dialog.type()}: ${dialog.message()}`);
        await dialog.accept().catch(() => {});
      });
      await page2b.goto(`${origin}/index.html`, { waitUntil: 'load' });
      await grabStore(page2b);
      await page2b.evaluate(async () => { await window.__store.initStore(); });
      const reimportResult = await page2b.evaluate(async (text) => new Promise((resolve) => {
        const file = new File([text], 'dashboard-backup-v12-second.json', { type: 'application/json' });
        window.__store.importData(file, (res) => resolve({
          committed: !!res?.committed,
          conflict: !!res?.conflict,
          cancelled: !!res?.cancelled,
          error: res?.error ? String(res.error.message ?? res.error) : null,
        }));
      }), export2.text);
      assert.equal(
        reimportResult.committed, true,
        `phase 1 second export re-import: the second export did not commit in a clean context: ${JSON.stringify(reimportResult)}; dialogs: ${dialogs2b.join(' | ')}`,
      );
      const snap2c = await page2b.evaluate(() => {
        const d = window.__store.getData();
        return { goals: d.goals.map((g) => g.id), jobs: d.jobs.map((j) => j.id), places: d.places.map((p) => p.id) };
      });
      assert.deepEqual(snap2c.jobs, [P1_JOB_1.id, P1_JOB_2.id], 'phase 1 second export re-import: imported jobs differ');
      assert.deepEqual(snap2c.goals, [P1_GOAL.id], 'phase 1 second export re-import: imported goals differ');
      assert.deepEqual(snap2c.places, [P1_UNRELATED_PLACE_ID], 'phase 1 second export re-import: the unrelated save is missing');
      const disk2b = await page2b.evaluate(rawReadRecordInPage);
      assert.deepEqual(
        disk2b?.envelopeExtras?.quarantine, P1_EXPECTED_QUARANTINE,
        'phase 1 second export re-import: the durable record does not carry the exact quarantine metadata',
      );
      assert.equal(errors2b.length, 0, `phase 1 second export re-import context produced pageerror(s): ${errors2b.join(' ; ')}`);
    } catch (error) {
      collect(error);
    }

    // --- Phase 2, step 6: disk record newer than the page cache. ---
    const context3 = await browser.newContext({ acceptDownloads: true });
    contexts.push(context3);
    const page3 = await context3.newPage();
    const errors3 = [];
    page3.on('pageerror', (error) => errors3.push(error.message));
    await page3.goto(`${origin}/index.html`, { waitUntil: 'load' });
    await grabStore(page3);
    await page3.evaluate(async () => { await window.__store.initStore(); });
    const seededD1 = await page3.evaluate(async ({ goal, job }) => {
      const store = window.__store;
      const snapshot = store.getData();
      snapshot.goals = [goal];
      snapshot.jobs = [job];
      return store.saveData(snapshot);
    }, { goal: P2_GOAL_D1, job: P2_JOB_D1 });
    assert.deepEqual(seededD1, { committed: true, conflict: false }, 'phase 2 D1 save did not commit');
    const diskD1 = await page3.evaluate(rawReadRecordInPage);
    assert.ok(diskD1, 'phase 2: no durable record exists after the D1 save');
    const recordD2 = JSON.parse(JSON.stringify(diskD1));
    recordD2.data = {
      goals: [null, P2_GOAL_D2],
      places: [],
      jobs: [P2_JOB_D2_1, P2_JOB_D2_2],
      investments: [],
      habits: [],
      indicators: [],
      metadata: {},
      college: { timetable: [], assignments: [], exams: [], fees: [] },
      news: { sources: [], cache: [], manual: [] },
    };
    recordD2.revision = diskD1.revision + 1;
    recordD2.savedAt = new Date().toISOString();
    recordD2.envelopeExtras = {};
    await page3.evaluate(rawWriteRecordInPage, recordD2);
    // No BroadcastChannel notification is sent. The page cache still
    // holds D1. This assert proves the setup before the export runs.
    const cachedJobs = await page3.evaluate(() => window.__store.getData().jobs.map((j) => j.id));
    assert.deepEqual(cachedJobs, [P2_JOB_D1.id], 'phase 2 setup: the page cache does not hold D1 before the export');

    // --- Phase 2, step 7: export with a stale cache. ---
    // The export must carry D2 partitioned, with the D2 quarantine.
    try {
      const exportP2 = await exportCapture(page3);
      assert.deepEqual(
        (exportP2.parsed.data?.jobs ?? []).map((j) => (j && typeof j === 'object' ? j.id : j)),
        [P2_JOB_D2_1.id, P2_JOB_D2_2.id],
        'phase 2 export: exported jobs are not the newer disk dataset D2',
      );
      assert.deepEqual(
        (exportP2.parsed.data?.goals ?? []).map((g) => (g && typeof g === 'object' ? g.id : g)),
        [P2_GOAL_D2.id],
        'phase 2 export: exported goals are not the partitioned D2 goals',
      );
      assertExportCollectionsClean(exportP2.parsed.data, 'phase 2 export');
      assertQuarantineExact(exportP2.parsed, [{ path: 'goals', index: 0, value: null }], 'phase 2 export');
      assert.equal(errors3.length, 0, `phase 2 produced pageerror(s): ${errors3.join(' ; ')}`);
    } catch (error) {
      collect(error);
    }

    assert.equal(defects.length, 0, defects.join(' || '));
    return 'export before any save or re-init carried the partitioned neighbours in order with exactly three quarantine entries (jobs[1]=null, jobs[2]=object with no identifying field, jobs[3]=object missing id, each with its original value) and imported with committed:true into a clean context, where the data and the quarantine survived an unrelated save, reload and a second export, and the second export re-imported with committed:true into a third clean context; with the disk record newer than the page cache and no sync notification, the export carried the newer disk dataset D2 partitioned with its quarantine (goals[0]=null), not the cached D1';
  } finally {
    for (const context of contexts) await context.close();
  }
});

await browser.close();
server.close();

const counts = results.reduce((acc, r) => {
  acc[r.status] = (acc[r.status] ?? 0) + 1;
  return acc;
}, {});
console.log('');
console.log(`Summary: PASS ${counts.PASS ?? 0}; NOT RUN ${counts['NOT RUN'] ?? 0}; FAIL ${counts.FAIL ?? 0}`);
console.log('Boundary rule: PASS here means the case ran in a real Chromium-family browser context against the native IndexedDB, BroadcastChannel and localStorage of the tree named in the header.');
if ((counts.FAIL ?? 0) > 0 || (counts['NOT RUN'] ?? 0) > 0) process.exitCode = 1;
emitResults();
