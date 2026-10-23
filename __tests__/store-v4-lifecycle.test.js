const assert = require('assert');

globalThis.window = { confirm: () => true, alert: () => {} };
globalThis.confirm = window.confirm;
globalThis.alert = window.alert;
globalThis.crypto = { randomUUID: () => 'uuid-' + Math.random() };

let bcCreateCount = 0;
let bcCloseCount = 0;
let bcThrow = false;
globalThis.BroadcastChannel = class { 
    constructor(name) {
        if (bcThrow) throw new Error('Simulated BC Error');
        bcCreateCount++;
    }
    postMessage() {} 
    close() { bcCloseCount++; } 
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

    // Test 1: Three successful init calls should not result in 3 orphan channels.
    await store.initStore();
    await store.initStore();
    await store.initStore();
    
    // We expect 1 active channel. That means either bcCreateCount is 1 (reusing the existing instance without clearing it), 
    // OR we created 3 and closed 2. Active = bcCreateCount - bcCloseCount
    let active = bcCreateCount - bcCloseCount;
    if (active === 1) pass('initStore correctly manages BroadcastChannel lifecycle across repeated calls');
    else fail(`initStore left orphaned channels. Created: ${bcCreateCount}, Closed: ${bcCloseCount}, Active: ${active}`);

    // Test 2: Failure after prior success must not leave an orphaned callback
    bcThrow = true;
    const res = await store.initStore();
    if (res.status === 'degraded') {
        pass('Failure correctly degrades store');
    } else {
        fail('Store did not degrade on BC failure');
    }

    // Now if the previous channel was cleared or overwritten, active count should be 0 since the new setup failed and threw.
    // If we just overwrite globalThis without closing the old one, we have orphans.
    active = bcCreateCount - bcCloseCount;
    if (active === 0) pass('Failed listener replacement correctly closed predecessor without orphaning');
    else fail(`Failed listener replacement left orphans. Created: ${bcCreateCount}, Closed: ${bcCloseCount}, Active: ${active}`);


    console.log(`\nTests completed: ${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exit(1);
}

runTests();
