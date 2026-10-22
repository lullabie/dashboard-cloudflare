// places-browser.spec.mjs — Lane B QA, dashboard V13.
// Run: node qa/v4/places-browser.spec.mjs [--tree <path>]
//        [--results-out <path>]
// Real-browser regression case for place-ID repair at adoption:
// V13-PLACES-01. Codex V13 defect, reproduced in installed Chrome on the
// V12 tree: a stored place with a missing id is adopted unchanged, so the
// app's own edit path (savePlace in js/maps.js, which matches by id)
// cannot find the record and the edit lands as a create — one place
// becomes two (original plus edited copy). The same malformed-id adoption
// breaks delete precision for duplicate ids.
//
// The repair contract asserted here: at adoption, a place whose id is
// missing, invalid (isValidId: a string starting with 'place_' and
// longer than 10 characters) or duplicated is assigned a minted valid
// id. Valid unique ids, entry count and order are preserved. Each
// replaced id leaves provenance in the record's envelopeExtras
// quarantine as { path: 'places', index, value } with the original place
// object verbatim. Repaired ids are stable across reload, export and
// import — a restore never re-mints them.
//
// No store mocks. The spec serves a static tree from a local temporary
// origin, opens a Chromium-family browser (Chrome/Brave/Chromium via
// QA_BROWSER) with isolated contexts, seeds a RAW IndexedDB record whose
// places carry a missing id, a duplicate id and an invalid short id,
// and loads the real app (index.html) against it. Edits and deletes go
// through the real js/maps.js entry points the app itself calls.
//
// Tree under test: QA_TREE_ROOT, else --tree, else DASH_TREE, else the
// checkout that contains this spec (qa/v4/ -> repo root, two levels up).
// The header prints the tree path and the actual js/store.js and
// js/feeds.js SHA-256 read from that tree. No source hash is pinned. No
// source is substituted. Results are written through the shared Lane E
// writer (scripts/write-browser-results.mjs), never by hand.
//
// Invented records only. No personal data.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
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

const CASE_IDS = ['V13-PLACES-01'];

// Seeded places, by original index. Index 0 is the valid neighbour: a
// valid unique id that adoption must preserve byte-identically. Index 1
// has NO id (the Codex V13 repro shape). Index 2 duplicates index 0's
// id. Index 3 carries an invalid short id.
const PLACE_VALID = { id: 'place_qa_v13_valid_neighbour', name: 'Valid Neighbour', title: 'Valid Neighbour', lat: 43.65, lng: -79.38 };
const PLACE_NO_ID = { name: 'Old valid place', title: 'Old valid place', lat: 43, lng: -79 };
const PLACE_DUP_ID = { id: 'place_qa_v13_valid_neighbour', name: 'Duplicate Id Place', title: 'Duplicate Id Place', lat: 43.1, lng: -79.1 };
const PLACE_SHORT_ID = { id: 'x', name: 'Short Id Place', title: 'Short Id Place', lat: 43.2, lng: -79.2 };
const SEEDED_PLACES = [PLACE_VALID, PLACE_NO_ID, PLACE_DUP_ID, PLACE_SHORT_ID];
const EDITED_TITLE = 'Edited old place';
// The cross-tab poison appended in phase 4: a place with no id, written
// raw by a second page at the next free index of the then-current array.
const PLACE_CROSS_TAB = { name: 'Cross Tab Poisoned Place', title: 'Cross Tab Poisoned Place', lat: 44, lng: -80 };
// Expected phase 1 provenance, in order: one entry per replaced id,
// each with the original place object verbatim.
const PROVENANCE_PHASE_1 = [
  { path: 'places', index: 1, value: PLACE_NO_ID },
  { path: 'places', index: 2, value: PLACE_DUP_ID },
  { path: 'places', index: 3, value: PLACE_SHORT_ID },
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

// --- Static server (recovery spec pattern; '/' serves index.html) -----------

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

// Seeds a RAW durable record directly in the native IndexedDB, in the
// exact envelope shape js/store.js writes. The places array is poisoned
// as described above; every other collection is present and empty.
const seedPoisonedRecordInPage = async (places) => {
  const data = {
    goals: [],
    places,
    jobs: [],
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
        generation: 'qa-v13-generation',
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

async function grabStore(page) {
  await page.evaluate(async () => {
    window.__store = await import('/js/store.js');
  });
}

// Polls until the app has adopted a record with the expected number of
// places, a pageerror lands, or the deadline passes. Settles briefly so
// a late boot error is still captured before assertions run.
async function waitForPlaces(page, pageErrors, count) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (pageErrors.length > 0) break;
    const n = await page
      .evaluate(() => window.__store?.getData().places.length ?? -1)
      .catch(() => -1);
    if (n === count) break;
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(500);
}

// Polls the RAW durable record until the predicate accepts it or the
// deadline passes. Returns the last record read either way, so the
// caller's assertions name the actual durable state.
async function pollDiskRecord(page, predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let rec = null;
  while (Date.now() < deadline) {
    rec = await page.evaluate(rawReadRecordInPage);
    if (rec && predicate(rec)) break;
    await page.waitForTimeout(150);
  }
  return rec;
}

// Runs the real store exportData() in the page and returns the download
// as raw text plus parsed JSON (recovery spec exportCapture pattern).
async function exportCapture(page) {
  await grabStore(page);
  const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
  await page.evaluate(async () => { await window.__store.exportData(); });
  const download = await downloadPromise;
  assert.ok(download, 'exportData produced no download');
  const target = path.join(
    os.tmpdir(),
    `v13-places-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
  await download.saveAs(target);
  return { text: readFileSync(target, 'utf8'), parsed: JSON.parse(readFileSync(target, 'utf8')) };
}

// Finds quarantine-shaped entries anywhere in an export envelope:
// objects with a string path and an integer index (the recovery
// metadata contract { path, index, value }).
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

// Asserts that a quarantine list is exactly the expected entry set:
// same length, and every expected { path, index, value } present with a
// deep-equal value. Order-insensitive; disk assertions separately use
// deepEqual where the contract fixes the order.
function assertQuarantineSet(actual, expected, label) {
  assert.ok(Array.isArray(actual), `${label}: quarantine is not an array (${JSON.stringify(actual)})`);
  assert.equal(
    actual.length, expected.length,
    `${label}: expected exactly ${expected.length} quarantine entries, found ${JSON.stringify(actual)}`,
  );
  for (const exp of expected) {
    const entry = actual.find(
      (e) => e.path === exp.path && e.index === exp.index &&
        JSON.stringify(e.value) === JSON.stringify(exp.value),
    );
    assert.ok(entry, `${label}: quarantine entry ${exp.path}[${exp.index}] with its original value is missing; found ${JSON.stringify(actual)}`);
  }
}

// The store's own place-ID contract (js/store.js isValidId).
function isValidPlaceId(id) {
  return typeof id === 'string' && id.startsWith('place_') && id.length > 10;
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
  console.log(`Summary: PASS 0; NOT RUN ${CASE_IDS.length}; FAIL 0`);
  emitResults();
  process.exit(1);
}

const { server, origin } = await startServer(TREE_ROOT);
console.log(`Local temporary origin: ${origin}`);
console.log(`Browser: ${browserInfo.runtimeLabel} (QA_BROWSER=${browserInfo.selection.kind})`);
console.log('');

// V13-PLACES-01 — poisoned place IDs repaired at adoption, provenance
// quarantined, edit updates one record, delete removes one record,
// cross-tab adoption repairs and merges provenance, and repaired IDs
// stay stable across reload, export and import.
// Assertion failures are collected per phase, not thrown at first
// sight: the case fails once with every defect named. Download, seed
// and navigation defects throw at once — those are mechanics.
await group('V13-PLACES-01', async () => {
  const defects = [];
  // Defect text goes on one line. The results writer keeps the first
  // lines of a failure only, and a multi-line diff would hide phases.
  const collect = (error) => defects.push(String(error.message).replace(/\s+/g, ' ').trim());
  const contexts = [];
  try {
    // --- Phase 1: poisoned load. ---
    const context1 = await browser.newContext({ acceptDownloads: true });
    contexts.push(context1);
    const errors1 = [];
    const page1 = await context1.newPage();
    page1.on('pageerror', (error) => errors1.push(error.message));
    await page1.goto(`${origin}/__qa_blank.html`);
    await page1.evaluate(seedPoisonedRecordInPage, SEEDED_PLACES);
    await page1.goto(`${origin}/index.html`, { waitUntil: 'load' });
    await grabStore(page1);
    await waitForPlaces(page1, errors1, SEEDED_PLACES.length);

    let adoptedIds = null;
    try {
      assert.equal(errors1.length, 0, `phase 1 poisoned load produced pageerror(s): ${errors1.join(' ; ')}`);
      const mem = await page1.evaluate(() => window.__store.getData().places);
      assert.equal(mem.length, 4, `phase 1: adopted places count is ${mem.length}, expected 4`);
      assert.deepEqual(
        mem.map((p) => p.title),
        ['Valid Neighbour', 'Old valid place', 'Duplicate Id Place', 'Short Id Place'],
        'phase 1: adopted place titles or order differ from the seeded record',
      );
      // Capture the adopted id set before the repair assertions, so a
      // repair failure still lets phases 2-4 run against the actual
      // adopted state and name their own defects in the same run.
      adoptedIds = mem.map((p) => p.id);
      const idProblems = [];
      if (mem[0]?.id !== PLACE_VALID.id) {
        idProblems.push(`the valid neighbour id changed (was ${PLACE_VALID.id}, now ${JSON.stringify(mem[0]?.id)})`);
      }
      for (let i = 1; i < 4; i++) {
        if (!isValidPlaceId(mem[i]?.id)) {
          idProblems.push(`places[${i}] ("${mem[i]?.title}") carries an unrepaired id ${JSON.stringify(mem[i]?.id ?? null)}`);
        }
      }
      if (new Set(adoptedIds).size !== 4) {
        idProblems.push(`adopted place ids are not unique (${JSON.stringify(adoptedIds)})`);
      }
      assert.equal(idProblems.length, 0, `phase 1: ${idProblems.join('; ')}`);
      // The durable record after init must carry the same repaired ids
      // and exactly the three provenance entries, in index order.
      const disk = await pollDiskRecord(
        page1,
        (rec) => (rec.envelopeExtras?.quarantine ?? []).length === PROVENANCE_PHASE_1.length,
      );
      assert.ok(disk, 'phase 1: no durable record exists after boot');
      assert.deepEqual(
        (disk.data?.places ?? []).map((p) => p.id),
        adoptedIds,
        'phase 1: the durable record does not carry the repaired ids the app exposes',
      );
      assert.deepEqual(
        disk.envelopeExtras?.quarantine, PROVENANCE_PHASE_1,
        'phase 1: the durable record quarantine is not exactly the three provenance entries in order',
      );
    } catch (error) {
      collect(error);
    }

    // --- Phase 2: edit-as-update, the Codex V13 repro. ---
    // The edit goes through js/maps.js savePlace with the place's
    // current in-memory object, exactly as the app submits it, changing
    // only the title. On the defect the formerly id-less place has no
    // id to match, so savePlace creates a second record.
    try {
      assert.ok(adoptedIds, 'phase 2: phase 1 produced no adopted id set to edit against');
      const outcome = await page1.evaluate(async (newTitle) => {
        const maps = await import('/js/maps.js');
        const before = maps.getPlaces();
        const target = before[1];
        const res = await maps.savePlace({ ...target, title: newTitle });
        const after = maps.getPlaces();
        return { res, beforeCount: before.length, afterCount: after.length, after };
      }, EDITED_TITLE);
      assert.deepEqual(outcome.res, { committed: true, conflict: false }, 'phase 2: the edit save did not commit cleanly');
      assert.equal(
        outcome.afterCount, 4,
        `phase 2: edit changed the place count ${outcome.beforeCount} -> ${outcome.afterCount} (edit landed as a create)`,
      );
      const edited = outcome.after.filter((p) => p.title === EDITED_TITLE);
      assert.equal(edited.length, 1, `phase 2: expected exactly one place titled "${EDITED_TITLE}", found ${edited.length}`);
      assert.equal(
        edited[0]?.id, adoptedIds[1],
        'phase 2: the edited place does not carry the repaired id of the formerly id-less place',
      );
      assert.ok(
        !outcome.after.some((p) => p.title === 'Old valid place'),
        'phase 2: the original unedited place is still present beside the edited copy',
      );
      assert.equal(errors1.length, 0, `phase 2 produced pageerror(s): ${errors1.join(' ; ')}`);
    } catch (error) {
      collect(error);
    }

    // --- Phase 3: delete precision. ---
    // Delete the duplicate-id-repaired place by its repaired id through
    // js/maps.js deletePlace. Exactly that record may go; the valid
    // neighbour that once shared its seeded id must stay.
    try {
      assert.ok(adoptedIds, 'phase 3: phase 1 produced no adopted id set to delete against');
      const outcome = await page1.evaluate(async (id) => {
        const maps = await import('/js/maps.js');
        const res = await maps.deletePlace(id);
        return { res, after: maps.getPlaces() };
      }, adoptedIds[2]);
      assert.deepEqual(outcome.res, { committed: true, conflict: false }, 'phase 3: the delete did not commit cleanly');
      assert.equal(outcome.after.length, 3, `phase 3: place count after delete is ${outcome.after.length}, expected 3`);
      assert.deepEqual(
        outcome.after.map((p) => ({ id: p.id, title: p.title })),
        [
          { id: adoptedIds[0], title: 'Valid Neighbour' },
          { id: adoptedIds[1], title: EDITED_TITLE },
          { id: adoptedIds[3], title: 'Short Id Place' },
        ],
        'phase 3: the surviving places are not exactly the expected set in order',
      );
      assert.equal(errors1.length, 0, `phase 3 produced pageerror(s): ${errors1.join(' ; ')}`);
    } catch (error) {
      collect(error);
    }

    // --- Phase 4: cross-tab adoption of a fresh poisoned write. ---
    // A second page on the same context and origin appends one id-less
    // place to the durable record with a bumped revision and notifies
    // through the native BroadcastChannel. Page 1 must adopt the new
    // place with a repaired id, persist the repair, and merge the new
    // provenance entry behind the three existing ones.
    let stableIds = null;
    let stableProvenance = null;
    try {
      assert.ok(adoptedIds, 'phase 4: phase 1 produced no adopted id set to build on');
      const page2 = await context1.newPage();
      const errors2 = [];
      page2.on('pageerror', (error) => errors2.push(error.message));
      await page2.goto(`${origin}/index.html`, { waitUntil: 'load' });
      await grabStore(page2);
      await waitForPlaces(page2, errors2, 3);
      assert.equal(errors2.length, 0, `phase 4 second-page load produced pageerror(s): ${errors2.join(' ; ')}`);
      const recForCrossTab = await page2.evaluate(rawReadRecordInPage);
      assert.ok(recForCrossTab, 'phase 4: no durable record exists for the cross-tab write');
      const crossTabRecord = JSON.parse(JSON.stringify(recForCrossTab));
      crossTabRecord.data.places = [...crossTabRecord.data.places, PLACE_CROSS_TAB];
      crossTabRecord.revision = recForCrossTab.revision + 1;
      crossTabRecord.savedAt = new Date().toISOString();
      await page2.evaluate(rawWriteRecordInPage, crossTabRecord);
      await page2.evaluate(async () => {
        const bc = new BroadcastChannel('dashboard_store_sync');
        bc.postMessage('sync');
        bc.close();
      });
      try {
        await page1.waitForFunction(
          () => window.__store.getData().places.length === 4 &&
            window.__store.getData().places.every(
              (p) => typeof p.id === 'string' && p.id.startsWith('place_') && p.id.length > 10,
            ),
          null,
          { timeout: 8000 },
        );
      } catch (error) {
        collect(new Error(`phase 4 cross-tab adoption wait: page 1 did not adopt the appended place with a repaired id (${String(error.message).split('\n')[0]})`));
      }
      const mem4 = await page1.evaluate(() => window.__store.getData().places);
      assert.equal(mem4.length, 4, `phase 4: page 1 exposes ${mem4.length} places after cross-tab adoption, expected 4`);
      // Capture the actual adopted set before the repair assertions,
      // so phase 5 still verifies stability and provenance against it
      // when the cross-tab repair itself is the defect.
      stableIds = mem4.map((p) => p.id);
      stableProvenance = [...PROVENANCE_PHASE_1, { path: 'places', index: 3, value: PLACE_CROSS_TAB }];
      assert.deepEqual(
        mem4.slice(0, 3).map((p) => p.id),
        [adoptedIds[0], adoptedIds[1], adoptedIds[3]],
        'phase 4: the surviving places changed during cross-tab adoption',
      );
      assert.equal(mem4[3]?.title, PLACE_CROSS_TAB.title, 'phase 4: the appended cross-tab place is missing or changed');
      assert.ok(
        isValidPlaceId(mem4[3]?.id),
        `phase 4: the cross-tab place carries an unrepaired id ${JSON.stringify(mem4[3]?.id ?? null)}`,
      );
      const ids4 = mem4.map((p) => p.id);
      assert.equal(new Set(ids4).size, 4, `phase 4: place ids are not unique after cross-tab adoption (${JSON.stringify(ids4)})`);
      // The repair must be persisted: the durable record carries the
      // same ids and the merged provenance set.
      const disk4 = await pollDiskRecord(
        page1,
        (rec) => JSON.stringify((rec.data?.places ?? []).map((p) => p.id)) === JSON.stringify(stableIds) &&
          (rec.envelopeExtras?.quarantine ?? []).length === stableProvenance.length,
      );
      assert.ok(disk4, 'phase 4: no durable record exists after cross-tab adoption');
      assert.deepEqual(
        (disk4.data?.places ?? []).map((p) => p.id),
        stableIds,
        'phase 4: the durable record does not carry the cross-tab repaired ids page 1 exposes',
      );
      assertQuarantineSet(disk4.envelopeExtras?.quarantine, stableProvenance, 'phase 4 durable record');
      assert.equal(errors1.length, 0, `phase 4 produced pageerror(s) on page 1: ${errors1.join(' ; ')}`);
      assert.equal(errors2.length, 0, `phase 4 produced pageerror(s) on page 2: ${errors2.join(' ; ')}`);
    } catch (error) {
      collect(error);
    }

    // --- Phase 5: stability across reload, export and import. ---
    try {
      assert.ok(stableIds && stableProvenance, 'phase 5: phase 4 produced no stable id/provenance set to verify');
      await page1.reload({ waitUntil: 'load' });
      await grabStore(page1);
      await waitForPlaces(page1, errors1, 4);
      const memAfterReload = await page1.evaluate(() => window.__store.getData().places);
      assert.deepEqual(
        memAfterReload.map((p) => p.id), stableIds,
        'phase 5: place ids changed across reload (a repaired id was re-minted)',
      );
      const diskAfterReload = await page1.evaluate(rawReadRecordInPage);
      assertQuarantineSet(diskAfterReload?.envelopeExtras?.quarantine, stableProvenance, 'phase 5 durable record after reload');
      assert.equal(errors1.length, 0, `phase 5 reload produced pageerror(s): ${errors1.join(' ; ')}`);

      const exportV13 = await exportCapture(page1);
      assert.equal(exportV13.parsed.app, 'dashboard', 'phase 5 export: app field is not dashboard');
      assert.deepEqual(
        (exportV13.parsed.data?.places ?? []).map((p) => p.id), stableIds,
        'phase 5 export: exported places do not carry the stable repaired ids',
      );
      assertQuarantineSet(findQuarantineEntries(exportV13.parsed), stableProvenance, 'phase 5 export');

      // Import the exact export into a third isolated clean context.
      // The restore must commit, keep the same repaired ids (import
      // never re-mints a valid id), and carry the provenance on the
      // imported record's durable extras.
      const context3 = await browser.newContext({ acceptDownloads: true });
      contexts.push(context3);
      const page3 = await context3.newPage();
      const errors3 = [];
      const dialogs3 = [];
      page3.on('pageerror', (error) => errors3.push(error.message));
      page3.on('dialog', async (dialog) => {
        dialogs3.push(`${dialog.type()}: ${dialog.message()}`);
        await dialog.accept().catch(() => {});
      });
      await page3.goto(`${origin}/index.html`, { waitUntil: 'load' });
      await grabStore(page3);
      await page3.evaluate(async () => { await window.__store.initStore(); });
      const importResult = await page3.evaluate(async (text) => new Promise((resolve) => {
        const file = new File([text], 'dashboard-backup-v13.json', { type: 'application/json' });
        window.__store.importData(file, (res) => resolve({
          committed: !!res?.committed,
          conflict: !!res?.conflict,
          cancelled: !!res?.cancelled,
          error: res?.error ? String(res.error.message ?? res.error) : null,
        }));
      }), exportV13.text);
      assert.equal(
        importResult.committed, true,
        `phase 5 import: the exact export did not commit in a clean context: ${JSON.stringify(importResult)}; dialogs: ${dialogs3.join(' | ')}`,
      );
      const snap3 = await page3.evaluate(() => window.__store.getData().places);
      assert.deepEqual(
        snap3.map((p) => p.id), stableIds,
        'phase 5 import: imported places do not carry the same repaired ids (a restore re-minted an id)',
      );
      assert.deepEqual(
        snap3.map((p) => p.title),
        ['Valid Neighbour', EDITED_TITLE, 'Short Id Place', PLACE_CROSS_TAB.title],
        'phase 5 import: imported place titles or order differ',
      );
      const disk3 = await page3.evaluate(rawReadRecordInPage);
      assertQuarantineSet(disk3?.envelopeExtras?.quarantine, stableProvenance, 'phase 5 imported durable record');
      assert.equal(errors3.length, 0, `phase 5 import context produced pageerror(s): ${errors3.join(' ; ')}`);
    } catch (error) {
      collect(error);
    }

    assert.equal(defects.length, 0, defects.join(' || '));
    return 'poisoned load repaired the missing, duplicate and invalid place ids at adoption with the valid neighbour id byte-identical and exactly three provenance entries (original objects at indices 1, 2, 3) on the durable record; the edit of the formerly id-less place updated one record (count stayed 4, no original left beside the edit); delete by repaired id removed exactly the duplicate-repaired record; a cross-tab raw poisoned append was adopted with a repaired id, persisted, and its provenance merged behind the existing entries; after reload the ids were byte-identical, the export carried the same ids and provenance, and the exact export imported with committed:true into a clean context with the same ids and provenance on disk';
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
