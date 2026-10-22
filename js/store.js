// --- Data Store (IndexedDB) ---
// Bounded IndexedDB transaction-authority design.

const DB_NAME = 'dashboard_store';
const DB_VERSION = 1;
const STORE_NAME = 'store_records';
const RECORD_ID = 1;

let currentData = null;
let currentGeneration = null;
let currentRevision = 0;
let lastConflictAt = null;
let unsavedDraft = null;
let envelopeExtras = {};
let storeStatus = 'uninitialized';
let storeError = null;

// WeakMap binding snapshotted cache to its specific token.
const snapshotTokens = new WeakMap();

function defaultData() {
    return {
        goals: [],
        places: [],
        jobs: [],
        investments: [],
        habits: [],
        indicators: [],
        metadata: {},
        college: { timetable: [], assignments: [], exams: [], fees: [] },
        news: { sources: [], cache: [], manual: [] }
    };
}

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IDB open denied'));
        req.onblocked = () => reject(new Error('IDB open blocked'));
    });
}

async function readRecord() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(RECORD_ID);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onabort = tx.onerror = () => {
            db.close();
            reject(tx.error || new Error('readRecord tx aborted'));
        };
    });
}

function isValidId(id) {
    return id && typeof id === 'string' && id.startsWith('place_') && id.length > 10;
}

// --- F-D1: import schema + record-shape validation ---------------
function assertRecordArray(arr, name) {
    if (!Array.isArray(arr)) {
        throw new Error(`Invalid import: '${name}' must be an array.`);
    }
    for (let i = 0; i < arr.length; i++) {
        if (!arr[i] || typeof arr[i] !== 'object' || Array.isArray(arr[i])) {
            throw new Error(`Invalid import: '${name}[${i}]' must be an object.`);
        }
    }
}

function validateImportData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Invalid import: payload must be an object.');
    }
    if (data.goals === null || data.places === null || data.jobs === null || data.investments === null || data.habits === null || data.indicators === null) {
        throw new Error('Invalid import: top-level collections cannot be null.');
    }
    assertRecordArray(data.goals ?? [], 'goals');
    const goals = data.goals ?? [];
    for (let i = 0; i < goals.length; i++) {
        if (!Array.isArray(goals[i].history)) goals[i].history = [];
    }
    assertRecordArray(data.places ?? [], 'places');
    assertRecordArray(data.jobs ?? [], 'jobs');
    const jobs = data.jobs ?? [];
    for (let i = 0; i < jobs.length; i++) {
        if (!jobs[i].id || !jobs[i].title) {
            throw new Error(`Invalid import: 'jobs[${i}]' missing required fields.`);
        }
    }
    assertRecordArray(data.investments ?? [], 'investments');
    assertRecordArray(data.habits ?? [], 'habits');
    assertRecordArray(data.indicators ?? [], 'indicators');

    const college = data.college;
    if (college === null) {
        throw new Error('Invalid import: "college" cannot be null.');
    }
    const c = college ?? { timetable: [], assignments: [], exams: [], fees: [] };
    if (typeof c !== 'object' || Array.isArray(c)) {
        throw new Error('Invalid import: "college" must be an object.');
    }
    if (c.timetable === null || c.assignments === null || c.exams === null || c.fees === null) {
        throw new Error('Invalid import: college arrays cannot be null.');
    }
    assertRecordArray(c.timetable ?? [], 'college.timetable');
    assertRecordArray(c.assignments ?? [], 'college.assignments');
    assertRecordArray(c.exams ?? [], 'college.exams');
    assertRecordArray(c.fees ?? [], 'college.fees');

    const news = data.news;
    if (news === null) {
        throw new Error('Invalid import: "news" cannot be null.');
    }
    const n = news ?? { sources: [], cache: [], manual: [] };
    if (typeof n !== 'object' || Array.isArray(n)) {
        throw new Error('Invalid import: "news" must be an object.');
    }
    if (n.sources === null || n.cache === null || n.manual === null) {
        throw new Error('Invalid import: news arrays cannot be null.');
    }
    assertRecordArray(n.sources ?? [], 'news.sources');
    assertRecordArray(n.cache ?? [], 'news.cache');
    assertRecordArray(n.manual ?? [], 'news.manual');
}

let lastNormalizeRecovery = [];
function normalizeImportData(data) {
    const out = { ...data };
    lastNormalizeRecovery = [];
    for (const k of ['goals', 'places', 'jobs', 'investments', 'habits', 'indicators']) {
        if (!(k in out)) out[k] = [];
        else if (!Array.isArray(out[k])) { out[k] = []; lastNormalizeRecovery.push(k); }
    }
    out.college = {
        timetable: [], assignments: [], exams: [], fees: [],
        ...(out.college || {})
    };
    out.news = { sources: [], cache: [], manual: [], ...(out.news || {}) };
    if (!out.metadata) out.metadata = {};
    return out;
}

// --- V10 Lane A: bounded adoption partition -----------------------
// Policy. A stored record is untrusted at adoption time: a foreign or
// older writer can leave malformed entries (null, primitives, arrays)
// inside a collection, and verbatim adoption crashes the UI.
// 1. Partition at adoption. syncFromRecord is the single adoption
//    funnel (initial IndexedDB load, BroadcastChannel refresh,
//    save/import conflict adoption). Each collection is partitioned
//    with the import entry-shape predicate: an entry is valid only
//    when it is a non-null, non-array object. Valid entries keep
//    their order and are the only entries in the getData() snapshot.
// 2. Nothing is dropped. Each malformed entry is preserved as
//    { path, index, value } in envelopeExtras.quarantine; index -1
//    means the collection value itself was malformed and is treated
//    as empty. A malformed root record recovers to the default empty
//    dataset with the raw value quarantined at path 'data'.
// 3. The quarantine travels with the record. Adoption on initial
//    load repairs the durable record in the same transaction, and
//    every save merges the in-memory extras over the disk extras, so
//    save, export, reload and conflict adoption never silently lose
//    quarantined entries. Unknown extras keys are merged, never
//    replaced. getData() never filters: the partition happens once,
//    at adoption, and the record itself carries the recovery data.
const TOP_LEVEL_COLLECTIONS = ['goals', 'places', 'jobs', 'investments', 'habits', 'indicators'];
const COLLEGE_COLLECTIONS = ['timetable', 'assignments', 'exams', 'fees'];
const NEWS_COLLECTIONS = ['sources', 'cache', 'manual'];

function isAdoptableEntry(entry) {
    return !!entry && typeof entry === 'object' && !Array.isArray(entry);
}

function partitionCollection(value, path, found) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        found.push({ path, index: -1, value });
        return [];
    }
    const out = [];
    for (let i = 0; i < value.length; i++) {
        if (isAdoptableEntry(value[i])) out.push(value[i]);
        else found.push({ path, index: i, value: value[i] === undefined ? null : value[i] });
    }
    return out;
}

function partitionCollectionGroup(value, path, keys, found) {
    const group = {};
    if (value === undefined) {
        for (const k of keys) group[k] = [];
        return group;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        found.push({ path, index: -1, value });
        for (const k of keys) group[k] = [];
        return group;
    }
    Object.assign(group, value);
    for (const k of keys) group[k] = partitionCollection(value[k], path + '.' + k, found);
    return group;
}

function quarantineKey(entry) {
    let v;
    try { v = JSON.stringify(entry && entry.value); } catch (e) { v = String(entry && entry.value); }
    return (entry && entry.path) + '|' + (entry && entry.index) + '|' + v;
}

function mergeQuarantine(prior, found) {
    const out = Array.isArray(prior) ? prior.slice() : [];
    const seen = new Set(out.map(quarantineKey));
    for (const entry of found) {
        const key = quarantineKey(entry);
        if (!seen.has(key)) { seen.add(key); out.push(entry); }
    }
    return out;
}

// Returns { data, quarantine, changed }. The input record is not mutated.
function partitionAdoptedData(rawData, priorQuarantine) {
    const found = [];
    if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
        if (rawData !== undefined) found.push({ path: 'data', index: -1, value: rawData });
        return { data: defaultData(), quarantine: mergeQuarantine(priorQuarantine, found), changed: true };
    }
    const data = { ...rawData };
    for (const k of TOP_LEVEL_COLLECTIONS) data[k] = partitionCollection(rawData[k], k, found);
    data.college = partitionCollectionGroup(rawData.college, 'college', COLLEGE_COLLECTIONS, found);
    data.news = partitionCollectionGroup(rawData.news, 'news', NEWS_COLLECTIONS, found);
    if (data.metadata === undefined) {
        data.metadata = {};
    } else if (!data.metadata || typeof data.metadata !== 'object' || Array.isArray(data.metadata)) {
        found.push({ path: 'metadata', index: -1, value: data.metadata });
        data.metadata = {};
    }
    return { data, quarantine: mergeQuarantine(priorQuarantine, found), changed: found.length > 0 };
}

function recordExtras(record) {
    return (record && record.envelopeExtras && typeof record.envelopeExtras === 'object' && !Array.isArray(record.envelopeExtras))
        ? record.envelopeExtras : null;
}

// Returns a repaired copy of the record when adoption partitioned any
// malformed content, else null. Used by initStore to make the durable
// record match the partitioned in-memory adoption.
function repairAdoptedRecord(record) {
    if (!record || typeof record !== 'object') return null;
    const extrasIn = recordExtras(record) || {};
    const part = partitionAdoptedData(record.data, extrasIn.quarantine);
    if (!part.changed) return null;
    const extras = { ...extrasIn };
    if (part.quarantine.length) extras.quarantine = part.quarantine;
    return { ...record, data: part.data, envelopeExtras: extras };
}

// --- F-B1a retained: legacy null/duplicate place-ID migration ----
function migratePlaces(data) {
    if (!data || !Array.isArray(data.places)) return false;
    let changed = false;
    const seen = new Set();
    data.places.forEach(p => {
        if (!p || typeof p !== 'object') return;
        if (!isValidId(p.id) || seen.has(p.id)) {
            p.id = 'place_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            changed = true;
        }
        seen.add(p.id);
    });
    return changed;
}

// --- public API --------------------------------------------------
export function getData() {
    if (!currentData) {
        currentData = defaultData();
        currentRevision = 0;
        currentGeneration = crypto.randomUUID();
    }
    // Deep copy to prevent callers mutating the in-memory committed state directly.
    const snapshot = JSON.parse(JSON.stringify(currentData));
    snapshotTokens.set(snapshot, { generation: currentGeneration, revision: currentRevision });
    return snapshot;
}

function syncFromRecord(record) {
    // V10 Lane A: every adoption path funnels through here, so the
    // partition is applied exactly once per adoption. The quarantine
    // already carried by the record is preserved and extended, never
    // replaced; unknown extras keys pass through unchanged.
    const extrasIn = recordExtras(record) || envelopeExtras;
    const part = partitionAdoptedData(record.data, extrasIn.quarantine);
    currentData = part.data;
    currentRevision = record.revision;
    currentGeneration = record.generation;
    const extras = { ...extrasIn };
    if (part.quarantine.length) extras.quarantine = part.quarantine;
    envelopeExtras = extras;
}

export async function initStore() {
    // Gracefully close any existing live channel before re-initializing
    if (globalThis._dashboardStoreBc && typeof globalThis._dashboardStoreBc.close === 'function') {
        globalThis._dashboardStoreBc.close();
    }
    globalThis._dashboardStoreBc = undefined;
    try {
        let db = await openDB();
        let record = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const getReq = store.get(RECORD_ID);
            let adoptedRecord = null;
            getReq.onsuccess = () => {
                adoptedRecord = getReq.result;
                if (!adoptedRecord) {
                    // Fix 3: Legacy Upgrade Compatibility
                    let legacyData = null;
                    let legacyRaw = null;
                    try {
                        const raw = localStorage.getItem('dashboard_data');
                        if (raw) { legacyRaw = raw; legacyData = JSON.parse(raw); }
                    } catch(e) {}
                    // Normalize the legacy payload to ensure valid shape without mutating localStorage
                    if (legacyData && typeof legacyData === 'object' && !Array.isArray(legacyData)) {
                        legacyData = normalizeImportData(legacyData);
                    } else {
                        legacyData = defaultData();
                    }
                    migratePlaces(legacyData);
                    // V5-STORE-01: validate the repaired shape before the first durable put.
                    validateImportData(legacyData);
                    const legacyRecovery = lastNormalizeRecovery.slice();

                    adoptedRecord = {
                        id: RECORD_ID,
                        storageFormatVersion: 1,
                        generation: crypto.randomUUID(),
                        revision: 1,
                        savedAt: new Date().toISOString(),
                        data: legacyData,
                        // V6: a malformed recovery is explicit and reversible. The record
                        // names every repaired field and keeps the original localStorage
                        // bytes, so recovery never silently destroys the original.
                        envelopeExtras: legacyRecovery.length ? { legacyRecovery, legacyOriginalRaw: legacyRaw } : {}
                    };
                    store.put(adoptedRecord);
                } else {
                    // V10 Lane A: an existing record can carry malformed
                    // entries from a foreign or older writer. Repair it in
                    // this same transaction so the durable record matches
                    // the partitioned adoption: malformed entries move to
                    // envelopeExtras.quarantine instead of reaching the UI.
                    const repaired = repairAdoptedRecord(adoptedRecord);
                    if (repaired) {
                        adoptedRecord = repaired;
                        store.put(adoptedRecord);
                    }
                }
            };
            getReq.onerror = () => reject(getReq.error);
            tx.oncomplete = () => {
                db.close();
                resolve(adoptedRecord);
            };
            tx.onabort = tx.onerror = () => {
                db.close();
                reject(tx.error || new Error('initStore tx aborted'));
            };
        });
        syncFromRecord(record);
        // Listen for other tabs changes to keep sync
        try {
            if (typeof BroadcastChannel !== 'undefined' && !globalThis._dashboardStoreBc) {
                globalThis._dashboardStoreBc = new BroadcastChannel('dashboard_store_sync');
                globalThis._dashboardStoreBc.onmessage = async (e) => {
                    if (e.data === 'sync') {
                        try {
                            const rec = await readRecord();
                            if (rec) syncFromRecord(rec);
                        } catch (readErr) {
                            console.warn('Cross-tab sync read failed:', readErr);
                        }
                    }
                };
            }
        } catch (bcErr) {
            throw new Error('BroadcastChannel setup failed: ' + bcErr.message);
        }
        
        storeStatus = 'ready';
        storeError = null;
        return { status: 'ready', generation: currentGeneration, revision: currentRevision };
    } catch (e) {
        storeStatus = 'degraded';
        storeError = e.message;
        console.error('initStore IDB failure:', e);
        return { status: 'degraded', error: e.message };
    }
}

// Every save is awaited by callers, runs serialized, and reports its outcome.
// On storage failure the throw propagates and memory is re-synced to disk;
// on cross-tab conflict the unsaved draft is exported and memory adopts the
// latest disk state. It never resolves "success" for a write that failed.
export async function saveData(data) {
    if (storeStatus !== 'ready') {
        throw new Error('Save rejected: store is in degraded mode. ' + (storeError || 'Initialization required.'));
    }
    const token = snapshotTokens.get(data);
    if (!token) {
        throw new Error('Save rejected: untracked raw saveData input. You must pass a tracked snapshot from getData().');
    }
    
    // We snapshot the expected baseline
    const expectedGeneration = token.generation;
    const expectedRevision = token.revision;
    data = JSON.parse(JSON.stringify(data)); // Break caller reference
    
    let db;
    try {
        db = await openDB();
    } catch (e) {
        unsavedDraft = data;
        throw new Error('Save failed: IDB open denied. ' + e.message);
    }
    
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        
        const getReq = store.get(RECORD_ID);
        getReq.onsuccess = () => {
            const record = getReq.result;
            if (!record) {
                tx.abort();
                return; // handled in onabort
            }
            if (record.generation !== expectedGeneration || record.revision !== expectedRevision) {
                // CAS Mismatch
                syncFromRecord(record); // Adopt authoritative state
                lastConflictAt = new Date().toISOString();
                tx.abort();
                return;
            }
            
            const nextRecord = {
                ...record,
                revision: record.revision + 1,
                savedAt: new Date().toISOString(),
                data: data,
                // V10 Lane A: merge, never replace. The in-memory extras
                // (seeded from this record at adoption and extended with
                // any quarantine) win per key, so a save after a
                // BroadcastChannel or conflict adoption cannot silently
                // delete quarantined entries or unknown extras keys.
                envelopeExtras: { ...(recordExtras(record) || {}), ...envelopeExtras }
            };
            store.put(nextRecord);
        };
        
        tx.oncomplete = () => {
            db.close();
            syncFromRecord({
                id: 1,
                storageFormatVersion: 1,
                generation: expectedGeneration,
                revision: expectedRevision + 1,
                savedAt: new Date().toISOString(),
                data: data,
                envelopeExtras: envelopeExtras
            });
            try {
                if (typeof BroadcastChannel !== 'undefined') {
                    const bc = new BroadcastChannel('dashboard_store_sync');
                    bc.postMessage('sync');
                    bc.close();
                }
            } catch (notifyErr) {
                console.warn('Commit successful, but cross-tab notification failed:', notifyErr);
            }
            resolve({ committed: true, conflict: false });
        };
        
        tx.onabort = tx.onerror = () => {
            db.close();
            unsavedDraft = data;
            const err = tx.error || new Error('Transaction aborted');
            if (lastConflictAt && (currentGeneration !== expectedGeneration || currentRevision !== expectedRevision)) {
                // Determine if it was the CAS mismatch abort
                try {
                    exportDraft(data);
                    reject(new Error('Conflict: another tab updated the data first. Your current data is unchanged; the draft was downloaded.'));
                } catch (draftErr) {
                    reject(new Error('Conflict: another tab updated the data first. Your unsaved draft is preserved in memory. Please manually Export Unsaved Draft and Reload Latest.'));
                }
            } else {
                reject(new Error('Save failed: ' + err.message));
            }
        };
    });
}

export function getLastConflict() {
    return lastConflictAt;
}

// --- export / import (F-D1, F-D2) --------------------------------
function downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export async function exportData() {
    let record;
    try {
        record = await readRecord();
    } catch(e) {}
    
    // V11: export uses one internally consistent selected record. The
    // selected record is the disk record when one is readable. Partition
    // that record as a unit. Pair the partitioned data with the extras of
    // that same record only. Raw disk data can carry malformed entries
    // that adoption already partitioned in memory. Pairing raw disk data
    // with the in-memory quarantine made the backup fail strict import.
    // Pairing in-memory data with disk extras can mix two revisions.
    // Export is read-only. This path writes nothing to disk. The
    // partition works on a copy. Export mutates no record and no cache.
    // Fallback stays unchanged: no readable disk record exports the
    // in-memory snapshot and the in-memory extras.
    let dataToExport;
    let extras;
    if (record) {
        const repaired = repairAdoptedRecord(record);
        const selected = repaired || record;
        dataToExport = selected.data;
        extras = recordExtras(selected) || {};
    } else {
        dataToExport = getData();
        extras = envelopeExtras;
    }
    
    const envelope = {
        app: 'dashboard',
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        data: dataToExport
    };
    
    for (const k of Object.keys(extras || {})) {
        if (!(k in envelope)) envelope[k] = extras[k];
    }
    
    downloadJson(`dashboard-backup-${new Date().toISOString().split('T')[0]}.json`, envelope);
}

// Draft recovery: the losing tab's unsaved work is downloadable, never lost.
export function exportDraft(data) {
    try {
        downloadJson(`dashboard-draft-${Date.now()}.json`, {
            app: 'dashboard',
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            draft: true,
            data: data || unsavedDraft || getData()
        });
    } catch (e) {
        console.error('Draft export failed:', e);
        throw e;
    }
}

// file: { text } in tests, or a File in the browser.
export function importData(file, onComplete) {
    if (storeStatus !== 'ready') {
        alert('Import rejected: store is in degraded mode. ' + (storeError || 'Initialization required.'));
        if (onComplete) onComplete({ committed: false, conflict: false, error: new Error('Degraded mode') });
        return;
    }
    const reader = new FileReader();
    // V5-STORE-02: settle exactly once on read failure or abort (onload never fires then).
    reader.onerror = () => {
        const res = { error: (reader.error || new Error('File read failed')), committed: false, conflict: false };
        if (onComplete) {
            try { onComplete(res); } catch (cbErr) { console.error('Import onComplete callback failed:', cbErr); }
        }
    };
    reader.onabort = () => {
        const res = { cancelled: true, committed: false, conflict: false };
        if (onComplete) {
            try { onComplete(res); } catch (cbErr) { console.error('Import onComplete callback failed:', cbErr); }
        }
    };
    reader.onload = async (e) => {
        let finalResult = null;
        try {
            const parsed = JSON.parse(e.target.result);
            // Re-check schema validation to strictly enforce rules
            if (parsed.app !== 'dashboard') throw new Error("Invalid import: wrong app");
            if (parsed.schemaVersion !== 1) throw new Error("Invalid import: unknown schemaVersion");
            
            let payload = null;
            // Validate BEFORE any confirmation or disk write.
            payload = parsed.data;
            validateImportData(payload);
            const data = normalizeImportData(payload);
            migratePlaces(data);
            
            // Baseline capture before confirm
            const snapshot = getData();
            const baseToken = snapshotTokens.get(snapshot);
            
            const confirmed = confirm(
                `Import backup from ${parsed.exportedAt || 'unknown date'}?\n` +
                'This REPLACES all current dashboard data. This cannot be undone.'
            );
            if (!confirmed) {
                finalResult = { cancelled: true, committed: false, conflict: false };
                return;
            }
            
            const extras = { ...parsed };
            delete extras.data;
            delete extras.app;
            delete extras.schemaVersion;
            delete extras.exportedAt;

            let db;
            try {
                db = await openDB();
            } catch(ex) {
                throw new Error("IDB open denied for import");
            }
            
            await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                
                let adoptedRecord = null;
                const getReq = store.get(RECORD_ID);
                getReq.onsuccess = () => {
                    const record = getReq.result;
                    if (record && baseToken && (record.generation !== baseToken.generation || record.revision !== baseToken.revision)) {
                        syncFromRecord(record);
                        lastConflictAt = new Date().toISOString();
                        tx.abort();
                        return;
                    }
                    
                    adoptedRecord = {
                        id: RECORD_ID,
                        storageFormatVersion: 1,
                        generation: crypto.randomUUID(),
                        revision: record ? record.revision + 1 : 1,
                        savedAt: new Date().toISOString(),
                        data: data,
                        envelopeExtras: extras
                    };
                    store.put(adoptedRecord);
                };
                
                tx.oncomplete = () => {
                    db.close();
                    syncFromRecord(adoptedRecord);
                    try {
                        if (typeof BroadcastChannel !== 'undefined') {
                            const bc = new BroadcastChannel('dashboard_store_sync');
                            bc.postMessage('sync');
                            bc.close();
                        }
                    } catch (notifyErr) {
                        console.warn('Import successful, but cross-tab notification failed:', notifyErr);
                    }
                    resolve();
                };
                
                tx.onabort = tx.onerror = () => {
                    db.close();
                    const err = tx.error || new Error('Transaction aborted');
                    // Ensure the conflict was triggered by THIS transaction
                    if (lastConflictAt && baseToken && (currentGeneration !== baseToken.generation || currentRevision !== baseToken.revision)) {
                        reject(new Error('Conflict: another tab updated the data first. Your current data is unchanged; the import draft was downloaded.'));
                    } else {
                        reject(new Error('Import transaction failed: ' + err.message));
                    }
                };
            });
            
            alert('Data imported successfully!');
            finalResult = { committed: true, conflict: false };
        } catch (err) {
            console.error('Import error:', err);
            if (err && err.message && err.message.includes('Conflict')) {
                finalResult = { conflict: true, committed: false };
                try {
                    // Try parsing again for the fallback block scope if payload isn't populated via try block closure reliably
                    let p = JSON.parse(e.target.result).data;
                    exportDraft(p);
                    alert('Import blocked: another tab updated the data first. Your current data is unchanged; the import draft was downloaded.');
                } catch(draftErr) {
                    let p = JSON.parse(e.target.result).data;
                    unsavedDraft = p;
                    alert('Import blocked: another tab updated the data first. Your draft is preserved in memory and can be exported manually.');
                }
            } else {
                finalResult = { error: err, committed: false, conflict: false };
                alert('Import failed: ' + (err && err.message ? err.message : err));
            }
        } finally {
            if (onComplete && finalResult) {
                try { onComplete(finalResult); } catch(cbErr) { console.error('Import onComplete callback failed:', cbErr); }
            }
        }
    };
    if (typeof file === 'string') reader.readAsText(file);
    else reader.readAsText(file instanceof Blob || file instanceof File ? file : new Blob([file.text !== undefined ? file.text : file]));
}
