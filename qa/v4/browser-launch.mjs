// browser-launch.mjs — shared Chromium-family launch helper for qa/v4 specs.
//
// Supported browsers (QA_BROWSER): chrome, brave, chromium (default
// chromium). There is no fallback: an unsupported value or a failed launch
// is an error, and the calling spec reports every owned case NOT RUN and
// exits nonzero. Launch uses the Playwright chromium launcher only, with
// isolated contexts created by the specs via browser.newContext(). No
// normal user profile is ever used.
//
// Executable override: QA_BROWSER_EXECUTABLE_PATH (alias
// QA_BROWSER_EXECUTABLE) points at an installed Chrome/Brave/Chromium
// executable. Without an override, kind chrome uses channel 'chrome',
// kind brave uses channel 'brave', and kind chromium uses the Playwright
// Chromium build installed by `npx playwright install chromium`.
//
// Documented setup: run "npm ci" in qa/v4 (pinned playwright 1.64.1),
// then "npx playwright install chromium". Or set
// QA_BROWSER_EXECUTABLE_PATH to an installed Chrome/Brave executable.

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const SUPPORTED_BROWSERS = ['chrome', 'brave', 'chromium'];

const KIND_LABELS = { chrome: 'Google Chrome', brave: 'Brave', chromium: 'Chromium' };

export const BROWSER_SETUP_TEXT =
  'Documented setup: run "npm ci" in qa/v4 (pinned playwright 1.64.1), ' +
  'then "npx playwright install chromium". Or set QA_BROWSER_EXECUTABLE_PATH ' +
  'to an installed Chrome/Brave executable (QA_BROWSER=chrome|brave|chromium).';

export function resolveBrowserSelection(env = process.env) {
  const raw = env.QA_BROWSER ?? 'chromium';
  const kind = String(raw).trim().toLowerCase() || 'chromium';
  if (!SUPPORTED_BROWSERS.includes(kind)) {
    throw new Error(
      `Unsupported QA_BROWSER "${raw}". Supported values: ${SUPPORTED_BROWSERS.join(', ')}. ` +
      'There is no fallback; set QA_BROWSER to a supported value.',
    );
  }
  const override = env.QA_BROWSER_EXECUTABLE_PATH ?? env.QA_BROWSER_EXECUTABLE ?? null;
  const executablePath = override && String(override).trim() ? String(override).trim() : null;
  return { kind, executablePath };
}

async function importCandidate(candidate) {
  return import(path.isAbsolute(candidate) ? pathToFileURL(candidate).href : candidate);
}

export async function loadPlaywright(env = process.env) {
  const candidates = [];
  if (env.PLAYWRIGHT_MODULE) candidates.push(env.PLAYWRIGHT_MODULE);
  candidates.push('playwright', 'playwright-core');
  candidates.push(path.join(here, 'node_modules', 'playwright-core', 'index.mjs'));
  candidates.push(path.join(here, 'node_modules', 'playwright', 'index.mjs'));
  try {
    const libDir = path.join(homedir(), '.local', 'lib');
    for (const entry of readdirSync(libDir)) {
      if (!entry.startsWith('python')) continue;
      const pkg = path.join(libDir, entry, 'site-packages', 'playwright', 'driver', 'package');
      if (existsSync(path.join(pkg, 'index.mjs'))) candidates.push(path.join(pkg, 'index.mjs'));
      else if (existsSync(pkg)) candidates.push(pkg);
    }
  } catch { /* no python driver package present */ }
  try {
    const npxDir = path.join(homedir(), '.npm', '_npx');
    for (const entry of readdirSync(npxDir)) {
      const pkg = path.join(npxDir, entry, 'node_modules', 'playwright-core');
      if (existsSync(path.join(pkg, 'index.mjs'))) candidates.push(path.join(pkg, 'index.mjs'));
      else if (existsSync(pkg)) candidates.push(pkg);
    }
  } catch { /* no npx cache present */ }

  const errors = [];
  for (const candidate of candidates) {
    try {
      const mod = await importCandidate(candidate);
      if (mod.chromium ?? mod.default?.chromium) return mod;
      errors.push(`${candidate}: loaded but exposes no chromium launcher`);
    } catch (error) {
      errors.push(`${candidate}: ${String(error?.message ?? error).split('\n')[0]}`);
    }
  }
  throw new Error(`No Playwright module resolved. Tried: ${errors.join(' ; ')}. ${BROWSER_SETUP_TEXT}`);
}

function actualNameFor(selection) {
  if (selection.executablePath) {
    const base = path.basename(selection.executablePath).toLowerCase();
    if (base.includes('brave')) return 'Brave';
    if (base.includes('chrome')) return 'Google Chrome';
    if (base.includes('chromium')) return 'Chromium';
  }
  return KIND_LABELS[selection.kind];
}

export async function launchSelectedBrowser(env = process.env) {
  const selection = resolveBrowserSelection(env);
  const playwright = await loadPlaywright(env);
  const chromium = playwright.chromium ?? playwright.default?.chromium;
  const options = { headless: true };
  if (selection.executablePath) options.executablePath = selection.executablePath;
  else if (selection.kind === 'chrome') options.channel = 'chrome';
  else if (selection.kind === 'brave') options.channel = 'brave';
  const browser = await chromium.launch(options);
  const actualName = actualNameFor(selection);
  const version = browser.version();
  const runtimeLabel = `${actualName} ${version}`;
  const launchNote = selection.executablePath
    ? `launched ${runtimeLabel} from ${selection.executablePath} (QA_BROWSER=${selection.kind})`
    : `launched ${runtimeLabel} (QA_BROWSER=${selection.kind})`;
  return { browser, selection, actualName, version, runtimeLabel, launchNote };
}

export function browserRuntimeLabel(info) {
  if (!info) return null;
  if (info.runtimeLabel) return info.runtimeLabel;
  if (info.actualName && info.version) return `${info.actualName} ${info.version}`;
  return null;
}
