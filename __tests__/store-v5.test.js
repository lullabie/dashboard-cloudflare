const assert = require('assert');

globalThis.window = { confirm: () => true, alert: () => {} };
globalThis.confirm = window.confirm;
globalThis.alert = window.alert;
globalThis.crypto = { randomUUID: () => 'uuid-' + Math.random() };

globalThis.BroadcastChannel = class { 
    constructor(name) {}
    postMessage() {} 
    close() {} 
};

// IDB Mock
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
globalThis.URL = { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} };
globalThis.document = {
    createElement: () => ({ click: () => {}, style: {} }),
    body: { appendChild: () => {}, removeChild: () => {} }
};

class FileReader {
    static nextOutcome = null; // 'error' | 'abort' | null
    readAsText(file) {
        const outcome = FileReader.nextOutcome;
        FileReader.nextOutcome = null;
        setTimeout(() => {
            if (outcome === 'error') { this.error = new Error('mock read failure'); if (this.onerror) this.onerror(); }
            else if (outcome === 'abort') { if (this.onabort) this.onabort(); }
            else this.onload({ target: { result: file.parts[0] } });
        }, 1);
    }
}
globalThis.FileReader = FileReader;

const store = require('../js/store.js');

async function runTests() {
    let passed = 0; let failed = 0;
    const pass = (name) => { console.log('PASS [MOCK]:', name); passed++; };
    const fail = (name, err) => { console.error('FAIL [MOCK]:', name, err); failed++; };

    // V5-STORE-01: Legacy Upgrade Normalization (MigratePlaces before Put)
    globalThis.localStorage = {
        getItem: (key) => {
            if (key === 'dashboard_data') return JSON.stringify({ places: [{ id: null, title: 'Test Place' }, { id: undefined }] });
            return null;
        }
    };
    dbState = {}; // ensure empty IDB
    await store.initStore();
    const upgraded = store.getData();
    if (upgraded.places && upgraded.places.length === 2 && upgraded.places[0].id !== null && upgraded.places[0].id.startsWith('place_')) {
        pass('Legacy Upgrade normalizes Place IDs correctly before saving');
    } else {
        fail('Legacy Upgrade failed to normalize Place IDs', upgraded.places);
    }

    // V5-STORE-02: Import Error explicit recovery resolution
    // Invalid schema version -> should fire onComplete({error: ..., committed: false, conflict: false})
    await new Promise((resolve) => {
        const payload = { app: 'dashboard', schemaVersion: 999, data: {} };
        const f = new File([JSON.stringify(payload)], 'test.json');
        store.importData(f, (res) => {
            if (res && res.error && !res.committed && !res.conflict) pass('Import gracefully settles callback on format error');
            else fail('Import callback failed on format error', res);
            resolve();
        });
        setTimeout(() => { resolve(); }, 150);
    });

    // Import confirmation cancel -> should fire onComplete({cancelled: true, committed: false, conflict: false})
    await new Promise((resolve) => {
        globalThis.confirm = () => false; // User cancels
        const payload = { app: 'dashboard', schemaVersion: 1, data: { goals: [], places: [], jobs: [], investments: [], habits: [], indicators: [], college: { timetable: [], assignments: [], exams: [], fees: [] }, news: { sources: [], cache: [], manual: [] } } };
        const f = new File([JSON.stringify(payload)], 'test.json');
        store.importData(f, (res) => {
            if (res && res.cancelled && !res.committed && !res.conflict) pass('Import gracefully settles callback on user cancellation');
            else fail('Import callback failed on user cancellation', res);
            resolve();
        });
        setTimeout(() => { resolve(); }, 150);
    });
    globalThis.confirm = window.confirm;
    
    // Import CAS conflict -> should fire onComplete({conflict: true, committed: false})
    globalThis.confirm = () => true;
    dbState[1].revision = 999; // force CAS failure on next put
    await new Promise((resolve) => {
        const payload = { app: 'dashboard', schemaVersion: 1, data: { goals: [], places: [], jobs: [], investments: [], habits: [], indicators: [], college: { timetable: [], assignments: [], exams: [], fees: [] }, news: { sources: [], cache: [], manual: [] } } };
        const f = new File([JSON.stringify(payload)], 'test.json');
        store.importData(f, (res) => {
            if (res && res.conflict && !res.committed) pass('Import gracefully settles callback on CAS conflict abort');
            else fail('Import callback failed on CAS conflict', res);
            resolve();
        });
        setTimeout(() => { resolve(); }, 150);
    });

    // V5-STORE-02 fix A: cancel path must settle EXACTLY once
    await new Promise((resolve) => {
        let calls = 0;
        globalThis.confirm = () => false; // User cancels
        const payload = { app: 'dashboard', schemaVersion: 1, data: { goals: [], places: [], jobs: [], investments: [], habits: [], indicators: [], college: { timetable: [], assignments: [], exams: [], fees: [] }, news: { sources: [], cache: [], manual: [] } } };
        const f = new File([JSON.stringify(payload)], 'test.json');
        store.importData(f, (res) => { calls++; });
        setTimeout(() => {
            if (calls === 1) pass('Import cancel fires onComplete exactly once');
            else fail('Import cancel onComplete invocation count', calls);
            resolve();
        }, 150);
    });
    globalThis.confirm = window.confirm;

    // V5-STORE-01 fix C: malformed legacy payload -> explicit recovery to valid shape
    globalThis.localStorage = {
        getItem: (key) => {
            if (key === 'dashboard_data') return JSON.stringify({ places: 'not-an-array', goals: 42 });
            return null;
        }
    };
    dbState = {}; // ensure empty IDB
    await store.initStore();
    const recovered = store.getData();
    if (Array.isArray(recovered.places) && recovered.places.length === 0 && Array.isArray(recovered.goals) && recovered.goals.length === 0) {
        pass('Malformed legacy payload recovered to valid shape before durable write');
    } else {
        fail('Malformed legacy recovery failed', { places: recovered.places, goals: recovered.goals });
    }

    // V6: the recovery record names every repaired field and preserves the
    // original localStorage bytes in the durable record envelopeExtras.
    const durable = dbState[1];
    const extras = durable && durable.envelopeExtras;
    const expectedRaw = JSON.stringify({ places: 'not-an-array', goals: 42 });
    if (extras && Array.isArray(extras.legacyRecovery) && extras.legacyRecovery.includes('places') && extras.legacyRecovery.includes('goals') && extras.legacyRecovery.length === 2 && extras.legacyOriginalRaw === expectedRaw) {
        pass('Malformed legacy recovery records all repaired fields and preserves original bytes');
    } else {
        fail('Malformed legacy recovery record incomplete', extras);
    }

    // V5-STORE-02 fix B: reader error and abort each settle exactly once
    await new Promise((resolve) => {
        let calls = 0;
        FileReader.nextOutcome = 'error';
        const f = new File(['{}'], 'test.json');
        store.importData(f, (res) => {
            calls++;
            if (res && res.error && !res.committed && !res.conflict) { /* ok */ }
        });
        setTimeout(() => {
            if (calls === 1) pass('Reader error fires onComplete exactly once');
            else fail('Reader error onComplete invocation count', calls);
            resolve();
        }, 150);
    });
    await new Promise((resolve) => {
        let calls = 0;
        FileReader.nextOutcome = 'abort';
        const f = new File(['{}'], 'test.json');
        store.importData(f, (res) => {
            calls++;
            if (res && res.cancelled && !res.committed) { /* ok */ }
        });
        setTimeout(() => {
            if (calls === 1) pass('Reader abort fires onComplete exactly once');
            else fail('Reader abort onComplete invocation count', calls);
            resolve();
        }, 150);
    });

    console.log(`\nTests completed: ${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exit(1);
}

runTests();
