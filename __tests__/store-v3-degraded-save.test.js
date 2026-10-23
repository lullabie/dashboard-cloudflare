const assert = require('assert');

globalThis.window = { confirm: () => true, alert: () => {} };
globalThis.confirm = window.confirm;
globalThis.alert = window.alert;
globalThis.crypto = { randomUUID: () => 'uuid-' + Math.random() };

let bcThrow = false;
globalThis.BroadcastChannel = class { 
    constructor(name) {
        if (bcThrow) throw new Error('Simulated BC Error');
    }
    postMessage() {} 
    close() {} 
};

// IDB Mock (Existing Durable Record)
let dbState = {
    1: {
        id: 1,
        storageFormatVersion: 1,
        generation: 'gen-123',
        revision: 42,
        savedAt: new Date().toISOString(),
        data: { goals: [], places: [], jobs: [], investments: [], habits: [], indicators: [], college: { timetable: [], assignments: [], exams: [], fees: [] }, news: { sources: [], cache: [], manual: [] } },
        envelopeExtras: {}
    }
};

let putCalledCount = 0;

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
                                setTimeout(() => {
                                    greq.result = JSON.parse(JSON.stringify(dbState[id]));
                                    greq.onsuccess();
                                }, 1);
                                return greq;
                            },
                            put: (rec) => {
                                putCalledCount++;
                                dbState[rec.id] = JSON.parse(JSON.stringify(rec));
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

    // Test 1: Initial BroadcastChannel failure degrades store, save rejects, zero writes
    bcThrow = true;
    putCalledCount = 0;
    const init1 = await store.initStore();
    
    if (init1.status === 'degraded') {
        pass('Initial BroadcastChannel failure returns degraded status');
    } else {
        fail('Initial BC failure did not degrade initStore', init1);
    }

    try {
        const snap = store.getData(); // We can still read
        await store.saveData(snap);
        fail('saveData succeeded despite degraded status');
    } catch (e) {
        if (e.message.includes('degraded mode')) {
            pass('saveData rejected due to degraded mode explicitly');
        } else {
            fail('saveData rejected with wrong error', e.message);
        }
    }
    
    if (putCalledCount === 0) pass('Zero writes performed while degraded');
    else fail(`Performed ${putCalledCount} writes while degraded`);

    // Test 2: Successful explicit init restores readiness and saves successfully
    bcThrow = false;
    const init2 = await store.initStore();
    
    if (init2.status === 'ready') {
        pass('Successful explicit init restores ready state');
    } else {
        fail('Explicit init did not restore ready state', init2);
    }
    
    try {
        putCalledCount = 0;
        const snap2 = store.getData();
        await store.saveData(snap2);
        if (putCalledCount === 1) pass('saveData commits successfully after restored ready state');
        else fail(`saveData performed ${putCalledCount} writes instead of 1`);
    } catch(e) {
        fail('saveData failed after restored state', e);
    }

    // Test 3: Failure after prior success degrades store and blocks save
    bcThrow = true;
    const init3 = await store.initStore();
    if (init3.status === 'degraded') {
        pass('Failure after success sets degraded status');
    } else {
        fail('Failure after success did not degrade state');
    }
    
    try {
        putCalledCount = 0;
        const snap3 = store.getData();
        await store.saveData(snap3);
        fail('saveData succeeded after subsequent degraded state');
    } catch(e) {
        if (e.message.includes('degraded mode') && putCalledCount === 0) {
            pass('saveData rejected correctly after subsequent degraded state');
        } else {
            fail('saveData failed incorrectly', { msg: e.message, putCalledCount });
        }
    }

    console.log(`\nTests completed: ${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exit(1);
}

runTests();
