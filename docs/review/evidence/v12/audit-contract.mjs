// audit-contract.mjs — Lane C (V12) read-only contract audit.
// Executes the REAL js/store.js from the v12-audit clone (commit 2eaa5268)
// through three behaviours per case:
//   (a) strict import acceptance via the public importData path,
//   (b) stored-record adoption outcome via initStore -> syncFromRecord
//       partition (exposed getData snapshot + disk quarantine),
//   (c) export -> import roundtrip of the adoption-repaired export.
// Harness mocks copied from __tests__/store-v10-adoption.test.mjs.
// This script writes ONLY audit-results.json next to itself. The clone
// is imported read-only and never modified.
// Published copy (docs/review/evidence/v12/): the single path adjustment
// vs the original workspace script is STORE_URL below, which resolves the
// repo's js/store.js relative to this location ('../../../../js/store.js').
// All probe logic is unchanged.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RealURL = globalThis.URL; // captured before the download mock replaces globalThis.URL
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
function liveBc() {
    for (let i = bcInstances.length - 1; i >= 0; i--) {
        if (typeof bcInstances[i].onmessage === 'function') return bcInstances[i];
    }
    return null;
}

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
const MISSING = Symbol('missing');
let instCounter = 0;
async function freshStore() {
    const url = new RealURL(STORE_URL.href);
    url.search = 'audit-inst=' + (++instCounter);
    return import(url.href);
}
function clone(v) {
    if (v === MISSING) return MISSING;
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}
function snap(v) {
    if (v === undefined) return '__UNDEFINED__';
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return '__UNSERIALIZABLE__:' + String(v); }
}
function baseData(overrides = {}) {
    return {
        goals: [], places: [], jobs: [], investments: [], habits: [], indicators: [],
        metadata: {},
        college: { timetable: [], assignments: [], exams: [], fees: [] },
        news: { sources: [], cache: [], manual: [] },
        ...overrides
    };
}
function makeRecord(data, extras = {}, revision = 1, generation = 'gen-audit') {
    const rec = { id: 1, storageFormatVersion: 1, generation, revision, savedAt: new Date().toISOString(), envelopeExtras: extras };
    if (data !== MISSING) rec.data = data;
    return rec;
}
function getPath(obj, p) {
    if (p === 'data') return obj;
    let cur = obj;
    for (const seg of p.split('.')) {
        if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
        cur = cur[seg];
    }
    return cur;
}
function hasPath(obj, p) {
    if (p === 'data') return obj !== undefined;
    let cur = obj;
    for (const seg of p.split('.')) {
        if (cur === null || cur === undefined || typeof cur !== 'object') return false;
        if (!(seg in cur)) return false;
        cur = cur[seg];
    }
    return true;
}
function setPath(data, p, value) {
    const segs = p.split('.');
    let cur = data;
    for (let i = 0; i < segs.length - 1; i++) cur = cur[segs[i]];
    if (value === MISSING) delete cur[segs[segs.length - 1]];
    else cur[segs[segs.length - 1]] = value;
}
function quarantineOf(holder) {
    const q = holder && holder.envelopeExtras ? holder.envelopeExtras.quarantine
        : (holder && Array.isArray(holder.quarantine) ? holder.quarantine : undefined);
    return q === undefined ? null : snap(q);
}
function envelopeQuarantine(env) {
    return env && Array.isArray(env.quarantine) ? snap(env.quarantine) : null;
}
function doImport(store, text) {
    return new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => { if (!done) { done = true; resolve({ committed: null, error: 'TIMEOUT' }); } }, 4000);
        try {
            store.importData(text, (res) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve({
                    committed: res && res.committed === true,
                    cancelled: !!(res && res.cancelled),
                    conflict: !!(res && res.conflict),
                    error: res && res.error ? String(res.error.message || res.error) : null
                });
            });
        } catch (e) {
            if (!done) { done = true; clearTimeout(timer); resolve({ committed: null, error: 'THROW:' + e.message }); }
        }
    });
}
function envelopeTextFor(data) {
    const env = { app: 'dashboard', schemaVersion: 1, exportedAt: '2026-10-22T00:00:00.000Z' };
    if (data !== MISSING) env.data = data;
    return JSON.stringify(env);
}
function neighbourFor(p) {
    const leaf = p.split('.').pop();
    if (p === 'goals') return { title: 'ok-goal', history: [] };
    if (p === 'places') return { id: 'place_1234567890', title: 'ok-place' };
    if (p === 'jobs') return { id: 'job-ok', title: 'OK Job' };
    return { marker: 'ok-' + leaf };
}

// ---------------- case definitions ----------------
const TOP = ['goals', 'places', 'jobs', 'investments', 'habits', 'indicators'];
const COLLEGE = ['college.timetable', 'college.assignments', 'college.exams', 'college.fees'];
const NEWS = ['news.sources', 'news.cache', 'news.manual'];
const ALL_COLL = [...TOP, ...COLLEGE, ...NEWS];

const cases = [];
function addCase(id, family, relPath, build, opts = {}) {
    cases.push({ id, family, relPath, build, root: !!opts.root });
}

// F1: entry-shape variants x every collection path. build returns full data.
const BAD_ENTRIES = [
    ['null', null], ['primitive-number', 42], ['primitive-string', 'text-entry'],
    ['array', [1, 2]], ['empty-object', {}]
];
for (const p of ALL_COLL) {
    for (const [label, bad] of BAD_ENTRIES) {
        addCase(`entry-${p}-${label}`, 'F1-entry-shape', p, () => {
            const d = baseData();
            setPath(d, p, [neighbourFor(p), clone(bad)]);
            return d;
        });
    }
}
// F3: collection-value variants x every collection path.
const BAD_COLLS = [['null', null], ['non-array-string', 'not-an-array'], ['missing', MISSING]];
for (const p of ALL_COLL) {
    for (const [label, val] of BAD_COLLS) {
        addCase(`coll-${p}-${label}`, 'F3-collection-value', p, () => {
            const d = baseData();
            setPath(d, p, val === MISSING ? MISSING : clone(val));
            return d;
        });
    }
}
// F2: jobs required-field variants (single entry unless noted).
const JOB_VARIANTS = [
    ['missing-title', { id: 'orphan' }],
    ['missing-id', { title: 'No Id Job' }],
    ['empty-string-id', { id: '', title: 'T' }],
    ['empty-string-title', { id: 'job-x', title: '' }],
    ['null-id', { id: null, title: 'T' }],
    ['null-title', { id: 'job-x', title: null }],
    ['zero-id', { id: 0, title: 'T' }],
    ['zero-title', { id: 'job-x', title: 0 }],
    ['numeric-id-control', { id: 123, title: 'T' }],
    ['extra-key-control', { id: 'job-x', title: 'T', extra: 'e' }]
];
for (const [label, entry] of JOB_VARIANTS) {
    addCase(`jobs-field-${label}`, 'F2-jobs-required-fields', 'jobs', () => baseData({ jobs: [clone(entry)] }));
}
addCase('jobs-field-missing-title-with-neighbour', 'F2-jobs-required-fields', 'jobs',
    () => baseData({ jobs: [{ id: 'job-ok', title: 'OK Job' }, { id: 'orphan' }] }));
// F4: goals history variants.
const HISTORY_VARIANTS = [
    ['string', 'bad-history'], ['number', 42], ['null', null],
    ['object', { note: 'x' }], ['missing', MISSING],
    ['empty-array-control', []], ['array-control', ['2026-01-01']]
];
for (const [label, h] of HISTORY_VARIANTS) {
    addCase(`goals-history-${label}`, 'F4-goals-history', 'goals', () => {
        const g = { title: 'g-history' };
        if (h !== MISSING) g.history = clone(h);
        return baseData({ goals: [g] });
    });
}
// F5: group-value variants (college / news whole value + subcollection object).
for (const g of ['college', 'news']) {
    for (const [label, val] of [['null', null], ['string', 'text-group'], ['array', [1]], ['missing', MISSING]]) {
        addCase(`group-${g}-${label}`, 'F5-group-value', g, () => {
            const d = baseData();
            if (val === MISSING) delete d[g]; else d[g] = clone(val);
            return d;
        });
    }
}
addCase('group-college-timetable-object', 'F5-group-value', 'college.timetable', () => {
    const d = baseData(); d.college.timetable = { a: 1 }; return d;
});
addCase('group-news-cache-object', 'F5-group-value', 'news.cache', () => {
    const d = baseData(); d.news.cache = { a: 1 }; return d;
});
// F6: metadata variants.
const META_VARIANTS = [
    ['missing', MISSING], ['empty-object-control', {}], ['null', null],
    ['string', 'meta-string'], ['number', 42], ['array', [1, 2]], ['boolean-true', true]
];
for (const [label, mv] of META_VARIANTS) {
    addCase(`metadata-${label}`, 'F6-metadata', 'metadata', () => {
        const d = baseData();
        if (mv === MISSING) delete d.metadata; else d.metadata = clone(mv);
        return d;
    });
}
// F7: root data value variants (build returns the raw root value itself).
for (const [label, rv] of [['null', null], ['string', 'raw-string'], ['array', [1, 2]], ['number', 42], ['missing', MISSING]]) {
    addCase(`root-${label}`, 'F7-root', 'data', () => clone(rv), { root: true });
}
// F8: places id variants (whole places collection is the input).
const PLACE_VARIANTS = [
    ['missing-id', [{ title: 'No id place' }]],
    ['short-id', [{ id: 'short', title: 'Short id' }]],
    ['numeric-id', [{ id: 12345, title: 'Numeric id' }]],
    ['duplicate-ids', [
        { id: 'place_1234567890', title: 'First' },
        { id: 'place_1234567890', title: 'Second' }
    ]],
    ['valid-control', [{ id: 'place_1234567890', title: 'Valid' }]],
    ['valid-with-extra', [{ id: 'place_1234567890', title: 'Valid', extra: 'e' }]]
];
for (const [label, places] of PLACE_VARIANTS) {
    addCase(`places-id-${label}`, 'F8-places-id', 'places', () => baseData({ places: clone(places) }));
}
// F9: unknown extra keys.
addCase('extra-top-level-key', 'F9-extra-keys', 'customTop', () => {
    const d = baseData(); d.customTop = { x: 1 }; return d;
});
addCase('extra-college-group-key', 'F9-extra-keys', 'college', () => {
    const d = baseData(); d.college.extraCollegeKey = 'cv'; return d;
});
addCase('extra-news-group-key', 'F9-extra-keys', 'news', () => {
    const d = baseData(); d.news.extraNewsKey = 'nv'; return d;
});
addCase('extra-goal-entry-key', 'F9-extra-keys', 'goals', () =>
    baseData({ goals: [{ title: 'g', history: [], extraField: 'e' }] }));
// F10: sparse shapes.
addCase('sparse-empty-data-object', 'F10-sparse', 'data', () => ({}));
addCase('sparse-college-empty-object', 'F10-sparse', 'college', () => {
    const d = baseData(); d.college = {}; return d;
});
addCase('sparse-news-empty-object', 'F10-sparse', 'news', () => {
    const d = baseData(); d.news = {}; return d;
});

// ---------------- probe runner ----------------
async function runCase(c) {
    const out = { id: c.id, family: c.family, relPath: c.relPath };
    // ---- (a) strict import acceptance on a fresh clean instance
    try {
        const sA = await freshStore();
        dbState = { 1: makeRecord(baseData()) };
        const initA = await sA.initStore();
        out.a_initStatus = initA.status;
        const built = c.root ? c.build() : c.build();
        const resA = await doImport(sA, envelopeTextFor(built));
        out.a_committed = resA.committed;
        out.a_error = resA.error;
        const diskA = dbState[1] ? dbState[1].data : undefined;
        out.a_diskRelevant = snap(getPath(diskA, c.relPath));
        out.a_diskRelevantPresent = diskA && typeof diskA === 'object' ? hasPath(diskA, c.relPath) : null;
        out.a_memRelevant = snap(getPath(sA.getData(), c.relPath));
        // reload the same instance: does a later adoption change the shape?
        await sA.initStore();
        out.a_memRelevantAfterReload = snap(getPath(sA.getData(), c.relPath));
        const diskA2 = dbState[1] ? dbState[1].data : undefined;
        out.a_diskRelevantAfterReload = snap(getPath(diskA2, c.relPath));
        out.a_diskQuarantineAfterReload = quarantineOf(dbState[1]);
    } catch (e) {
        out.a_throw = String(e && e.message || e);
    }
    // ---- (b) adoption outcome on a fresh instance seeded with the case record
    let exportText = null;
    try {
        const sB = await freshStore();
        const builtB = c.build();
        dbState = { 1: makeRecord(builtB === MISSING ? MISSING : builtB) };
        const initB = await sB.initStore();
        out.b_initStatus = initB.status;
        out.b_memRelevant = snap(getPath(sB.getData(), c.relPath));
        const diskB = dbState[1] ? dbState[1].data : undefined;
        out.b_diskRelevant = snap(getPath(diskB, c.relPath));
        out.b_diskRelevantPresent = diskB && typeof diskB === 'object' ? hasPath(diskB, c.relPath) : (dbState[1] && !('data' in dbState[1]) ? false : null);
        out.b_diskQuarantine = quarantineOf(dbState[1]);
        const diskBeforeExport = JSON.stringify(dbState[1] || null);
        lastDownloadText = null;
        await sB.exportData();
        out.b_exportWroteDisk = JSON.stringify(dbState[1] || null) !== diskBeforeExport;
        exportText = lastDownloadText;
        const env = exportText ? JSON.parse(exportText) : null;
        out.b_exportRelevant = env ? snap(getPath(env.data, c.relPath)) : null;
        out.b_exportRelevantPresent = env && env.data && typeof env.data === 'object' ? hasPath(env.data, c.relPath) : null;
        out.b_exportDataKeys = env && env.data && typeof env.data === 'object' ? Object.keys(env.data) : null;
        out.b_exportQuarantine = env ? envelopeQuarantine(env) : null;
        out.exportText = exportText;
    } catch (e) {
        out.b_throw = String(e && e.message || e);
    }
    // ---- (c) roundtrip: import the exact export into a fresh clean instance
    try {
        if (exportText) {
            const sC = await freshStore();
            dbState = { 1: makeRecord(baseData()) };
            await sC.initStore();
            const resC = await doImport(sC, exportText);
            out.c_committed = resC.committed;
            out.c_error = resC.error;
            out.c_memRelevant = snap(getPath(sC.getData(), c.relPath));
            out.c_diskQuarantine = quarantineOf(dbState[1]);
        } else {
            out.c_committed = null;
            out.c_error = 'NO_EXPORT_TEXT';
        }
    } catch (e) {
        out.c_throw = String(e && e.message || e);
    }
    return out;
}

// BC spot-check: jobs orphan adopted via BroadcastChannel on a ready tab.
async function runBcSpotCheck() {
    const out = { id: 'bc-jobs-orphan', family: 'F11-bc-spotcheck', relPath: 'jobs' };
    try {
        const s = await freshStore();
        dbState = { 1: makeRecord(baseData()) };
        await s.initStore();
        dbState[1] = makeRecord(baseData({ jobs: [{ id: 'orphan' }] }), {}, dbState[1].revision + 1);
        const bc = liveBc();
        out.bc_handlerFound = !!bc;
        if (bc) { bc.onmessage({ data: 'sync' }); await sleep(80); }
        out.bc_memJobs = snap(s.getData().jobs);
        lastDownloadText = null;
        await s.exportData();
        const env = lastDownloadText ? JSON.parse(lastDownloadText) : null;
        out.bc_exportJobs = env ? snap(env.data.jobs) : null;
        out.bc_exportQuarantine = env ? envelopeQuarantine(env) : null;
        out.exportText = lastDownloadText;
        if (lastDownloadText) {
            const sC = await freshStore();
            dbState = { 1: makeRecord(baseData()) };
            await sC.initStore();
            const resC = await doImport(sC, lastDownloadText);
            out.c_committed = resC.committed;
            out.c_error = resC.error;
        }
    } catch (e) {
        out.bc_throw = String(e && e.message || e);
    }
    return out;
}

const results = [];
for (const c of cases) {
    const r = await runCase(c);
    delete r.exportText; // keep the JSON evidence compact; text is reproducible
    results.push(r);
    console.log(`[${results.length}/${cases.length + 1}] ${r.id} a=${r.a_committed} c=${r.c_committed}${r.a_throw || r.b_throw || r.c_throw ? ' THROW' : ''}`);
}
const bc = await runBcSpotCheck();
const bcText = bc.exportText;
delete bc.exportText;
results.push(bc);
console.log(`[${results.length}/${cases.length + 1}] ${bc.id} bcMem=${JSON.stringify(bc.bc_memJobs)} c=${bc.c_committed}`);

const summary = {
    totalProbes: results.length,
    aCommitted: results.filter((r) => r.a_committed === true).length,
    aRejected: results.filter((r) => r.a_committed === false).length,
    cCommitted: results.filter((r) => r.c_committed === true).length,
    cFailed: results.filter((r) => r.c_committed === false).length,
    throws: results.filter((r) => r.a_throw || r.b_throw || r.c_throw || r.bc_throw).map((r) => r.id)
};
console.log('\nSUMMARY', JSON.stringify(summary, null, 2));
await writeFile(path.join(HERE, 'audit-results.json'), JSON.stringify({ summary, results }, null, 2));
console.log('Wrote', path.join(HERE, 'audit-results.json'));
