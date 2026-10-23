// hosted-headers.spec.mjs — QA owner spec for the V17 CSP repair.
// Run: node qa/v4/hosted-headers.spec.mjs [--tree <path>]
//        [--cases V17-HOSTED-01,V17-HOSTED-02] [--results-out <path>]
//
// This spec serves the app from a local temporary origin with the ACTUAL
// deployed response headers parsed from fixtures-headers-deployed.txt.
// It does not reconstruct or weaken the deployed policy in the server.
//
// Cases:
//   V17-HOSTED-01  Zero CSP console messages and zero
//                  securitypolicyviolation events across all nine views.
//   V17-HOSTED-02  A countdown progress fill matches its known percent.
//   V17-HOSTED-03  No document-level horizontal overflow at 375 or 320 px.
//   V17-HOSTED-04  Settings import input is concealed without leaking,
//                  its visible trigger is keyboard-operable, and the
//                  import buttons stay inside a 375 px viewport.
//   V17-HOSTED-05  Populated Today content and News content render as
//                  readable content or an explicit News empty state.
//
// The coordinator must register these IDs as required in
// scripts/write-browser-results.mjs before they become gate-required.
// Extra IDs are ignored by the current gate until that registration.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBrowserResults } from '../../scripts/write-browser-results.mjs';
import { launchSelectedBrowser } from './browser-launch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
function argValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}
const TREE_ROOT = path.resolve(
  process.env.QA_TREE_ROOT ?? argValue('--tree') ?? process.env.DASH_TREE ??
    path.resolve(here, '..', '..'),
);
const ONLY = (argValue('--cases') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const HEADERS_FIXTURE = path.join(here, 'fixtures-headers-deployed.txt');

const CASE_IDS = [
  'V17-HOSTED-01',
  'V17-HOSTED-02',
  'V17-HOSTED-03',
  'V17-HOSTED-04',
  'V17-HOSTED-05',
];
const NAV_VIEWS = [
  'today', 'goals', 'maps', 'college', 'jobs',
  'investments', 'news', 'habits', 'settings',
];

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
function want(id) {
  return ONLY.length === 0 || ONLY.includes(id);
}
async function group(id, fn) {
  if (!want(id)) return;
  try {
    const detail = await fn();
    record(id, 'REAL-BROWSER', 'PASS', detail);
  } catch (error) {
    record(id, 'REAL-BROWSER', 'FAIL', (error?.stack ?? String(error)).split('\n').slice(0, 4).join(' | '));
  }
}
function notRunAll(blocker) {
  for (const id of CASE_IDS) {
    if (want(id)) record(id, 'REAL-BROWSER', 'NOT RUN', `Missing precondition: ${blocker}`);
  }
}

function sha256File(file) {
  return existsSync(file)
    ? createHash('sha256').update(readFileSync(file)).digest('hex')
    : 'MISSING';
}
const storeSha = sha256File(path.join(TREE_ROOT, 'js', 'store.js'));
const feedsSha = sha256File(path.join(TREE_ROOT, 'js', 'feeds.js'));
console.log(`Tree under test: ${TREE_ROOT}`);
console.log(`js/store.js SHA-256: ${storeSha}`);
console.log(`js/feeds.js SHA-256: ${feedsSha}`);

function emitResults() {
  const out = process.env.QA_RESULTS_FILE ?? argValue('--results-out') ?? process.env.QA_RESULTS_OUT ??
    path.join(here, 'browser-results.json');
  try {
    writeBrowserResults({
      outFile: path.resolve(out),
      tree: TREE_ROOT,
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

// ---------------------------------------------------------------------------
// Deployed-header parsing and preview server
// ---------------------------------------------------------------------------

function parseDeployedHeaders(text) {
  const rules = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) {
      current = null;
      continue;
    }
    if (!/^\s/.test(rawLine)) {
      current = { pattern: rawLine.trim(), headers: new Map() };
      rules.push(current);
      continue;
    }
    if (!current) throw new Error(`Header line has no path rule: ${rawLine}`);
    const colon = rawLine.indexOf(':');
    if (colon < 1) throw new Error(`Malformed deployed header line: ${rawLine}`);
    const name = rawLine.slice(0, colon).trim().toLowerCase();
    const value = rawLine.slice(colon + 1).trim();
    current.headers.set(name, value);
  }
  return new Map(rules.map((rule) => [rule.pattern, rule.headers]));
}

const DEPLOYED_HEADERS = parseDeployedHeaders(readFileSync(HEADERS_FIXTURE, 'utf8'));
const GLOBAL_HEADERS = DEPLOYED_HEADERS.get('/*');
const INDEX_HEADERS = DEPLOYED_HEADERS.get('/index.html');
assert.ok(GLOBAL_HEADERS?.has('content-security-policy'),
  'fixtures-headers-deployed.txt must contain a /* Content-Security-Policy rule');
assert.ok(INDEX_HEADERS?.has('cache-control'),
  'fixtures-headers-deployed.txt must contain the /index.html Cache-Control rule');
console.log(`Deployed headers fixture: ${HEADERS_FIXTURE}`);
console.log(`Parsed /* headers: ${[...GLOBAL_HEADERS.keys()].join(', ')}`);
console.log(`Parsed /index.html headers: ${[...INDEX_HEADERS.keys()].join(', ')}`);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function startHostedServer(root) {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.join(root, relative);
    const headers = Object.fromEntries(GLOBAL_HEADERS);
    if (pathname === '/' || pathname === '/index.html') {
      Object.assign(headers, Object.fromEntries(INDEX_HEADERS));
    }
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      res.writeHead(403, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('forbidden');
      return;
    }
    if (!existsSync(filePath)) {
      res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      ...headers,
      'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
    });
    res.end(readFileSync(filePath));
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      sockets,
      origin: `http://127.0.0.1:${server.address().port}`,
    }));
  });
}

// ---------------------------------------------------------------------------
// Invented data and app setup
// ---------------------------------------------------------------------------

function torontoDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}
const TODAY_TORONTO = torontoDateKey();
const TODAY_COMPLETED_AT = new Date(`${TODAY_TORONTO}T16:00:00.000Z`).toISOString();

function importPayload(data) {
  return {
    goals: [], places: [], jobs: [], investments: [], habits: [], indicators: [],
    metadata: {},
    college: { timetable: [], assignments: [], exams: [], fees: [] },
    news: { sources: [], cache: [], manual: [] },
    ...data,
  };
}

const INVENTED_PAYLOAD = importPayload({
  goals: [{
    id: 'goal_v17_hosted_priority',
    title: 'Hosted Priority Fixture',
    notes: 'Invented priority used only by the hosted-header spec.',
    showNotes: true,
    target: 4,
    status: 'active',
    history: [{ type: 'CREATE', timestamp: '2026-10-01T00:00:00.000Z' }],
    occurrences: { '2026-09-30': 'done', [TODAY_TORONTO]: 'done' },
    checkIns: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }],
  places: [{
    id: 'place_v17_hosted', name: 'Hosted Fixture Place',
    lat: 43.65, lng: -79.38, color: '#a3e635',
  }],
  jobs: [{
    id: 'job_v17_hosted', company: 'Hosted Fixture Co', role: 'Review Engineer',
    status: 'applied', location: 'toronto', date: '2026-10-01',
    notes: 'Invented job used only by QA.',
  }],
  investments: [{
    id: 'investment_v17_hosted', ticker: 'HOST', entry: 10, current: 12,
    notes: 'Invented watchlist item used only by QA.',
  }],
  habits: [{
    id: 'habit_v17_hosted',
    title: 'Hosted Habit Fixture',
    name: 'Hosted Habit Fixture',
    schedule: 'daily',
    status: 'active',
    archived: false,
    history: [{ type: 'CREATE', timestamp: '2026-10-01T00:00:00.000Z' }],
    occurrences: { [TODAY_TORONTO]: { completedAt: TODAY_COMPLETED_AT } },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }],
  college: {
    timetable: [], fees: [], exams: [],
    assignments: [{
      id: 'assignment_v17_hosted', title: 'Hosted Assignment Fixture',
      date: '2026-11-01', notes: 'Invented assignment used only by QA.',
    }],
  },
  news: {
    sources: [{
      id: 'source_v17_hosted', name: 'Hosted Example Source',
      url: 'https://example.com/hosted.xml', category: 'global',
      status: 'ok', lastRefresh: '2026-10-23T00:00:00.000Z',
    }],
    cache: [{
      id: 'news_v17_cached', sourceId: 'source_v17_hosted',
      title: 'Hosted Cached News Fixture',
      url: 'https://example.com/articles/hosted-cached',
      published: '2026-10-23T12:00:00.000Z', category: 'global',
    }],
    manual: [{
      id: 'news_v17_manual',
      title: 'Hosted News Fixture',
      url: 'https://example.com/articles/hosted-manual',
      published: '2026-10-23T13:00:00.000Z', category: 'global',
    }],
  },
});

async function grabStore(page) {
  await page.evaluate(async () => {
    window.__store = await import('/js/store.js');
    await window.__store.initStore();
  });
}

async function importInPage(page, payload) {
  const onDialog = (dialog) => { dialog.accept().catch(() => {}); };
  page.on('dialog', onDialog);
  try {
    const result = await page.evaluate(async (text) => {
      const file = new File([text], 'hosted-headers-import.json', { type: 'application/json' });
      return await new Promise((resolve, reject) => {
        try {
          window.__store.importData(file, (value) => resolve(value ?? {}));
        } catch (error) { reject(error); }
      });
    }, JSON.stringify({
      app: 'dashboard', schemaVersion: 1,
      exportedAt: new Date().toISOString(), data: payload,
    }));
    assert.ok(result && result.committed === true,
      `invented import committed (got: ${JSON.stringify(result).slice(0, 200)})`);
  } finally {
    page.off('dialog', onDialog);
  }
}

async function waitForApp(page) {
  await page.waitForFunction(() => {
    return document.querySelectorAll('.nav-btn').length === 9 &&
      document.getElementById('view-today')?.classList.contains('active');
  }, null, { timeout: 12000 });
  await page.waitForTimeout(250);
}

async function switchView(page, view) {
  if (view === 'today' && await page.evaluate(() =>
    document.getElementById('view-today')?.classList.contains('active'))) return;
  await page.click(`.nav-btn[data-view="${view}"]`);
  await page.waitForFunction((name) => {
    const section = document.getElementById(`view-${name}`);
    return section && !section.classList.contains('hidden') && section.classList.contains('active');
  }, view, { timeout: 8000 });
  await page.waitForTimeout(200);
}

async function visitAllViews(page) {
  for (const view of NAV_VIEWS) await switchView(page, view);
}

let ORIGIN = null;

async function createHostedPage(browser, {
  viewport = { width: 1440, height: 900 },
  seed = true,
  fixedTime = null,
} = {}) {
  const context = await browser.newContext({
    viewport,
    timezoneId: 'America/Toronto',
    acceptDownloads: true,
  });
  const state = {
    context,
    page: null,
    cspConsole: [],
    pageErrors: [],
    rootHeaders: {},
  };

  // Keep the hosted-header evidence local. External app requests are not
  // the behavior under test and must not make this spec depend on them.
  await context.route('**/*', async (route) => {
    const requestUrl = route.request().url();
    if (requestUrl.startsWith(ORIGIN) || /^(about|blob|data):/.test(requestUrl)) {
      await route.continue();
    } else {
      await route.abort();
    }
  });

  const page = await context.newPage();
  state.page = page;
  page.on('console', (message) => {
    const text = message.text();
    if (/content security policy|securitypolicyviolation|refused to apply inline style|violates the following content security policy/i.test(text)) {
      state.cspConsole.push({ type: message.type(), text });
    }
  });
  page.on('pageerror', (error) => state.pageErrors.push(String(error?.message ?? error)));

  // Playwright's addInitScript is the evaluateOnNewDocument hook. The
  // listener is installed before the app document's own scripts run.
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations.push({
        blockedURI: event.blockedURI,
        columnNumber: event.columnNumber,
        disposition: event.disposition,
        documentURI: event.documentURI,
        effectiveDirective: event.effectiveDirective,
        lineNumber: event.lineNumber,
        originalPolicy: event.originalPolicy,
        referrer: event.referrer,
        sample: event.sample,
        sourceFile: event.sourceFile,
        statusCode: event.statusCode,
        violatedDirective: event.violatedDirective,
      });
    }, true);
  });

  if (fixedTime) await page.clock.setSystemTime(fixedTime);
  const response = await page.goto(`${ORIGIN}/`, { waitUntil: 'load', timeout: 20000 });
  state.rootHeaders = response?.headers() ?? {};
  await waitForApp(page);
  await grabStore(page);
  if (seed) {
    await importInPage(page, INVENTED_PAYLOAD);
    await page.waitForFunction(() => {
      return window.__store?.getData()?.goals?.some((goal) => goal.id === 'goal_v17_hosted_priority');
    }, null, { timeout: 8000 });
    // Direct importData does not itself call the app's refreshUI. A click
    // on the already-active Today nav runs the real navigation handler
    // and renders the imported records through the normal UI path.
    await page.click('.nav-btn[data-view="today"]');
    await page.waitForTimeout(250);
  }
  return state;
}

async function closeState(state) {
  await state.context.close().catch(() => {});
}

// Keyboard-only focus walk, following accessibility-offline-browser.spec.mjs.
async function tabUntil(page, predicateSource, maxTabs = 100) {
  for (let i = 0; i < maxTabs; i++) {
    if (await page.evaluate(predicateSource)) return true;
    await page.keyboard.press('Tab');
  }
  return page.evaluate(predicateSource);
}

// ---------------------------------------------------------------------------
// Browser launch and preview server
// ---------------------------------------------------------------------------

let browser;
try {
  browserInfo = await launchSelectedBrowser();
  browser = browserInfo.browser;
} catch (error) {
  console.log(`Browser launch blocker: ${error.message.split('\n')[0]}`);
  notRunAll(`browser launch failed: ${error.message.split('\n')[0]}`);
  console.log(`Summary: PASS 0; NOT RUN ${results.length}; FAIL 0`);
  emitResults();
  process.exit(1);
}

const hosted = await startHostedServer(TREE_ROOT);
ORIGIN = hosted.origin;
console.log(`Local hosted-header origin: ${ORIGIN}`);
console.log(`Browser: ${browserInfo.runtimeLabel} (QA_BROWSER=${browserInfo.selection.kind})`);
console.log('');

// --- V17-HOSTED-01: CSP cleanliness across all nine views -------------------
await group('V17-HOSTED-01', async () => {
  const state = await createHostedPage(browser);
  try {
    assert.equal(state.rootHeaders['content-security-policy'],
      GLOBAL_HEADERS.get('content-security-policy'),
      'root response carries the deployed CSP from the fixture');
    assert.equal(state.rootHeaders['x-content-type-options'],
      GLOBAL_HEADERS.get('x-content-type-options'),
      'root response carries the deployed X-Content-Type-Options value');
    assert.equal(state.rootHeaders['referrer-policy'],
      GLOBAL_HEADERS.get('referrer-policy'),
      'root response carries the deployed Referrer-Policy value');
    assert.equal(state.rootHeaders['cache-control'],
      INDEX_HEADERS.get('cache-control'),
      'root response carries the /index.html Cache-Control rule');

    await visitAllViews(state.page);
    await state.page.waitForTimeout(500);
    const violations = await state.page.evaluate(() => window.__cspViolations ?? []);
    const problems = [];
    if (state.cspConsole.length > 0) {
      problems.push(
        `CSP console messages: ${state.cspConsole.length}; first: ${state.cspConsole[0].text.slice(0, 240)}`,
      );
    }
    if (violations.length > 0) {
      problems.push(
        `securitypolicyviolation events: ${violations.length}; first: ${JSON.stringify(violations[0]).slice(0, 300)}`,
      );
    }
    assert.equal(problems.length, 0, problems.join('; '));
    return 'actual deployed headers were served on /; populated app visited all 9 views with 0 CSP console messages and 0 securitypolicyviolation events';
  } finally {
    await closeState(state);
  }
});

// --- V17-HOSTED-02: progress numerics ---------------------------------------
await group('V17-HOSTED-02', async () => {
  // 2026-10-02 in Toronto leaves 54 of the countdown module's 90-day
  // visual window before the fixed 2026-11-25 deadline: exactly 40%.
  const fixedTime = new Date('2026-10-02T16:00:00.000Z');
  const state = await createHostedPage(browser, { fixedTime });
  try {
    const measurement = await state.page.evaluate(() => {
      const card = [...document.querySelectorAll('#countdowns-container .card')]
        .find((element) => element.textContent.includes('Fee Balance Due'));
      const fill = card?.querySelector('.progress-bar');
      const track = card?.querySelector('.progress-bar-container');
      if (!card || !fill || !track) return null;
      const fillRect = fill.getBoundingClientRect();
      const trackRect = track.getBoundingClientRect();
      return {
        fillWidth: fillRect.width,
        trackWidth: trackRect.width,
        ratioPercent: trackRect.width > 0 ? (fillRect.width / trackRect.width) * 100 : null,
        text: card.textContent.replace(/\s+/g, ' ').trim(),
      };
    });
    assert.ok(measurement, 'Fee Balance Due countdown fill and track rendered');
    assert.ok(measurement.trackWidth > 0, `countdown track has width (got ${measurement.trackWidth})`);
    assert.ok(measurement.ratioPercent !== null && Number.isFinite(measurement.ratioPercent),
      `countdown fill ratio is finite (got ${measurement.ratioPercent})`);
    assert.ok(Math.abs(measurement.ratioPercent - 40) <= 2,
      `Fee Balance Due fill ratio ${measurement.ratioPercent.toFixed(2)}% is within ±2 points of the known 40%`);
    return `fixed Toronto date 2026-10-02; Fee Balance Due fill measured ${measurement.ratioPercent.toFixed(2)}% of its track against the known 40% (fill ${measurement.fillWidth.toFixed(1)}px / track ${measurement.trackWidth.toFixed(1)}px)`;
  } finally {
    await closeState(state);
  }
});

// --- V17-HOSTED-03: small-screen document overflow ---------------------------
await group('V17-HOSTED-03', async () => {
  const failures = [];
  const evidence = [];
  for (const width of [375, 320]) {
    const state = await createHostedPage(browser, { viewport: { width, height: 844 } });
    try {
      for (const view of NAV_VIEWS) {
        await switchView(state.page, view);
        const measurement = await state.page.evaluate((name) => ({
          view: name,
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }), view);
        evidence.push(`${width}px/${view} ${measurement.scrollWidth}/${measurement.innerWidth}`);
        if (measurement.scrollWidth > measurement.innerWidth) {
          failures.push(
            `${width}px ${view}: documentElement.scrollWidth ${measurement.scrollWidth} > window.innerWidth ${measurement.innerWidth}`,
          );
        }
      }
    } finally {
      await closeState(state);
    }
  }
  assert.equal(failures.length, 0, failures.join('; '));
  return `populated app had no document-level horizontal overflow in any of the 9 views at 375px or 320px (${evidence.join('; ')})`;
});

// --- V17-HOSTED-04: Settings import control ---------------------------------
await group('V17-HOSTED-04', async () => {
  const state = await createHostedPage(browser, { viewport: { width: 375, height: 800 } });
  const page = state.page;
  try {
    await switchView(page, 'settings');
    const inspection = await page.evaluate(() => {
      const input = document.getElementById('import-file');
      const trigger = document.getElementById('btn-import-trigger');
      if (!input || !trigger) return null;
      const style = window.getComputedStyle(input);
      const rect = input.getBoundingClientRect();
      const group = trigger.closest('.button-group');
      const buttons = group ? [...group.querySelectorAll('button')].map((button) => {
        const buttonRect = button.getBoundingClientRect();
        return {
          id: button.id,
          text: button.textContent.replace(/\s+/g, ' ').trim(),
          left: buttonRect.left,
          right: buttonRect.right,
          top: buttonRect.top,
          bottom: buttonRect.bottom,
          width: buttonRect.width,
          height: buttonRect.height,
        };
      }) : [];
      return {
        innerWidth: window.innerWidth,
        input: {
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          clip: style.clip,
          clipPath: style.clipPath,
          position: style.position,
          tabIndex: input.tabIndex,
          rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
        },
        buttons,
      };
    });
    assert.ok(inspection, '#import-file and #btn-import-trigger are present in Settings');

    const inputRect = inspection.input.rect;
    const fullyClipped =
      /rect\(0(?:px)?,\s*0(?:px)?,\s*0(?:px)?,\s*0(?:px)?\)/.test(inspection.input.clip) ||
      inspection.input.clipPath === 'inset(50%)' ||
      inspection.input.clipPath === 'inset(100%)';
    const concealed =
      inspection.input.display === 'none' ||
      inspection.input.visibility === 'hidden' ||
      inspection.input.visibility === 'collapse' ||
      (inputRect.width <= 1 && inputRect.height <= 1) ||
      fullyClipped;
    assert.ok(concealed,
      `native file input is not visibly rendered or leaked (display=${inspection.input.display}, visibility=${inspection.input.visibility}, clip=${inspection.input.clip}, clip-path=${inspection.input.clipPath}, rect=${inputRect.width}x${inputRect.height})`);

    assert.ok(inspection.buttons.length >= 2, 'import button group exposes its visible buttons');
    for (const button of inspection.buttons) {
      assert.ok(button.width > 0 && button.height > 0,
        `${button.id || button.text} has a visible size (${button.width}x${button.height})`);
      assert.ok(button.left >= -0.5 && button.right <= inspection.innerWidth + 0.5,
        `${button.id || button.text} stays within the 375px viewport (left ${button.left}, right ${button.right})`);
    }

    // The concealed input need not be tab-focusable itself when its
    // visible trigger is. Prove the actual keyboard route: Tab to the
    // trigger, press Enter, and require the real #import-file chooser.
    await page.evaluate(() => { document.activeElement?.blur(); });
    const reachedTrigger = await tabUntil(page,
      () => document.activeElement?.id === 'btn-import-trigger');
    assert.ok(reachedTrigger, 'Tab order never reached #btn-import-trigger');
    let chooser = null;
    for (let attempt = 0; attempt < 2 && !chooser; attempt++) {
      const chooserPromise = page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
      await page.keyboard.press('Enter');
      chooser = await chooserPromise;
    }
    assert.ok(chooser, 'Enter on #btn-import-trigger opened no file chooser');
    const chooserHandle = await chooser.element();
    const chooserInputId = await chooserHandle.evaluate((element) => element.id);
    assert.equal(chooserInputId, 'import-file', 'keyboard-operated trigger opens the #import-file chooser');

    return `at 375px the file input is concealed (display=${inspection.input.display}, rect=${inputRect.width}x${inputRect.height}, clip=${inspection.input.clip}, clip-path=${inspection.input.clipPath}); all import-group buttons are inside the viewport; Tab reached #btn-import-trigger and Enter opened the real #import-file chooser`;
  } finally {
    await closeState(state);
  }
});

// --- V17-HOSTED-05: populated Today and News content -------------------------
await group('V17-HOSTED-05', async () => {
  const state = await createHostedPage(browser);
  const page = state.page;
  try {
    await page.waitForFunction(() => {
      return document.querySelector('#today-goals-container')?.textContent.includes('Hosted Priority Fixture');
    }, null, { timeout: 8000 });
    const today = await page.evaluate(() => {
      const container = document.querySelector('#today-goals-container');
      const card = [...container.querySelectorAll('.card')]
        .find((element) => element.textContent.includes('Hosted Priority Fixture'));
      const summary = document.querySelector('#progress-summary-root');
      const cardRect = card?.getBoundingClientRect();
      const summaryRect = summary?.getBoundingClientRect();
      return {
        todayText: container.textContent.replace(/\s+/g, ' ').trim(),
        cardRect: cardRect ? { width: cardRect.width, height: cardRect.height } : null,
        summaryText: summary?.textContent.replace(/\s+/g, ' ').trim() ?? '',
        summaryRect: summaryRect ? { width: summaryRect.width, height: summaryRect.height } : null,
      };
    });
    assert.ok(today.cardRect && today.cardRect.width > 0 && today.cardRect.height > 0,
      'Today priority card has a rendered size');
    assert.ok(today.todayText.includes('2 / 4 done'),
      `Today priority shows the seeded progress count (got: ${today.todayText.slice(0, 180)})`);
    assert.ok(today.todayText.includes('50%'),
      `Today priority shows the seeded 50% progress (got: ${today.todayText.slice(0, 180)})`);
    assert.ok(today.summaryRect && today.summaryRect.width > 0 && today.summaryRect.height > 0,
      'Today progress summary has a rendered size');
    assert.ok(today.summaryText.includes('Progress Summary for'),
      `Today summary has its heading (got: ${today.summaryText.slice(0, 180)})`);
    assert.ok(today.summaryText.includes('Goals Completed:') && /\d+\s*\/\s*1/.test(today.summaryText),
      `Today summary shows a goals count (got: ${today.summaryText.slice(0, 180)})`);
    assert.ok(today.summaryText.includes('Habits Completed:') && /\d+\s*\/\s*1/.test(today.summaryText),
      `Today summary shows a habits count (got: ${today.summaryText.slice(0, 180)})`);

    await switchView(page, 'news');
    const news = await page.evaluate(() => {
      const container = document.querySelector('#news-container');
      const rect = container?.getBoundingClientRect();
      return {
        text: container?.textContent.replace(/\s+/g, ' ').trim() ?? '',
        rect: rect ? { width: rect.width, height: rect.height } : null,
      };
    });
    assert.ok(news.rect && news.rect.width > 0 && news.rect.height > 0,
      'News container has a rendered size');
    assert.ok(news.text.length > 0, 'News view is not blank');
    assert.ok(
      news.text.includes('Hosted News Fixture') ||
        news.text.includes('Hosted Cached News Fixture') ||
        news.text.includes('No news found for this category.'),
      `News shows a seeded item or the explicit empty state (got: ${news.text.slice(0, 180)})`,
    );
    return `Today renders the seeded priority (2 / 4 done, 50%) and a readable progress summary; News renders populated content (${news.text.slice(0, 120)})`;
  } finally {
    await closeState(state);
  }
});

// ---------------------------------------------------------------------------
// Summary and machine results
// ---------------------------------------------------------------------------

await browser.close().catch(() => {});
for (const socket of hosted.sockets) socket.destroy();
await new Promise((resolve) => hosted.server.close(resolve));

const counts = results.reduce((acc, result) => {
  acc[result.status] = (acc[result.status] ?? 0) + 1;
  return acc;
}, {});
console.log('');
console.log(`Summary: PASS ${counts.PASS ?? 0}; NOT RUN ${counts['NOT RUN'] ?? 0}; FAIL ${counts.FAIL ?? 0}`);
console.log('Boundary rule: PASS here means the case ran in a real Chromium-family browser against the tree and deployed-header fixture named above.');
emitResults();
if ((counts.FAIL ?? 0) > 0 || (counts['NOT RUN'] ?? 0) > 0) process.exitCode = 1;
