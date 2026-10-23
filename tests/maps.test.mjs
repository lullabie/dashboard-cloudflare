import assert from 'node:assert';
import fs from 'node:fs';

// Since we cannot modify the original file to inject mocks safely and might need to avoid globals,
// we can use the data URL approach to mock store.js if needed.
// However, the simplest way is to see if we can just import it directly since the user said:
// "Use a direct import of the module under test."

// Let's try direct import. But since we need localStorage, we can define it on globalThis.
if (!globalThis.localStorage) {
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
}

import { getMapEmbedUrl } from '../js/maps.js';

let failures = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    console.error(err);
    failures++;
  }
}

// 1. 0 places
runTest('0 places returns null', () => {
  const result = getMapEmbedUrl([]);
  assert.strictEqual(result, null);

  const result2 = getMapEmbedUrl(null);
  assert.strictEqual(result2, null);
});

// 2. 1 place
runTest('1 place calculates bounding box with padding', () => {
  const places = [{ lat: 10, lng: 20 }];
  const url = getMapEmbedUrl(places);
  assert.ok(url.includes('bbox='), 'URL should include bbox');

  // URL should contain: baseUrl + ?bbox=...&layer=mapnik
  const urlObj = new URL(url);
  const bbox = urlObj.searchParams.get('bbox');
  assert.ok(bbox, 'bbox parameter should exist');

  const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);

  // padding logic:
  // latPadding = Math.max(0.01, 0) = 0.01
  // lngPadding = Math.max(0.01, 0) = 0.01
  // minLng = 20 - 0.01 = 19.99
  // minLat = 10 - 0.01 = 9.99
  // maxLng = 20 + 0.01 = 20.01
  // maxLat = 10 + 0.01 = 10.01
  assert.strictEqual(minLng, 19.99);
  assert.strictEqual(minLat, 9.99);
  assert.strictEqual(maxLng, 20.01);
  assert.strictEqual(maxLat, 10.01);
});

// 3. identical coordinates
runTest('places with identical coordinates', () => {
  const places = [
    { lat: 45, lng: 90 },
    { lat: 45, lng: 90 }
  ];
  const url = getMapEmbedUrl(places);
  const urlObj = new URL(url);
  const bbox = urlObj.searchParams.get('bbox');
  const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);

  assert.strictEqual(minLng, 89.99);
  assert.strictEqual(minLat, 44.99);
  assert.strictEqual(maxLng, 90.01);
  assert.strictEqual(maxLat, 45.01);
});

// 4. non-number coordinates
runTest('non-number coordinates', () => {
  const places = [
    { lat: "invalid", lng: "invalid" },
    { lat: "50", lng: "100" }
  ];
  const url = getMapEmbedUrl(places);
  const urlObj = new URL(url);
  const bbox = urlObj.searchParams.get('bbox');
  const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);

  // 'invalid' parses as NaN
  // if lat < minLat (NaN < 90 is false)
  // so NaN values are effectively ignored by the min/max checks if compared correctly,
  // BUT wait: parseFloat('invalid') is NaN.
  // NaN < 90 is false. NaN > -90 is false.
  // So the minLat/maxLat won't be updated by 'invalid'.
  // Thus, the bbox should only reflect the valid "50" and "100".
  // Let's verify what the code actually does.

  // padding for 50/100 is 0.01.
  assert.strictEqual(minLng, 99.99);
  assert.strictEqual(minLat, 49.99);
  assert.strictEqual(maxLng, 100.01);
  assert.strictEqual(maxLat, 50.01);
});

// 5. out-of-bounds coordinates
runTest('out-of-bounds latitudes and longitudes', () => {
  const places = [
    { lat: 100, lng: 200 }, // invalid lat > 90, lng > 180
    { lat: -100, lng: -200 } // invalid lat < -90, lng < -180
  ];
  const url = getMapEmbedUrl(places);
  const urlObj = new URL(url);
  const bbox = urlObj.searchParams.get('bbox');
  const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);

  // In the current code, it just uses the numbers as-is:
  // minLat = -100, maxLat = 100
  // minLng = -200, maxLng = 200
  // latPadding = (100 - -100) * 0.1 = 20
  // lngPadding = (200 - -200) * 0.1 = 40
  // bbox: minLng= -240, minLat= -120, maxLng= 240, maxLat= 120
  assert.strictEqual(minLng, -240);
  assert.strictEqual(minLat, -120);
  assert.strictEqual(maxLng, 240);
  assert.strictEqual(maxLat, 120);
});

if (failures > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
