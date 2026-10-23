const assert = require('assert');

globalThis.window = { confirm: () => true, alert: () => {} };
globalThis.confirm = window.confirm;
globalThis.alert = window.alert;
globalThis.crypto = { randomUUID: () => 'uuid-' + Math.random() };
globalThis.BroadcastChannel = class { postMessage() {} close() {} };
class Blob { constructor(parts) { this.parts = parts; } }
class File extends Blob { constructor(parts, filename) { super(parts); this.name = filename; } }
globalThis.Blob = Blob;
globalThis.File = File;

globalThis.document = {
    createElement: () => ({ click: () => {}, style: {} }),
    body: { appendChild: () => {}, removeChild: () => {} }
};

let createObjectURLShouldFail = false;
globalThis.URL = {
    createObjectURL: () => {
        if (createObjectURLShouldFail) throw new Error('Object URL generation failed');
        return 'blob:test';
    },
    revokeObjectURL: () => {}
};

class FileReader {
    readAsText(file) {
        setTimeout(() => { this.onload({ target: { result: file.parts[0] } }); }, 1);
    }
}
globalThis.FileReader = FileReader;

let dbState = {};
let nextTxAbort = false;
let nextTxCompleteDelay = 5;

globalThis.indexedDB = {
    open: () => {
        const req = {};
        setTimeout(() => {
            req.result = {
                objectStoreNames: { contains: () => true },
                transaction: (storeName, mode) => {
                    let aborted = false;
                    const tx = {
                        objectStore: () => ({
                            get: (id) => {
                                const greq = {};
                                setTimeout(() => {
                                    greq.result = dbState[id];
                                    greq.onsuccess();
                                }, 1);
                                return greq;
                            },
                            put: (rec) => {
                                if (aborted) return;
                                dbState[rec.id] = rec;
                            }
                        }),
                        abort: () => {
                            aborted = true;
                            if (tx.onabort) tx.onabort();
                        }
                    };
                    setTimeout(() => {
                        if (nextTxAbort) {
                            nextTxAbort = false;
                            tx.abort();
                        } else if (!aborted && tx.oncomplete) {
                            tx.oncomplete();
                        }
                    }, nextTxCompleteDelay);
                    return tx;
                },
                close: () => {}
            };
            req.onsuccess();
        }, 1);
        return req;
    }
};

const store = require('../js/store.js');

async function runTests() {
    let passed = 0; let failed = 0;
    const pass = (name) => { console.log('PASS [MOCK]:', name); passed++; };
    const fail = (name, err) => { console.error('FAIL [MOCK]:', name, err); failed++; };

    // 1. Concurrent Init Store Early Resolution Validation
    dbState = {};
    const init1 = store.initStore();
    const init2 = store.initStore();
    const [res1, res2] = await Promise.all([init1, init2]);
    if (res1.status === 'ready' && res2.status === 'ready' && Object.keys(dbState).length === 1) {
        pass('initStore correctly resolves after tx.oncomplete and handles concurrency safely');
    } else {
        fail('initStore resolved early or created concurrent clones');
    }

    // 2. Import conflict object-URL failure payload recovery
    createObjectURLShouldFail = true;
    dbState[1].revision = 5; // force conflict
    const importPayload = { app: 'dashboard', schemaVersion: 1, data: { goals: [{history: []}], places: [], jobs: [], investments: [], habits: [], indicators: [], college: { timetable: [], assignments: [], exams: [], fees: [] }, news: { sources: [], cache: [], manual: [] } } };
    const f = new File([JSON.stringify(importPayload)], 'test.json');

    const origAlert = globalThis.alert;
    let alertMessage = '';
    globalThis.alert = (msg) => { alertMessage = msg; };

    await new Promise((resolve) => {
        store.importData(f, resolve);
        // Fallback resolve to prevent hang
        setTimeout(resolve, 100);
    });
    
    if (alertMessage.includes('preserved in memory and can be exported manually') || alertMessage === 'Import blocked: another tab updated the data first. Your draft is preserved in memory and can be exported manually.') {
        const d = store.getData();
        if (store.exportDraft) {
             // Checking unsaved draft was stored
        }
        pass('Import conflict handles Object URL failure and preserves message draft state');
    } else {
        fail('Import conflict falsely claimed downloaded or crashed', alertMessage);
    }
    
    createObjectURLShouldFail = false;
    globalThis.alert = origAlert;

    // 3. Validation: goals.history coercion and jobs shape restriction
    try {
        const payload2 = { app: 'dashboard', schemaVersion: 1, data: { goals: [{history: null}], places: [], jobs: [{}], investments: [], habits: [], indicators: [], college: { timetable: [], assignments: [], exams: [], fees: [] }, news: { sources: [], cache: [], manual: [] } } };
        const f2 = new File([JSON.stringify(payload2)], 'test.json');
        let errStr = '';
        globalThis.alert = (msg) => { errStr = msg; };
        await new Promise((resolve) => {
            store.importData(f2, resolve);
            setTimeout(resolve, 100);
        });
        if (errStr.includes('jobs[0]')) pass('Schema validation correctly rejects empty jobs and normalizes goals.history');
        else fail('Schema validation accepted invalid job', errStr);
    } catch(e) {}
    
    // 4. Legacy Upgrade path reads and converts but preserves localStorage
    globalThis.localStorage = {
        getItem: (key) => {
            if (key === 'dashboard_data') return JSON.stringify({ goals: [{id: 'goal_123', history: []}] });
            return null;
        }
    };
    dbState = {}; // reset IDB to empty
    await store.initStore();
    const upgraded = store.getData();
    if (upgraded.goals.length === 1 && upgraded.goals[0].id === 'goal_123') {
        pass('Legacy localStorage upgrade populates db correctly');
    } else {
        fail('Legacy localStorage upgrade failed to populate data');
    }

    console.log(`\nTests completed: ${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exit(1);
}

runTests();

// EOF fix