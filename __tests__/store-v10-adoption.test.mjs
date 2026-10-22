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

// FileReader mock for importData round-trip tests (V11 sections).
globalThis.FileReader = class {
    readAsText(input) {
        const text = typeof input === 'string' ? input
            : (input && Array.isArray(input.parts) ? input.parts.join('') : String(input && input.text !== undefined ? input.text : input));
        setTimeout(() => { if (this.onload) this.onload({ target: { result: text } }); }, 1);
    }
};

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

    // --- 8. V11 (a)+(d)+(e): BroadcastChannel adoption partitions the
    // in-memory snapshot, but the disk record stays raw. An export with
    // NO intervening save must still export the partitioned snapshot:
    // one internally consistent selected record, not raw disk data
    // paired with the correct in-memory quarantine.
    const jobOk = { id: 'job-v11-1', title: 'Field Engineer' };
    const goalOk = { title: 'V11 Goal' };
    dbState = { 1: record(baseData({ goals: [{ title: 'Clean boot goal' }] })) };
    const init8 = await store.initStore();
    check('V11 clean boot is ready', init8.status === 'ready', init8);
    dbState[1] = record(baseData({
        goals: [goalOk, 42],
        jobs: [jobOk, null]
    }), { diskOnlyKey: 'v11-disk' }, dbState[1].revision + 1);
    const bc8 = liveBc();
    check('V11 cross-tab channel handler registered', !!bc8, bcInstances.length);
    if (bc8) { bc8.onmessage({ data: 'sync' }); await sleep(60); }
    const snapV11 = store.getData();
    check('V11 BC adoption partitions the in-memory snapshot',
        snapV11.goals.length === 1 && snapV11.goals[0].title === 'V11 Goal' &&
        snapV11.jobs.length === 1 && snapV11.jobs[0].id === 'job-v11-1',
        { goals: snapV11.goals, jobs: snapV11.jobs });
    const diskBefore8 = JSON.stringify(dbState[1]);
    lastDownloadText = null;
    await store.exportData();
    check('V11 export performs no disk write (BC-adopted raw record untouched)',
        JSON.stringify(dbState[1]) === diskBefore8, dbState[1]);
    let env8 = null;
    try { env8 = JSON.parse(lastDownloadText); } catch (e) {}
    check('V11 export envelope keeps the standard shape',
        !!env8 && env8.app === 'dashboard' && env8.schemaVersion === 1 && typeof env8.exportedAt === 'string', env8 && Object.keys(env8));
    check('V11 export with no intervening save contains no malformed entries',
        !!env8 && env8.data.goals.length === 1 && env8.data.goals[0].title === 'V11 Goal' &&
        env8.data.jobs.length === 1 && env8.data.jobs[0].id === 'job-v11-1',
        env8 && env8.data);
    const q8 = env8 && quarantineOf(env8);
    check('V11 export quarantine exactly matches the malformed entries',
        Array.isArray(q8) && q8.length === 2 &&
        qEntries(q8, 'goals').some((e) => e.index === 1 && e.value === 42) &&
        qEntries(q8, 'jobs').some((e) => e.index === 1 && e.value === null),
        q8);
    check('V11 unknown extras of the selected record survive export',
        !!env8 && env8.diskOnlyKey === 'v11-disk', env8 && Object.keys(env8 || {}));

    // --- 9. V11 (b): that exact export passes the app's own strict import
    // validation and round-trips with data and quarantine preserved.
    let importRes = null;
    store.importData(lastDownloadText, (res) => { importRes = res; });
    await sleep(120);
    check('V11 exact export imports successfully (committed)',
        !!importRes && importRes.committed === true, importRes);
    const snap9v11 = store.getData();
    check('V11 import round-trip preserves valid neighbours and order',
        snap9v11.goals.length === 1 && snap9v11.goals[0].title === 'V11 Goal' &&
        snap9v11.jobs.length === 1 && snap9v11.jobs[0].id === 'job-v11-1' && snap9v11.jobs[0].title === 'Field Engineer',
        { goals: snap9v11.goals, jobs: snap9v11.jobs });
    const diskQ9 = quarantineOf(dbState[1].envelopeExtras);
    check('V11 import round-trip preserves the quarantine on disk',
        Array.isArray(diskQ9) && diskQ9.length === 2 &&
        qEntries(diskQ9, 'goals').some((e) => e.index === 1 && e.value === 42) &&
        qEntries(diskQ9, 'jobs').some((e) => e.index === 1 && e.value === null),
        dbState[1].envelopeExtras);
    check('V11 import round-trip preserves unknown extras on disk',
        dbState[1].envelopeExtras.diskOnlyKey === 'v11-disk', dbState[1].envelopeExtras);

    // --- 10. V11 (c)+(d)+(e): the disk record is newer than the cache and
    // no adoption runs in between. Export must select the disk record:
    // its latest valid data, partitioned, with its own quarantine and
    // unknown extras — never the stale cache, never raw disk data.
    const newerGoal = { title: 'Newer disk goal' };
    const newerJob = { id: 'job-v11-2', title: 'Newer Job' };
    dbState[1] = record(baseData({
        goals: [newerGoal],
        jobs: [newerJob, 'junk-entry']
    }), { quarantine: [{ path: 'places', index: 0, value: null }], newerDiskKey: 'newer-value' },
        dbState[1].revision + 5, dbState[1].generation);
    const diskBefore10 = JSON.stringify(dbState[1]);
    lastDownloadText = null;
    await store.exportData();
    check('V11 export performs no disk write (newer record untouched)',
        JSON.stringify(dbState[1]) === diskBefore10, dbState[1]);
    let env10 = null;
    try { env10 = JSON.parse(lastDownloadText); } catch (e) {}
    check('V11 export selects the newer disk data, not the stale cache',
        !!env10 && env10.data.goals.length === 1 && env10.data.goals[0].title === 'Newer disk goal' &&
        env10.data.jobs.length === 1 && env10.data.jobs[0].id === 'job-v11-2',
        env10 && env10.data);
    const q10 = env10 && quarantineOf(env10);
    check('V11 export of newer record merges its quarantine with the new partition findings',
        Array.isArray(q10) && q10.length === 2 &&
        qEntries(q10, 'places').some((e) => e.index === 0 && e.value === null) &&
        qEntries(q10, 'jobs').some((e) => e.index === 1 && e.value === 'junk-entry'),
        q10);
    check('V11 unknown extras of the newer record survive export',
        !!env10 && env10.newerDiskKey === 'newer-value', env10 && Object.keys(env10 || {}));
    const snapAfter10 = store.getData();
    check('V11 export does not adopt or mutate the in-memory cache',
        snapAfter10.goals.length === 1 && snapAfter10.goals[0].title === 'V11 Goal' &&
        snapAfter10.jobs.length === 1 && snapAfter10.jobs[0].id === 'job-v11-1',
        { goals: snapAfter10.goals, jobs: snapAfter10.jobs });

    // --- 11. V11 (f): no-record fallback export is unchanged: in-memory
    // snapshot plus in-memory extras.
    dbState = {};
    const memSnap = store.getData();
    lastDownloadText = null;
    await store.exportData();
    let env11 = null;
    try { env11 = JSON.parse(lastDownloadText); } catch (e) {}
    check('V11 no-record fallback exports the in-memory snapshot',
        !!env11 && JSON.stringify(env11.data) === JSON.stringify(memSnap), env11 && env11.data);
    check('V11 no-record fallback exports the in-memory quarantine',
        !!env11 && Array.isArray(quarantineOf(env11)) && quarantineOf(env11).length === 2, env11 && env11.quarantine);

    // --- 12. V12: jobs entries that are objects but fail the strict
    // import invariant (truthy id AND truthy title) are partitioned at
    // adoption, exactly like malformed entries. The jobs rule is the
    // only per-entry invariant beyond object shape in
    // validateImportData; no other collection gains a new constraint.
    const jobV12A = { id: 'job-v12-a', title: 'Alpha Job' };
    const jobV12B = { id: 'job-v12-b', title: 'Beta Job' };
    const orphanNoTitle = { id: 'orphan' };
    const orphanNoId = { title: 'No Id Job' };
    const orphanEmptyTitle = { id: 'job-v12-x', title: '' };
    const orphanEmptyId = { id: '', title: 'Empty Id Job' };
    const priorQ12 = { path: 'places', index: 0, value: null };
    dbState = { 1: record(baseData({
        jobs: [jobV12A, orphanNoTitle, orphanNoId, orphanEmptyTitle, orphanEmptyId, jobV12B]
    }), { quarantine: [priorQ12], v12Key: 'keep-v12' }) };
    const init12 = await store.initStore();
    check('V12 initial load of shape-invalid jobs stays ready', init12.status === 'ready', init12);
    const snap12 = store.getData();
    check('V12 initial load keeps only import-valid jobs, order preserved',
        snap12.jobs.length === 2 && snap12.jobs[0].id === 'job-v12-a' && snap12.jobs[1].id === 'job-v12-b', snap12.jobs);
    const diskQ12 = quarantineOf(dbState[1].envelopeExtras);
    check('V12 rejected jobs are quarantined verbatim at their indices',
        Array.isArray(diskQ12) &&
        qEntries(diskQ12, 'jobs').some((e) => e.index === 1 && JSON.stringify(e.value) === JSON.stringify(orphanNoTitle)) &&
        qEntries(diskQ12, 'jobs').some((e) => e.index === 2 && JSON.stringify(e.value) === JSON.stringify(orphanNoId)) &&
        qEntries(diskQ12, 'jobs').some((e) => e.index === 3 && JSON.stringify(e.value) === JSON.stringify(orphanEmptyTitle)) &&
        qEntries(diskQ12, 'jobs').some((e) => e.index === 4 && JSON.stringify(e.value) === JSON.stringify(orphanEmptyId)),
        diskQ12);
    check('V12 pre-existing quarantine and unknown extras survive initial adoption',
        Array.isArray(diskQ12) && qEntries(diskQ12, 'places').some((e) => e.index === 0 && e.value === null) &&
        dbState[1].envelopeExtras.v12Key === 'keep-v12',
        dbState[1].envelopeExtras);

    // --- 13. V12: BroadcastChannel adoption partitions shape-invalid
    // jobs; export BEFORE any save carries only valid jobs, and that
    // exact export passes the module's own strict import.
    const jobV12C = { id: 'job-v12-c', title: 'Gamma Job' };
    const jobV12D = { id: 'job-v12-d', title: 'Delta Job' };
    const orphanBc = { title: 'BC Missing Id' };
    dbState[1] = record(baseData({ jobs: [jobV12C, orphanBc, jobV12D] }),
        { quarantine: [priorQ12], v12BcKey: 'keep-bc' }, dbState[1].revision + 1);
    const bc13 = liveBc();
    check('V12 cross-tab channel handler registered', !!bc13, bcInstances.length);
    if (bc13) { bc13.onmessage({ data: 'sync' }); await sleep(60); }
    const snap13 = store.getData();
    check('V12 BC adoption partitions shape-invalid jobs, neighbours keep order',
        snap13.jobs.length === 2 && snap13.jobs[0].id === 'job-v12-c' && snap13.jobs[1].id === 'job-v12-d', snap13.jobs);
    const diskBefore13 = JSON.stringify(dbState[1]);
    lastDownloadText = null;
    await store.exportData();
    check('V12 export before save performs no disk write', JSON.stringify(dbState[1]) === diskBefore13, dbState[1]);
    let env13 = null;
    try { env13 = JSON.parse(lastDownloadText); } catch (e) {}
    const q13 = env13 && quarantineOf(env13);
    check('V12 export before save contains only import-valid jobs',
        !!env13 && env13.data.jobs.length === 2 && env13.data.jobs[0].id === 'job-v12-c' && env13.data.jobs[1].id === 'job-v12-d',
        env13 && env13.data);
    check('V12 export quarantine holds the rejected original plus prior entries and unknown extras',
        Array.isArray(q13) &&
        qEntries(q13, 'jobs').some((e) => e.index === 1 && JSON.stringify(e.value) === JSON.stringify(orphanBc)) &&
        qEntries(q13, 'places').some((e) => e.index === 0 && e.value === null) &&
        env13.v12BcKey === 'keep-bc',
        q13);
    let importRes13 = null;
    store.importData(lastDownloadText, (res) => { importRes13 = res; });
    await sleep(120);
    check('V12 exact export passes strict import (committed)',
        !!importRes13 && importRes13.committed === true, importRes13);
    const snap13b = store.getData();
    check('V12 clean reimport preserves valid jobs and order',
        snap13b.jobs.length === 2 && snap13b.jobs[0].id === 'job-v12-c' && snap13b.jobs[1].id === 'job-v12-d', snap13b.jobs);
    const diskQ13 = quarantineOf(dbState[1].envelopeExtras);
    check('V12 reimport keeps quarantine and unknown extras on disk',
        Array.isArray(diskQ13) &&
        qEntries(diskQ13, 'jobs').some((e) => e.index === 1 && JSON.stringify(e.value) === JSON.stringify(orphanBc)) &&
        qEntries(diskQ13, 'places').some((e) => e.index === 0 && e.value === null) &&
        dbState[1].envelopeExtras.v12BcKey === 'keep-bc',
        dbState[1].envelopeExtras);
    const snap13c = store.getData();
    snap13c.habits.push({ name: 'V12 unrelated habit' });
    const save13 = await store.saveData(snap13c);
    await store.initStore(); // reload
    lastDownloadText = null;
    await store.exportData();
    let env13b = null;
    try { env13b = JSON.parse(lastDownloadText); } catch (e) {}
    const q13b = env13b && quarantineOf(env13b);
    check('V12 quarantine survives unrelated save, reload and second export',
        save13.committed === true && Array.isArray(q13b) &&
        qEntries(q13b, 'jobs').some((e) => e.index === 1 && JSON.stringify(e.value) === JSON.stringify(orphanBc)) &&
        qEntries(q13b, 'places').some((e) => e.index === 0 && e.value === null) &&
        !!env13b && env13b.data.jobs.length === 2,
        { save13, q13b });

    // --- 14. V12: conflict adoption partitions shape-invalid jobs too.
    const jobV12E = { id: 'job-v12-e', title: 'Epsilon Job' };
    const orphanConflict = { id: 'orphan-conflict' };
    const snap14 = store.getData();
    dbState[1] = record(baseData({ jobs: [orphanConflict, jobV12E] }), {}, dbState[1].revision + 5);
    let conflictErr14 = null;
    try { await store.saveData(snap14); } catch (e) { conflictErr14 = e; }
    check('V12 CAS mismatch still rejects with Conflict', !!conflictErr14 && conflictErr14.message.includes('Conflict'), conflictErr14);
    const snap14b = store.getData();
    check('V12 conflict adoption exposes only the import-valid job',
        snap14b.jobs.length === 1 && snap14b.jobs[0].id === 'job-v12-e', snap14b.jobs);
    const snap14c = store.getData();
    snap14c.goals.push({ title: 'V12 after conflict' });
    const save14 = await store.saveData(snap14c);
    const diskQ14 = quarantineOf(dbState[1].envelopeExtras);
    check('V12 conflict-adopted quarantine survives the next save verbatim',
        save14.committed === true && Array.isArray(diskQ14) &&
        qEntries(diskQ14, 'jobs').some((e) => e.index === 0 && JSON.stringify(e.value) === JSON.stringify(orphanConflict)),
        { save14, extras: dbState[1].envelopeExtras });

    // --- 15. V12: latest-disk export selection (V11) still applies the
    // jobs rule: a newer disk record that the cache has not adopted
    // exports partitioned, and the exact export reimports cleanly.
    const jobV12F = { id: 'job-v12-f', title: 'Zeta Job' };
    const orphanLatest = { id: 'orphan-latest' };
    const priorQ15 = { path: 'habits', index: 2, value: 'legacy-junk' };
    dbState[1] = record(baseData({ goals: [{ title: 'V12 newer goal' }], jobs: [jobV12F, orphanLatest] }),
        { quarantine: [priorQ15], v12LatestKey: 'latest-value' }, dbState[1].revision + 5, dbState[1].generation);
    const diskBefore15 = JSON.stringify(dbState[1]);
    lastDownloadText = null;
    await store.exportData();
    check('V12 latest-disk export performs no disk write', JSON.stringify(dbState[1]) === diskBefore15, dbState[1]);
    let env15 = null;
    try { env15 = JSON.parse(lastDownloadText); } catch (e) {}
    const q15 = env15 && quarantineOf(env15);
    check('V12 export selects newer disk data and partitions its shape-invalid job',
        !!env15 && env15.data.goals.length === 1 && env15.data.goals[0].title === 'V12 newer goal' &&
        env15.data.jobs.length === 1 && env15.data.jobs[0].id === 'job-v12-f',
        env15 && env15.data);
    check('V12 latest-disk export quarantine merges prior entries with the rejected original; unknown extras survive',
        Array.isArray(q15) &&
        qEntries(q15, 'jobs').some((e) => e.index === 1 && JSON.stringify(e.value) === JSON.stringify(orphanLatest)) &&
        qEntries(q15, 'habits').some((e) => e.index === 2 && e.value === 'legacy-junk') &&
        env15.v12LatestKey === 'latest-value',
        q15);
    await store.initStore(); // adopt the newer record before reimport
    let importRes15 = null;
    store.importData(lastDownloadText, (res) => { importRes15 = res; });
    await sleep(120);
    check('V12 latest-disk exact export passes strict import (committed)',
        !!importRes15 && importRes15.committed === true, importRes15);
    const snap15 = store.getData();
    check('V12 latest-disk reimport preserves the valid job and newer goal',
        snap15.jobs.length === 1 && snap15.jobs[0].id === 'job-v12-f' && snap15.goals.length === 1 && snap15.goals[0].title === 'V12 newer goal',
        { jobs: snap15.jobs, goals: snap15.goals });

    console.log(`\nTests completed: ${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exit(1);
}

runTests();
