// store-v10-adoption.test.mjs — V10 Lane A: bounded adoption partition.
// A raw IndexedDB record may contain malformed collection entries (null,
// primitives, arrays) written by an older or foreign writer. Adoption must
// partition them into explicit recovery metadata (envelopeExtras.quarantine)
// instead of exposing them to the UI snapshot, where they crash rendering.
// Harness style follows store-v5.test.js (mock IDB/BC, [MOCK] markers).

globalThis.window = { confirm: () => true, alert: () => {} };
globalThis.confirm = window.confirm;
globalThis.alert = window.alert;
Object.defineProperty(globalThis, 'crypto', { value: { randomUUID: () => 'uuid-' + Math.random() }, configurable: true });

// BroadcastChannel mock with an instance registry so tests can fire the
// store's cross-tab sync handler.
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

// IDB mock (same shape as store-v5.test.js: get/put/abort, pending-count tx).
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

// Capture the last downloaded JSON payload (export / draft readback).
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

const store = await import('../js/store.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function baseData(overrides = {}) {
    return {
        goals: [], places: [], jobs: [], investments: [], habits: [], indicators: [],
        metadata: {},
        college: { timetable: [], assignments: [], exams: [], fees: [] },
        news: { sources: [], cache: [], manual: [] },
        ...overrides
    };
}
function record(data, extras = {}, revision = 1, generation = 'gen-v10') {
    return { id: 1, storageFormatVersion: 1, generation, revision, savedAt: new Date().toISOString(), data, envelopeExtras: extras };
}
function quarantineOf(extras) {
    return (extras && Array.isArray(extras.quarantine)) ? extras.quarantine : null;
}
function qEntries(q, path) { return (q || []).filter((e) => e.path === path); }

async function runTests() {
    let passed = 0; let failed = 0;
    const pass = (name) => { console.log('PASS [MOCK]:', name); passed++; };
    const fail = (name, err) => { console.error('FAIL [MOCK]:', name, err); failed++; };
    const check = (name, cond, detail) => { if (cond) pass(name); else fail(name, detail); };

    // --- 1. Initial-load partition: null + primitives + array entry, valid
    // neighbours keep order; nested college/news lists partitioned too.
    const goalA = { title: 'Goal A' };
    const goalB = { title: 'Goal B' };
    const feeOk = { label: 'Tuition' };
    const cacheOk = { id: 'story-1' };
    dbState = { 1: record(baseData({
        goals: [goalA, null, goalB, 42, 'text-entry', [1, 2]],
        college: { timetable: [], assignments: [], exams: [], fees: [null, feeOk] },
        news: { sources: [], cache: [cacheOk, null], manual: [] }
    }), { customKey: 'keep-me', legacyOriginalRaw: 'original-bytes' }) };
    const initRes = await store.initStore();
    check('Initial load of poisoned record stays ready (no crash)', initRes.status === 'ready', initRes);
    const snap1 = store.getData();
    check('Initial load exposes only valid goal entries, order preserved',
        snap1.goals.length === 2 && snap1.goals[0].title === 'Goal A' && snap1.goals[1].title === 'Goal B', snap1.goals);
    check('Nested college.fees partitioned', snap1.college.fees.length === 1 && snap1.college.fees[0].label === 'Tuition', snap1.college.fees);
    check('Nested news.cache partitioned', snap1.news.cache.length === 1 && snap1.news.cache[0].id === 'story-1', snap1.news.cache);

    // --- 2. Export readback shows the quarantine with path/index/value, and
    // unknown extras survive alongside it.
    lastDownloadText = null;
    await store.exportData();
    let envelope = null;
    try { envelope = JSON.parse(lastDownloadText); } catch (e) {}
    check('Export envelope parses', !!envelope, lastDownloadText);
    const q = envelope && quarantineOf(envelope);
    check('Export readback shows quarantine metadata', Array.isArray(q), envelope && Object.keys(envelope));
    if (Array.isArray(q)) {
        const gq = qEntries(q, 'goals');
        check('Quarantine records goals null at index 1', gq.some((e) => e.index === 1 && e.value === null), gq);
        check('Quarantine records goals primitive 42 at index 3', gq.some((e) => e.index === 3 && e.value === 42), gq);
        check('Quarantine records goals string at index 4', gq.some((e) => e.index === 4 && e.value === 'text-entry'), gq);
        check('Quarantine records nested college.fees null', qEntries(q, 'college.fees').some((e) => e.index === 0 && e.value === null), q);
        check('Quarantine records nested news.cache null', qEntries(q, 'news.cache').some((e) => e.index === 1 && e.value === null), q);
    }
    check('Export data itself is partitioned (re-importable shape)',
        !!envelope && envelope.data.goals.length === 2 && envelope.data.college.fees.length === 1, envelope && envelope.data);
    check('Unknown extras preserved in export envelope',
        !!envelope && envelope.customKey === 'keep-me' && envelope.legacyOriginalRaw === 'original-bytes', envelope && Object.keys(envelope || {}));

    // --- 3. Unrelated save + reload retains the quarantine on disk.
    const snap2 = store.getData();
    snap2.habits.push({ name: 'Unrelated habit' });
    const saveRes = await store.saveData(snap2);
    check('Unrelated save commits after poisoned adoption', saveRes.committed === true, saveRes);
    const diskQ = quarantineOf(dbState[1].envelopeExtras);
    check('Quarantine persisted on disk after unrelated save',
        Array.isArray(diskQ) && qEntries(diskQ, 'goals').length === 4 && qEntries(diskQ, 'college.fees').length === 1, dbState[1].envelopeExtras);
    check('Unknown extras persisted on disk after save',
        dbState[1].envelopeExtras.customKey === 'keep-me' && dbState[1].envelopeExtras.legacyOriginalRaw === 'original-bytes', dbState[1].envelopeExtras);
    check('Disk data after save holds only valid entries',
        dbState[1].data.goals.length === 2 && dbState[1].data.habits.length === 1, dbState[1].data);
    await store.initStore(); // reload
    const snap3 = store.getData();
    check('Reload after save keeps partitioned snapshot and habit',
        snap3.goals.length === 2 && snap3.habits.length === 1, { goals: snap3.goals, habits: snap3.habits });
    lastDownloadText = null;
    await store.exportData();
    let env3 = null;
    try { env3 = JSON.parse(lastDownloadText); } catch (e) {}
    check('Reload export still shows the same quarantine (no loss, no duplicates)',
        !!env3 && Array.isArray(quarantineOf(env3)) && quarantineOf(env3).length === (q ? q.length : -1), env3 && env3.quarantine);

    // --- 4. BroadcastChannel refresh adoption partitions a record poisoned
    // by another tab after this tab was already ready.
    const placeOk = { id: 'place_1234567890', title: 'Library' };
    const assignOk = { title: 'Assignment 1' };
    const before = store.getData();
    dbState[1] = record(baseData({
        goals: before.goals, habits: before.habits,
        places: [placeOk, 42, null],
        college: { timetable: [], assignments: [null, assignOk], exams: [], fees: [] }
    }), { customKey: 'keep-me' }, dbState[1].revision + 1);
    const bc = liveBc();
    check('Cross-tab channel handler registered', !!bc, bcInstances.length);
    if (bc) { bc.onmessage({ data: 'sync' }); await sleep(60); }
    const snap4 = store.getData();
    check('BroadcastChannel refresh adoption partitions places',
        snap4.places.length === 1 && snap4.places[0].title === 'Library', snap4.places);
    check('BroadcastChannel refresh adoption partitions college.assignments',
        snap4.college.assignments.length === 1 && snap4.college.assignments[0].title === 'Assignment 1', snap4.college.assignments);
    // The BC-carried quarantine must survive this tab's next save.
    const snap5 = store.getData();
    snap5.goals.push({ title: 'Post-sync goal' });
    const save5 = await store.saveData(snap5);
    const diskQ5 = quarantineOf(dbState[1].envelopeExtras);
    check('Save after BC adoption commits and keeps BC quarantine on disk',
        save5.committed === true && Array.isArray(diskQ5) &&
        qEntries(diskQ5, 'places').some((e) => e.index === 1 && e.value === 42) &&
        qEntries(diskQ5, 'places').some((e) => e.index === 2 && e.value === null) &&
        qEntries(diskQ5, 'college.assignments').some((e) => e.index === 0 && e.value === null),
        { save5, extras: dbState[1].envelopeExtras });

    // --- 5. Conflict adoption: a CAS-losing save adopts the authoritative
    // (poisoned) record partitioned, never raw.
    const snap6 = store.getData(); // token at current generation/revision
    const winnerGoal = { title: 'Winner goal' };
    dbState[1] = record(baseData({ goals: [winnerGoal, null] }), {}, dbState[1].revision + 5);
    let conflictErr = null;
    try { await store.saveData(snap6); } catch (e) { conflictErr = e; }
    check('CAS mismatch still rejects with Conflict', !!conflictErr && conflictErr.message.includes('Conflict'), conflictErr);
    const snap7 = store.getData();
    check('Conflict adoption exposes only the valid authoritative entry',
        snap7.goals.length === 1 && snap7.goals[0].title === 'Winner goal', snap7.goals);
    const snap8 = store.getData();
    snap8.goals.push({ title: 'After conflict' });
    const save8 = await store.saveData(snap8);
    const diskQ8 = quarantineOf(dbState[1].envelopeExtras);
    check('Conflict-adopted quarantine survives the next save',
        save8.committed === true && Array.isArray(diskQ8) &&
        qEntries(diskQ8, 'goals').some((e) => e.index === 1 && e.value === null),
        { save8, extras: dbState[1].envelopeExtras });

    // --- 6. Malformed collection shape: a non-array collection is treated
    // as empty and its raw value is quarantined at that path.
    dbState = { 1: record(baseData({ goals: 'not-an-array', jobs: [{ id: 'job-1', title: 'Engineer' }] })) };
    const init6 = await store.initStore();
    const snap9 = store.getData();
    check('Non-array collection recovers to empty array, store ready',
        init6.status === 'ready' && Array.isArray(snap9.goals) && snap9.goals.length === 0 && snap9.jobs.length === 1,
        { init6, goals: snap9.goals });
    const diskQ6 = quarantineOf(dbState[1].envelopeExtras);
    check('Non-array raw value quarantined at its path',
        Array.isArray(diskQ6) && qEntries(diskQ6, 'goals').some((e) => e.value === 'not-an-array'), dbState[1].envelopeExtras);

    // --- 7. Malformed root record: explicit recovery, never a ready crash.
    dbState = { 1: record(null) };
    const init7 = await store.initStore();
    let rootSnap = null; let rootThrew = null;
    try { rootSnap = store.getData(); } catch (e) { rootThrew = e; }
    check('Malformed root record recovers without throwing',
        init7.status === 'ready' && !rootThrew && !!rootSnap && Array.isArray(rootSnap.goals) && Array.isArray(rootSnap.college.assignments),
        { init7, rootThrew });
    const diskQ7 = quarantineOf(dbState[1].envelopeExtras);
    check('Malformed root raw value quarantined',
        Array.isArray(diskQ7) && qEntries(diskQ7, 'data').some((e) => e.value === null), dbState[1].envelopeExtras);

    console.log(`\nTests completed: ${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exit(1);
}

runTests();
