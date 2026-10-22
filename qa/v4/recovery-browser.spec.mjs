// recovery-browser.spec.mjs — Lane D independent QA, dashboard V10.
// Run: node qa/v4/recovery-browser.spec.mjs [--tree <path>]
//        [--results-out <path>]
// One real-browser regression case (V10-RECOVERY-01) for native IndexedDB
// adoption of a malformed stored record. No store mocks. The spec serves a
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

const CASE_IDS = ['V10-RECOVERY-01'];

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
  console.log('Summary: PASS 0; NOT RUN 1; FAIL 0');
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
