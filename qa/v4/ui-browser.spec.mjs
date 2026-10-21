// ui-browser.spec.mjs — Lane D-UI browser QA for dashboard v5.
// Run: node ui-browser.spec.mjs [--tree <path>] [--cases TEST-UI-001,V5-STORE-02]
// Env: DASH_TREE (tree root), PLAYWRIGHT_MODULE (module path or name),
//      QA_OUT (scratch dir for downloads and generated import files).
//
// This spec serves the assembled tree from a local temporary origin and drives
// it in a real Firefox browser through Playwright. Each browser context is an
// isolated profile. Test data is invented in this file. No case uses mocks of
// the app. A case reports PASS, FAIL, or NOT RUN. NOT RUN means a named
// precondition was missing. PASS here means the case ran in a real browser.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}
const TREE = path.resolve(
  argValue('--tree') ?? process.env.DASH_TREE ??
    path.resolve(here, '../../../codex-v4-20261021/assembly/tree'),
);
const ONLY = (argValue('--cases') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const QA_OUT = process.env.QA_OUT ?? mkdtempSync(path.join(os.tmpdir(), 'ui-browser-qa-'));
mkdirSync(QA_OUT, { recursive: true });
const TAG = String(Date.now()).slice(-6);

// ---------------------------------------------------------------------------
// Harness record keeping. The line format matches acceptance.spec.mjs.
// ---------------------------------------------------------------------------
const results = [];
function record(id, status, detail) {
  results.push({ id, status });
  console.log(`${status.padEnd(7)} ${id} [REAL-BROWSER] ${detail}`);
}
function want(id) {
  return ONLY.length === 0 || ONLY.includes(id);
}
async function runCase(id, fn) {
  if (!want(id)) return;
  try {
    const detail = await fn();
    if (detail !== null) record(id, 'PASS', detail);
  } catch (error) {
    record(id, 'FAIL', (error?.stack ?? String(error)).split('\n').slice(0, 3).join(' | '));
  }
}
function notRun(id, precondition) {
  if (want(id)) record(id, 'NOT RUN', `Missing precondition: ${precondition}`);
}

// ---------------------------------------------------------------------------
// Source snapshot label. The line names the exact tree under test.
// ---------------------------------------------------------------------------
function sha256Of(file) {
  if (!existsSync(file)) return 'ABSENT';
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
console.log(
  `UI BROWSER SPEC — tree ${TREE}; store.js ${sha256Of(path.join(TREE, 'js/store.js'))}; ` +
    `feeds.js ${sha256Of(path.join(TREE, 'js/feeds.js'))}; main.js ${sha256Of(path.join(TREE, 'js/main.js'))}; ` +
    `index.html ${sha256Of(path.join(TREE, 'index.html'))}`,
);
console.log(`Scratch dir: ${QA_OUT}`);
console.log('');

// ---------------------------------------------------------------------------
// Static file server on a local temporary origin.
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(TREE, rel);
  if (!file.startsWith(TREE) || !existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------------------
// Playwright resolution. The spec needs the playwright or playwright-core
// package and the Firefox browser build. A missing package or browser makes
// every case NOT RUN with the exact blocker.
// ---------------------------------------------------------------------------
let pw = null;
const pwErrors = [];
for (const name of [process.env.PLAYWRIGHT_MODULE, 'playwright', 'playwright-core'].filter(Boolean)) {
  try {
    pw = await import(name);
    if (pw?.firefox) break;
    pwErrors.push(`${name}: loaded but exposes no firefox launcher`);
    pw = null;
  } catch (error) {
    pwErrors.push(`${name}: ${error?.code ?? error.message}`);
  }
}
let browser = null;
let browserNote = '';
if (pw) {
  try {
    browser = await pw.firefox.launch();
    browserNote = 'firefox launched from the Playwright browser cache';
  } catch (firstError) {
    // Fall back to a cached Firefox binary when the registry lookup fails.
    const cacheRoot = path.join(os.homedir(), '.cache', 'ms-playwright');
    const candidates = existsSync(cacheRoot)
      ? readdirSync(cacheRoot)
          .filter((d) => d.startsWith('firefox-'))
          .map((d) => path.join(cacheRoot, d, 'firefox', 'firefox'))
          .filter((p) => existsSync(p))
      : [];
    for (const exe of candidates) {
      try {
        browser = await pw.firefox.launch({ executablePath: exe });
        browserNote = `firefox launched from ${exe}`;
        break;
      } catch { /* try the next candidate */ }
    }
    if (!browser) pwErrors.push(`firefox launch: ${firstError.message.split('\n')[0]}`);
  }
}

// ---------------------------------------------------------------------------
// Page helpers. Collectors record page errors, console errors, failed module
// requests, dialogs, and downloads for later assertions.
// ---------------------------------------------------------------------------
function watchPage(page) {
  const state = {
    pageerrors: [],
    consoleErrors: [],
    failedScripts: [],
    dialogs: [],
    downloads: [],
    holdConfirm: false,
    held: null,
  };
  page.on('pageerror', (error) => state.pageerrors.push(String(error?.message ?? error)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') state.consoleErrors.push(msg.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && /\.(m?js|css)(\?|$)/.test(response.url())) {
      state.failedScripts.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('dialog', async (dialog) => {
    const entry = { type: dialog.type(), message: dialog.message(), action: null };
    state.dialogs.push(entry);
    if (state.holdConfirm && dialog.type() === 'confirm' && !state.held) {
      state.held = { dialog, entry };
      return; // The case resolves the held confirm at a chosen moment.
    }
    entry.action = 'accept';
    await dialog.accept().catch(() => {});
  });
  page.on('download', async (download) => {
    const target = path.join(QA_OUT, `${Date.now()}-${download.suggestedFilename()}`);
    await download.saveAs(target).catch(() => {});
    state.downloads.push({ name: download.suggestedFilename(), path: target });
  });
  return state;
}

async function gotoApp(page, state) {
  await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'load', timeout: 20000 });
  let booted = true;
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('.nav-btn').length === 9 &&
        !document.getElementById('view-today')?.classList.contains('hidden'),
      null,
      { timeout: 12000 },
    );
    await page.waitForTimeout(1200); // Let late module and init errors surface.
  } catch {
    booted = false;
  }
  return {
    booted,
    evidence: [
      ...state.pageerrors.map((e) => `pageerror: ${e}`),
      ...state.failedScripts.map((e) => `failed request: ${e}`),
    ].join('; '),
  };
}

async function switchView(page, name) {
  await page.click(`.nav-btn[data-view="${name}"]`);
  await page.waitForFunction(
    (n) => !document.getElementById(`view-${n}`)?.classList.contains('hidden'),
    name,
    { timeout: 5000 },
  );
}

async function createGoal(page, title) {
  await switchView(page, 'goals');
  await page.click('#btn-create-goal');
  await page.waitForFunction(
    () => !document.getElementById('goal-modal')?.classList.contains('hidden'),
    null, { timeout: 5000 },
  );
  await page.fill('#goal-title', title);
  await page.click('#goal-form button[type="submit"]');
  await page.waitForFunction(
    () => document.getElementById('goal-modal')?.classList.contains('hidden'),
    null, { timeout: 8000 },
  );
  const text = await page.textContent('#active-goals-container');
  assert.ok(text.includes(title), `created goal "${title}" not rendered in the goals list`);
}

async function goalsText(page) {
  await switchView(page, 'goals');
  return page.textContent('#active-goals-container');
}

async function waitForHeldConfirm(state, timeoutMs = 12000) {
  const start = Date.now();
  while (!state.held && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(state.held, 'import did not reach its confirm dialog');
  return state.held;
}

async function waitForDialogCount(state, fromIndex, count, timeoutMs = 12000) {
  const start = Date.now();
  while (state.dialogs.length - fromIndex < count && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return state.dialogs.slice(fromIndex);
}

// ---------------------------------------------------------------------------
// Cases. A missing browser makes every selected case NOT RUN.
// ---------------------------------------------------------------------------
if (!browser) {
  const blocker = pwErrors.join('; ') || 'unknown launch failure';
  for (const id of [
    'TEST-UI-001', 'TEST-UI-002a', 'TEST-UI-002b', 'TEST-UI-002c', 'TEST-UI-002d',
    'TEST-UI-002e', 'TEST-UI-002f', 'TEST-UI-002g', 'TEST-UI-002h', 'TEST-UI-002i',
    'TEST-UI-002j', 'V5-STORE-02',
  ]) notRun(id, `Playwright Firefox unavailable — ${blocker}`);
} else {
  console.log(`Browser: ${browserNote}`);
  console.log('');

  // ----- Context 1: clean profile. Startup, export, import, conflict. -----
  const ctx1 = await browser.newContext({ acceptDownloads: true });
  const pageA = await ctx1.newPage();
  const stateA = watchPage(pageA);
  const bootA = await gotoApp(pageA, stateA);
  let exportFile = null;
  const goal1 = `QA Goal One ${TAG}`;
  const goal2 = `QA Goal Two ${TAG}`;
  const goal3 = `QA Goal Three ${TAG}`;

  await runCase('TEST-UI-001', async () => {
    assert.ok(bootA.booted, `app did not boot — ${bootA.evidence || 'no boot signal'}`);
    assert.deepEqual(stateA.pageerrors, [], `uncaught page errors: ${stateA.pageerrors.join(' | ')}`);
    assert.deepEqual(stateA.failedScripts, [], `module or asset requests failed: ${stateA.failedScripts.join(' | ')}`);
    for (const view of ['goals', 'maps', 'college', 'jobs', 'investments', 'news', 'habits', 'settings', 'today']) {
      await switchView(pageA, view);
    }
    assert.deepEqual(stateA.pageerrors, [], `uncaught page errors during nav sweep: ${stateA.pageerrors.join(' | ')}`);
    return 'app booted on the local origin; all 9 nav views rendered; zero uncaught page errors; zero failed module requests';
  });

  if (!bootA.booted) {
    for (const id of ['TEST-UI-002c', 'TEST-UI-002d', 'TEST-UI-002e', 'TEST-UI-002f', 'V5-STORE-02']) {
      notRun(id, `app did not boot in a clean profile — ${bootA.evidence || 'no boot signal'}`);
    }
  } else {
    await createGoal(pageA, goal1);

    // TEST-UI-002f — export readback.
    await runCase('TEST-UI-002f', async () => {
      await switchView(pageA, 'settings');
      const before = stateA.downloads.length;
      await pageA.click('#btn-export');
      const start = Date.now();
      while (stateA.downloads.length <= before && Date.now() - start < 10000) {
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(stateA.downloads.length > before, 'export click produced no download');
      exportFile = stateA.downloads[stateA.downloads.length - 1].path;
      const parsed = JSON.parse(readFileSync(exportFile, 'utf8'));
      assert.equal(parsed.app, 'dashboard');
      const titles = (parsed.data?.goals ?? []).map((g) => g.title);
      assert.ok(titles.includes(goal1), `export lacks the invented goal; titles: ${titles.join(', ')}`);
      assert.ok(!Number.isNaN(Date.parse(parsed.exportedAt)), 'export has no parseable exportedAt');
      return `export downloaded and parsed; exportedAt ${parsed.exportedAt}; goals in file: ${titles.join(', ')}`;
    });

    // V5-STORE-02 — an import conflict settles the UI exactly once.
    await runCase('V5-STORE-02', async () => {
      assert.ok(exportFile, 'export file from TEST-UI-002f is required');
      await createGoal(pageA, goal2);
      const pageB = await ctx1.newPage();
      const stateB = watchPage(pageB);
      const bootB = await gotoApp(pageB, stateB);
      assert.ok(bootB.booted, `second tab did not boot — ${bootB.evidence}`);
      // Park tab A on the goals view. The list shows goal1 and goal2.
      const beforeText = await goalsText(pageA);
      assert.ok(beforeText.includes(goal1) && beforeText.includes(goal2));
      // Start the import in tab A and hold its confirm dialog open.
      const dialogFrom = stateA.dialogs.length;
      const downloadFrom = stateA.downloads.length;
      stateA.held = null;
      stateA.holdConfirm = true;
      await pageA.setInputFiles('#import-file', exportFile);
      const held = await waitForHeldConfirm(stateA);
      // Tab B commits while tab A waits on the confirm. This makes the import stale.
      await createGoal(pageB, goal3);
      // Release the confirm. The import must now hit the conflict path.
      stateA.holdConfirm = false;
      stateA.held = null;
      held.entry.action = 'accept';
      await held.dialog.accept();
      const dialogs = await waitForDialogCount(stateA, dialogFrom, 2);
      const confirms = dialogs.filter((d) => d.type === 'confirm');
      const alerts = dialogs.filter((d) => d.type === 'alert');
      assert.equal(confirms.length, 1, `expected exactly one confirm, saw ${confirms.length}`);
      assert.equal(alerts.length, 1, `expected exactly one terminal alert, saw ${alerts.length}: ${alerts.map((a) => a.message).join(' | ')}`);
      assert.match(alerts[0].message, /Import blocked/, `expected a conflict alert, saw: ${alerts[0].message}`);
      const newDownloads = stateA.downloads.slice(downloadFrom);
      assert.equal(newDownloads.length, 1, `expected exactly one recovery download, saw ${newDownloads.length}`);
      assert.ok(newDownloads[0].name.startsWith('dashboard-draft-'), `recovery download name: ${newDownloads[0].name}`);
      // Required settle behavior: the callback refreshes tab A without a reload.
      // Tab A must now show tab B's goal because its data was adopted, not replaced.
      await pageA.waitForTimeout(800);
      const domNow = await pageA.textContent('#active-goals-container');
      assert.ok(
        domNow.includes(goal3),
        'tab A UI stayed stale after the conflict settled: the adopted goal is not rendered without a reload (onComplete did not refresh the UI)',
      );
      assert.ok(domNow.includes(goal1) && domNow.includes(goal2), 'tab A lost pre-conflict goals after the conflict settled');
      // Storage truth after a real reload agrees with the settled UI.
      await pageA.reload({ waitUntil: 'load' });
      await pageA.waitForFunction(
        () => document.querySelectorAll('.nav-btn').length === 9, null, { timeout: 12000 },
      );
      const truth = await goalsText(pageA);
      assert.ok(truth.includes(goal1) && truth.includes(goal2) && truth.includes(goal3),
        'stored data after reload does not hold all three goals; the conflict import replaced data');
      await pageB.close();
      return 'conflict produced exactly one confirm, one blocked alert, and one draft download; the UI refreshed to the adopted data without a reload; stored data kept all goals';
    });

    // TEST-UI-002e — import repeat selection of the same file.
    await runCase('TEST-UI-002e', async () => {
      assert.ok(exportFile, 'export file from TEST-UI-002f is required');
      for (let attempt = 1; attempt <= 2; attempt++) {
        const from = stateA.dialogs.length;
        await pageA.setInputFiles('#import-file', exportFile);
        const dialogs = await waitForDialogCount(stateA, from, 2);
        const success = dialogs.filter((d) => d.type === 'alert' && /imported successfully/.test(d.message));
        assert.equal(success.length, 1, `attempt ${attempt}: expected one success alert, saw: ${dialogs.map((d) => d.message).join(' | ')}`);
        const text = await goalsText(pageA);
        assert.ok(text.includes(goal1), `attempt ${attempt}: imported goal missing after import`);
        assert.ok(!text.includes(goal3), `attempt ${attempt}: import did not replace current data`);
        const cards = await pageA.locator('#active-goals-container .goal-card, #active-goals-container > *').count();
        assert.ok(cards >= 1, `attempt ${attempt}: goals list is empty after import`);
      }
      return 'the same export file imported twice; each import settled with one success alert and identical resulting data';
    });

    // TEST-UI-002d — import reject: malformed JSON and a wrong-app file.
    await runCase('TEST-UI-002d', async () => {
      const malformed = path.join(QA_OUT, 'invented-malformed.json');
      writeFileSync(malformed, '{not json');
      const wrongApp = path.join(QA_OUT, 'invented-wrong-app.json');
      writeFileSync(wrongApp, JSON.stringify({ app: 'other-app', schemaVersion: 1, data: {} }));
      for (const file of [malformed, wrongApp]) {
        const from = stateA.dialogs.length;
        await pageA.setInputFiles('#import-file', file);
        const dialogs = await waitForDialogCount(stateA, from, 1);
        assert.equal(dialogs.length, 1, `no terminal dialog for ${path.basename(file)}`);
        assert.match(dialogs[0].message, /Import failed/, `expected an import-failed alert, saw: ${dialogs[0].message}`);
      }
      const text = await goalsText(pageA);
      assert.ok(text.includes(goal1), 'a rejected import changed the current data');
      assert.deepEqual(stateA.pageerrors, [], `uncaught page errors: ${stateA.pageerrors.join(' | ')}`);
      return 'malformed JSON and wrong-app files each produced exactly one import-failed alert; current data unchanged; zero uncaught errors';
    });

    // TEST-UI-002c — import cancel at the confirm step.
    await runCase('TEST-UI-002c', async () => {
      assert.ok(exportFile, 'export file from TEST-UI-002f is required');
      const dialogFrom = stateA.dialogs.length;
      const downloadFrom = stateA.downloads.length;
      stateA.held = null;
      stateA.holdConfirm = true;
      await pageA.setInputFiles('#import-file', exportFile);
      const held = await waitForHeldConfirm(stateA);
      stateA.holdConfirm = false;
      stateA.held = null;
      held.entry.action = 'dismiss';
      await held.dialog.dismiss();
      await pageA.waitForTimeout(1000);
      const after = stateA.dialogs.slice(dialogFrom);
      assert.equal(after.filter((d) => d.type === 'alert').length, 0, 'cancel produced an alert');
      assert.equal(stateA.downloads.length, downloadFrom, 'cancel produced a download');
      const inputValue = await pageA.evaluate(() => document.getElementById('import-file').value);
      assert.equal(inputValue, '', 'file input was not reset after the change event; repeat selection would break');
      const text = await goalsText(pageA);
      assert.ok(text.includes(goal1), 'cancel changed the current data');
      return 'dismissing the import confirm cancelled cleanly: no alert, no download, no data change, file input reset for the next selection';
    });
  }
  await ctx1.close();

  // ----- Context 2: one-shot BroadcastChannel fault. Degraded save path. -----
  const ctx2 = await browser.newContext({ acceptDownloads: true });
  await ctx2.addInitScript(() => {
    // Harness-only fault. The first page in this profile cannot construct a
    // BroadcastChannel, so the store must init degraded. A reload spends the
    // one-shot fault and boots clean. This mirrors storage-faults.mjs.
    if (!sessionStorage.getItem('qa-bc-fault-used')) {
      sessionStorage.setItem('qa-bc-fault-used', '1');
      window.BroadcastChannel = class {
        constructor() { throw new Error('QA fault: BroadcastChannel construction failed'); }
      };
    }
  });
  const pageF = await ctx2.newPage();
  const stateF = watchPage(pageF);
  const retainedTitle = `QA Retained Title ${TAG}`;

  await runCase('TEST-UI-002a', async () => {
    const boot = await gotoApp(pageF, stateF);
    assert.ok(boot.booted, `fault-profile app did not render — ${boot.evidence}`);
    await switchView(pageF, 'goals');
    await pageF.click('#btn-create-goal');
    await pageF.fill('#goal-title', retainedTitle);
    const from = stateF.dialogs.length;
    await pageF.click('#goal-form button[type="submit"]');
    const dialogs = await waitForDialogCount(stateF, from, 1, 8000);
    assert.equal(dialogs.length, 1, 'rejected save produced no alert');
    assert.match(dialogs[0].message, /Could not save|Save rejected/, `unexpected alert: ${dialogs[0].message}`);
    const modalVisible = await pageF.evaluate(
      () => !document.getElementById('goal-modal').classList.contains('hidden'),
    );
    assert.ok(modalVisible, 'modal closed after a rejected save; the form must stay open');
    const value = await pageF.inputValue('#goal-title');
    assert.equal(value, retainedTitle, 'form input was not retained after the rejected save');
    const list = await pageF.textContent('#active-goals-container');
    assert.ok(!list.includes(retainedTitle), 'rejected save still wrote the goal');
    return `degraded save rejected with alert "${dialogs[0].message}"; modal stayed open; input retained verbatim; nothing was written`;
  });

  await runCase('TEST-UI-002b', async () => {
    // Recovery is an explicit clean reload. The one-shot fault is spent.
    stateF.pageerrors.length = 0;
    const boot = await gotoApp(pageF, stateF);
    assert.ok(boot.booted, `recovery reload did not boot — ${boot.evidence}`);
    await switchView(pageF, 'goals');
    await pageF.click('#btn-create-goal');
    await pageF.fill('#goal-title', retainedTitle);
    const from = stateF.dialogs.length;
    await pageF.click('#goal-form button[type="submit"]');
    await pageF.waitForFunction(
      () => document.getElementById('goal-modal')?.classList.contains('hidden'),
      null, { timeout: 8000 },
    );
    const list = await pageF.textContent('#active-goals-container');
    assert.ok(list.includes(retainedTitle), 'retry after recovery did not render the saved goal');
    const retryAlerts = stateF.dialogs.slice(from).filter((d) => d.type === 'alert');
    assert.equal(retryAlerts.length, 0, `retry produced alerts: ${retryAlerts.map((a) => a.message).join(' | ')}`);
    return 'after a clean reload the same title saved successfully; modal closed; goal rendered; no alert on retry';
  });
  await ctx2.close();

  // ----- Context 3: keyboard focus and small viewports. -----
  const ctx3 = await browser.newContext({ acceptDownloads: true });
  const pageK = await ctx3.newPage();
  const stateK = watchPage(pageK);
  const bootK = await gotoApp(pageK, stateK);

  await runCase('TEST-UI-002g', async () => {
    assert.ok(bootK.booted, `app did not boot — ${bootK.evidence}`);
    await switchView(pageK, 'goals');
    await pageK.evaluate(() => document.getElementById('btn-create-goal').blur());
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      await pageK.keyboard.press('Tab');
      reached = await pageK.evaluate(() => document.activeElement?.id === 'btn-create-goal');
    }
    assert.ok(reached, 'Tab order never reached the New Goal button');
    await pageK.keyboard.press('Enter');
    await pageK.waitForFunction(
      () => !document.getElementById('goal-modal')?.classList.contains('hidden'),
      null, { timeout: 5000 },
    );
    const firstFocus = await pageK.evaluate(() => document.activeElement?.id);
    assert.equal(firstFocus, 'goal-title', `modal opened with focus on "${firstFocus}", expected goal-title`);
    const order = [firstFocus];
    for (let i = 0; i < 5; i++) {
      await pageK.keyboard.press('Tab');
      order.push(await pageK.evaluate(
        () => document.activeElement?.id || document.activeElement?.textContent?.trim() || document.activeElement?.tagName,
      ));
    }
    assert.deepEqual(
      order.slice(0, 5),
      ['goal-title', 'goal-notes', 'goal-target', 'goal-show-notes', 'btn-cancel-modal'],
      `unexpected in-form Tab order: ${order.join(' -> ')}`,
    );
    await pageK.keyboard.press('Shift+Tab');
    const backAt = await pageK.evaluate(() => document.activeElement?.id);
    assert.equal(backAt, 'btn-cancel-modal', `Shift+Tab from Save landed on "${backAt}", expected btn-cancel-modal`);
    await pageK.keyboard.press('Enter');
    await pageK.waitForFunction(
      () => document.getElementById('goal-modal')?.classList.contains('hidden'),
      null, { timeout: 5000 },
    );
    const returned = await pageK.evaluate(() => document.activeElement?.id);
    assert.equal(returned, 'btn-create-goal', `focus returned to "${returned}", expected btn-create-goal`);
    return `keyboard opened the modal; focus started on goal-title; Tab order ${order.join(' -> ')}; cancel returned focus to btn-create-goal`;
  });

  async function layoutCheck(page, width, height) {
    await page.setViewportSize({ width, height });
    const widths = {};
    for (const view of ['today', 'goals', 'settings']) {
      await switchView(page, view);
      widths[view] = await page.evaluate(() => Math.max(
        document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0,
      ));
      assert.ok(widths[view] <= width + 1, `${view} view overflows at ${width}px: scrollWidth ${widths[view]}`);
    }
    return widths;
  }

  await runCase('TEST-UI-002h', async () => {
    assert.ok(bootK.booted, `app did not boot — ${bootK.evidence}`);
    const widths = await layoutCheck(pageK, 320, 568);
    return `no horizontal overflow at 320x568; scrollWidths today ${widths.today}, goals ${widths.goals}, settings ${widths.settings}`;
  });

  await runCase('TEST-UI-002i', async () => {
    assert.ok(bootK.booted, `app did not boot — ${bootK.evidence}`);
    const widths = await layoutCheck(pageK, 375, 667);
    return `no horizontal overflow at 375px width; scrollWidths today ${widths.today}, goals ${widths.goals}, settings ${widths.settings}`;
  });
  await ctx3.close();

  // ----- Context 4: reduced motion. -----
  const ctx4 = await browser.newContext({ reducedMotion: 'reduce', acceptDownloads: true });
  const pageM = await ctx4.newPage();
  const stateM = watchPage(pageM);
  const bootM = await gotoApp(pageM, stateM);

  await runCase('TEST-UI-002j', async () => {
    assert.ok(bootM.booted, `app did not boot — ${bootM.evidence}`);
    const probe = await pageM.evaluate(() => {
      const matches = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      let mediaRules = 0;
      for (const sheet of document.styleSheets) {
        let rules = null;
        try { rules = sheet.cssRules; } catch { rules = null; }
        if (!rules) continue;
        for (const rule of rules) {
          if (rule.conditionText?.includes('prefers-reduced-motion')) mediaRules++;
        }
      }
      const el = document.querySelector('.modal-content') ?? document.body;
      const cs = getComputedStyle(el);
      return { matches, mediaRules, transition: cs.transitionDuration, animation: cs.animationDuration };
    });
    assert.ok(probe.matches, 'browser context did not expose prefers-reduced-motion: reduce');
    assert.ok(probe.mediaRules >= 1, 'no stylesheet carries a prefers-reduced-motion media rule');
    const toSeconds = (v) => v.split(',').map((p) => {
      const t = p.trim();
      return t.endsWith('ms') ? parseFloat(t) / 1000 : parseFloat(t);
    });
    const durations = [...toSeconds(probe.transition), ...toSeconds(probe.animation)];
    assert.ok(
      durations.every((d) => Number.isNaN(d) || d <= 0.001),
      `motion not reduced: transition ${probe.transition}, animation ${probe.animation}`,
    );
    return `reduced-motion media matches; ${probe.mediaRules} stylesheet media rule(s); computed durations transition ${probe.transition}, animation ${probe.animation}`;
  });
  await ctx4.close();
  await browser.close();
}

server.close();
const counts = results.reduce((acc, r) => {
  acc[r.status] = (acc[r.status] ?? 0) + 1;
  return acc;
}, {});
console.log('');
console.log(`Summary: PASS ${counts.PASS ?? 0}; NOT RUN ${counts['NOT RUN'] ?? 0}; FAIL ${counts.FAIL ?? 0}`);
console.log('Boundary rule: PASS means the case ran in a real Firefox browser against the tree named in the header.');
if ((counts.FAIL ?? 0) > 0) process.exitCode = 1;
