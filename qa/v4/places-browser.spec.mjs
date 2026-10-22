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
// V14 extension (phases 6-9, same case): Codex V14 reproduced a repair
// race in installed Chrome — two tabs adopt the same poisoned record
// simultaneously, mint different ids under one shared generation/
// revision token, and the losing tab's tracked snapshot then saves with
// committed success over the durable winner. Phases 6-9 race two pages
// in one context against a fresh poisoned record, capture each page's
// minted id and tracked snapshot inside the adoption window, and assert
// one canonical winner: the loser's stale snapshot is rejected as a
// conflict (verified against the disk, never the return value alone),
// and the loser's edit still lands through a fresh snapshot with the
// canonical id intact.
//
// V14 QA correction (this revision): Codex's independent installed-
// Chrome gate failed the first version of phase 7 — but the failure
// was in this spec, not in the store. The old barrier polled getData()
// every 5 ms and could not guarantee a pre-claim capture: in Codex's
// run both captures were taken AFTER the repair claim had settled
// (both held the same canonical id), so the selected "loser" snapshot
// was actually fresh and its save committed — correct store behavior.
// The corrected spec makes the capture deterministic with a native
// scheduling barrier and gates the stale assertions on a proven
// precondition:
//   - Each race page pre-opens a test-owned IndexedDB connection and
//     runs a MessageChannel turn chain. A held readwrite transaction
//     cannot be created before the sync post: IDB serializes
//     overlapping transactions in creation order, so it would also
//     block the pages' adoption reads (verified by probe in this
//     Chromium: a held readwrite transaction blocks later readonly
//     and readwrite transactions on the same store, across
//     connections, until it commits). Instead, the first chain turn
//     that observes the race place in getData() creates the hold
//     synchronously in that same turn. That turn was enqueued before
//     the store's claim transaction can exist — the claim is created
//     only in the IDB open-success task of the claim's openDB() call,
//     which the adoption itself starts — so the hold queues ahead of
//     every claim transaction while the adoption reads (created
//     earlier) have already run. No claim can settle while a hold is
//     active, so a capture taken under the barrier is pre-settle by
//     construction.
//   - Staleness is nevertheless PROVEN, not assumed, before phase 7
//     asserts rejection, under either of two gates: (G1) the
//     capture's minted id differs from the durable winner's id —
//     the page must have adopted the poisoned record (the only other
//     record carrying a race place is the claimed one, whose id is
//     the winner's), so its snapshot token carries the poisoned
//     revision, one behind the winner's claimed revision; or (G2)
//     the capture was taken under the barrier and its capture-time
//     disk proof — a readonly read created in the capture turn,
//     ahead of the hold and of every later claim — completed while
//     the hold was active and still shows the poisoned record
//     durable, which also proves the claim winner's own pre-settle
//     snapshot stale. If neither capture is provably stale, the
//     stale-rejection coverage reports NOT RUN (the case is
//     downgraded, never passed on that coverage, never failed as a
//     product defect); phase 8 separately asserts that a FRESH
//     post-settle snapshot commits — the behavior Codex's run
//     actually exercised.
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
// V14 race fixtures (phases 6-8): one id-less place written raw to a
// clean record at a bumped revision, so two pages in one context adopt
// it at effectively the same time and repair it independently.
const RACE_PLACE = { name: 'Race Place', title: 'Race Place', lat: 43, lng: -79 };
const RACE_EDITED_TITLE = 'Race Place Edited By Loser';
// Phase 8's fresh-snapshot edit, applied from the non-loser page after
// the race settles; phase 9 then overwrites it with RACE_EDITED_TITLE.
const RACE_FRESH_EDITED_TITLE = 'Race Place Edited From Fresh Snapshot';

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

// Posts the store's cross-tab sync notification. Page-side use.
const postSyncInPage = async () => {
  const bc = new BroadcastChannel('dashboard_store_sync');
  bc.postMessage('sync');
  bc.close();
};

// V14 race barrier (QA correction). Deterministic native capture of a
// pre-claim tracked snapshot. Design (see the header comment for the
// full argument):
//   - A test-owned IndexedDB connection is pre-opened on the page.
//   - A MessageChannel turn chain watches getData(). The first turn
//     that observes the race place stashes that page's minted id and a
//     tracked getData() snapshot on window AND, synchronously in the
//     same turn, creates a readwrite transaction on the app's object
//     store and holds it open with a get-request chain. That turn was
//     enqueued before the store's claim transaction can exist (the
//     claim is created in the IDB open-success task of the claim's
//     own openDB() call, started by the adoption the turn observed),
//     so the hold queues ahead of every claim transaction, while this
//     page's adoption read — created earlier — has already run. No
//     claim can settle while the hold is active.
//   - The hold must NOT be created before the sync post: a readwrite
//     transaction created earlier would also block the adoption reads
//     (IDB serializes overlapping transactions in creation order;
//     probe-verified in this Chromium for readonly and readwrite
//     transactions alike, across connections).
// The snapshot object must stay in the page: saveData() tokens are
// keyed by object identity in a WeakMap, so a snapshot round-tripped
// through the driver is untracked. Page-side use.
const installRaceBarrierInPage = async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('dashboard_store', 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  window.__raceDb = db;
  window.__raceHoldState = 'armed'; // armed -> held -> released
  window.__raceHoldSteps = 0;
  window.__raceHoldError = null;
  window.__raceCapture = new Promise((resolve) => {
    const channel = new MessageChannel();
    const startedAt = Date.now();
    const turn = () => {
      let race = null;
      try {
        const places = window.__store?.getData().places ?? [];
        race = places.find((p) => p.title === 'Race Place') ?? null;
      } catch { race = null; }
      if (race) {
        window.__raceMintId = race.id ?? null;
        window.__raceSnap = window.__store.getData();
        // Capture-time disk proof: a readonly transaction created in
        // this same turn, BEFORE the hold. It executes in creation
        // order — ahead of this page's hold and of every claim
        // transaction created later — and records the durable record
        // as of the capture: if it still shows the poisoned record
        // (poisoned revision, race place without a repaired id) and
        // it completed while the hold was active, the capture is
        // provably pre-settle even when this page's mint turns out
        // to be the winner's (the claim winner's own snapshot).
        window.__raceDiskProof = null;
        try {
          const proofTx = db.transaction('store_records', 'readonly');
          const proofReq = proofTx.objectStore('store_records').get(1);
          proofReq.onsuccess = () => {
            const rec = proofReq.result ?? null;
            const rp = (rec?.data?.places ?? []).find((p) => p.title === 'Race Place');
            window.__raceDiskProof = {
              revision: rec?.revision ?? null,
              raceId: rp?.id ?? null,
              whileHeld: window.__raceHoldState === 'held',
            };
          };
          proofReq.onerror = () => { window.__raceDiskProof = { error: true }; };
        } catch (error) {
          window.__raceDiskProof = { error: String(error?.message ?? error) };
        }
        // Create the hold NOW, in this turn, before resolving.
        try {
          const tx = db.transaction('store_records', 'readwrite');
          window.__raceHoldTx = tx;
          const store = tx.objectStore('store_records');
          const holdStartedAt = Date.now();
          const step = () => {
            // Stop placing requests once released (or after a 60 s
            // safety cap) and the transaction commits on its own.
            if (window.__raceHoldState !== 'held') return;
            if (Date.now() - holdStartedAt > 60000) {
              window.__raceHoldState = 'released';
              return;
            }
            window.__raceHoldSteps++;
            const getReq = store.get(1);
            getReq.onsuccess = () => step();
            getReq.onerror = () => {};
          };
          window.__raceHoldState = 'held';
          step();
          tx.oncomplete = () => { window.__raceHoldState = 'released'; };
          tx.onabort = () => { window.__raceHoldState = 'released'; };
        } catch (error) {
          window.__raceHoldError = String(error?.message ?? error);
        }
        resolve({
          mintId: window.__raceMintId,
          holdState: window.__raceHoldState,
          holdError: window.__raceHoldError,
        });
        return;
      }
      if (Date.now() - startedAt > 12000) { resolve(null); return; }
      channel.port2.postMessage(null);
    };
    channel.port1.onmessage = turn;
    channel.port2.postMessage(null);
  });
};

// Releases the race barrier hold: the keep-alive chain stops placing
// requests, the held transaction commits, and any claim transactions
// queued behind it run. Page-side use.
const releaseRaceHoldInPage = async () => {
  if (window.__raceHoldState === 'held') window.__raceHoldState = 'released';
};

// Attempts to save the stashed adoption-window snapshot with the race
// place's title edited — the losing tab's stale save. Returns the
// outcome shape; never throws. Page-side use.
const attemptRaceSaveInPage = async (editedTitle) => {
  const snap = window.__raceSnap;
  if (!snap) return { outcome: 'no-snapshot' };
  const race = snap.places.find((p) => p.title === 'Race Place');
  if (!race) return { outcome: 'race-place-missing-from-snapshot' };
  race.title = editedTitle;
  try {
    const res = await window.__store.saveData(snap);
    return { outcome: 'resolved', res };
  } catch (error) {
    return { outcome: 'rejected', message: String(error?.message ?? error) };
  }
};

// Saves the race place edit through a FRESH tracked snapshot — the
// legitimate retry after a conflict adoption. Finds the race place by
// its canonical id first, then by either title, so the phase still
// runs against the actual state a failed race leaves behind.
// Page-side use.
const freshRaceEditInPage = async ({ canonicalId, editedTitle }) => {
  const snap = window.__store.getData();
  const race = snap.places.find((p) => p.id === canonicalId) ??
    snap.places.find((p) => p.title === 'Race Place' || p.title === editedTitle);
  if (!race) return { outcome: 'race-place-missing' };
  race.title = editedTitle;
  try {
    const res = await window.__store.saveData(snap);
    return { outcome: 'resolved', res };
  } catch (error) {
    return { outcome: 'rejected', message: String(error?.message ?? error) };
  }
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
// stay stable across reload, export and import. Phases 6-9 (V14, QA
// correction) add the two-tab repair race: one canonical winner, the
// losing tab's provably stale snapshot rejected, a fresh post-settle
// snapshot committing, and the loser's edit preserved via a fresh
// snapshot. Assertion failures are collected per phase, not thrown at
// first sight: the case fails once with every defect named. Download,
// seed and navigation defects throw at once — those are mechanics.
// If the race obtains no provably stale capture, the stale-rejection
// coverage is NOT RUN: raceCoverageNotRun is set inside the case and
// the recorded PASS is downgraded to NOT RUN after the group (a real
// FAIL is never downgraded).
let raceCoverageNotRun = null;
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

    // --- Phase 6 (V14, QA correction): two-tab repair race — setup,
    // barrier captures under held claims, release, settle. ---
    // Two pages in ONE context share the native IndexedDB and
    // BroadcastChannel. Both load the app clean and install the race
    // barrier (pre-opened test connection + MessageChannel turn
    // chain). Then one raw poisoned record (a single id-less place,
    // revision bumped) is written from page A and the store's sync
    // notification is posted, so both pages adopt it at effectively
    // the same time. Each page's barrier captures its minted id and a
    // tracked snapshot in the first turn that observes the adoption,
    // creating its IndexedDB hold in that same turn — before that
    // page's claim transaction can exist — so no claim settles while
    // the captures are taken. The driver releases both holds, the
    // claims race, and the assertions are winner-agnostic: whichever
    // mint the disk settles on is the canonical id both pages must
    // converge to. The stale precondition for phase 7 is proven from
    // the captures, not from the barrier alone — gate G1 (a capture
    // whose mint differs from the canonical winner adopted the
    // poisoned record, so its token carries the poisoned revision)
    // or gate G2 (a barrier capture whose capture-time disk proof
    // shows the poisoned record still durable).
    let racePageA = null;
    let racePageB = null;
    let raceCanonicalId = null;
    let raceCanonicalRevision = null;
    let racePoisonRevision = null;
    let raceLoserPage = null;
    let raceLoserLabel = null;
    let raceStalePage = null;
    let raceStaleLabel = null;
    let raceFreshPage = null;
    let raceCandidates = null;
    let raceEvidence = null;
    const errorsRaceA = [];
    const errorsRaceB = [];
    try {
      const contextRace = await browser.newContext({ acceptDownloads: true });
      contexts.push(contextRace);
      racePageA = await contextRace.newPage();
      racePageB = await contextRace.newPage();
      racePageA.on('pageerror', (error) => errorsRaceA.push(error.message));
      racePageB.on('pageerror', (error) => errorsRaceB.push(error.message));
      for (const racePage of [racePageA, racePageB]) {
        await racePage.goto(`${origin}/index.html`, { waitUntil: 'load' });
        await grabStore(racePage);
      }
      const bootRecord = await pollDiskRecord(racePageA, (rec) => !!rec);
      assert.ok(bootRecord, 'phase 6: the race context produced no clean boot record');
      // Barriers first: each page pre-opens its test connection and
      // starts its capture chain before the poisoned record exists.
      await racePageA.evaluate(installRaceBarrierInPage);
      await racePageB.evaluate(installRaceBarrierInPage);
      const poisonedRecord = JSON.parse(JSON.stringify(bootRecord));
      poisonedRecord.data.places = [RACE_PLACE];
      poisonedRecord.revision = bootRecord.revision + 1;
      poisonedRecord.savedAt = new Date().toISOString();
      racePoisonRevision = poisonedRecord.revision;
      await racePageA.evaluate(rawWriteRecordInPage, poisonedRecord);
      // The durable record the pages are about to adopt, read back
      // before the sync post. While a barrier hold is active no claim
      // transaction can execute, so this is also the durable state at
      // capture time; if a hold missed its window, the mint gate
      // below — not this read — arbitrates the verdict.
      const diskAtCapture = await racePageA.evaluate(rawReadRecordInPage);
      assert.equal(
        diskAtCapture?.revision, racePoisonRevision,
        `phase 6: the durable record before the sync post is revision ${diskAtCapture?.revision}, expected the poisoned revision ${racePoisonRevision}`,
      );
      assert.ok(
        !(diskAtCapture?.data?.places ?? []).some((p) => p.title === RACE_PLACE.title && p.id),
        'phase 6: the poisoned race place already carries an id before adoption',
      );
      await racePageA.evaluate(postSyncInPage);
      let holdsReleased = false;
      const releaseHolds = async () => {
        if (holdsReleased) return;
        holdsReleased = true;
        for (const racePage of [racePageA, racePageB]) {
          await racePage.evaluate(releaseRaceHoldInPage).catch(() => {});
        }
      };
      let capA = await racePageA.evaluate(() => window.__raceCapture);
      let capB = await racePageB.evaluate(() => window.__raceCapture);
      if (!capA || !capB) {
        // A page whose adoption read queued behind the other page's
        // hold cannot capture until the holds release. Release, let
        // the late adoption land, and take a fallback capture of what
        // the page then exposes; the mint gate decides whether it is
        // provably stale. A page that never exposes the race place at
        // all is an adoption defect, collected below as a failure.
        await releaseHolds();
        for (const [label, racePage] of [['A', racePageA], ['B', racePageB]]) {
          const have = label === 'A' ? capA : capB;
          if (have) continue;
          await racePage.waitForFunction(
            () => window.__store?.getData().places.some((p) => p.title === 'Race Place'),
            null,
            { timeout: 8000 },
          ).catch(() => {});
          const late = await racePage.evaluate(() => {
            const race = window.__store?.getData().places.find((p) => p.title === 'Race Place');
            if (!race) return null;
            window.__raceMintId = race.id ?? null;
            window.__raceSnap = window.__store.getData();
            return { mintId: window.__raceMintId, holdState: 'none', holdError: null, fallback: true };
          }).catch(() => null);
          if (label === 'A') capA = late; else capB = late;
        }
      }
      assert.ok(capA, 'phase 6: page A never adopted the poisoned race place');
      assert.ok(capB, 'phase 6: page B never adopted the poisoned race place');
      raceCandidates = { A: capA.mintId, B: capB.mintId };
      // Collect each page's capture-time disk proof before releasing
      // the holds (bounded wait: a proof read queued behind the other
      // page's hold completes only after release and then reports
      // whileHeld false, which the gate reads honestly as no proof).
      const raceDiskProofs = { A: null, B: null };
      {
        const proofDeadline = Date.now() + 1000;
        while (Date.now() < proofDeadline && (!raceDiskProofs.A || !raceDiskProofs.B)) {
          for (const [label, racePage] of [['A', racePageA], ['B', racePageB]]) {
            if (!raceDiskProofs[label]) {
              raceDiskProofs[label] = await racePage.evaluate(() => window.__raceDiskProof ?? null).catch(() => null);
            }
          }
          if (!raceDiskProofs.A || !raceDiskProofs.B) await racePageA.waitForTimeout(50);
        }
      }
      // Both captures are taken. Release the holds and let the
      // claims race to one canonical winner.
      await releaseHolds();
      // Settle: the durable record carries one valid repaired id,
      // stable across two reads, and both pages expose that same id.
      const settleDisk = await pollDiskRecord(racePageA, (rec) => {
        const rp = (rec.data?.places ?? []).find((p) => p.title === RACE_PLACE.title);
        return !!rp && isValidPlaceId(rp.id);
      });
      const settleRace = (settleDisk?.data?.places ?? []).find((p) => p.title === RACE_PLACE.title);
      assert.ok(
        settleRace && isValidPlaceId(settleRace.id),
        'phase 6: the durable record never settled on a valid repaired race id',
      );
      raceCanonicalId = settleRace.id;
      await racePageA.waitForTimeout(300);
      const settleDisk2 = await racePageA.evaluate(rawReadRecordInPage);
      const settleRace2 = (settleDisk2?.data?.places ?? []).find((p) => p.title === RACE_PLACE.title);
      assert.equal(
        settleRace2?.id, raceCanonicalId,
        'phase 6: the durable race id was still changing when the settle window closed',
      );
      raceCanonicalRevision = settleDisk2?.revision ?? null;
      for (const [label, racePage] of [['A', racePageA], ['B', racePageB]]) {
        try {
          await racePage.waitForFunction(
            (id) => window.__store.getData().places.some(
              (p) => p.title === 'Race Place' && p.id === id,
            ),
            raceCanonicalId,
            { timeout: 8000 },
          );
        } catch {
          const exposed = await racePage.evaluate(
            () => window.__store.getData().places.find((p) => p.title === 'Race Place')?.id ?? null,
          );
          collect(new Error(`phase 6: page ${label} did not converge to the canonical race id (exposes ${JSON.stringify(exposed)}, canonical ${raceCanonicalId}; candidates A=${JSON.stringify(raceCandidates.A)} B=${JSON.stringify(raceCandidates.B)})`));
        }
      }
      // Stale proofs. A capture is provably stale under either gate:
      //   (G1) its minted id differs from the canonical winner — the
      //        page adopted the poisoned record (the only other
      //        record carrying a race place is the claimed one,
      //        whose id is the winner's), so its snapshot token
      //        carries the poisoned revision;
      //   (G2) it was taken under the barrier (holdState 'held') and
      //        its capture-time disk proof — a readonly read created
      //        in the capture turn, ahead of the hold and of every
      //        later claim — completed while the hold was active and
      //        still shows the poisoned record durable (poisoned
      //        revision, race place without a repaired id). This
      //        covers the claim winner's own pre-settle snapshot,
      //        whose mint equals the winner's and which G1 cannot
      //        separate from a post-settle fresh capture.
      const proofStale = (cap, proof) => !!cap && cap.holdState === 'held' && !!proof &&
        proof.whileHeld === true && proof.revision === racePoisonRevision &&
        !isValidPlaceId(proof.raceId);
      const staleA = capA.mintId !== raceCanonicalId ? 'mint-differs' : (proofStale(capA, raceDiskProofs.A) ? 'disk-proof' : null);
      const staleB = capB.mintId !== raceCanonicalId ? 'mint-differs' : (proofStale(capB, raceDiskProofs.B) ? 'disk-proof' : null);
      // Recorded race evidence (carried into the case detail): each
      // capture's minted id, barrier state, capture-time disk proof
      // and implied token revision, the disk revision at capture
      // time (the poisoned revision, per the read-back above), and
      // the durable winner's id and revision after settle. A capture
      // proven stale under either gate has the poisoned revision as
      // its implied token revision. An unproven capture holding the
      // winner's mint stays indeterminate: claim winner pre-settle
      // (poisoned revision) or post-settle fresh (winner revision).
      const impliedTokenRevision = (cap, basis) => (basis
        ? racePoisonRevision
        : `indeterminate (${racePoisonRevision} pre-settle as claim winner, or ${raceCanonicalRevision} post-settle)`);
      raceEvidence = {
        poisonRevision: racePoisonRevision,
        diskRevisionAtCapture: diskAtCapture?.revision ?? null,
        winnerId: raceCanonicalId,
        winnerRevision: raceCanonicalRevision,
        captures: {
          A: { mintId: capA.mintId, holdState: capA.holdState, fallback: !!capA.fallback, diskProof: raceDiskProofs.A, staleBasis: staleA, impliedTokenRevision: impliedTokenRevision(capA, staleA) },
          B: { mintId: capB.mintId, holdState: capB.holdState, fallback: !!capB.fallback, diskProof: raceDiskProofs.B, staleBasis: staleB, impliedTokenRevision: impliedTokenRevision(capB, staleB) },
        },
      };
      // The provably stale capture, if any, is the loser for phase
      // 7 (G1 preferred — it names the tab whose mint lost). The
      // remaining page serves the phase 8 fresh-snapshot check;
      // phase 9's edit runs from the loser when one is proven, else
      // from page A.
      if (staleA) {
        raceStalePage = racePageA; raceStaleLabel = 'A';
        raceLoserPage = racePageA; raceLoserLabel = 'A';
        raceFreshPage = racePageB;
      } else if (staleB) {
        raceStalePage = racePageB; raceStaleLabel = 'B';
        raceLoserPage = racePageB; raceLoserLabel = 'B';
        raceFreshPage = racePageA;
      } else {
        raceLoserPage = racePageA; raceLoserLabel = 'A';
        raceFreshPage = racePageB;
        raceCoverageNotRun =
          `no provably stale capture: both pages captured the canonical id ${raceCanonicalId} ` +
          `(A=${JSON.stringify(capA.mintId)}, B=${JSON.stringify(capB.mintId)}) and neither capture carries a ` +
          'capture-time disk proof of the unsettled poisoned record, so each capture either won the claim ' +
          'or was taken after the claim settled, and its token revision is indeterminate; ' +
          'asserting a stale rejection on such a capture would test a fresh snapshot, whose commit is correct behavior';
      }
      assert.equal(errorsRaceA.length, 0, `phase 6 produced pageerror(s) on race page A: ${errorsRaceA.join(' ; ')}`);
      assert.equal(errorsRaceB.length, 0, `phase 6 produced pageerror(s) on race page B: ${errorsRaceB.join(' ; ')}`);
    } catch (error) {
      collect(error);
    }

    // --- Phase 7 (V14, QA correction): the losing tab's provably stale
    // snapshot must not commit. ---
    // The loser saves its barrier-captured snapshot with the race
    // place edited. The save must be rejected as a conflict, and the
    // proof is the disk read afterwards — never the returned flag
    // alone. These assertions run ONLY when phase 6 proved the stale
    // precondition for the selected capture under gate G1 (minted id
    // differs from the canonical winner) or G2 (barrier capture whose
    // capture-time disk proof shows the poisoned record still
    // durable) — either way its token carries the poisoned revision,
    // behind the winner's claimed revision. Without a provably stale
    // capture this phase asserts nothing and the race coverage
    // reports NOT RUN — a fresh capture committing is correct
    // behavior, asserted as such in phase 8.
    try {
      assert.ok(
        raceCanonicalId && raceLoserPage,
        'phase 7: phase 6 produced no canonical id or losing page to save from',
      );
      if (!raceStalePage) {
        // Coverage NOT RUN (raceCoverageNotRun was set in phase 6).
        // No rejection is asserted on an indeterminate capture.
      } else {
      const attempt = await raceStalePage.evaluate(attemptRaceSaveInPage, RACE_EDITED_TITLE);
      try {
        assert.equal(
          attempt.outcome, 'rejected',
          `the losing tab's provably stale snapshot save was not rejected (outcome ${attempt.outcome}` +
            `${attempt.outcome === 'resolved' ? `, result ${JSON.stringify(attempt.res)}` : `, ${attempt.message ?? 'no detail'}`}` +
            `; stale page ${raceStaleLabel} captured mint ${JSON.stringify(raceCandidates?.[raceStaleLabel])} at token revision ${racePoisonRevision}` +
            `, canonical ${raceCanonicalId} at revision ${raceCanonicalRevision})`,
        );
        assert.ok(
          String(attempt.message ?? '').includes('Conflict'),
          `the losing save rejection is not the store conflict error (${attempt.message ?? 'no message'})`,
        );
      } catch (error) {
        collect(new Error(`phase 7: ${String(error.message).replace(/\s+/g, ' ').trim()}`));
      }
      try {
        const diskAfterLoser = await raceStalePage.evaluate(rawReadRecordInPage);
        const diskRace = (diskAfterLoser?.data?.places ?? []).find(
          (p) => p.title === RACE_PLACE.title || p.title === RACE_EDITED_TITLE,
        );
        assert.ok(diskRace, 'the race place is missing from the durable record after the losing save attempt');
        assert.equal(
          diskRace.id, raceCanonicalId,
          `the durable race id is ${JSON.stringify(diskRace.id)} after the losing save, not the canonical ${raceCanonicalId} (the loser's mint overwrote the winner)`,
        );
        assert.equal(
          diskRace.title, RACE_PLACE.title,
          'the losing tab edit landed on the durable record despite the rejection',
        );
      } catch (error) {
        collect(new Error(`phase 7 durable record: ${String(error.message).replace(/\s+/g, ' ').trim()}`));
      }
      try {
        const loserNow = await raceStalePage.evaluate(
          () => window.__store.getData().places.find((p) => p.title === 'Race Place')?.id ?? null,
        );
        assert.equal(
          loserNow, raceCanonicalId,
          `the losing tab does not expose the canonical id after its rejected save (exposes ${JSON.stringify(loserNow)})`,
        );
      } catch (error) {
        collect(new Error(`phase 7 loser convergence: ${String(error.message).replace(/\s+/g, ' ').trim()}`));
      }
      }
      assert.equal(errorsRaceA.length, 0, `phase 7 produced pageerror(s) on race page A: ${errorsRaceA.join(' ; ')}`);
      assert.equal(errorsRaceB.length, 0, `phase 7 produced pageerror(s) on race page B: ${errorsRaceB.join(' ; ')}`);
    } catch (error) {
      collect(error);
    }

    // --- Phase 8 (V14, QA correction): a FRESH post-settle snapshot
    // must commit. ---
    // The non-loser page takes a fresh getData() snapshot after the
    // race settled, edits the race place, and saves. The save must
    // commit and the disk must carry the edit under the canonical id
    // at exactly the next revision. This is the behavior Codex's
    // Chrome gate actually exercised when the old barrier captured
    // post-settle snapshots; it is correct behavior and is asserted
    // as such here, in its own phase — distinct from the stale
    // rejection in phase 7.
    try {
      assert.ok(
        raceCanonicalId && raceFreshPage && raceCanonicalRevision != null,
        'phase 8: phase 6 produced no settled race state to build on',
      );
      const fresh = await raceFreshPage.evaluate(freshRaceEditInPage, {
        canonicalId: raceCanonicalId,
        editedTitle: RACE_FRESH_EDITED_TITLE,
      });
      assert.equal(
        fresh.outcome, 'resolved',
        `phase 8: the fresh post-settle snapshot edit did not commit (${fresh.outcome}: ${fresh.message ?? 'no detail'})`,
      );
      assert.deepEqual(fresh.res, { committed: true, conflict: false }, 'phase 8: the fresh edit did not commit cleanly');
      const diskAfterFresh = await raceFreshPage.evaluate(rawReadRecordInPage);
      const freshRace = (diskAfterFresh?.data?.places ?? []).find((p) => p.title === RACE_FRESH_EDITED_TITLE);
      assert.ok(freshRace, 'phase 8: the fresh-edited race place is missing from the durable record');
      assert.equal(
        freshRace.id, raceCanonicalId,
        `phase 8: the durable race id after the fresh edit is ${JSON.stringify(freshRace.id)}, not the canonical winner ${raceCanonicalId}`,
      );
      assert.equal(
        diskAfterFresh?.revision, raceCanonicalRevision + 1,
        `phase 8: the durable revision after the fresh edit is ${diskAfterFresh?.revision}, expected the canonical revision + 1 (${raceCanonicalRevision + 1})`,
      );
      assert.equal(errorsRaceA.length, 0, `phase 8 produced pageerror(s) on race page A: ${errorsRaceA.join(' ; ')}`);
      assert.equal(errorsRaceB.length, 0, `phase 8 produced pageerror(s) on race page B: ${errorsRaceB.join(' ; ')}`);
    } catch (error) {
      collect(error);
    }

    // --- Phase 9 (V14): the loser's edit lands via a fresh snapshot. ---
    // A rejected save must not lose the user's edit: the losing tab
    // retries with a fresh tracked snapshot and the edit commits, with
    // the canonical winner id intact on disk, on both tabs after
    // reload, and in the export. Adaptation for the QA correction:
    // phase 8's fresh save advanced the durable record past the
    // revision this page settled on, so the phase first waits until
    // this page's cross-tab sync has adopted that save (its race
    // place carries the phase 8 title); without the wait, the fresh
    // snapshot could be taken against the pre-phase-8 revision and
    // conflict for a scheduling reason, not a product reason.
    try {
      assert.ok(
        raceCanonicalId && raceLoserPage && racePageA && racePageB,
        'phase 9: phase 6 produced no race state to build on',
      );
      try {
        await raceLoserPage.waitForFunction(
          (t) => window.__store.getData().places.some((p) => p.title === t),
          RACE_FRESH_EDITED_TITLE,
          { timeout: 8000 },
        );
      } catch {
        collect(new Error('phase 9: the losing tab never adopted the phase 8 fresh save via cross-tab sync'));
      }
      const fresh = await raceLoserPage.evaluate(freshRaceEditInPage, {
        canonicalId: raceCanonicalId,
        editedTitle: RACE_EDITED_TITLE,
      });
      assert.equal(
        fresh.outcome, 'resolved',
        `phase 9: the losing tab's fresh-snapshot edit did not commit (${fresh.outcome}: ${fresh.message ?? 'no detail'})`,
      );
      assert.deepEqual(fresh.res, { committed: true, conflict: false }, 'phase 9: the fresh edit did not commit cleanly');
      const diskAfterEdit = await raceLoserPage.evaluate(rawReadRecordInPage);
      const editedRace = (diskAfterEdit?.data?.places ?? []).find((p) => p.title === RACE_EDITED_TITLE);
      assert.ok(editedRace, 'phase 9: the edited race place is missing from the durable record');
      assert.equal(
        editedRace.id, raceCanonicalId,
        `phase 9: the durable race id after the legitimate edit is ${JSON.stringify(editedRace.id)}, not the canonical winner ${raceCanonicalId}`,
      );
      for (const [label, racePage] of [['A', racePageA], ['B', racePageB]]) {
        await racePage.reload({ waitUntil: 'load' });
        await grabStore(racePage);
        await racePage.waitForFunction(
          (t) => window.__store.getData().places.some((p) => p.title === t),
          RACE_EDITED_TITLE,
          { timeout: 8000 },
        );
        const exposed = await racePage.evaluate(
          (t) => window.__store.getData().places.find((p) => p.title === t) ?? null,
          RACE_EDITED_TITLE,
        );
        assert.ok(exposed, `phase 9: race page ${label} does not expose the edited race place after reload`);
        assert.equal(
          exposed.id, raceCanonicalId,
          `phase 9: race page ${label} exposes race id ${JSON.stringify(exposed.id)} after reload, not the canonical ${raceCanonicalId}`,
        );
      }
      const raceExport = await exportCapture(racePageA);
      const exportedRace = (raceExport.parsed.data?.places ?? []).find((p) => p.title === RACE_EDITED_TITLE);
      assert.ok(exportedRace, 'phase 9 export: the edited race place is missing from the export');
      assert.equal(
        exportedRace.id, raceCanonicalId,
        'phase 9 export: the exported race place does not carry the canonical id',
      );
      assert.equal(errorsRaceA.length, 0, `phase 9 produced pageerror(s) on race page A: ${errorsRaceA.join(' ; ')}`);
      assert.equal(errorsRaceB.length, 0, `phase 9 produced pageerror(s) on race page B: ${errorsRaceB.join(' ; ')}`);
    } catch (error) {
      collect(error);
    }

    assert.equal(defects.length, 0, defects.join(' || '));
    return 'poisoned load repaired the missing, duplicate and invalid place ids at adoption with the valid neighbour id byte-identical and exactly three provenance entries (original objects at indices 1, 2, 3) on the durable record; the edit of the formerly id-less place updated one record (count stayed 4, no original left beside the edit); delete by repaired id removed exactly the duplicate-repaired record; a cross-tab raw poisoned append was adopted with a repaired id, persisted, and its provenance merged behind the existing entries; after reload the ids were byte-identical, the export carried the same ids and provenance, and the exact export imported with committed:true into a clean context with the same ids and provenance on disk; two simultaneous cross-tab adopters of a fresh poisoned record were captured under a native IndexedDB barrier hold (no claim could settle during capture) and settled on one canonical race id; ' +
      (raceStalePage
        ? 'the losing tab provably stale barrier snapshot save was rejected as a conflict with the durable record verified unchanged on disk; '
        : 'no provably stale capture was obtained, so the stale-rejection assertions did not run (see the NOT RUN note); ') +
      'a fresh post-settle snapshot from the other tab committed its edit under the canonical id at the next revision; and the losing tab edit then committed through a fresh snapshot with the canonical id intact on disk, on both tabs after reload, and in the export. ' +
      `Race evidence: ${JSON.stringify(raceEvidence)}`;
  } finally {
    for (const context of contexts) await context.close();
  }
});

// Downgrade a PASS to NOT RUN when the race obtained no provably stale
// capture: every asserted check passed, but the stale-rejection
// coverage did not run, and a PASS would claim it did. A FAIL is never
// downgraded — a real defect outranks a coverage gap. The exit code
// already treats NOT RUN as nonzero, so this can never read as success.
if (raceCoverageNotRun) {
  const entry = results.find((r) => r.id === 'V13-PLACES-01');
  if (entry && entry.status === 'PASS') {
    entry.status = 'NOT RUN';
    entry.detail = `${entry.detail} || RACE COVERAGE NOT RUN: ${raceCoverageNotRun}`;
    console.log(`NOT RUN  V13-PLACES-01 [race coverage] ${raceCoverageNotRun}`);
  }
}

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
