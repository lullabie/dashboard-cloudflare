// content-matrix-browser.spec.mjs — Lane C QA, dashboard V16.
// Run: node qa/v4/content-matrix-browser.spec.mjs [--tree <path>]
//        [--results-out <path>]
// Real-browser content-matrix cases for complete-app local acceptance
// (Codex V16 lane C), one case per content family:
//
//   V16-CONTENT-01  Maps actual UI CRUD: places are created, edited and
//     deleted through the real Maps/Places UI; ids stay unique and
//     precise across create/edit/delete and reload. Two places are
//     created in quick succession and an edit must not merge or
//     renumber ids.
//   V16-CONTENT-02  College markup stays literal: markup entered into
//     college form fields through the real UI renders as inert text,
//     creates no element, fires no handler, and the stored value stays
//     verbatim after reload.
//   V16-CONTENT-03  Investments numeric round-trip: investments are
//     created and edited through the real UI with meaningful zero and
//     decimal values (0, 0.01, multi-decimal prices, a large value);
//     values stay exact across save, reload, export and reimport into
//     a clean context (no float drift, no truncation) per the current
//     contract.
//   V16-CONTENT-04  Populated Jobs explorer: invented jobs are seeded
//     through the real Add Job form; the Jobs view filter, the view's
//     date sort, the chart-explorer filter and column sort operate on
//     the real data, and opening a row's Edit reaches the right record.
//   V16-CONTENT-05  Populated Investments explorer: same discipline
//     for investments — explorer filter/sort on populated real data
//     and Edit navigation to the right record.
//
// No store mocks. The spec serves a static tree from a local
// temporary origin and drives the real app (index.html) and the real
// form/import paths in a Chromium-family browser (QA_BROWSER).
// Invented records only. No personal data.

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

const CASE_IDS = ['V16-CONTENT-01', 'V16-CONTENT-02', 'V16-CONTENT-03', 'V16-CONTENT-04', 'V16-CONTENT-05'];

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
async function group(id, fn) {
  try {
    const detail = await fn();
    record(id, 'REAL-BROWSER', 'PASS', detail);
  } catch (error) {
    record(id, 'REAL-BROWSER', 'FAIL', (error?.stack ?? String(error)).split('\n').slice(0, 4).join(' | '));
  }
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function startServer(root) {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.join(root, urlPath);
    if (!filePath.startsWith(root) || !existsSync(filePath)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
    res.end(readFileSync(filePath));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function grabStore(page) {
  await page.evaluate(async () => {
    window.__store = await import('/js/store.js');
    await window.__store.initStore();
  });
}

async function bootPage(context, origin, pageErrors) {
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message ?? e)));
  await page.goto(origin + '/index.html', { waitUntil: 'load' });
  await grabStore(page);
  return page;
}

function importPayload(data) {
  return {
    goals: [], places: [], jobs: [], investments: [], habits: [], indicators: [],
    metadata: {},
    college: { timetable: [], assignments: [], exams: [], fees: [] },
    news: { sources: [], cache: [], manual: [] },
    ...data,
  };
}

async function importInPage(page, payload) {
  // importData expects the export envelope and asks confirm() before
  // replacing data; accept dialogs for the duration of the import.
  const onDialog = (d) => { d.accept().catch(() => {}); };
  page.on('dialog', onDialog);
  try {
    const res = await page.evaluate(async (text) => {
      const file = new File([text], 'content-import.json', { type: 'application/json' });
      return await new Promise((resolve, reject) => {
        try {
          window.__store.importData(file, (r) => resolve(r ?? {}));
        } catch (e) { reject(e); }
      });
    }, JSON.stringify({
      app: 'dashboard', schemaVersion: 1,
      exportedAt: new Date().toISOString(), data: payload,
    }));
    assert.ok(res && res.committed === true,
      `import committed (got: ${JSON.stringify(res).slice(0, 200)})`);
  } finally {
    page.off('dialog', onDialog);
  }
}

async function waitModal(page, modalId, open) {
  await page.waitForFunction((args) => {
    const el = document.getElementById(args.id);
    return el && (args.open ? !el.classList.contains('hidden') : el.classList.contains('hidden'));
  }, { id: modalId, open }, { timeout: 8000 });
}

const storePath = path.join(TREE_ROOT, 'js', 'store.js');
const storeSha = existsSync(storePath)
  ? createHash('sha256').update(readFileSync(storePath)).digest('hex')
  : 'MISSING';
const feedsPath = path.join(TREE_ROOT, 'js', 'feeds.js');
const feedsSha = existsSync(feedsPath)
  ? createHash('sha256').update(readFileSync(feedsPath)).digest('hex')
  : 'MISSING';
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

let browser;
try {
  browserInfo = await launchSelectedBrowser();
  browser = browserInfo.browser;
} catch (error) {
  console.log(`Browser launch blocker: ${error.message.split('\n')[0]}`);
  for (const id of CASE_IDS) record(id, 'REAL-BROWSER', 'NOT RUN', `Missing precondition: browser launch failed: ${error.message.split('\n')[0]}`);
  console.log(`Summary: PASS 0; NOT RUN ${CASE_IDS.length}; FAIL 0`);
  emitResults();
  process.exit(1);
}

const { server, origin } = await startServer(TREE_ROOT);
console.log(`Local temporary origin: ${origin}`);
console.log(`Browser: ${browserInfo.runtimeLabel} (QA_BROWSER=${browserInfo.selection.kind})`);
console.log('');

// --- V16-CONTENT-01: Maps actual UI CRUD, id precision -----------------------
await group('V16-CONTENT-01', async () => {
  const errors = [];
  const context = await browser.newContext({ acceptDownloads: true });
  // The map embed is an external iframe; it is not the behaviour under
  // test and must not make the case depend on outside network.
  await context.route('**openstreetmap.org**', (route) => route.abort());
  try {
    const page = await bootPage(context, origin, errors);
    // Place delete asks confirm() in the real UI; accept it.
    const acceptDialogs = (d) => { d.accept().catch(() => {}); };
    page.on('dialog', acceptDialogs);
    await page.click('.nav-btn[data-view="maps"]');

    async function createPlaceViaForm(name, lat, lng) {
      await page.click('#btn-create-place');
      await waitModal(page, 'place-modal', true);
      await page.fill('#place-name', name);
      await page.fill('#place-lat', lat);
      await page.fill('#place-lng', lng);
      await page.click('#place-form button[type="submit"]');
      await waitModal(page, 'place-modal', false);
      await page.waitForFunction((n) => {
        return [...document.querySelectorAll('#places-list .place-item .place-name')]
          .some((el) => el.textContent === n);
      }, name, { timeout: 8000 });
    }

    // Two places created in quick succession, back to back.
    await createPlaceViaForm('Alpha Depot', '43.6500', '-79.3800');
    await createPlaceViaForm('Beta Depot', '43.6600', '-79.3900');

    const created = await page.evaluate(async () => {
      window.__maps = await import('/js/maps.js');
      return window.__maps.getPlaces();
    });
    assert.equal(created.length, 2, `two places after two form creates (got ${created.length})`);
    const alpha = created.find((p) => p.name === 'Alpha Depot');
    const beta = created.find((p) => p.name === 'Beta Depot');
    assert.ok(alpha && beta, 'both created places are present by name');
    assert.ok(typeof alpha.id === 'string' && alpha.id.startsWith('place_') && alpha.id.length > 10,
      `Alpha id has the producer shape (got ${JSON.stringify(alpha.id)})`);
    assert.ok(typeof beta.id === 'string' && beta.id.startsWith('place_') && beta.id.length > 10,
      `Beta id has the producer shape (got ${JSON.stringify(beta.id)})`);
    assert.notEqual(alpha.id, beta.id, 'quick-succession creates minted distinct ids');
    assert.equal(alpha.lat, 43.65, 'Alpha latitude stored as entered');
    assert.equal(beta.lng, -79.39, 'Beta longitude stored as entered');
    const idAlpha = alpha.id;
    const idBeta = beta.id;

    // Ids survive a reload unchanged.
    await page.reload({ waitUntil: 'load' });
    await grabStore(page);
    await page.click('.nav-btn[data-view="maps"]');
    await page.waitForFunction(() => document.querySelectorAll('#places-list .place-item').length === 2,
      null, { timeout: 8000 });
    const afterReload = await page.evaluate(async () => {
      window.__maps = await import('/js/maps.js');
      return window.__maps.getPlaces();
    });
    assert.deepEqual(afterReload.map((p) => p.id).sort(), [idAlpha, idBeta].sort(),
      'place ids are identical after reload (no re-mint)');

    // Edit Alpha through the real UI: the edit must update exactly
    // that record, keep its id, and leave Beta untouched.
    await page.locator('#places-list .place-item', { hasText: 'Alpha Depot' })
      .locator('button[title="Edit"]').click();
    await waitModal(page, 'place-modal', true);
    assert.equal(await page.inputValue('#place-id'), idAlpha, 'edit modal carries Alpha id');
    assert.equal(await page.inputValue('#place-name'), 'Alpha Depot', 'edit modal carries Alpha name');
    await page.fill('#place-name', 'Alpha Depot Renamed');
    await page.fill('#place-lat', '43.7000');
    await page.click('#place-form button[type="submit"]');
    await waitModal(page, 'place-modal', false);
    await page.waitForFunction(() => {
      return [...document.querySelectorAll('#places-list .place-item .place-name')]
        .some((el) => el.textContent === 'Alpha Depot Renamed');
    }, null, { timeout: 8000 });
    const afterEdit = await page.evaluate(async () => {
      window.__maps = await import('/js/maps.js');
      return window.__maps.getPlaces();
    });
    assert.equal(afterEdit.length, 2, `edit did not change the place count (got ${afterEdit.length})`);
    const renamed = afterEdit.find((p) => p.name === 'Alpha Depot Renamed');
    assert.ok(renamed, 'renamed place is present');
    assert.equal(renamed.id, idAlpha, 'edit kept the original id (no renumber, no create)');
    assert.equal(renamed.lat, 43.7, 'edit applied the new latitude');
    const betaAfterEdit = afterEdit.find((p) => p.id === idBeta);
    assert.ok(betaAfterEdit, 'Beta still present after the edit (no merge)');
    assert.equal(betaAfterEdit.name, 'Beta Depot', 'Beta name unchanged by the edit');
    assert.equal(betaAfterEdit.lat, 43.66, 'Beta latitude unchanged by the edit');

    // Delete the renamed place through the real UI; only Beta remains.
    await page.locator('#places-list .place-item', { hasText: 'Alpha Depot Renamed' })
      .locator('button[title="Delete"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#places-list .place-item').length === 1,
      null, { timeout: 8000 });
    const afterDelete = await page.evaluate(async () => {
      window.__maps = await import('/js/maps.js');
      return window.__maps.getPlaces();
    });
    assert.equal(afterDelete.length, 1, 'one place remains after delete');
    assert.equal(afterDelete[0].id, idBeta, 'the survivor is Beta with its original id');
    assert.equal(afterDelete[0].name, 'Beta Depot', 'the survivor is Beta');

    // The delete and the surviving id are durable across reload.
    await page.reload({ waitUntil: 'load' });
    await grabStore(page);
    const afterDeleteReload = await page.evaluate(async () => {
      window.__maps = await import('/js/maps.js');
      return window.__maps.getPlaces();
    });
    assert.equal(afterDeleteReload.length, 1, 'delete is durable after reload');
    assert.equal(afterDeleteReload[0].id, idBeta, 'surviving id is stable after reload');
    page.off('dialog', acceptDialogs);
    assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
    return `places created in quick succession via the real form minted distinct ids (${idAlpha}, ${idBeta}); ids stable across reload; edit renamed Alpha in place under its original id without merging Beta; delete removed only Alpha; survivor Beta kept id ${idBeta} after reload`;
  } finally {
    await context.close();
  }
});

// --- V16-CONTENT-02: college markup stays literal ----------------------------
await group('V16-CONTENT-02', async () => {
  const errors = [];
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await bootPage(context, origin, errors);
    const titleMarkup = '<img src=x onerror="window.__collegePwned=1" id="college-markup-marker">';
    const notesMarkup = '<script id="college-script-marker">window.__collegePwned=2</' + 'script>';

    await page.click('.nav-btn[data-view="college"]');
    await page.click('#btn-create-college-item');
    await waitModal(page, 'college-modal', true);
    await page.selectOption('#college-item-type', 'assignments');
    await page.fill('#college-item-title', titleMarkup);
    await page.fill('#college-item-date', '2026-11-20');
    await page.fill('#college-item-notes', notesMarkup);
    await page.click('#college-form button[type="submit"]');
    await waitModal(page, 'college-modal', false);

    const stored = await page.evaluate(async () => {
      window.__college = await import('/js/college.js');
      return window.__college.getCollegeData();
    });
    assert.equal(stored.assignments.length, 1, 'one assignment after form create');
    assert.equal(stored.assignments[0].title, titleMarkup, 'stored title is the markup string verbatim');
    assert.equal(stored.assignments[0].notes, notesMarkup, 'stored notes are the markup string verbatim');

    await page.click('#view-college .tab-btn[data-tab="assignments"]');
    await page.waitForFunction(() => {
      const cards = document.querySelectorAll('#college-assignments-container .card');
      return [...cards].some((c) => c.textContent.includes('college-markup-marker'));
    }, null, { timeout: 8000 });

    async function probeMarkup() {
      return page.evaluate(() => {
        const card = [...document.querySelectorAll('#college-assignments-container .card')]
          .find((c) => c.textContent.includes('college-markup-marker'));
        return {
          imgMarker: !!document.querySelector('#college-markup-marker'),
          scriptMarker: !!document.querySelector('#college-script-marker'),
          imgsInCard: card ? card.querySelectorAll('img').length : -1,
          scriptsInCard: card ? card.querySelectorAll('script').length : -1,
          pwned: window.__collegePwned ?? null,
          cardHtml: card ? card.innerHTML : '',
          cardText: card ? card.textContent : '',
        };
      });
    }
    let probe = await probeMarkup();
    assert.equal(probe.imgMarker, false, 'no element was created from the title markup');
    assert.equal(probe.scriptMarker, false, 'no element was created from the notes markup');
    assert.equal(probe.imgsInCard, 0, 'the rendered card contains no img element');
    assert.equal(probe.scriptsInCard, 0, 'the rendered card contains no script element');
    assert.equal(probe.pwned, null, 'no injected handler fired');
    assert.ok(!probe.cardHtml.includes('<img'), 'card HTML carries no raw img tag from the field value');
    assert.ok(!probe.cardHtml.includes('<script'), 'card HTML carries no raw script tag from the field value');
    assert.ok(probe.cardText.includes(titleMarkup), 'card renders the title markup as literal text');
    assert.ok(probe.cardText.includes(notesMarkup), 'card renders the notes markup as literal text');

    // Verbatim storage and inert rendering survive a reload.
    await page.reload({ waitUntil: 'load' });
    await grabStore(page);
    const storedAfter = await page.evaluate(async () => {
      window.__college = await import('/js/college.js');
      return window.__college.getCollegeData();
    });
    assert.equal(storedAfter.assignments.length, 1, 'assignment still present after reload');
    assert.equal(storedAfter.assignments[0].title, titleMarkup, 'stored title verbatim after reload');
    assert.equal(storedAfter.assignments[0].notes, notesMarkup, 'stored notes verbatim after reload');
    await page.click('.nav-btn[data-view="college"]');
    await page.click('#view-college .tab-btn[data-tab="assignments"]');
    await page.waitForFunction(() => {
      const cards = document.querySelectorAll('#college-assignments-container .card');
      return [...cards].some((c) => c.textContent.includes('college-markup-marker'));
    }, null, { timeout: 8000 });
    probe = await probeMarkup();
    assert.equal(probe.imgMarker, false, 'no element created from the markup after reload');
    assert.equal(probe.scriptMarker, false, 'no script element created after reload');
    assert.equal(probe.pwned, null, 'no injected handler fired after reload');
    assert.ok(probe.cardText.includes(titleMarkup), 'literal title text still rendered after reload');
    assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
    return 'markup entered through the real college form stayed verbatim in storage, rendered as literal text with no element created and no handler fired, before and after reload';
  } finally {
    await context.close();
  }
});

// --- V16-CONTENT-03: investments numeric round-trip --------------------------
await group('V16-CONTENT-03', async () => {
  const errors = [];
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await bootPage(context, origin, errors);
    await page.click('.nav-btn[data-view="investments"]');

    // The form declares step="0.01", so the exercised values are the
    // meaningful cases inside the current contract: exact zero, one
    // cent, multi-decimal prices and a large value.
    const fixtures = [
      { ticker: 'ZERO', entry: '0', current: '0', entryNum: 0, currentNum: 0 },
      { ticker: 'CENT', entry: '0.01', current: '0.99', entryNum: 0.01, currentNum: 0.99 },
      { ticker: 'MULTI', entry: '1234.56', current: '2345.67', entryNum: 1234.56, currentNum: 2345.67 },
      { ticker: 'LARGE', entry: '999999.99', current: '1000000.50', entryNum: 999999.99, currentNum: 1000000.5 },
    ];
    async function createInvestmentViaForm(fx) {
      await page.click('#btn-create-investment');
      await waitModal(page, 'investment-modal', true);
      await page.fill('#investment-ticker', fx.ticker);
      await page.fill('#investment-entry', fx.entry);
      await page.fill('#investment-current', fx.current);
      await page.click('#investment-form button[type="submit"]');
      await waitModal(page, 'investment-modal', false);
      await page.waitForFunction((t) => {
        return [...document.querySelectorAll('#investments-container .card .card-title')]
          .some((el) => el.textContent === t);
      }, fx.ticker, { timeout: 8000 });
    }
    for (const fx of fixtures) await createInvestmentViaForm(fx);

    async function readInvestments(p) {
      return p.evaluate(async () => {
        window.__inv = await import('/js/investments.js');
        return window.__inv.getInvestments();
      });
    }
    function assertExact(list, label) {
      assert.equal(list.length, fixtures.length, `${label}: four investments (got ${list.length})`);
      for (const fx of fixtures) {
        const inv = list.find((i) => i.ticker === fx.ticker);
        assert.ok(inv, `${label}: ${fx.ticker} is present`);
        assert.ok(Object.is(inv.entry, fx.entryNum),
          `${label}: ${fx.ticker} entry is exactly ${fx.entryNum} (got ${inv.entry})`);
        assert.ok(Object.is(inv.current, fx.currentNum),
          `${label}: ${fx.ticker} current is exactly ${fx.currentNum} (got ${inv.current})`);
      }
    }
    assertExact(await readInvestments(page), 'after form create');

    // Edit CENT through the real UI: only its current price changes.
    const beforeEdit = await readInvestments(page);
    const centId = beforeEdit.find((i) => i.ticker === 'CENT').id;
    await page.locator('#investments-container .card', { hasText: 'CENT' })
      .locator('button.edit-btn').click();
    await waitModal(page, 'investment-modal', true);
    assert.equal(await page.inputValue('#investment-id'), centId, 'edit modal carries the CENT id');
    await page.fill('#investment-current', '0.03');
    await page.click('#investment-form button[type="submit"]');
    await waitModal(page, 'investment-modal', false);
    await page.waitForFunction(() => {
      const inv = window.__store?.getData().investments.find((i) => i.ticker === 'CENT');
      return inv && inv.current === 0.03;
    }, null, { timeout: 8000 });
    const centFixture = fixtures.find((f) => f.ticker === 'CENT');
    centFixture.currentNum = 0.03;
    const afterEdit = await readInvestments(page);
    assertExact(afterEdit, 'after edit');
    assert.equal(afterEdit.find((i) => i.ticker === 'CENT').id, centId, 'edit kept the CENT id');

    // Exactness survives reload.
    await page.reload({ waitUntil: 'load' });
    await grabStore(page);
    assertExact(await readInvestments(page), 'after reload');

    // Export, then reimport the exact export into a clean context.
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 8000 }),
      page.evaluate(() => window.__store.exportData()),
    ]);
    const exportedText = readFileSync(await download.path(), 'utf8');
    const exported = JSON.parse(exportedText);
    assertExact(exported.data.investments.map((i) => ({ ...i })), 'in the export payload');

    const errors2 = [];
    const context2 = await browser.newContext({ acceptDownloads: true });
    try {
      const page2 = await bootPage(context2, origin, errors2);
      await importInPage(page2, importPayload(exported.data));
      assertExact(await readInvestments(page2), 'after reimport into a clean context');
      await page2.reload({ waitUntil: 'load' });
      await grabStore(page2);
      assertExact(await readInvestments(page2), 'after reimport and reload');
      assert.equal(errors2.length, 0, `no page errors in the reimport context: ${errors2.join(' | ')}`);
    } finally {
      await context2.close();
    }
    assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
    return 'zero, 0.01, multi-decimal (1234.56/2345.67) and large (999999.99/1000000.5) values created and edited through the real form stayed exact across save, reload, export and reimport into a clean context';
  } finally {
    await context.close();
  }
});

// --- V16-CONTENT-04: populated Jobs explorer ---------------------------------
await group('V16-CONTENT-04', async () => {
  const errors = [];
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await bootPage(context, origin, errors);
    await page.click('.nav-btn[data-view="jobs"]');

    const fixtures = [
      { company: 'Zeta Corp', role: 'Designer', status: 'applied', location: 'toronto', date: '2026-10-04', notes: 'zeta note' },
      { company: 'Alpha Corp', role: 'Engineer', status: 'interview', location: 'vancouver', date: '2026-10-01', notes: 'alpha note' },
      { company: 'Metro Corp', role: 'Engineer', status: 'applied', location: 'toronto', date: '2026-10-03', notes: 'metro note' },
      { company: 'Beta Corp', role: 'Manager', status: 'offer', location: 'remote-canada', date: '2026-10-02', notes: 'beta note' },
    ];
    async function createJobViaForm(fx) {
      await page.click('#btn-create-job');
      await waitModal(page, 'job-modal', true);
      await page.fill('#job-company', fx.company);
      await page.fill('#job-role', fx.role);
      await page.selectOption('#job-status', fx.status);
      await page.selectOption('#job-location', fx.location);
      await page.fill('#job-date', fx.date);
      await page.fill('#job-notes', fx.notes);
      await page.click('#job-form button[type="submit"]');
      await waitModal(page, 'job-modal', false);
      await page.waitForFunction((c) => {
        return [...document.querySelectorAll('#jobs-container .card h3')]
          .some((el) => el.textContent === c);
      }, fx.company, { timeout: 8000 });
    }
    for (const fx of fixtures) await createJobViaForm(fx);

    const stored = await page.evaluate(async () => {
      window.__jobs = await import('/js/jobs.js');
      return window.__jobs.getJobs();
    });
    assert.equal(stored.length, 4, 'four jobs seeded through the real form');
    const idByCompany = Object.fromEntries(stored.map((j) => [j.company, j.id]));

    async function cardCompanies() {
      return page.evaluate(() =>
        [...document.querySelectorAll('#jobs-container .card h3')].map((el) => el.textContent));
    }
    // The Jobs view sorts by date, newest first.
    assert.deepEqual(await cardCompanies(), ['Zeta Corp', 'Metro Corp', 'Beta Corp', 'Alpha Corp'],
      'jobs view lists the populated data newest-first by date');

    // View status filter narrows to the matching rows only.
    await page.selectOption('#job-status-filter', 'applied');
    await page.waitForFunction(() => document.querySelectorAll('#jobs-container .card').length === 2,
      null, { timeout: 8000 });
    assert.deepEqual(await cardCompanies(), ['Zeta Corp', 'Metro Corp'],
      'status filter Applied shows exactly the two applied jobs, still newest-first');
    await page.selectOption('#job-status-filter', 'all');
    await page.selectOption('#job-location-filter', 'vancouver');
    await page.waitForFunction(() => document.querySelectorAll('#jobs-container .card').length === 1,
      null, { timeout: 8000 });
    assert.deepEqual(await cardCompanies(), ['Alpha Corp'],
      'location filter Vancouver shows exactly Alpha Corp');
    await page.selectOption('#job-location-filter', 'all');
    await page.waitForFunction(() => document.querySelectorAll('#jobs-container .card').length === 4,
      null, { timeout: 8000 });

    // Chart explorer: text filter narrows the table to matching rows.
    const explorerRoot = '#jobs-explorer-root';
    async function explorerRows() {
      return page.evaluate((root) => {
        return [...document.querySelectorAll(`${root} tbody tr`)].map((tr) =>
          [...tr.querySelectorAll('td')].map((td) => td.textContent));
      }, explorerRoot);
    }
    await page.waitForFunction((root) => document.querySelectorAll(`${root} tbody tr`).length === 4,
      explorerRoot, { timeout: 8000 });
    await page.locator(`${explorerRoot} input[placeholder="Filter data..."]`).fill('Engineer');
    await page.waitForFunction((root) => document.querySelectorAll(`${root} tbody tr`).length === 2,
      explorerRoot, { timeout: 8000 });
    let rows = await explorerRows();
    assert.deepEqual(rows.map((r) => r[0]).sort(), ['Alpha Corp', 'Metro Corp'],
      'explorer filter Engineer shows exactly the two Engineer rows');
    await page.locator(`${explorerRoot} input[placeholder="Filter data..."]`).fill('');
    await page.waitForFunction((root) => document.querySelectorAll(`${root} tbody tr`).length === 4,
      explorerRoot, { timeout: 8000 });

    // Explorer column sort: company ascending, then descending, with
    // the header label showing the direction as labelled.
    await page.locator(`${explorerRoot} thead th`, { hasText: 'company' }).first().click();
    await page.waitForFunction((root) => {
      const th = [...document.querySelectorAll(`${root} thead th`)]
        .find((el) => el.textContent.includes('company'));
      return th && th.textContent.includes('▲');
    }, explorerRoot, { timeout: 8000 });
    rows = await explorerRows();
    assert.deepEqual(rows.map((r) => r[0]), ['Alpha Corp', 'Beta Corp', 'Metro Corp', 'Zeta Corp'],
      'explorer company sort ascending orders the rows A to Z');
    await page.locator(`${explorerRoot} thead th`, { hasText: 'company' }).first().click();
    await page.waitForFunction((root) => {
      const th = [...document.querySelectorAll(`${root} thead th`)]
        .find((el) => el.textContent.includes('company'));
      return th && th.textContent.includes('▼');
    }, explorerRoot, { timeout: 8000 });
    rows = await explorerRows();
    assert.deepEqual(rows.map((r) => r[0]), ['Zeta Corp', 'Metro Corp', 'Beta Corp', 'Alpha Corp'],
      'explorer company sort descending orders the rows Z to A');

    // Navigation: opening Metro Corp from the list reaches its record.
    await page.locator('#jobs-container .card', { hasText: 'Metro Corp' })
      .locator('button', { hasText: 'Edit' }).click();
    await waitModal(page, 'job-modal', true);
    assert.equal(await page.inputValue('#job-id'), idByCompany['Metro Corp'],
      'Edit opens the modal with the Metro Corp record id');
    assert.equal(await page.inputValue('#job-company'), 'Metro Corp', 'modal company is Metro Corp');
    assert.equal(await page.inputValue('#job-role'), 'Engineer', 'modal role is the Metro Corp role');
    assert.equal(await page.inputValue('#job-notes'), 'metro note', 'modal notes are the Metro Corp notes');
    await page.click('#btn-cancel-job-modal');
    await waitModal(page, 'job-modal', false);
    assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
    return 'four jobs seeded via the real form listed newest-first; status/location filters narrowed exactly; explorer text filter showed the two Engineer rows; company sort asc/desc matched its ▲/▼ labels; Edit on Metro Corp opened its exact record';
  } finally {
    await context.close();
  }
});

// --- V16-CONTENT-05: populated Investments explorer ----------------------------
await group('V16-CONTENT-05', async () => {
  const errors = [];
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await bootPage(context, origin, errors);
    await page.click('.nav-btn[data-view="investments"]');

    const fixtures = [
      { ticker: 'ZULU', entry: '10', current: '12' },
      { ticker: 'ALPHA', entry: '5', current: '7' },
      { ticker: 'MIKE', entry: '20', current: '18' },
      { ticker: 'BRAVO', entry: '15', current: '15' },
    ];
    async function createInvestmentViaForm(fx) {
      await page.click('#btn-create-investment');
      await waitModal(page, 'investment-modal', true);
      await page.fill('#investment-ticker', fx.ticker);
      await page.fill('#investment-entry', fx.entry);
      await page.fill('#investment-current', fx.current);
      await page.click('#investment-form button[type="submit"]');
      await waitModal(page, 'investment-modal', false);
      await page.waitForFunction((t) => {
        return [...document.querySelectorAll('#investments-container .card .card-title')]
          .some((el) => el.textContent === t);
      }, fx.ticker, { timeout: 8000 });
    }
    for (const fx of fixtures) await createInvestmentViaForm(fx);

    const stored = await page.evaluate(async () => {
      window.__inv = await import('/js/investments.js');
      return window.__inv.getInvestments();
    });
    assert.equal(stored.length, 4, 'four investments seeded through the real form');
    const idByTicker = Object.fromEntries(stored.map((i) => [i.ticker, i.id]));
    const cardCount = await page.evaluate(() => document.querySelectorAll('#investments-container .card').length);
    assert.equal(cardCount, 4, 'four investment cards render for the populated data');

    const explorerRoot = '#investments-explorer-root';
    async function explorerRows() {
      return page.evaluate((root) => {
        return [...document.querySelectorAll(`${root} tbody tr`)].map((tr) =>
          [...tr.querySelectorAll('td')].map((td) => td.textContent));
      }, explorerRoot);
    }
    await page.waitForFunction((root) => document.querySelectorAll(`${root} tbody tr`).length === 4,
      explorerRoot, { timeout: 8000 });

    // Explorer text filter narrows to the single matching row.
    await page.locator(`${explorerRoot} input[placeholder="Filter data..."]`).fill('zulu');
    await page.waitForFunction((root) => document.querySelectorAll(`${root} tbody tr`).length === 1,
      explorerRoot, { timeout: 8000 });
    let rows = await explorerRows();
    assert.equal(rows[0][0], 'ZULU', 'explorer filter zulu shows exactly the ZULU row');
    await page.locator(`${explorerRoot} input[placeholder="Filter data..."]`).fill('');
    await page.waitForFunction((root) => document.querySelectorAll(`${root} tbody tr`).length === 4,
      explorerRoot, { timeout: 8000 });

    // Explorer ticker sort ascending matches its label.
    await page.locator(`${explorerRoot} thead th`, { hasText: 'ticker' }).first().click();
    await page.waitForFunction((root) => {
      const th = [...document.querySelectorAll(`${root} thead th`)]
        .find((el) => el.textContent.includes('ticker'));
      return th && th.textContent.includes('▲');
    }, explorerRoot, { timeout: 8000 });
    rows = await explorerRows();
    assert.deepEqual(rows.map((r) => r[0]), ['ALPHA', 'BRAVO', 'MIKE', 'ZULU'],
      'explorer ticker sort ascending orders the rows A to Z');

    // Explorer entry sort is numeric, not lexical: 5 < 10 < 15 < 20.
    await page.locator(`${explorerRoot} thead th`, { hasText: 'entry' }).first().click();
    await page.waitForFunction((root) => {
      const th = [...document.querySelectorAll(`${root} thead th`)]
        .find((el) => el.textContent.includes('entry'));
      return th && th.textContent.includes('▲');
    }, explorerRoot, { timeout: 8000 });
    rows = await explorerRows();
    assert.deepEqual(rows.map((r) => r[0]), ['ALPHA', 'ZULU', 'BRAVO', 'MIKE'],
      'explorer entry sort ascending orders by numeric entry (5, 10, 15, 20)');
    assert.deepEqual(rows.map((r) => r[1]), ['5', '10', '15', '20'],
      'explorer entry cells show the numeric order');

    // Navigation: opening MIKE from the list reaches its record.
    await page.locator('#investments-container .card', { hasText: 'MIKE' })
      .locator('button.edit-btn').click();
    await waitModal(page, 'investment-modal', true);
    assert.equal(await page.inputValue('#investment-id'), idByTicker['MIKE'],
      'Edit opens the modal with the MIKE record id');
    assert.equal(await page.inputValue('#investment-ticker'), 'MIKE', 'modal ticker is MIKE');
    assert.equal(await page.inputValue('#investment-entry'), '20', 'modal entry is the MIKE entry');
    assert.equal(await page.inputValue('#investment-current'), '18', 'modal current is the MIKE current');
    await page.click('#btn-cancel-investment-modal');
    await waitModal(page, 'investment-modal', false);
    assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
    return 'four investments seeded via the real form; explorer filter zulu showed one row; ticker sort A to Z and numeric entry sort (5, 10, 15, 20) matched their ▲ labels; Edit on MIKE opened its exact record';
  } finally {
    await context.close();
  }
});

await browser.close();
server.close();

const passed = results.filter((r) => r.status === 'PASS').length;
const notRun = results.filter((r) => r.status === 'NOT RUN').length;
const failed = results.filter((r) => r.status === 'FAIL').length;
console.log('');
console.log(`Summary: PASS ${passed}; NOT RUN ${notRun}; FAIL ${failed}`);
emitResults();
if (failed > 0) process.exitCode = 1;
