const assert = require('assert');

globalThis.window = { confirm: () => true, alert: () => {} };
globalThis.confirm = window.confirm;
globalThis.alert = window.alert;
globalThis.crypto = { randomUUID: () => 'uuid-' + Math.random() };

let bcThrowNotification = false;
globalThis.BroadcastChannel = class { 
    constructor(name) {}
    postMessage() {
        if (bcThrowNotification) throw new Error('Simulated BC Notification Error');
    } 
    close() {} 
};

// IDB Mock
let dbState = {
    1: { id: 1, storageFormatVersion: 1, generation: 'gen-123', revision: 42, savedAt: new Date().toISOString(), data: { goals: [], places: [], jobs: [], investments: [], habits: [], indicators: [], college: { timetable: [], assignments: [], exams: [], fees: [] }, news: { sources: [], cache: [], manual: [] } }, envelopeExtras: {} }
};

globalThis.indexedDB = {
    open: () => {
        const req = {};
        setTimeout(() => {
            req.result = {
                objectStoreNames: { contains: () => true },
                transaction: (storeName, mode) => {
                    const tx = {
                        objectStore: () => ({
                            get: (id) => {
                                const greq = {};
                                setTimeout(() => { greq.result = dbState[id]; greq.onsuccess(); }, 1);
                                return greq;
                            },
                            put: (rec) => {
                                dbState[rec.id] = rec;
                            }
                        })
                    };
                    setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 5);
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

    await store.initStore();

    // Test 1: Notification failure does not cause saveData to reject, and correctly reports committed: true
    bcThrowNotification = true;
    try {
        const snap = store.getData();
        const res = await store.saveData(snap);
        if (res.committed && !res.conflict) {
            pass('saveData promise resolves successfully (committed) despite notification failure');
        } else {
            fail('saveData returned invalid commit state', res);
        }
    } catch(e) {
        fail('saveData rejected when only the notification failed', e);
    }
    
    // Ensure committed data survives natively
    const snap2 = store.getData();
    if (snap2.goals) pass('Committed data stays intact');
    else fail('Committed data damaged');

    console.log(`\nTests completed: ${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exit(1);
}

runTests();
