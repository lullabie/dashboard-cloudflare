// storage-browser.spec.mjs — Lane D-STORAGE, dashboard v6 browser QA.
// Run: node qa/v4/storage-browser.spec.mjs [--tree <path>]
//        [--results-out <path>]
// Real-browser storage cases for js/store.js. No store mocks. The spec serves
// a static tree from a local temporary origin, opens Firefox with an isolated
// context per case, and drives the real store module in the page. IndexedDB,
// BroadcastChannel and localStorage are the native browser APIs.
//
// Tree under test: QA_TREE_ROOT, else --tree, else DASH_TREE, else the
// checkout that contains this spec (qa/v4/ -> repo root, two levels up).
// The header prints the tree path and the actual js/store.js and js/feeds.js
// SHA-256 read from that tree. No source hash is pinned. No source is
// substituted.
//
// Playwright resolution order: QA_PLAYWRIGHT_CORE or PLAYWRIGHT_MODULE path,
// bare "playwright-core" or "playwright" import (the documented pinned
// install in qa/v4/README.md), then fallbacks only: the Python Playwright
// driver package, the npx cache. If no driver loads or Firefox does not
// launch, every case reports NOT RUN with the blocker and the process exits
// 1. A NOT RUN run never reports success. Results are written as JSON next
// to this spec (browser-results.json) unless --results-out or
// QA_RESULTS_OUT names another path. Lane E's schema supersedes that file.
//
// Invented records only. No personal data.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeBrowserResults } from '../../scripts/write-browser-results.mjs';

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
  'TEST-STORE-001',
  'TEST-STORE-002',
  'TEST-STORE-003',
  'TEST-STORE-004',
  'V5-STORE-01',
  'TEST-STORE-005',
];

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

// --- Playwright driver resolution -------------------------------------------

async function loadFirefox() {
  const candidates = [];
  if (process.env.QA_PLAYWRIGHT_CORE) candidates.push(process.env.QA_PLAYWRIGHT_CORE);
  candidates.push('playwright-core', 'playwright');
  try {
    const libDir = path.join(os.homedir(), '.local', 'lib');
    for (const entry of readdirSync(libDir)) {
      const pkg = path.join(libDir, entry, 'site-packages', 'playwright', 'driver', 'package');
      if (existsSync(path.join(pkg, 'index.mjs'))) candidates.push(pkg);
    }
  } catch {}
  try {
    const npxDir = path.join(os.homedir(), '.npm', '_npx');
    for (const entry of readdirSync(npxDir)) {
      const pkg = path.join(npxDir, entry, 'node_modules', 'playwright-core');
      if (existsSync(pkg)) candidates.push(pkg);
    }
  } catch {}

  const errors = [];
  for (const candidate of candidates) {
    try {
      const mod = await import(path.isAbsolute(candidate) ? pathToFileURL(path.join(candidate.replace(/[\\/]$/, ''), 'index.mjs')).href : candidate).catch(
        async () => {
          const require = createRequire(import.meta.url);
          return require(candidate);
        },
      );
      const fw = mod.firefox ?? mod.default?.firefox;
      if (fw) return fw;
      errors.push(`${candidate}: no firefox export`);
    } catch (error) {
      errors.push(`${candidate}: ${error.message.split('\n')[0]}`);
    }
  }
  throw new Error(`No Playwright driver loadable. Tried: ${errors.join(' ; ')}`);
}

// --- Static server ------------------------------------------------------------

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
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (urlPath === '/__qa_blank.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><html><head><title>qa-blank</title></head><body>qa</body></html>');
      return;
    }
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

// --- Page-side helpers (strings evaluated in the real page) -------------------

// These helpers are real functions. Playwright calls a function argument in
// the page; a string that holds a function is not called and returns undefined.
const readRecordInPage = async () => {
  return await new Promise((resolve, reject) => {
    const req = indexedDB.open('dashboard_store', 1);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('store_records')) { db.close(); resolve(null); return; }
      const tx = db.transaction('store_records', 'readonly');
      const get = tx.objectStore('store_records').get(1);
      get.onsuccess = () => {
        const r = get.result;
        db.close();
        resolve(r ? { revision: r.revision, generation: r.generation, data: r.data } : null);
      };
      get.onerror = () => { db.close(); reject(get.error); };
    };
    req.onerror = () => reject(req.error);
  });
};

const poisonDbInPage = async () => {
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('dashboard_store', 99);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('store_records')) {
        req.result.createObjectStore('store_records', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => { req.result.close(); resolve(); };
    req.onerror = () => reject(req.error);
  });
};

const deleteDbInPage = async () => {
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase('dashboard_store');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('deleteDatabase blocked'));
  });
};

const BC_TRACKER_SCRIPT = `(() => {
  const Native = window.BroadcastChannel;
  const stats = { constructed: 0, closed: 0 };
  class Tracked extends Native {
    constructor(name) { super(name); stats.constructed += 1; }
    close() { stats.closed += 1; super.close(); }
  }
  window.BroadcastChannel = Tracked;
  window.__bcStats = () => ({ ...stats, active: stats.constructed - stats.closed });
})()`;

const BC_POSTMESSAGE_FAULT_SCRIPT = `(() => {
  const Native = window.BroadcastChannel;
  class Faulty extends Native {
    postMessage() { throw new Error('Injected post-commit notification failure'); }
  }
  window.BroadcastChannel = Faulty;
})()`;

async function importStore(page, tag) {
  return page.evaluate(async (t) => {
    window.__store = await import(`/js/store.js?inst=${t}`);
    return typeof window.__store.initStore;
  }, tag);
}

// --- Driver -------------------------------------------------------------------

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
      runtime: process.env.QA_RUNTIME ?? `node ${process.version}`,
      runId: process.env.QA_RUN_ID,
      cases: results,
    });
    console.log(`Machine results written: ${out}`);
  } catch (error) {
    console.error(`Machine results NOT written: ${error.message}`);
    process.exitCode = 1;
  }
}

let firefox;
try {
  firefox = await loadFirefox();
} catch (error) {
  console.log(`Driver blocker: ${error.message}`);
  for (const id of CASE_IDS) record(id, 'REAL-BROWSER', 'NOT RUN', `Missing precondition: ${error.message}`);
  console.log('Summary: PASS 0; NOT RUN 6; FAIL 0');
  emitResults();
  process.exit(1);
}

const { server, origin } = await startServer(TREE_ROOT);
console.log(`Local temporary origin: ${origin}`);
let browser;
try {
  browser = await firefox.launch({ headless: true });
} catch (error) {
  console.log(`Browser launch blocker: ${error.message.split('\n')[0]}`);
  for (const id of CASE_IDS) record(id, 'REAL-BROWSER', 'NOT RUN', `Missing precondition: Firefox launch failed: ${error.message.split('\n')[0]}`);
  console.log('Summary: PASS 0; NOT RUN 6; FAIL 0');
  emitResults();
  server.close();
  process.exit(1);
}
console.log(`Browser: Firefox ${browser.version()}`);
console.log('');

async function newCasePage(initScript) {
  const context = await browser.newContext({ acceptDownloads: true });
  if (initScript) await context.addInitScript(initScript);
  const page = await context.newPage();
  page.on('download', () => {});
  await page.goto(`${origin}/__qa_blank.html`);
  return { context, page };
}

// TEST-STORE-001 — degraded init and failed re-init block writes; reads/export remain.
await group('TEST-STORE-001', async () => {
  const { context, page } = await newCasePage();
  try {
    await page.evaluate(poisonDbInPage);
    await importStore(page, 's1');
    const out = await page.evaluate(async () => {
      const store = window.__store;
      const init1 = await store.initStore();
      const snapshot = store.getData();
      let saveError = null;
      try { await store.saveData(snapshot); } catch (e) { saveError = e.message; }
      const init2 = await store.initStore();
      let saveError2 = null;
      try { await store.saveData(store.getData()); } catch (e) { saveError2 = e.message; }
      return {
        init1, init2, saveError, saveError2,
        readable: !!snapshot && Array.isArray(snapshot.goals) && Array.isArray(snapshot.places),
      };
    });
    assert.equal(out.init1.status, 'degraded', `first init not degraded: ${JSON.stringify(out.init1)}`);
    assert.match(out.saveError ?? '', /degraded/i, 'save in degraded state did not reject');
    assert.equal(out.init2.status, 'degraded', 're-init under the same fault did not stay degraded');
    assert.match(out.saveError2 ?? '', /degraded/i, 'save after failed re-init did not reject');
    assert.equal(out.readable, true, 'committed/default data not readable in degraded state');

    const downloadPromise = page.waitForEvent('download', { timeout: 5000 });
    await page.evaluate(async () => { await window.__store.exportData(); });
    const download = await downloadPromise;
    assert.ok(download, 'export produced no download');
    return 'poisoned higher-version DB forces degraded init; failed re-init stays degraded; saves reject with the degraded error; getData reads and exportData downloads';
  } finally {
    await context.close();
  }
});

// TEST-STORE-002 — explicit recovery permits one durable save; reload preserves it.
await group('TEST-STORE-002', async () => {
  const { context, page } = await newCasePage();
  try {
    await page.evaluate(poisonDbInPage);
    await importStore(page, 's2');
    const degraded = await page.evaluate(async () => (await window.__store.initStore()).status);
    assert.equal(degraded, 'degraded');

    await page.evaluate(deleteDbInPage);
    const out = await page.evaluate(async () => {
      const store = window.__store;
      const ready = await store.initStore();
      const snapshot = store.getData();
      snapshot.goals.push({ id: 'goal_qa_recovery', title: 'Invented recovery goal', history: [] });
      const saved = await store.saveData(snapshot);
      return { ready, saved };
    });
    assert.equal(out.ready.status, 'ready');
    assert.deepEqual(out.saved, { committed: true, conflict: false });

    const record = await page.evaluate(readRecordInPage);
    assert.equal(record.revision, 2, `expected exactly one durable save (revision 1 -> 2), got revision ${record?.revision}`);
    assert.equal(record.data.goals.length, 1);

    await page.reload();
    await importStore(page, 's2-after-reload');
    const after = await page.evaluate(async () => {
      const ready = await window.__store.initStore();
      const data = window.__store.getData();
      return { status: ready.status, revision: ready.revision, title: data.goals[0]?.title ?? null };
    });
    assert.deepEqual(after, { status: 'ready', revision: 2, title: 'Invented recovery goal' });
    return 'after fault removal an explicit initStore restores ready; one save commits (revision 1 -> 2); a real reload preserves the record';
  } finally {
    await context.close();
  }
});

// TEST-STORE-003 — repeated init leaves one active subscription; two real tabs refresh.
await group('TEST-STORE-003', async () => {
  const { context, page: tabA } = await newCasePage(BC_TRACKER_SCRIPT);
  try {
    await importStore(tabA, 's3');
    const stats = await tabA.evaluate(async () => {
      const store = window.__store;
      await store.initStore();
      await store.initStore();
      await store.initStore();
      return window.__bcStats();
    });
    assert.deepEqual(stats, { constructed: 3, closed: 2, active: 1 },
      `repeated init must close each predecessor channel: ${JSON.stringify(stats)}`);

    const tabB = await context.newPage();
    await tabB.goto(`${origin}/__qa_blank.html`);
    await importStore(tabB, 's3');
    await tabB.evaluate(async () => { await window.__store.initStore(); });

    const saved = await tabA.evaluate(async () => {
      const store = window.__store;
      const snapshot = store.getData();
      snapshot.goals.push({ id: 'goal_qa_tab_sync', title: 'Invented cross-tab goal', history: [] });
      return store.saveData(snapshot);
    });
    assert.deepEqual(saved, { committed: true, conflict: false });

    await tabB.waitForFunction(
      () => window.__store.getData().goals.some((g) => g.id === 'goal_qa_tab_sync'),
      null,
      { timeout: 8000 },
    );
    return 'three initStore calls construct 3 channels, close 2, leave 1 active; a save in tab A becomes visible in tab B through the native BroadcastChannel sync';
  } finally {
    await context.close();
  }
});

// TEST-STORE-004 — post-commit notification failure settles accurately; no duplicate retry.
await group('TEST-STORE-004', async () => {
  const { context, page } = await newCasePage(BC_POSTMESSAGE_FAULT_SCRIPT);
  try {
    await importStore(page, 's4');
    const out = await page.evaluate(async () => {
      const store = window.__store;
      await store.initStore();
      const snapshot = store.getData();
      snapshot.goals.push({ id: 'goal_qa_notify', title: 'Invented notify goal', history: [] });
      return store.saveData(snapshot);
    });
    assert.deepEqual(out, { committed: true, conflict: false },
      'save must settle as committed even when the post-commit notification throws');

    const record = await page.evaluate(readRecordInPage);
    assert.equal(record.revision, 2, `notification failure must not retry the write; revision is ${record?.revision}, expected 2`);
    assert.equal(record.data.goals.length, 1);

    await page.reload();
    await importStore(page, 's4-after-reload');
    const title = await page.evaluate(async () => {
      await window.__store.initStore();
      return window.__store.getData().goals[0]?.title ?? null;
    });
    assert.equal(title, 'Invented notify goal');
    return 'saveData resolves { committed: true, conflict: false } while postMessage throws; the durable record advances exactly one revision and survives reload';
  } finally {
    await context.close();
  }
});

// V5-STORE-01 — first-open legacy data with null place IDs is repaired before the first durable put.
// Both parts always run. A failure in one part does not hide the other part.
await group('V5-STORE-01', async () => {
  const problems = [];
  const check = (cond, msg) => { if (!cond) problems.push(msg); };

  const { context, page } = await newCasePage();
  try {
    await page.evaluate(async () => {
      localStorage.setItem('dashboard_data', JSON.stringify({
        goals: [],
        places: [
          { id: null, name: 'Invented Place A' },
          { id: 'place_valid_1234567890', name: 'Invented Place B' },
          { name: 'Invented Place C' },
        ],
        jobs: [],
        college: { timetable: [], assignments: [], exams: [], fees: [] },
      }));
    });
    await importStore(page, 's5');
    const status = await page.evaluate(async () => (await window.__store.initStore()).status);
    check(status === 'ready', `init over legacy data returned ${status}, expected ready`);
    const record = await page.evaluate(readRecordInPage);
    check(!!record, 'first open wrote no durable record');
    if (record) {
      const places = record.data.places;
      const validId = (id) => typeof id === 'string' && id.startsWith('place_') && id.length > 10;
      check(Array.isArray(places) && places.length === 3, `legacy place count changed: ${JSON.stringify(places)}`);
      if (Array.isArray(places)) {
        check(places.every((p) => validId(p.id)),
          `legacy places reached the durable record without ID repair: ${JSON.stringify(places.map((p) => p.id))}`);
        check(places[1]?.id === 'place_valid_1234567890', 'a valid legacy place ID was not preserved');
        check(new Set(places.map((p) => p.id)).size === places.length, 'repaired place IDs are not unique');
        check(JSON.stringify(places.map((p) => p.name)) === JSON.stringify(['Invented Place A', 'Invented Place B', 'Invented Place C']),
          'legacy place records were not preserved');
      }
    }
  } finally {
    await context.close();
  }

  const malformed = await browser.newContext({ acceptDownloads: true });
  try {
    const page2 = await malformed.newPage();
    await page2.goto(`${origin}/__qa_blank.html`);
    await page2.evaluate(async () => {
      localStorage.setItem('dashboard_data', JSON.stringify({ goals: 42, places: 'not-an-array', jobs: [] }));
    });
    await importStore(page2, 's5-malformed');
    const out2 = await page2.evaluate(async () => window.__store.initStore());
    const record2 = await page2.evaluate(readRecordInPage);
    const explicitRecovery =
      (out2.status === 'degraded' && typeof out2.error === 'string' && out2.error.length > 0) ||
      (record2 && Array.isArray(record2.data.places) && Array.isArray(record2.data.goals));
    check(explicitRecovery,
      `malformed legacy payload produced no explicit recovery (init=${JSON.stringify(out2)}, durable places=${JSON.stringify(record2?.data?.places)}, durable goals=${JSON.stringify(record2?.data?.goals)})`);
  } finally {
    await malformed.close();
  }

  if (problems.length > 0) throw new Error(`V5-STORE-01 open defects: ${problems.join(' ; ')}`);
  return 'legacy null/missing place IDs are repaired by the migrator before the first durable put; the one valid ID and all records survive; malformed legacy input yields explicit recovery';
});

// TEST-STORE-005 — native transaction failure with reload recovery; delayed and rejected saves.
await group('TEST-STORE-005', async () => {
  const { context, page } = await newCasePage();
  try {
    await importStore(page, 's6');
    // Part 1: the durable record disappears under a tracked snapshot (native abort path).
    const part1 = await page.evaluate(async () => {
      const store = window.__store;
      await store.initStore();
      const snapshot = store.getData();
      snapshot.goals.push({ id: 'goal_qa_abort', title: 'Invented abort goal', history: [] });
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('dashboard_store', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('store_records', 'readwrite');
          tx.objectStore('store_records').delete(1);
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(tx.error); };
        };
        req.onerror = () => reject(req.error);
      });
      let saveError = null;
      try { await store.saveData(snapshot); } catch (e) { saveError = e.message; }
      const ready = await store.initStore();
      const snap2 = store.getData();
      snap2.goals.push({ id: 'goal_qa_recovered', title: 'Invented recovered goal', history: [] });
      const saved = await store.saveData(snap2);
      return { saveError, readyStatus: ready.status, saved };
    });
    assert.match(part1.saveError ?? '', /Save failed/, 'save over a deleted record did not reject explicitly');
    assert.equal(part1.readyStatus, 'ready', 'explicit re-init did not recover after the native abort');
    assert.deepEqual(part1.saved, { committed: true, conflict: false });

    await page.reload();
    await importStore(page, 's6-after-reload');
    const recoveredTitle = await page.evaluate(async () => {
      await window.__store.initStore();
      return window.__store.getData().goals[0]?.title ?? null;
    });
    assert.equal(recoveredTitle, 'Invented recovered goal', 'post-recovery save is not durable across reload');

    // Part 2: untracked input rejects; two in-flight saves settle as one commit and one conflict.
    const part2 = await page.evaluate(async () => {
      const store = window.__store;
      let untrackedError = null;
      try { await store.saveData({ goals: [] }); } catch (e) { untrackedError = e.message; }
      const s1 = store.getData();
      const s2 = store.getData();
      s1.goals.push({ id: 'goal_qa_race_a', title: 'Invented race A', history: [] });
      s2.goals.push({ id: 'goal_qa_race_b', title: 'Invented race B', history: [] });
      const settled = await Promise.allSettled([store.saveData(s1), store.saveData(s2)]);
      return {
        untrackedError,
        settled: settled.map((r) => r.status === 'fulfilled'
          ? { status: 'fulfilled', value: r.value }
          : { status: 'rejected', reason: r.reason.message }),
      };
    });
    assert.match(part2.untrackedError ?? '', /untracked/i, 'untracked raw input was not rejected');
    const fulfilled = part2.settled.filter((r) => r.status === 'fulfilled');
    const rejected = part2.settled.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1, `expected exactly one commit, got ${JSON.stringify(part2.settled)}`);
    assert.deepEqual(fulfilled[0].value, { committed: true, conflict: false });
    assert.equal(rejected.length, 1, 'expected exactly one rejected save');
    assert.match(rejected[0].reason, /Conflict/, 'the delayed save did not settle as an explicit conflict');

    const record = await page.evaluate(readRecordInPage);
    const raceGoals = record.data.goals.filter((g) => g.id.startsWith('goal_qa_race_'));
    assert.equal(record.revision, 3, `expected revision 3 after recovery save + one race commit, got ${record.revision}`);
    assert.equal(raceGoals.length, 1, 'both race writes landed; CAS serialization failed');
    return 'save over a natively deleted record rejects with Save failed, explicit re-init recovers and the next save is durable across reload; untracked input rejects; two in-flight saves settle as exactly one commit and one Conflict rejection with one durable winner';
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
console.log('Boundary rule: PASS here means the case ran in a real Firefox profile against the native IndexedDB, BroadcastChannel and localStorage of the tree named in the header.');
if ((counts.FAIL ?? 0) > 0 || (counts['NOT RUN'] ?? 0) > 0) process.exitCode = 1;
emitResults();
