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

    // --- 1. Adoption partition under the V15 jobs contract.
    const formJob = { id: 'job_form_1', company: 'Invented Co', role: 'Engineer', status: 'applied', location: 'toronto', date: '2026-10-01', notes: 'n' };
    const legacyJob = { id: 'job_legacy_1', title: 'Legacy Title Role', status: 'applied' };
    const roleOnlyJob = { id: 'job_role_1', role: 'Role Only' };
    const noIdentityJob = { id: 'job_bad_1', status: 'applied', notes: 'no identity' };
    const markupGoal = { title: 'Markup Goal', target: '<b id="audit-markup-marker">Invented markup</b>', history: [] };
    const badDateHabit = { name: 'Bad Date Habit', createdAt: 'invalid', occurrences: {} };
    dbState = { 1: record(baseData({
        jobs: [formJob, noIdentityJob, legacyJob, null, roleOnlyJob],
        goals: [markupGoal, null],
        habits: [badDateHabit, 'text-entry']
    })) };
    const initRes = await store.initStore();
    check('V15: poisoned record loads ready', initRes.status === 'ready', initRes);
    const snap = store.getData();
    check('V15: form-produced job (company+role, no title) survives adoption',
        snap.jobs.some((j) => j.id === 'job_form_1'), snap.jobs);
    check('V15: legacy title-only job survives adoption',
        snap.jobs.some((j) => j.id === 'job_legacy_1'), snap.jobs);
    check('V15: role-only job survives adoption',
        snap.jobs.some((j) => j.id === 'job_role_1'), snap.jobs);
    check('V15: id-only job (no identifying field) is quarantined, not kept',
        !snap.jobs.some((j) => j.id === 'job_bad_1'), snap.jobs);
    check('V15: kept jobs preserve order',
        JSON.stringify(snap.jobs.map((j) => j.id)) === JSON.stringify(['job_form_1', 'job_legacy_1', 'job_role_1']), snap.jobs);
    const q = quarantineOf(dbState[1].envelopeExtras) || [];
    check('V15: quarantined jobs entries are the id-only entry and the null entry',
        qEntries(q, 'jobs').length === 2 && qEntries(q, 'jobs').some((e) => e.value && e.value.id === 'job_bad_1'), q);
    check('V15: malformed-target goal retained verbatim (no quarantine, no rewrite)',
        snap.goals.length === 1 && snap.goals[0].target === '<b id="audit-markup-marker">Invented markup</b>', snap.goals);
    check('V15: invalid-createdAt habit retained verbatim',
        snap.habits.length === 1 && snap.habits[0].createdAt === 'invalid', snap.habits);
    check('V15: shape failures for goals/habits quarantined',
        qEntries(q, 'goals').length === 1 && qEntries(q, 'habits').length === 1, q);

    // --- 2. Producer round trip: saveJob with the actual form shape,
    // then a reload must still expose the job (the V15 audit defect).
    const jobsMod = await import('../js/jobs.js');
    const saveRes = await jobsMod.saveJob({ id: null, company: 'Second Co', role: 'Drafter', status: 'interview', location: 'remote-canada', date: '2026-10-02', notes: '' });
    check('V15: saveJob commits', !!(saveRes && saveRes.committed), saveRes);
    check('V15: getJobs exposes the form-shaped job before reload',
        jobsMod.getJobs().some((j) => j.company === 'Second Co'), jobsMod.getJobs());
    await store.initStore(); // reload
    check('V15: form-shaped job still exposed after reload (adoption)',
        jobsMod.getJobs().some((j) => j.company === 'Second Co'), jobsMod.getJobs());

    console.log(`\nTests completed: ${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exit(1);
}

runTests();
