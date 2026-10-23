// acceptance.spec.mjs — Track D QA preparation skeleton.
// Run: node qa/v4/acceptance.spec.mjs
//
// This file is a harness skeleton. It checks fixture shape and test-only fault
// or response primitives where Node can do so. It does not import production
// modules and it does not establish integrated acceptance. Browser-required
// cases report NOT RUN with the missing precondition instead of a false pass.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CountingBroadcastChannel,
  createReadinessGate,
  installBroadcastChannelFault,
  makePostCommitNotificationFailure,
} from './storage-faults.mjs';
import {
  buildMalformedXml,
  buildOversizeBody,
  createOrderedFeedServer,
  exceedsByteCap,
  fetchWithTimeout,
  standardFeedPlan,
} from './feed-responses.mjs';

export const SOURCE_SNAPSHOT_LABEL =
  'FROZEN-SOURCE SHAPE CHECK ONLY — base 29d43ff04a6abb257b5046c85f2fcba6f0bb679d; STORE patch 8b02dce00f4cd5b3b10bcce05e74f82bec98e0b5382e3e9188ea65d2e5198193; store.js b600175c04e7100e8bb7bb6a8e5cd899f5eb0cb6663cd16f85ad64c22074be11; MAIN patch 00b6939d970fb9b46ff8d6c3effc04a53b658562dd97ee721b3428dc13c3e5c1; HABITS patch 67d9ab66e4527fcfd30c6cb55009f4e3817f0e3d678e989352c79844ae265431; PROGRESS patch ee317ac5b5037f600d3750a1308caae37c803cf4cfcf13a35b78868b70fb8bcb; FEEDS repaired source unavailable. NOT INTEGRATED ACCEPTANCE.';

const fixture = JSON.parse(readFileSync(new URL('./dashboard-invented.json', import.meta.url), 'utf8'));
const results = [];

function record(id, boundary, status, detail) {
  results.push({ id, boundary, status, detail });
  console.log(`${status.padEnd(7)} ${id} [${boundary}] ${detail}`);
}

function browserNotRun(id, precondition, detail = '') {
  record(
    id,
    'REAL-BROWSER',
    'NOT RUN',
    `Missing precondition: ${precondition}${detail ? `; ${detail}` : ''}`,
  );
}

async function group(id, boundary, fn) {
  try {
    const detail = await fn();
    record(id, boundary, 'PASS', detail);
  } catch (error) {
    record(id, boundary, 'FAIL', error?.stack ?? String(error));
  }
}

function toTrackedSnapshot(source) {
  // Shape used by the store contract in QA fixtures: a caller-held snapshot
  // carries revision/generation plus the data collections. saveData accepts
  // only a snapshot obtained from getData; this helper models that shape.
  return {
    revision: source.revision,
    generation: source.generation,
    data: structuredClone({
      goals: source.goals,
      habits: source.habits,
      news: source.news,
      settings: source.settings,
    }),
  };
}

function isValidIso(value) {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function normalizeHabitOccurrence(value) {
  if (value === true) return { completed: true, legacy: true, completedAt: null };
  if (value === 'done') return { completed: true, legacy: true, completedAt: null };
  if (value && typeof value === 'object' && isValidIso(value.completedAt)) {
    return { completed: true, legacy: false, completedAt: value.completedAt };
  }
  return { completed: false, legacy: false, completedAt: null };
}

function isDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

console.log(SOURCE_SNAPSHOT_LABEL);
console.log('');

// TEST-UI-001 — complete imports and startup.
{
  const requiredCollections = ['goals', 'habits', 'news', 'settings'];
  const precheckPass = requiredCollections.every((key) => key in fixture);
  assert.equal(precheckPass, true, 'invented fixture lacks a required top-level collection');
  browserNotRun(
    'TEST-UI-001',
    'assembled frozen review commit + local server + isolated browser profile/origin + browser runner',
    'fixture shape precheck passed; Today, Goals and Updates startup remain unproven until the browser case runs',
  );
}

// TEST-STORE-001 — degraded init and failed re-init block writes; reads/export remain.
await group('TEST-STORE-001', 'MOCK harness', async () => {
  const gate = createReadinessGate();
  assert.throws(() => gate.assertWriteAllowed(), /Write blocked/);

  const fault = installBroadcastChannelFault({ failFirst: true });
  let constructionError = null;
  try {
    // eslint-disable-next-line no-new
    new globalThis.BroadcastChannel('dashboard-invented');
  } catch (error) {
    constructionError = error;
  } finally {
    fault.restore();
  }
  assert.equal(constructionError?.name, 'BroadcastChannelConstructionError');

  gate.markDegraded(constructionError);
  const snapshot = toTrackedSnapshot(fixture);
  assert.throws(() => gate.saveForHarness(snapshot), /Write blocked while store status is degraded/);
  assert.equal(gate.writes().length, 0, 'degraded save performed a write');

  const readable = structuredClone(snapshot.data);
  assert.equal(readable.habits[0].occurrences['2026-10-21'].completedAt, '2026-10-21T04:30:00.000Z');
  return 'fault injection throws; degraded gate rejects save with zero harness writes; committed fixture data stays readable';
});

// TEST-STORE-002 — explicit recovery permits one durable save; reload preserves it.
await group('TEST-STORE-002', 'MOCK harness', async () => {
  const gate = createReadinessGate();
  gate.markDegraded(new Error('initial harness failure'));
  assert.throws(() => gate.saveForHarness(toTrackedSnapshot(fixture)), /Write blocked/);

  gate.markReady();
  const result = gate.saveForHarness(toTrackedSnapshot(fixture));
  assert.deepEqual(result, { committed: true, conflict: false, writeCount: 1 });

  const reloaded = structuredClone(gate.writes()[0]);
  assert.equal(reloaded.revision, 12);
  assert.equal(reloaded.data.goals[0].checkIns['2026-10-21'], true);
  assert.equal(reloaded.data.habits[0].occurrences['2026-10-21'].completedAt, '2026-10-21T04:30:00.000Z');
  return 'successful explicit recovery permits exactly one harness save; cloned reload preserves revision and record shapes';
});

// TEST-STORE-003 — repeated init leaves one active subscription; two real tabs refresh.
browserNotRun(
  'TEST-STORE-003',
  'two real browser tabs on one isolated origin with native BroadcastChannel and real IndexedDB',
  `CountingBroadcastChannel double is available for harness counts (active=${CountingBroadcastChannel.activeCount()} before browser work); it is not a substitute for native two-tab evidence`,
);

// TEST-STORE-004 — post-commit notification failure settles accurately; no duplicate retry.
await group('TEST-STORE-004', 'MOCK harness', async () => {
  const gate = createReadinessGate();
  gate.markReady();
  const commit = gate.saveForHarness(toTrackedSnapshot(fixture));
  const notifyAfterCommit = makePostCommitNotificationFailure(() => {});
  const settled = await notifyAfterCommit(commit);

  assert.equal(settled.committed, true);
  assert.equal(settled.retryInduced, false);
  assert.match(settled.notificationError, /post-commit notification failure/);
  assert.equal(gate.writes().length, 1, 'notification failure induced a duplicate write');
  return 'save promise settles as committed with a separate notification error; exactly one harness write remains';
});

// TEST-FEEDS-001 — persisted cache/generation, module reload, valid refresh preserved.
{
  assert.equal(fixture.news._lastUpdateGen, 5, 'fixture must carry the persisted generation shape');
  assert.equal(fixture.news.sources[0].url, 'https://example.com/feed.xml');
  browserNotRun(
    'TEST-FEEDS-001',
    'repaired feeds source + persisted IndexedDB cache/generation + module reload + browser or module acceptance runner',
    'persisted generation shape precheck passed; reload behavior remains unproven',
  );
}

// TEST-FEEDS-002 — paused refresh plus another tab accepted edit loses neither change.
browserNotRun(
  'TEST-FEEDS-002',
  'two real tabs, repaired feeds source, tracked store snapshots, and a paused refresh barrier released after the second tab commits',
  'feed-responses.mjs supplies the deterministic barrier; cross-tab production behavior remains unproven',
);

// TEST-FEEDS-003 — response ordering and bad responses preserve ordering and last valid cache.
await group('TEST-FEEDS-003', 'MOCK harness', async () => {
  const { plan } = standardFeedPlan();
  const server = createOrderedFeedServer(plan);

  const olderPromise = server.fetch('https://example.com/older.xml');
  const newerPromise = server.fetch('https://example.com/newer.xml');

  server.release('https://example.com/newer.xml');
  const newerText = await (await newerPromise).text();
  server.release('https://example.com/older.xml');
  const olderText = await (await olderPromise).text();

  let accepted = null;
  const applyIfNewer = (token, text) => {
    if (!accepted || token > accepted.token) accepted = { token, text };
  };
  applyIfNewer(2, newerText);
  applyIfNewer(1, olderText);
  assert.match(accepted.text, /Newer invented item/);
  assert.doesNotMatch(accepted.text, /Older invented item/);

  assert.equal(exceedsByteCap(buildOversizeBody()), true, 'oversize body was not detected by byte cap');
  const malformed = buildMalformedXml();
  assert.equal(malformed.includes('</rss>'), false, 'malformed fixture unexpectedly closes the RSS document');

  const held = createOrderedFeedServer({
    'https://example.com/held.xml': { body: '<rss version="2.0"></rss>' },
  });
  await assert.rejects(
    fetchWithTimeout(held.fetch, 'https://example.com/held.xml', { timeoutMs: 5 }),
    (error) => error?.name === 'TimeoutError',
  );
  held.releaseAll();

  return 'barrier-controlled newer response wins over a later-released older response; oversize, malformed and timeout primitives are detectable';
});

// TEST-HABITS-001 — completedAt create/remove; summary, reload and local-day agree on shape.
await group('TEST-HABITS-001', 'MOCK/SHAPE harness', async () => {
  const habit = structuredClone(fixture.habits[0]);
  const day = '2026-10-21';
  assert.equal(isDateKey(day), true);
  assert.deepEqual(normalizeHabitOccurrence(habit.occurrences[day]), {
    completed: true,
    legacy: false,
    completedAt: '2026-10-21T04:30:00.000Z',
  });

  habit.occurrences['2026-10-22'] = { completedAt: '2026-10-22T04:45:00.000Z' };
  assert.equal(normalizeHabitOccurrence(habit.occurrences['2026-10-22']).completed, true);
  delete habit.occurrences['2026-10-22'];
  assert.equal('2026-10-22' in habit.occurrences, false);

  const legacy = normalizeHabitOccurrence(fixture.habits[1].occurrences['2026-10-20']);
  assert.equal(legacy.completed, true);
  assert.equal(legacy.legacy, true);

  const reloaded = structuredClone(habit);
  assert.equal(reloaded.occurrences[day].completedAt, '2026-10-21T04:30:00.000Z');
  return 'completedAt object validates; create/remove works on the real occurrence shape; legacy true remains completed; cloned reload preserves the day entry';
});

// TEST-UI-002 — browser interaction bundle; every subcase stays separate.
browserNotRun(
  'TEST-UI-002',
  'assembled app in a real browser with keyboard control, import/export controls, 320x568 viewport, 375px viewport and reduced-motion setting',
  'subcases not run: TEST-UI-002a form rejection retains input; TEST-UI-002b retry; TEST-UI-002c import cancel; TEST-UI-002d import reject; TEST-UI-002e import repeat selection; TEST-UI-002f export readback; TEST-UI-002g keyboard focus; TEST-UI-002h 320x568 layout; TEST-UI-002i 375px layout; TEST-UI-002j reduced motion',
);

const counts = results.reduce((acc, result) => {
  acc[result.status] = (acc[result.status] ?? 0) + 1;
  return acc;
}, {});

console.log('');
console.log(`Summary: PASS ${counts.PASS ?? 0}; NOT RUN ${counts['NOT RUN'] ?? 0}; FAIL ${counts.FAIL ?? 0}`);
console.log('Boundary rule: PASS here means harness/shape only unless the group boundary says REAL-BROWSER and the case actually ran.');
if ((counts.FAIL ?? 0) > 0) process.exitCode = 1;
