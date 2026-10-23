const assert = require('assert');

// DOM Mocks
globalThis.window = {
    confirm: () => true,
    alert: () => {}
};
globalThis.confirm = window.confirm;
globalThis.alert = window.alert;

globalThis.crypto = {
    randomUUID: () => 'uuid-' + Math.random()
};
globalThis.BroadcastChannel = class {
    postMessage() {}
};
class Blob {
    constructor(parts, options) {
        this.parts = parts;
        this.options = options;
    }
}
class File extends Blob {
    constructor(parts, filename, options) {
        super(parts, options);
        this.name = filename;
    }
}
globalThis.Blob = Blob;
globalThis.File = File;

globalThis.document = {
    createElement: () => ({
        click: () => {},
        style: {}
    }),
    body: {
        appendChild: () => {},
        removeChild: () => {}
    }
};

globalThis.URL = {
    createObjectURL: () => 'blob:test',
    revokeObjectURL: () => {}
};

class FileReader {
    readAsText(file) {
        setTimeout(() => {
            this.onload({ target: { result: file.parts[0] } });
        }, 10);
    }
}
globalThis.FileReader = FileReader;


// IDB Mock
let dbState = {};
globalThis.indexedDB = {
    open: (name, version) => {
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
                        },
                        _pending: 0
                    };
                    // Ensure empty transactions also complete
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


// Load module
const store = require('../js/store.js');

async function runTests() {
    let passed = 0;
    let failed = 0;
    
    function pass(name) {
        console.log('PASS:', name);
        passed++;
    }
    
    function fail(name, err) {
        console.error('FAIL:', name, err);
        failed++;
    }
    
    await store.initStore();
    // Test A1: import validation rejects schemaVersion 999
    try {
        await new Promise((resolve) => {
            const f = new File([JSON.stringify({ app: 'dashboard', schemaVersion: 999, data: {} })], 'test.json');
            // Intercept alert
            const origAlert = globalThis.alert;
            globalThis.alert = (msg) => {
                if (msg.includes('unknown schemaVersion')) pass('Test A1: Rejects schemaVersion 999');
                else fail('Test A1: Wrong error message');
                globalThis.alert = origAlert;
                resolve();
            }
            store.importData(f, (res) => resolve(res));
            setTimeout(resolve, 50);
        });
    } catch(e) {}
    
    // Test A2: wrong app identifier
    try {
        await new Promise((resolve) => {
            const f = new File([JSON.stringify({ app: 'wrongapp', schemaVersion: 1, data: {} })], 'test.json');
            // Intercept alert
            const origAlert = globalThis.alert;
            globalThis.alert = (msg) => {
                if (msg.includes('wrong app')) pass('Test A2: Rejects wrong app identifier');
                else fail('Test A2: Wrong error message');
                globalThis.alert = origAlert;
                resolve();
            }
            store.importData(f, () => {});
            setTimeout(resolve, 50);
        });
    } catch(e) {}
    
    // Test A3: null array rejection
    try {
        await new Promise((resolve) => {
            const payload = {
                app: 'dashboard', schemaVersion: 1, data: { goals: null, places: [], jobs: [], investments: [], habits: [], indicators: [], college: { timetable: [], assignments: [], exams: [], fees: [] }, news: { sources: [], cache: [], manual: [] } }
            };
            const f = new File([JSON.stringify(payload)], 'test.json');
            // Intercept alert
            const origAlert = globalThis.alert;
            globalThis.alert = (msg) => {
                if (msg.includes('top-level collections cannot be null')) pass('Test A3: Rejects null arrays');
                else fail('Test A3: Wrong error message');
                globalThis.alert = origAlert;
                resolve();
            }
            store.importData(f, () => {});
        });
    } catch(e) {}

    
    // Initialize store state first
    await store.initStore();
    
    // Test B: saveData WeakMap snapshot token behavior
    try {
        const rawObj = { goals: [] };
        await store.saveData(rawObj);
        fail('Test B: saveData accepted untracked input');
    } catch(e) {
        if (e.message.includes('untracked raw saveData input')) {
            pass('Test B: saveData requires WeakMap tracked snapshot');
        } else {
            fail('Test B: Wrong error message', e);
        }
    }
    
    // Test C: generation/revision mismatch
    try {
        const snap = store.getData();
        // Force the IDB record to a higher revision to simulate cross-tab
        dbState[1].revision = 99;
        
        await store.saveData(snap);
        fail('Test C: saveData ignored CAS mismatch');
    } catch(e) {
        if (e.message.includes('Conflict')) {
            pass('Test C: CAS mismatch throws conflict');
            // Verify draft preservation
            let draftExported = false;
            const origCreateObjectURL = globalThis.URL.createObjectURL;
            globalThis.URL.createObjectURL = (blob) => {
                const text = blob.parts[0];
                if (text.includes('draft": true')) draftExported = true;
                return 'blob:test';
            };
            store.exportDraft();
            if (draftExported) pass('Test C2: Unsaved draft preserved and exportable');
            else fail('Test C2: Unsaved draft not properly exported');
            globalThis.URL.createObjectURL = origCreateObjectURL;
            
        } else {
            fail('Test C: Wrong error message', e);
        }
    }
    
    // Test D: export reads via readonly tx
    // Our mock executes transaction logic synchronously in event loop delays.
    try {
        dbState[1].data = { testExport: true };
        let exportRead = false;
        const origCreateObjectURL = globalThis.URL.createObjectURL;
        globalThis.URL.createObjectURL = (blob) => {
            const text = blob.parts[0];
            if (text.includes('testExport')) exportRead = true;
            return 'blob:test';
        };
        await store.exportData();
        if (exportRead) pass('Test D: Export reads IDB successfully');
        else fail('Test D: Export failed to read IDB');
        globalThis.URL.createObjectURL = origCreateObjectURL;
    } catch(e) {
        fail('Test D: Export threw exception', e);
    }
    
    console.log(`\nTests completed: ${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exit(1);
}

runTests();
