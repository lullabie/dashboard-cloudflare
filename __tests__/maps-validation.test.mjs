// Maps coordinate validation tests (V9-B finding 1). Run: node __tests__/maps-validation.test.mjs
// js/maps.js is loaded via a data URL with its './store.js' import replaced by an
// in-memory mock store (same technique as __tests__/feeds-v4-contract.test.mjs),
// because the real js/store.js requires IndexedDB. The mock mirrors the real
// getData() deep-copy contract and counts saveData calls. Invented records only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const mapsCode = fs.readFileSync(path.resolve('js/maps.js'), 'utf8');

const mockStoreCode = `
    let storeData = { places: [] };
    export const mockState = { saveCalls: 0 };
    export function getData() { return JSON.parse(JSON.stringify(storeData)); }
    export async function saveData(data) {
        mockState.saveCalls++;
        storeData = JSON.parse(JSON.stringify(data));
        return { committed: true, conflict: false };
    }
    export function __setPlaces(places) { storeData = { places: JSON.parse(JSON.stringify(places)) }; }
    export function __getPlaces() { return JSON.parse(JSON.stringify(storeData.places || [])); }
`;
const mockStoreUrl = `data:text/javascript;base64,${Buffer.from(mockStoreCode).toString('base64')}`;
const testMapsCode = mapsCode.replace(
    /import \{ getData, saveData \} from '\.\/store\.js';/,
    `import { getData, saveData } from '${mockStoreUrl}';`
);
assert.notStrictEqual(testMapsCode, mapsCode, 'store import replacement must apply');
const maps = await import(`data:text/javascript;base64,${Buffer.from(testMapsCode).toString('base64')}`);
const store = await import(mockStoreUrl);
const { isValidCoordinate, savePlace, getMapEmbedUrl, createPlaceElement } = maps;
const { mockState, __setPlaces, __getPlaces } = store;

// Minimal DOM stub for createPlaceElement (same shape as other suites).
class El {
    constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.className = ''; this.textContent = ''; }
    setAttribute() {}
    addEventListener() {}
    appendChild(c) { this.children.push(c); return c; }
}
globalThis.document = { createElement: (tag) => new El(tag) };
globalThis.confirm = () => true;
function findCoords(el) {
    if (el.className === 'place-coords') return el;
    for (const c of el.children || []) { const r = findCoords(c); if (r) return r; }
    return null;
}

const EXPECTED_ERROR = 'Invalid coordinates: latitude must be a finite number from -90 to 90 and longitude from -180 to 180';
const validPlace = { id: 'p_valid', name: 'ValidPlace', lat: 43.65, lng: -79.38 };
const invalidPlace = { id: 'p_bad', name: 'BadPlace', lat: 999, lng: 0 };

let passed = 0;
let failed = 0;
const pass = (name) => { console.log('PASS [MOCK]:', name); passed++; };
const fail = (name, err) => { console.error('FAIL [MOCK]:', name, '-', err && err.message ? err.message : err); failed++; };
async function check(name, fn) {
    try { await fn(); pass(name); } catch (e) { fail(name, e); }
}

await check('isValidCoordinate accepts range edges and zero', () => {
    assert.strictEqual(typeof isValidCoordinate, 'function', 'isValidCoordinate must be exported');
    assert.strictEqual(isValidCoordinate(90, 180), true);
    assert.strictEqual(isValidCoordinate(-90, -180), true);
    assert.strictEqual(isValidCoordinate(90, -180), true);
    assert.strictEqual(isValidCoordinate(-90, 180), true);
    assert.strictEqual(isValidCoordinate(0, 0), true);
    assert.strictEqual(isValidCoordinate(43.65, -79.38), true);
});

await check('isValidCoordinate rejects out-of-range and non-finite input', () => {
    assert.strictEqual(isValidCoordinate(90.0001, 0), false);
    assert.strictEqual(isValidCoordinate(-90.0001, 0), false);
    assert.strictEqual(isValidCoordinate(0, 180.0001), false);
    assert.strictEqual(isValidCoordinate(0, -180.0001), false);
    assert.strictEqual(isValidCoordinate(999, 0), false);
    assert.strictEqual(isValidCoordinate(NaN, 0), false);
    assert.strictEqual(isValidCoordinate(0, NaN), false);
    assert.strictEqual(isValidCoordinate('abc', 0), false);
    assert.strictEqual(isValidCoordinate(undefined, 0), false);
    assert.strictEqual(isValidCoordinate(0, undefined), false);
    assert.strictEqual(isValidCoordinate(undefined, undefined), false);
});

await check('savePlace invalid create is rejected, dataset unchanged, saveData not called', async () => {
    __setPlaces([validPlace]);
    const callsBefore = mockState.saveCalls;
    await assert.rejects(
        savePlace({ name: 'NewBad', lat: 999, lng: 0 }),
        (e) => e instanceof Error && e.message === EXPECTED_ERROR
    );
    assert.strictEqual(mockState.saveCalls, callsBefore, 'saveData must not be called');
    assert.deepStrictEqual(__getPlaces(), [validPlace], 'stored places must be unchanged');
});

await check('savePlace invalid update is rejected, original record retained, saveData not called', async () => {
    __setPlaces([validPlace]);
    const callsBefore = mockState.saveCalls;
    await assert.rejects(
        savePlace({ id: 'p_valid', lat: 999, lng: 0 }),
        (e) => e instanceof Error && e.message === EXPECTED_ERROR
    );
    assert.strictEqual(mockState.saveCalls, callsBefore, 'saveData must not be called');
    assert.deepStrictEqual(__getPlaces(), [validPlace], 'original record must be retained');
});

await check('savePlace valid create and update still save', async () => {
    __setPlaces([validPlace]);
    const callsBefore = mockState.saveCalls;
    await savePlace({ name: 'NewValid', lat: 45.5, lng: -73.5 });
    let places = __getPlaces();
    assert.strictEqual(places.length, 2);
    assert.strictEqual(places[1].lat, 45.5);
    assert.strictEqual(places[1].lng, -73.5);
    await savePlace({ id: 'p_valid', lat: 44, lng: -80 });
    places = __getPlaces();
    assert.strictEqual(places[0].lat, 44);
    assert.strictEqual(places[0].lng, -80);
    assert.strictEqual(mockState.saveCalls, callsBefore + 2);
});

await check('getMapEmbedUrl invalid active falls back to valid-places bbox with no marker', () => {
    const fallback = getMapEmbedUrl([validPlace, invalidPlace], invalidPlace);
    assert.notStrictEqual(fallback, null, 'invalid active must not blank the map');
    assert.strictEqual(fallback, getMapEmbedUrl([validPlace], null), 'fallback must equal the no-active URL for the valid places');
    assert.ok(fallback.includes('bbox='), 'fallback must carry the valid place bbox');
    assert.ok(!fallback.includes('marker'), 'fallback must not carry a marker for the invalid place');
});

await check('getMapEmbedUrl all-invalid returns null', () => {
    assert.strictEqual(getMapEmbedUrl([invalidPlace], invalidPlace), null);
    assert.strictEqual(getMapEmbedUrl([invalidPlace], null), null);
    assert.strictEqual(getMapEmbedUrl([], null), null);
});

await check('getMapEmbedUrl valid active URL is unchanged (marker present)', () => {
    // Exact URL produced by the unedited code for this input (repro, V9-B finding 1).
    const expected = 'https://www.openstreetmap.org/export/embed.html?bbox=-79.39%2C43.64%2C-79.36999999999999%2C43.66&layer=mapnik&marker=43.65%2C-79.38';
    assert.strictEqual(getMapEmbedUrl([validPlace], validPlace), expected);
});

await check('createPlaceElement shows raw stored values for an invalid place, toFixed(4) for a valid place', () => {
    const elBad = createPlaceElement({ ...invalidPlace }, () => {}, () => {}, () => {}, false);
    assert.strictEqual(findCoords(elBad)?.textContent, '999, 0');
    const elNonFinite = createPlaceElement({ id: 'p_x', name: 'BadStored', lat: 'abc', lng: 0 }, () => {}, () => {}, () => {}, false);
    assert.strictEqual(findCoords(elNonFinite)?.textContent, 'abc, 0');
    const elValid = createPlaceElement({ ...validPlace }, () => {}, () => {}, () => {}, false);
    assert.strictEqual(findCoords(elValid)?.textContent, '43.6500, -79.3800');
});

console.log(`\nmaps-validation: ${passed} passed, ${failed} failed [MOCK]`);
if (failed > 0) process.exit(1);
