// repro-ag.mjs — Independent read-only QA reproduction of V12 contract
// audit acceptance gaps AG-1 (goals.history coercion), AG-2 (places id
// migration), AG-3 (metadata disk/memory divergence).
// Executes the REAL js/store.js from the v12-ag-repro clone at base
// 2eaa5268afc91d13df872bb709dec8179e9f2f94. The clone is imported
// read-only and never modified. Harness mocks copied from
// __tests__/store-v10-adoption.test.mjs (same pattern as Lane C audit).
//
// Per variant, three legs on fresh module instances:
//   A import   — strict importData of the case payload on a clean store;
//                captures committed flag, disk record, in-memory getData().
//                AG-3 additionally exports and then reloads (initStore).
//   B adoption — initStore on a stored record seeded with the case data;
//                captures getData(), disk record after init, quarantine,
//                and the exportData() envelope (plus a no-disk-write check).
//   C roundtrip— the exact leg-B export imported into a fresh clean store;
//                captures committed flag, disk record, getData(), and
//                whether the original raw value survives anywhere in the
//                post-roundtrip disk record.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RealURL = globalThis.URL;
// Published copy note: STORE_URL adjusted from '../v12-ag-repro/js/store.js'
// to the repo-relative path below so the script runs against this repo's
// js/store.js from docs/review/evidence/v12/. All other logic byte-identical
// to the QA lane original (base 2eaa5268 run record: repro-results.json).
const STORE_URL = new RealURL('../../../../js/store.js', import.meta.url);

// ---------------- mocks (from store-v10-adoption.test.mjs) ----------------
globalThis.window = { confirm: () => true, alert: () => {} };
globalThis.confirm = window.confirm;
globalThis.alert = window.alert;
Object.defineProperty(globalThis, 'crypto', { value: { randomUUID: () => 'uuid-' + Math.random() }, configurable: true });

const bcInstances = [];
globalThis.BroadcastChannel = class {
    constructor(name) { this.name = name; bcInstances.push(this); }
    postMessage() {}
    close() {}
};

let dbState = {};
globalThis.indexedDB = {
    open: () => {
        const req = {};
        setTimeout(() => {
            req.result = {
                objectStoreNames: { contains: () => true },
                transaction: (storeName, mode) => {
                    let aborted = false;
                    const tx = {
                        _pending: 0,
                        objectStore: () => ({
                            get: (id) => {
                                const greq = {};
                                tx._pending++;
                                setTimeout(() => {
                                    greq.result = dbState[id];
                                    if (greq.onsuccess) greq.onsuccess();
                                    tx._pending--;
                                    if (tx._pending === 0 && !aborted && tx.oncomplete) tx.oncomplete();
                                }, 1);
                                return greq;
                            },
                            put: (rec) => {
                                if (aborted) return;
                                tx._pending++;
                                dbState[rec.id] = rec;
                                setTimeout(() => {
                                    tx._pending--;
                                    if (tx._pending === 0 && !aborted && tx.oncomplete) tx.oncomplete();
                                }, 1);
                            }
                        }),
                        abort: () => {
                            if (aborted) return;
                            aborted = true;
                            if (tx.onabort) tx.onabort();
                        }
                    };
                    setTimeout(() => {
                        if (tx._pending === 0 && !aborted && tx.oncomplete) tx.oncomplete();
                    }, 5);
                    return tx;
                },
                close: () => {}
            };
            req.onsuccess();
        }, 1);
        return req;
    }
};

class Blob { constructor(parts) { this.parts = parts; } }
class File extends Blob { constructor(parts, filename) { super(parts); this.name = filename; } }
globalThis.Blob = Blob;
globalThis.File = File;
globalThis.FileReader = class {
    readAsText(input) {
        const text = typeof input === 'string' ? input
            : (input && Array.isArray(input.parts) ? input.parts.join('') : String(input && input.text !== undefined ? input.text : input));
        setTimeout(() => { if (this.onload) this.onload({ target: { result: text } }); }, 1);
    }
};
let lastDownloadText = null;
globalThis.URL = {
    createObjectURL: (blob) => { lastDownloadText = blob.parts[0]; return 'blob:test'; },
    revokeObjectURL: () => {}
};
globalThis.document = {
    createElement: () => ({ click: () => {}, style: {} }),
    body: { appendChild: () => {}, removeChild: () => {} }
};
globalThis.localStorage = { getItem: () => null };

// ---------------- helpers ----------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let instCounter = 0;
async function freshStore() {
    const url = new RealURL(STORE_URL.href);
    url.search = 'ag-inst=' + (++instCounter);
    return import(url.href);
}
const J = (v) => (v === undefined ? '__UNDEFINED__' : JSON.parse(JSON.stringify(v)));
function baseData(overrides = {}) {
    return {
        goals: [], places: [], jobs: [], investments: [], habits: [], indicators: [],
        metadata: {},
        college: { timetable: [], assignments: [], exams: [], fees: [] },
        news: { sources: [], cache: [], manual: [] },
        ...overrides
    };
}
function makeRecord(data, extras = {}, revision = 1, generation = 'gen-ag') {
    return { id: 1, storageFormatVersion: 1, generation, revision, savedAt: new Date().toISOString(), data, envelopeExtras: extras };
}
function envelopeText(data) {
    return JSON.stringify({ app: 'dashboard', schemaVersion: 1, exportedAt: '2026-10-22T00:00:00.000Z', data });
}
function importAsync(store, text) {
    return new Promise((resolve) => {
        let done = false;
        store.importData(text, (res) => { if (!done) { done = true; resolve(res); } });
        setTimeout(() => { if (!done) { done = true; resolve({ timeout: true }); } }, 2000);
    });
}
function diskRecord() { return dbState[1] ? J(dbState[1]) : null; }
function rawIn(value, haystack) {
    // Is the JSON encoding of `value` present anywhere in the haystack JSON?
    return JSON.stringify(haystack).includes(JSON.stringify(value));
}
const results = { base: '2eaa5268afc91d13df872bb709dec8179e9f2f94', gaps: {} };
function emit(section, obj) {
    console.log('\n### ' + section);
    console.log(JSON.stringify(obj, null, 1));
}

// Generic three-leg runner. getField(data) extracts the field under test
// from a data object; rawNeedle is the original value whose survival is
// tracked (null = track by field comparison instead).
async function runVariant(gapKey, variantName, caseData, getField, rawNeedle) {
    const out = { variant: variantName, inputData: J(caseData) };

    // ---- Leg A: strict import on a clean store
    dbState = {};
    const sA = await freshStore();
    const initA = await sA.initStore();
    const resA = await importAsync(sA, envelopeText(J(caseData)));
    await sleep(30);
    const diskA = diskRecord();
    out.legA_import = {
        initStatus: initA.status,
        committed: resA && resA.committed === true,
        error: resA && resA.error ? String(resA.error.message || resA.error) : null,
        diskField: diskA ? J(getField(diskA.data)) : null,
        diskQuarantine: diskA ? J(diskA.envelopeExtras && diskA.envelopeExtras.quarantine || null) : null,
        memoryField: J(getField(sA.getData()))
    };

    // ---- Leg A2 (AG-3 only): export right after import, then reload
    if (gapKey === 'AG-3') {
        lastDownloadText = null;
        await sA.exportData();
        const envA2 = lastDownloadText ? JSON.parse(lastDownloadText) : null;
        const diskBeforeReload = diskRecord();
        const initA2 = await sA.initStore(); // reload: init adoption repair runs
        await sleep(30);
        const diskAfterReload = diskRecord();
        out.legA_exportThenReload = {
            exportedField: envA2 ? J(getField(envA2.data)) : null,
            exportedQuarantine: envA2 ? J(envA2.quarantine || null) : null,
            diskFieldBeforeReload: diskBeforeReload ? J(getField(diskBeforeReload.data)) : null,
            reloadStatus: initA2.status,
            diskFieldAfterReload: diskAfterReload ? J(getField(diskAfterReload.data)) : null,
            diskQuarantineAfterReload: diskAfterReload ? J(diskAfterReload.envelopeExtras && diskAfterReload.envelopeExtras.quarantine || null) : null,
            memoryFieldAfterReload: J(getField(sA.getData())),
            rawValueInDiskRecordAfterReload: rawNeedle !== null ? rawIn(rawNeedle, diskAfterReload) : null,
            rawValueInQuarantineAfterReload: rawNeedle !== null ? rawIn(rawNeedle, (diskAfterReload && diskAfterReload.envelopeExtras && diskAfterReload.envelopeExtras.quarantine) || null) : null
        };
    }

    // ---- Leg B: adoption of a stored record carrying the case data
    dbState = { 1: makeRecord(J(caseData)) };
    const sB = await freshStore();
    const initB = await sB.initStore();
    await sleep(30);
    const diskB = diskRecord();
    const diskJsonBeforeExport = JSON.stringify(dbState[1]);
    lastDownloadText = null;
    await sB.exportData();
    const envB = lastDownloadText ? JSON.parse(lastDownloadText) : null;
    out.legB_adoption = {
        initStatus: initB.status,
        memoryField: J(getField(sB.getData())),
        diskFieldAfterInit: diskB ? J(getField(diskB.data)) : null,
        diskQuarantineAfterInit: diskB ? J(diskB.envelopeExtras && diskB.envelopeExtras.quarantine || null) : null,
        exportedField: envB ? J(getField(envB.data)) : null,
        exportedQuarantine: envB ? J(envB.quarantine || null) : null,
        exportWroteToDisk: JSON.stringify(dbState[1]) !== diskJsonBeforeExport
    };

    // ---- Leg C: roundtrip — import the exact leg-B export into a clean store
    const exportText = lastDownloadText;
    dbState = {};
    const sC = await freshStore();
    await sC.initStore();
    const resC = await importAsync(sC, exportText);
    await sleep(30);
    const diskC = diskRecord();
    out.legC_roundtrip = {
        committed: resC && resC.committed === true,
        error: resC && resC.error ? String(resC.error.message || resC.error) : null,
        diskField: diskC ? J(getField(diskC.data)) : null,
        diskQuarantine: diskC ? J(diskC.envelopeExtras && diskC.envelopeExtras.quarantine || null) : null,
        memoryField: J(getField(sC.getData())),
        rawValueInPostRoundtripDiskRecord: rawNeedle !== null ? rawIn(rawNeedle, diskC) : null,
        rawValueInSourceExportFile: rawNeedle !== null ? exportText.includes(JSON.stringify(rawNeedle)) : null
    };

    results.gaps[gapKey] = results.gaps[gapKey] || { variants: [] };
    results.gaps[gapKey].variants.push(out);
    emit(gapKey + ' / ' + variantName, out);
    return out;
}

// ================= AG-1: goals.history =================
const goalField = (d) => (d.goals && d.goals[0] ? ('history' in d.goals[0] ? d.goals[0].history : '__MISSING__') : '__NO_GOAL__');
await runVariant('AG-1', 'history-string', baseData({ goals: [{ title: 'Goal H', history: 'bad-history' }] }), goalField, 'bad-history');
await runVariant('AG-1', 'history-number', baseData({ goals: [{ title: 'Goal H', history: 42 }] }), goalField, 42);
await runVariant('AG-1', 'history-missing', baseData({ goals: [{ title: 'Goal H' }] }), goalField, null);

// ================= AG-2: places ids =================
const placeIds = (d) => (d.places || []).map((p) => ('id' in p ? p.id : '__MISSING__'));
await runVariant('AG-2', 'id-missing', baseData({ places: [{ title: 'No id place' }] }), placeIds, null);
await runVariant('AG-2', 'id-short', baseData({ places: [{ id: 'short', title: 'Short id place' }] }), placeIds, 'short');
await runVariant('AG-2', 'id-numeric', baseData({ places: [{ id: 12345, title: 'Numeric id place' }] }), placeIds, 12345);
await runVariant('AG-2', 'id-duplicate', baseData({ places: [{ id: 'place_1234567890', title: 'First' }, { id: 'place_1234567890', title: 'Second' }] }), placeIds, null);

// ================= AG-3: metadata =================
const metaField = (d) => ('metadata' in d ? d.metadata : '__MISSING__');
await runVariant('AG-3', 'metadata-string', baseData({ metadata: 'meta-string' }), metaField, 'meta-string');
await runVariant('AG-3', 'metadata-array', baseData({ metadata: [1, 2] }), metaField, [1, 2]);

await writeFile(path.join(HERE, 'repro-results.json'), JSON.stringify(results, null, 1));
console.log('\n### DONE — structured evidence written to repro-results.json');
