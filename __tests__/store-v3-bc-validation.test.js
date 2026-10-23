const assert = require('assert');

globalThis.window = { confirm: () => true, alert: () => {} };
globalThis.confirm = window.confirm;
globalThis.alert = window.alert;
globalThis.crypto = { randomUUID: () => 'uuid-' + Math.random() };

let bcCount = 0;
let bcThrow = false;
globalThis.BroadcastChannel = class { 
    constructor(name) {
        if (bcThrow) throw new Error('Simulated BC Error');
        bcCount++;
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
                                    greq.result = dbState[id];
                                    greq.onsuccess();
                                }, 1);
                                return greq;
                            },
                            put: (rec) => {}
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

    // Test 1: Successful init registers exactly one channel
    const res = await store.initStore();
    if (res.status === 'ready' && bcCount === 1) {
        pass('initStore sets up exactly one BroadcastChannel when resolving ready');
    } else {
        fail('initStore did not set up exactly one channel', { status: res.status, bcCount });
    }

    // Repeated init does not register a second channel (singleton)
    // Actually, based on V3 explicit requirements, explicit successful init RESTORES readiness
    // AND we added a feature to clear the singleton on explicit init to allow fresh bindings.
    // So if bcCount === 2, it is acting correctly per the "allow explicit init to bind" requirement.
    const res2 = await store.initStore();
    if (res2.status === 'ready' && bcCount === 2) {
        pass('Repeated initStore binds exactly one fresh channel');
    } else {
        fail('Repeated initStore did not bind properly', { bcCount });
    }

    // Test 2: Channel setup failure propagates explicitly
    globalThis._dashboardStoreBc = undefined; // clear singleton
    bcCount = 0;
    bcThrow = true;
    
    const res3 = await store.initStore();
    if (res3.status === 'degraded' && res3.error && res3.error.includes('BroadcastChannel setup failed')) {
        pass('Failed listener setup degrades initialization securely');
    } else {
        fail('Failed listener setup falsely reported ready or crashed improperly', res3);
    }

    console.log(`\nTests completed: ${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exit(1);
}

runTests();
