// feeds-browser.spec.mjs — Lane D FEEDS browser QA, dashboard v6.
// Run: node qa/v4/feeds-browser.spec.mjs [--tree <path>]
//        [--results-out <path>]
//
// Real-browser cases for the feeds lane. Each case runs in a Chromium-family
// browser (Chrome/Brave/Chromium via QA_BROWSER) through
// Playwright against the app served from a local temporary origin. Feed
// responses come from a fixture server in this file. Timing is controlled
// by server-side barriers, not by sleeps alone. Data is invented only.
//
// Tree under test: --tree, else QA_TREE_ROOT, else DASH_TREE, else the
// checkout that contains this spec (qa/v4/ -> repo root, two levels up).
// The spec serves that tree as-is. It applies no patch, substitutes no
// source, and pins no hash. It reads and reports the actual js/store.js
// and js/feeds.js SHA-256 of the tested tree. Any FAIL or NOT RUN case
// makes the process exit nonzero. Results are written as JSON next to
// this spec (browser-results.json) unless --results-out or
// QA_RESULTS_OUT names another path. Lane E's schema supersedes it.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeBrowserResults } from '../../scripts/write-browser-results.mjs';
import { launchSelectedBrowser } from './browser-launch.mjs';
// Repo-local fixture builders (RSS, oversize, malformed).
import { buildMalformedXml, buildOversizeBody, buildRssXml } from './feed-responses.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
function argValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}
const TREE = path.resolve(
  argValue('--tree') ?? process.env.QA_TREE_ROOT ?? process.env.DASH_TREE ??
    path.resolve(here, '..', '..'),
);

function sha256File(file) {
  return existsSync(file)
    ? createHash('sha256').update(readFileSync(file)).digest('hex')
    : 'MISSING';
}
const STORE_SHA256 = sha256File(path.join(TREE, 'js', 'store.js'));
const FEEDS_SHA256 = sha256File(path.join(TREE, 'js', 'feeds.js'));

export const SOURCE_SNAPSHOT_LABEL =
  `REAL-BROWSER — tree under test: ${TREE}; js/store.js SHA-256 ${STORE_SHA256}; js/feeds.js SHA-256 ${FEEDS_SHA256}. Hashes are read from the tested tree at run time. No source is pinned or substituted.`;

const CASE_IDS = ['TEST-FEEDS-001', 'TEST-FEEDS-002', 'TEST-FEEDS-003', 'V5-FEEDS-01', 'V5-FEEDS-02', 'V5-FEEDS-03'];
let browserInfo = null;
const attemptedKind = String(process.env.QA_BROWSER ?? 'chromium').trim().toLowerCase() || 'chromium';
function currentRuntime() {
  const base = process.env.QA_RUNTIME ?? `node ${process.version}`;
  return browserInfo
    ? `${base}; browser ${browserInfo.actualName} ${browserInfo.version} (QA_BROWSER=${browserInfo.selection.kind})`
    : `${base}; browser ${attemptedKind} not launched`;
}

const results = [];

function record(id, boundary, status, detail) {
  results.push({ id, boundary, status, detail });
  console.log(`${status.padEnd(7)} ${id} [${boundary}] ${detail}`);
}

function notRunAll(blocker) {
  for (const id of CASE_IDS) record(id, 'REAL-BROWSER', 'NOT RUN', `Blocker: ${blocker}`);
  summarize();
}

function emitResults() {
  const out = process.env.QA_RESULTS_FILE ?? argValue('--results-out') ?? process.env.QA_RESULTS_OUT ??
    path.join(here, 'browser-results.json');
  try {
    writeBrowserResults({
      outFile: path.resolve(out),
      tree: TREE,
      testedCommit: process.env.QA_TESTED_COMMIT ?? 'working-tree',
      runtime: currentRuntime(),
      runId: process.env.QA_RUN_ID,
      cases: results,
    });
    console.log(`Machine results written: ${out}`);
  } catch (error) {
    console.error(`Machine results NOT written: ${error.message}`);
    process.exitCode = 1;
  }
}

function summarize() {
  const counts = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log('');
  console.log(`Summary: PASS ${counts.PASS ?? 0}; NOT RUN ${counts['NOT RUN'] ?? 0}; FAIL ${counts.FAIL ?? 0}`);
  console.log('Boundary rule: PASS here means the case ran in a real browser against the tree named in the source label.');
  if ((counts.FAIL ?? 0) > 0 || (counts['NOT RUN'] ?? 0) > 0) process.exitCode = 1;
  emitResults();
}

// --- Fixture server. One server serves the app and the feed endpoints. ---
// Held endpoints park each response until the test releases it by index.

function createFixtureServer(appDir) {
  const held = new Map(); // key -> { bodies: [], pending: [respond] }
  const seen = new Map(); // key -> request count
  const openSockets = new Set();
  let validARequests = 0;

  function holdState(key) {
    if (!held.has(key)) held.set(key, { bodies: [], pending: [] });
    return held.get(key);
  }

  const control = {
    setBodies(key, bodies) {
      holdState(key).bodies = bodies;
    },
    release(key, index = 0) {
      const state = holdState(key);
      const respond = state.pending[index];
      if (!respond) throw new Error(`No held response at index ${index} for ${key}`);
      state.pending.splice(index, 1);
      respond();
    },
    pendingCount(key) {
      return holdState(key).pending.length;
    },
    seenCount(key) {
      return seen.get(key) ?? 0;
    },
    destroyOpenSockets() {
      for (const socket of openSockets) socket.destroy();
      openSockets.clear();
    },
  };

  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/feed/')) {
      const key = pathname.slice('/feed/'.length);
      seen.set(key, (seen.get(key) ?? 0) + 1);
      if (key === 'valid-a.xml') {
        // First response carries one item. Later responses add a second.
        // TEST-FEEDS-001 uses this to prove a valid refresh preserves items.
        validARequests += 1;
        const items = [
          { id: 'alpha-001', title: 'Invented alpha item', url: 'https://example.com/articles/alpha', summary: 'First valid item.' },
        ];
        if (validARequests > 1) {
          items.push({ id: 'alpha-002', title: 'Invented alpha two', url: 'https://example.com/articles/alpha-two', summary: 'Added by a later valid response.' });
        }
        res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' });
        res.end(buildRssXml({ title: 'Invented Alpha', items }));
        return;
      }
      if (key.startsWith('hold-')) {
        const state = holdState(key);
        const requestIndex = seen.get(key) - 1;
        state.pending.push(() => {
          const body = state.bodies[requestIndex] ?? state.bodies[0] ?? localBuildRss({ items: [] });
          res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' });
          res.end(body);
        });
        return;
      }
      if (key === 'stall.xml') {
        // Headers and one partial chunk go out. The body never completes.
        res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' });
        res.write('<?xml version="1.0"?><rss><channel><title>Stalled Example</title>');
        return;
      }
      if (key === 'oversize.xml') {
        res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' });
        res.end(buildOversizeBody());
        return;
      }
      if (key === 'malformed.xml') {
        res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' });
        res.end(buildMalformedXml());
        return;
      }
      if (key === 'error500.xml') {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('invented server error');
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('unknown feed fixture');
      return;
    }

    // Static app files from the tree under test, served as-is.
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const filePath = path.join(appDir, relative);
    if (!filePath.startsWith(appDir)) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    readFile(filePath).then((bytes) => {
      res.writeHead(200, { 'content-type': mime[path.extname(filePath)] ?? 'application/octet-stream' });
      res.end(bytes);
    }).catch(() => {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    });
  });

  server.on('connection', (socket) => {
    openSockets.add(socket);
    socket.on('close', () => openSockets.delete(socket));
  });

  return { server, control };
}

// --- Page helpers. Each tab imports the real modules and inits the real store. ---

async function openTab(context, origin) {
  const page = await context.newPage();
  await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
  await page.evaluate(async () => {
    window.__store = await import('/js/store.js');
    window.__feeds = await import('/js/feeds.js');
    window.__init = await window.__store.initStore();
  });
  return page;
}

function tabEval(page, fn, arg) {
  return page.evaluate(fn, arg);
}

function readNews(page) {
  return tabEval(page, async () => {
    const news = await window.__feeds.getNewsData();
    return JSON.parse(JSON.stringify(news));
  });
}

function readEnvelope(page) {
  return tabEval(page, async () => {
    const record = await new Promise((resolve, reject) => {
      const req = indexedDB.open('dashboard_store', 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('store_records', 'readonly');
        const get = tx.objectStore('store_records').get(1);
        get.onsuccess = () => { resolve(get.result ?? null); db.close(); };
        get.onerror = () => reject(get.error);
      };
      req.onerror = () => reject(req.error);
    });
    return record ? { generation: record.generation, revision: record.revision } : null;
  });
}

function startRefresh(page) {
  return tabEval(page, () => {
    window.__refresh = { settled: false, error: null, doneAt: null };
    const startedAt = performance.now();
    window.__feeds.refreshFeeds().then(
      () => { window.__refresh = { settled: true, error: null, doneAt: performance.now() - startedAt }; },
      (error) => { window.__refresh = { settled: true, error: String(error?.message ?? error), doneAt: performance.now() - startedAt }; },
    );
    return true;
  });
}

function refreshState(page) {
  return tabEval(page, () => window.__refresh ?? { settled: false, error: null, doneAt: null });
}

async function waitFor(label, fn, { timeoutMs = 8000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

async function runCase(id, fn) {
  try {
    const detail = await fn();
    record(id, 'REAL-BROWSER', 'PASS', detail);
  } catch (error) {
    record(id, 'REAL-BROWSER', 'FAIL', (error?.stack ?? String(error)).split('\n').slice(0, 3).join(' | '));
  }
}

// --- Cases ---

async function caseFeeds001(browser, origin) {
  const context = await browser.newContext();
  try {
    const page = await openTab(context, origin);
    const feedUrl = `${origin}/feed/valid-a.xml`;
    await tabEval(page, async (url) => {
      await window.__feeds.saveSource({ id: 'src-alpha', name: 'Invented Alpha', url, category: 'global' });
    }, feedUrl);
    await tabEval(page, async () => { await window.__feeds.refreshFeeds(); });

    let news = await readNews(page);
    assert.equal(news.sources[0].status, 'ok', 'first refresh did not commit ok status');
    assert.ok(news.cache.some((item) => item.title === 'Invented alpha item'), 'first refresh item missing from cache');

    const envelopeBefore = await readEnvelope(page);
    assert.ok(envelopeBefore?.generation, 'no persisted envelope before reload');

    await page.reload({ waitUntil: 'load' });
    await page.evaluate(async () => {
      window.__store = await import('/js/store.js');
      window.__feeds = await import('/js/feeds.js');
      window.__init = await window.__store.initStore();
    });
    const envelopeAfter = await readEnvelope(page);
    assert.equal(envelopeAfter.generation, envelopeBefore.generation, 'generation changed across reload');
    news = await readNews(page);
    assert.ok(news.cache.some((item) => item.title === 'Invented alpha item'), 'persisted cache lost across reload');

    // The fixture body for valid-a gains a second item. A valid refresh must
    // keep the first item and add the second.
    await tabEval(page, async () => { await window.__feeds.refreshFeeds(); });
    news = await readNews(page);
    const titles = news.cache.filter((item) => item.sourceId === 'src-alpha').map((item) => item.title).sort();
    assert.deepEqual(titles, ['Invented alpha item', 'Invented alpha two'], `valid refresh did not preserve and extend cache: ${titles.join(', ')}`);
    return `cache persisted in IndexedDB; generation ${envelopeBefore.generation.slice(0, 8)} stable across reload; valid refresh preserved item 1 and added item 2`;
  } finally {
    await context.close();
  }
}

async function caseFeeds002(browser, origin, control) {
  const context = await browser.newContext();
  try {
    const tabA = await openTab(context, origin);
    const tabB = await openTab(context, origin);
    const feedUrl = `${origin}/feed/hold-a.xml`;
    control.setBodies('hold-a.xml', [buildRssXml({
      title: 'Invented Held',
      items: [{ id: 'held-001', title: 'Invented held item', url: 'https://example.com/articles/held', summary: 'Released after tab B commits.' }],
    })]);
    await tabEval(tabA, async (url) => {
      await window.__feeds.saveSource({ id: 'src-held', name: 'Invented Held', url, category: 'global' });
    }, feedUrl);

    await startRefresh(tabA);
    await waitFor('held request reaches fixture server', () => control.seenCount('hold-a.xml') >= 1);
    await waitFor('request token admitted in tab A', async () => {
      const news = await readNews(tabA);
      return news.sources[0]?._lastUpdateToken ? true : null;
    });

    // Tab B commits an accepted edit while tab A refresh is paused.
    await tabEval(tabB, async () => {
      await window.__feeds.saveManualEntry({
        id: 'manual-b', title: 'Invented manual from tab B', url: 'https://example.com/manual-b',
        category: 'global', published: '2026-10-21T01:00:00.000Z',
      });
    });

    // Wait until tab A memory shows tab B edit. BroadcastChannel sync is the
    // mechanism that lets the later commit build on the newer snapshot.
    await waitFor('tab A sees tab B edit', async () => {
      const news = await readNews(tabA);
      return news.manual.some((entry) => entry.id === 'manual-b') ? true : null;
    }, { timeoutMs: 5000 }).catch(() => null);

    control.release('hold-a.xml', 0);
    const settled = await waitFor('tab A refresh settles', async () => {
      const state = await refreshState(tabA);
      return state.settled ? state : null;
    }, { timeoutMs: 10000 });
    assert.equal(settled.error, null, `refresh rejected: ${settled.error}`);

    const news = await readNews(tabA);
    assert.ok(news.cache.some((item) => item.title === 'Invented held item'), 'refreshed item lost after cross-tab edit');
    assert.ok(news.manual.some((entry) => entry.id === 'manual-b'), 'tab B manual edit lost after refresh commit');
    return 'paused refresh committed after tab B edit; refreshed item and tab B manual entry both present';
  } finally {
    await context.close();
  }
}

async function caseFeeds003(browser, origin, control) {
  const details = [];

  // Phase R: two refreshes of one source. The newer response releases first.
  // The older response releases second and must not replace the newer items.
  {
    const context = await browser.newContext();
    try {
      const page = await openTab(context, origin);
      const feedUrl = `${origin}/feed/hold-r.xml`;
      control.setBodies('hold-r.xml', [
        buildRssXml({ title: 'Older', items: [{ id: 'old-001', title: 'Older response item', url: 'https://example.com/articles/old', summary: 'First request. Released last.' }] }),
        buildRssXml({ title: 'Newer', items: [{ id: 'new-001', title: 'Newer response item', url: 'https://example.com/articles/new', summary: 'Second request. Released first.' }] }),
      ]);
      await tabEval(page, async (url) => {
        await window.__feeds.saveSource({ id: 'src-race', name: 'Invented Race', url, category: 'global' });
      }, feedUrl);
      await startRefresh(page);
      await waitFor('first held request', () => control.pendingCount('hold-r.xml') >= 1);
      // A second refresh of the same source admits a newer token, then fetches.
      await tabEval(page, () => {
        window.__refresh2 = { settled: false, error: null };
        window.__feeds.refreshFeeds().then(
          () => { window.__refresh2 = { settled: true, error: null }; },
          (error) => { window.__refresh2 = { settled: true, error: String(error?.message ?? error) }; },
        );
      });
      await waitFor('second held request', () => control.pendingCount('hold-r.xml') >= 2);
      control.release('hold-r.xml', 1); // newer response first
      await waitFor('second refresh settles', async () => {
        const state = await tabEval(page, () => window.__refresh2);
        return state?.settled ? state : null;
      });
      control.release('hold-r.xml', 0); // older response last
      await waitFor('first refresh settles', async () => {
        const state = await refreshState(page);
        return state.settled ? state : null;
      });
      const news = await readNews(page);
      const titles = news.cache.filter((item) => item.sourceId === 'src-race').map((item) => item.title);
      assert.deepEqual(titles, ['Newer response item'], `reversed order broke the cache: ${titles.join(', ')}`);
      details.push('reversed order: newer items kept, older response blocked by token');
    } finally {
      await context.close();
    }
  }

  // Phase C: the source is deleted while its fetch is held. The late response
  // must not recreate the source or its items.
  {
    const context = await browser.newContext();
    try {
      const page = await openTab(context, origin);
      const feedUrl = `${origin}/feed/hold-c.xml`;
      control.setBodies('hold-c.xml', [
        buildRssXml({ title: 'Ghost', items: [{ id: 'ghost-001', title: 'Ghost item', url: 'https://example.com/articles/ghost', summary: 'Source deleted mid-flight.' }] }),
      ]);
      await tabEval(page, async (url) => {
        await window.__feeds.saveSource({ id: 'src-ghost', name: 'Invented Ghost', url, category: 'global' });
      }, feedUrl);
      await startRefresh(page);
      await waitFor('ghost request held', () => control.pendingCount('hold-c.xml') >= 1);
      await tabEval(page, async () => { await window.__feeds.deleteSource('src-ghost'); });
      control.release('hold-c.xml', 0);
      await waitFor('ghost refresh settles', async () => {
        const state = await refreshState(page);
        return state.settled ? state : null;
      });
      const news = await readNews(page);
      assert.equal(news.sources.some((s) => s.id === 'src-ghost'), false, 'deleted source was recreated');
      assert.equal(news.cache.some((item) => item.sourceId === 'src-ghost'), false, 'items from a deleted source were committed');
      details.push('deleted source: late response committed nothing');
    } finally {
      await context.close();
    }
  }

  // Phase B: oversize, malformed and HTTP 500 responses preserve the last
  // valid cache. The stalled-body timeout case is V5-FEEDS-01.
  {
    const context = await browser.newContext();
    try {
      const page = await openTab(context, origin);
      await tabEval(page, async (url) => {
        await window.__feeds.saveSource({ id: 'src-good', name: 'Invented Good', url, category: 'global' });
      }, `${origin}/feed/valid-a.xml`);
      await tabEval(page, async () => { await window.__feeds.refreshFeeds(); });
      let news = await readNews(page);
      assert.ok(news.cache.some((item) => item.title === 'Invented alpha item'), 'seed refresh failed');

      for (const badPath of ['oversize.xml', 'malformed.xml', 'error500.xml']) {
        await tabEval(page, async (url) => {
          await window.__feeds.saveSource({ id: 'src-good', url });
        }, `${origin}/feed/${badPath}`);
        await tabEval(page, async () => { await window.__feeds.refreshFeeds(); });
        news = await readNews(page);
        const source = news.sources.find((s) => s.id === 'src-good');
        assert.equal(source.status, 'error', `${badPath}: source not marked error`);
        assert.ok(news.cache.some((item) => item.title === 'Invented alpha item'), `${badPath}: last valid cache was lost`);
      }
      details.push('oversize, malformed and HTTP 500 each preserved the last valid cache');
    } finally {
      await context.close();
    }
  }

  return details.join('; ');
}

async function caseV5Feeds01(browser, origin, control) {
  const context = await browser.newContext();
  try {
    const page = await openTab(context, origin);
    await tabEval(page, async (url) => {
      await window.__feeds.saveSource({ id: 'src-stall', name: 'Invented Stall', url, category: 'global' });
    }, `${origin}/feed/valid-a.xml`);
    await tabEval(page, async () => { await window.__feeds.refreshFeeds(); });
    let news = await readNews(page);
    assert.ok(news.cache.some((item) => item.title === 'Invented alpha item'), 'seed refresh failed');

    // Same source now points at the stalled-body endpoint. Headers arrive at
    // once. The body never completes. The 15 second deadline must still fire.
    await tabEval(page, async (url) => {
      await window.__feeds.saveSource({ id: 'src-stall', url });
    }, `${origin}/feed/stall.xml`);
    const t0 = Date.now();
    await startRefresh(page);
    await waitFor('stall request reaches fixture server', () => control.seenCount('stall.xml') >= 1, { timeoutMs: 5000 });

    const early = await refreshState(page);
    assert.equal(early.settled, false, 'refresh settled at headers, before body completion');

    const settled = await waitFor('refresh settles at the deadline', async () => {
      const state = await refreshState(page);
      return state.settled ? state : null;
    }, { timeoutMs: 21000, intervalMs: 250 }).catch(() => null);
    const elapsedMs = Date.now() - t0;
    assert.ok(settled, `refresh still pending ${Math.round(elapsedMs / 1000)}s after headers arrived; the 15s deadline does not cover body consumption`);
    assert.ok(elapsedMs >= 13000 && elapsedMs <= 20000, `refresh settled at ${elapsedMs}ms, outside the 13-20s deadline window`);
    news = await readNews(page);
    const source = news.sources.find((s) => s.id === 'src-stall');
    assert.equal(source.status, 'error', 'stalled refresh did not record an error status');
    assert.match(source.reason ?? '', /timed out/i, `unexpected stall reason: ${source.reason}`);
    assert.ok(news.cache.some((item) => item.title === 'Invented alpha item'), 'last valid cache lost after stall timeout');
    return `stalled body settled at ${elapsedMs}ms with timeout error; last valid cache preserved`;
  } finally {
    control.destroyOpenSockets();
    await context.close();
  }
}

async function caseV5Feeds02(browser, origin, control) {
  const context = await browser.newContext();
  try {
    const tabA = await openTab(context, origin);
    const tabB = await openTab(context, origin);
    const feedUrl = `${origin}/feed/hold-b.xml`;
    control.setBodies('hold-b.xml', [
      buildRssXml({ title: 'Invented Fence', items: [{ id: 'fence-001', title: 'Invented fenced item', url: 'https://example.com/articles/fence', summary: 'Fetched while category was global.' }] }),
    ]);
    await tabEval(tabA, async (url) => {
      await window.__feeds.saveSource({ id: 'src-fence', name: 'Invented Fence', url, category: 'global' });
    }, feedUrl);
    await startRefresh(tabA);
    await waitFor('fence request held', () => control.pendingCount('hold-b.xml') >= 1);
    await waitFor('request token admitted', async () => {
      const news = await readNews(tabA);
      return news.sources[0]?._lastUpdateToken ? true : null;
    });

    // The category edit lands while the fetch is in flight. URL stays equal.
    await tabEval(tabB, async () => {
      await window.__feeds.saveSource({ id: 'src-fence', category: 'canada' });
    });
    await waitFor('tab A sees category edit', async () => {
      const news = await readNews(tabA);
      return news.sources[0]?.category === 'canada' ? true : null;
    }, { timeoutMs: 5000 }).catch(() => null);

    control.release('hold-b.xml', 0);
    await waitFor('fence refresh settles', async () => {
      const state = await refreshState(tabA);
      return state.settled ? state : null;
    }, { timeoutMs: 10000 });

    const news = await readNews(tabA);
    const items = news.cache.filter((item) => item.sourceId === 'src-fence');
    const stale = items.filter((item) => item.category !== 'canada');
    assert.equal(stale.length, 0, `stale commit: ${items.length} item(s) fetched under category global were committed after the source category changed to canada`);
    return items.length === 0
      ? 'category edit during fetch blocked the stale commit; no items committed'
      : 'committed items carry the current source category';
  } finally {
    await context.close();
  }
}

async function caseV5Feeds03(browser, origin) {
  const context = await browser.newContext();
  try {
    const page = await openTab(context, origin);
    await tabEval(page, async () => {
      await window.__feeds.saveManualEntry({
        id: 'manual-keep', title: 'Invented keep entry', url: 'https://example.com/keep',
        category: 'global', published: '2026-10-21T01:00:00.000Z',
      });
    });

    // Part 1: a javascript: URL must not persist through the save path.
    const saveOutcome = await tabEval(page, async () => {
      try {
        await window.__feeds.saveManualEntry({
          id: 'manual-unsafe', title: 'Invented unsafe entry', url: 'javascript:alert(1)',
          category: 'global', published: '2026-10-21T01:00:00.000Z',
        });
        return 'resolved';
      } catch {
        return 'rejected';
      }
    });
    let news = await readNews(page);
    const persistedUnsafe = news.manual.filter((entry) => /^javascript:/i.test(entry.url ?? ''));
    assert.equal(persistedUnsafe.length, 0, `javascript: URL persisted through saveManualEntry (save ${saveOutcome})`);

    // Part 2: blank and https: records still save. Unrelated entries stay.
    await tabEval(page, async () => {
      await window.__feeds.saveManualEntry({
        id: 'manual-blank', title: 'Invented blank link entry', url: '',
        category: 'global', published: '2026-10-21T01:00:00.000Z',
      });
      await window.__feeds.saveManualEntry({
        id: 'manual-https', title: 'Invented https entry', url: 'https://example.com/ok',
        category: 'global', published: '2026-10-21T01:00:00.000Z',
      });
    });
    news = await readNews(page);
    assert.ok(news.manual.some((entry) => entry.id === 'manual-blank'), 'blank-link manual record was not preserved');
    assert.ok(news.manual.some((entry) => entry.id === 'manual-https'), 'https manual record was not preserved');
    assert.ok(news.manual.some((entry) => entry.id === 'manual-keep'), 'unrelated manual entry was lost');

    // Part 3: a legacy record that already holds a javascript: URL must
    // render inert. Seed it through the tracked store snapshot, then render.
    // Inert means: no anchor carries an unsafe href. Rendering no anchor at
    // all (a non-link text element) is the strongest inert form and passes;
    // a live javascript:/data: href on any anchor fails.
    const renderInfo = await tabEval(page, async () => {
      const snapshot = window.__store.getData();
      snapshot.news.manual.push({
        id: 'manual-legacy', title: 'Invented legacy entry', url: 'javascript:alert(2)',
        category: 'global', published: '2026-10-21T01:00:00.000Z',
      });
      await window.__store.saveData(snapshot);
      const card = window.__feeds.createNewsCard(
        { id: 'manual-legacy', title: 'Invented legacy entry', url: 'javascript:alert(2)', category: 'global', published: '2026-10-21T01:00:00.000Z' },
        true,
        () => {},
      );
      document.body.appendChild(card);
      const hrefs = Array.from(card.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
      const viewText = Array.from(card.querySelectorAll('a, span')).some((el) => el.textContent === 'View article');
      return { hrefs, viewText };
    });
    assert.ok(renderInfo.viewText, 'rendered card lost its View article element');
    for (const href of renderInfo.hrefs) {
      assert.ok(!/^(javascript|data|vbscript):/i.test(href), `unsafe legacy link rendered as a live href: ${href}`);
    }
    return `save path rejected or dropped the javascript: URL (save ${saveOutcome}); blank and https records preserved; legacy link rendered inert (anchor hrefs: ${JSON.stringify(renderInfo.hrefs)})`;
  } finally {
    await context.close();
  }
}

// --- Runner ---

console.log(SOURCE_SNAPSHOT_LABEL);
console.log('');

let browser;
try {
  browserInfo = await launchSelectedBrowser();
  browser = browserInfo.browser;
} catch (error) {
  notRunAll(`Browser launch failed: ${error.message.split('\n')[0]}. Documented route: the pinned install in qa/v4/README.md.`);
  process.exit(1);
}

for (const required of ['index.html', path.join('js', 'feeds.js'), path.join('js', 'store.js')]) {
  if (!existsSync(path.join(TREE, required))) {
    await browser.close();
    notRunAll(`tree under test lacks ${required}: ${TREE}`);
    process.exit(1);
  }
}
const appDir = TREE;

const { server, control } = createFixtureServer(appDir);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

await runCase('TEST-FEEDS-001', () => caseFeeds001(browser, origin));
await runCase('TEST-FEEDS-002', () => caseFeeds002(browser, origin, control));
await runCase('TEST-FEEDS-003', () => caseFeeds003(browser, origin, control));
await runCase('V5-FEEDS-01', () => caseV5Feeds01(browser, origin, control));
await runCase('V5-FEEDS-02', () => caseV5Feeds02(browser, origin, control));
await runCase('V5-FEEDS-03', () => caseV5Feeds03(browser, origin));

await browser.close();
server.close();
summarize();
