// feeds-browser.spec.mjs — Lane D FEEDS browser QA, dashboard v5.
// Run: node qa/v4/feeds-browser.spec.mjs
//
// Real-browser cases for the feeds lane. Each case runs in Firefox through
// Playwright against the assembled app served from a local temporary origin.
// Feed responses come from a fixture server in this file. Timing is controlled
// by server-side barriers, not by sleeps alone. Data is invented only.
//
// App under test: the v4 assembly tree plus the selected v4 STORE and FEEDS
// post-images, staged into a scratch copy under /tmp. The assembly tree and
// the production sources are never edited by this file.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

export const SOURCE_SNAPSHOT_LABEL =
  'REAL-BROWSER — app: v4 assembly tree (base 29d43ff04a6abb257b5046c85f2fcba6f0bb679d) staged in /tmp with selected STORE patch 777d74ceddcc8bf76d3c3cfcb510d122a32820613bf490b16d05af0aeaecddc4 (store.js d613cf1890995fa09b56fd3f7cb3f2b0638b79098429b572dd74ec9ed501d6e4) and selected FEEDS patch 2b44a190e684736285921676f4b2c9761c76c0ab9b26032c09240831007b72ab (feeds.js aaa6ea7dbb0214c7a348e962779a65d5392bd5add8f4ae4867af52995a1334e9). Cases name the tested tree, not a frozen review commit.';

const GOAL_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..', '..', '..',
);
const ASSEMBLY_TREE = path.join(GOAL_DIR, 'hidden_files', 'codex-v4-20261021', 'assembly', 'tree');
const FEEDS_PATCH = path.join(GOAL_DIR, 'hidden_files', 'codex-v4-20261021', 'feeds-v4-completion-20261021.patch');
const STORE_PATCH = path.join(GOAL_DIR, 'hidden_files', 'codex-v3-20261021', 'store-v3-completion-20261021-1147.patch');
const HARNESS = path.join(GOAL_DIR, 'hidden_files', 'codex-v4-20261021', 'qa-v4', 'feed-responses.mjs');
const EXPECTED_SHA256 = {
  'js/feeds.js': 'aaa6ea7dbb0214c7a348e962779a65d5392bd5add8f4ae4867af52995a1334e9',
  'js/store.js': 'd613cf1890995fa09b56fd3f7cb3f2b0638b79098429b572dd74ec9ed501d6e4',
};

const CASE_IDS = ['TEST-FEEDS-001', 'TEST-FEEDS-002', 'TEST-FEEDS-003', 'V5-FEEDS-01', 'V5-FEEDS-02', 'V5-FEEDS-03'];
const results = [];

function record(id, boundary, status, detail) {
  results.push({ id, boundary, status, detail });
  console.log(`${status.padEnd(7)} ${id} [${boundary}] ${detail}`);
}

function notRunAll(blocker) {
  for (const id of CASE_IDS) record(id, 'REAL-BROWSER', 'NOT RUN', `Blocker: ${blocker}`);
  summarize();
}

function summarize() {
  const counts = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log('');
  console.log(`Summary: PASS ${counts.PASS ?? 0}; NOT RUN ${counts['NOT RUN'] ?? 0}; FAIL ${counts.FAIL ?? 0}`);
  console.log('Boundary rule: PASS here means the case ran in a real browser against the staged tree named in the source label.');
  if ((counts.FAIL ?? 0) > 0) process.exitCode = 1;
}

// --- Fixture builders. Reuse the v4 harness builders when present. ---

function escapeXmlText(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function localBuildRss({ title = 'Example Feed', items = [] } = {}) {
  const itemXml = items
    .map((item) => `    <item>\n      <title>${escapeXmlText(item.title)}</title>\n      <link>${escapeXmlText(item.url)}</link>\n      <guid>${escapeXmlText(item.id)}</guid>\n      <pubDate>Wed, 21 Oct 2026 01:00:00 GMT</pubDate>\n      <description>${escapeXmlText(item.summary ?? '')}</description>\n    </item>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>${escapeXmlText(title)}</title>\n    <link>https://example.com/</link>\n${itemXml}\n  </channel>\n</rss>\n`;
}

function localBuildOversize(minBytes = 1024 * 1024 + 1) {
  const header = '<?xml version="1.0"?><rss><channel><title>Oversize Example</title><!--';
  const footer = '--></channel></rss>';
  return header + 'x'.repeat(Math.max(0, minBytes - header.length - footer.length)) + footer;
}

function localBuildMalformed() {
  return '<?xml version="1.0"?><rss><channel><title>Broken Example</title><item><title>Missing close tags';
}

let buildRssXml = localBuildRss;
let buildOversizeBody = localBuildOversize;
let buildMalformedXml = localBuildMalformed;
try {
  const harness = await import(new URL(`file://${HARNESS}`).href);
  buildRssXml = harness.buildRssXml;
  buildOversizeBody = harness.buildOversizeBody;
  buildMalformedXml = harness.buildMalformedXml;
} catch {
  // Harness file absent. Local builders above keep the same fixture shape.
}

// --- Post-image extraction. A patch post-image is its context plus added lines. ---

function extractPostImage(patchText, targetPath) {
  const lines = patchText.split('\n');
  let inFile = false;
  const out = [];
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      inFile = line.includes(` b/${targetPath}`);
      continue;
    }
    if (!inFile) continue;
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('\\')) continue;
    if (line.startsWith('@@')) continue;
    if (line.startsWith('+')) out.push(line.slice(1));
    else if (line.startsWith(' ')) out.push(line.slice(1));
    else if (line.startsWith('-')) continue;
  }
  return out.join('\n') + '\n';
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// --- Playwright loading. Bare imports first, then known scratch installs. ---

async function loadPlaywright() {
  const candidates = ['playwright', 'playwright-core'];
  if (process.env.PLAYWRIGHT_MODULE) candidates.unshift(process.env.PLAYWRIGHT_MODULE);
  candidates.push('/tmp/pwprobe/node_modules/playwright-core/index.mjs');
  candidates.push(path.join(homedir(), 'workspace', 'skills', 'evidence-driven-testing', 'scripts', 'playwright', 'node_modules', 'playwright', 'index.mjs'));
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const mod = await import(candidate.startsWith('/') ? `file://${candidate}` : candidate);
      if (mod.firefox) return mod;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`no Playwright module resolved (last error: ${lastError?.message ?? 'none'}). Install with: npm install playwright-core, or set PLAYWRIGHT_MODULE to a module path.`);
}

function cachedFirefoxPath() {
  const cacheDir = path.join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cacheDir)) return null;
  const builds = readdirSync(cacheDir).filter((name) => name.startsWith('firefox-')).sort().reverse();
  for (const build of builds) {
    const exe = path.join(cacheDir, build, 'firefox', 'firefox');
    if (existsSync(exe)) return exe;
  }
  return null;
}

async function launchFirefox(playwright) {
  try {
    return await playwright.firefox.launch({ headless: true });
  } catch (firstError) {
    const exe = cachedFirefoxPath();
    if (!exe) throw firstError;
    return await playwright.firefox.launch({ headless: true, executablePath: exe });
  }
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

    // Static app files from the staged scratch tree.
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

// --- Staging. Copy the assembly tree to /tmp and overlay the selected sources. ---

async function stageApp() {
  const feedsImage = extractPostImage(await readFile(FEEDS_PATCH, 'utf8'), 'js/feeds.js');
  const storeImage = extractPostImage(await readFile(STORE_PATCH, 'utf8'), 'js/store.js');
  for (const [name, image] of [['js/feeds.js', feedsImage], ['js/store.js', storeImage]]) {
    const digest = sha256(image);
    assert.equal(digest, EXPECTED_SHA256[name], `post-image hash mismatch for ${name}: ${digest}`);
  }
  const appDir = await mkdtemp(path.join(tmpdir(), 'feeds-browser-app-'));
  await cp(ASSEMBLY_TREE, appDir, { recursive: true, filter: (src) => !src.includes(`${path.sep}.git`) });
  await mkdir(path.join(appDir, 'js'), { recursive: true });
  await writeFile(path.join(appDir, 'js', 'feeds.js'), feedsImage);
  await writeFile(path.join(appDir, 'js', 'store.js'), storeImage);
  return appDir;
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
    const href = await tabEval(page, async () => {
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
      const anchor = card.querySelector('a');
      return anchor ? (anchor.getAttribute('href') ?? '') : null;
    });
    assert.ok(href !== null, 'rendered card has no anchor to inspect');
    assert.ok(!/^javascript:/i.test(href), `unsafe legacy link rendered as a live href: ${href}`);
    return `save path rejected or dropped the javascript: URL (save ${saveOutcome}); blank and https records preserved; legacy link rendered inert (href: ${JSON.stringify(href)})`;
  } finally {
    await context.close();
  }
}

// --- Runner ---

console.log(SOURCE_SNAPSHOT_LABEL);
console.log('');

let playwright;
try {
  playwright = await loadPlaywright();
} catch (error) {
  notRunAll(error.message);
  process.exit();
}

let browser;
try {
  browser = await launchFirefox(playwright);
} catch (error) {
  notRunAll(`Firefox launch failed: ${error.message.split('\n')[0]}. A Playwright Firefox build under ~/.cache/ms-playwright is the accepted route.`);
  process.exit();
}

let appDir;
try {
  appDir = await stageApp();
} catch (error) {
  await browser.close();
  notRunAll(`app staging failed: ${error.message}`);
  process.exit();
}

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
await rm(appDir, { recursive: true, force: true });
summarize();
