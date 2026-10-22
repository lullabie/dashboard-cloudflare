// package-v15-manifest.test.mjs — V15 Lane D: the staged-asset
// manifest checker is exact (exclusions first, exact set equality,
// required files, dependency closure). Includes the Codex V15
// counterexample that the v4 checker passed, plus the staging-safety
// cases from the Codex review of 7883921 (P1: --stage deleted its
// target before validating; the old negative case also accepted ANY
// exit 1, including a MODULE_NOT_FOUND loader error on Windows,
// where new URL('..', import.meta.url).pathname produced
// C:\C:\Users... — hence fileURLToPath + process.execPath here, and
// every negative case asserts the expected validation reason and
// the absence of loader errors).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const script = join(repo, 'scripts/package-static-assets.mjs');

let passed = 0; let failed = 0;
const check = (name, cond, detail) => {
    if (cond) { console.log('PASS:', name); passed++; }
    else { console.error('FAIL:', name, detail); failed++; }
};
const LOADER_ERROR = /MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|Cannot find module/;
function runChecker(source, staged, stage) {
    const argv = [script];
    if (stage) argv.push('--stage');
    argv.push(source, staged);
    try {
        const out = execFileSync(process.execPath, argv, { encoding: 'utf8' });
        return { code: 0, out };
    } catch (e) {
        return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
    }
}
// A rejection counts only when the process failed for the expected
// validation reason — never for a loader or runtime error.
function checkRejection(name, r, reason) {
    check(name, r.code !== 0 && r.out.includes(reason) && !LOADER_ERROR.test(r.out),
        `code=${r.code} reason=${JSON.stringify(reason)}\n${r.out}`);
}
function tempDir(label) { return mkdtempSync(join(tmpdir(), `v15pkg-${label}-`)); }
function minimalValidSource(dir) {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html></html>');
    writeFileSync(join(dir, 'LICENSE'), 'MIT');
    writeFileSync(join(dir, 'THIRD-PARTY-NOTICES.txt'), 'notices');
    mkdirSync(join(dir, 'css'), { recursive: true });
    writeFileSync(join(dir, 'css/app.css'), 'body{}');
    mkdirSync(join(dir, 'js'), { recursive: true });
    writeFileSync(join(dir, 'js/main.js'), 'export {};');
    writeFileSync(join(dir, 'js/store.js'), 'export {};');
    writeFileSync(join(dir, 'js/chart.umd.js'), '/* bundle */');
}

// 1. Codex counterexample: LICENSE + a test fixture, no index.html.
// The v4 checker returned PASS here; the V15 checker must FAIL for
// the REQUIRED reason, and --stage must not create the output.
{
    const src = tempDir('counter-src'); const stg = join(tempDir('counter-parent'), 'staged');
    writeFileSync(join(src, 'LICENSE'), 'MIT');
    mkdirSync(join(src, 'js/__tests__'), { recursive: true });
    writeFileSync(join(src, 'js/__tests__/fixture.js'), 'export {};');
    const r = runChecker(src, stg, true);
    checkRejection('V15-D: counterexample tree (LICENSE + fixture, no index.html) FAILS on REQUIRED', r, 'REQUIRED file missing');
    check('V15-D: invalid source leaves the stage target uncreated', !existsSync(stg), stg);
    check('V15-D: fixture under __tests__ is never staged',
        !existsSync(join(stg, 'js/__tests__/fixture.js')), stg);
    rmSync(src, { recursive: true, force: true });
}

// 2. The real tree stages exactly and passes closure.
const work = tempDir('real');
const realStaged = join(work, 'staged');
{
    const r = runChecker(repo, realStaged, true);
    check('V15-D: real tree stages and passes the exact manifest + closure', r.code === 0, r.out);
    check('V15-D: staged set contains the third-party notices',
        existsSync(join(realStaged, 'THIRD-PARTY-NOTICES.txt')));
    check('V15-D: staged set contains no docs, qa, tests, or scripts',
        !existsSync(join(realStaged, 'docs')) && !existsSync(join(realStaged, 'qa')) &&
        !existsSync(join(realStaged, '__tests__')) && !existsSync(join(realStaged, 'scripts')));
}

// 3. An extra file in the staged folder fails.
{
    writeFileSync(join(realStaged, 'extra.js'), 'export {};');
    const r = runChecker(repo, realStaged, false);
    checkRejection('V15-D: extra staged file FAILS on EXTRA', r, 'EXTRA');
}

// 4. A missing file in the staged folder fails.
{
    rmSync(join(realStaged, 'extra.js'), { force: true });
    rmSync(join(realStaged, 'js/store.js'), { force: true });
    const r = runChecker(repo, realStaged, false);
    checkRejection('V15-D: missing staged file FAILS on MISSING', r, 'MISSING');
}

// 5. A broken local reference fails closure (set unchanged, content edited).
{
    const r0 = runChecker(repo, realStaged, true); // restage clean (owned target)
    if (r0.code !== 0) { check('V15-D: restage for closure case', false, r0.out); }
    else {
        const mainPath = join(realStaged, 'js/main.js');
        writeFileSync(mainPath, readFileSync(mainPath, 'utf8') + "\nimport './does-not-exist-v15.js';\n");
        const r = runChecker(repo, realStaged, false);
        checkRejection('V15-D: broken import reference FAILS on BROKEN', r, 'BROKEN');
    }
}

// 6. A file the user placed in an owned staged folder is never
// deleted by a restage; verification reports it as EXTRA instead.
{
    const r0 = runChecker(repo, realStaged, true);
    if (r0.code !== 0) { check('V15-D: restage for preservation case', false, r0.out); }
    else {
        writeFileSync(join(realStaged, 'keep-me.txt'), 'user data');
        const r = runChecker(repo, realStaged, true);
        checkRejection('V15-D: restage with a user file present FAILS on EXTRA', r, 'EXTRA');
        check('V15-D: user file survives the restage attempt',
            existsSync(join(realStaged, 'keep-me.txt')) &&
            readFileSync(join(realStaged, 'keep-me.txt'), 'utf8') === 'user data');
        rmSync(join(realStaged, 'keep-me.txt'), { force: true });
    }
}
rmSync(work, { recursive: true, force: true });

// 7. --stage with stage == source is refused; the source survives.
{
    const src = tempDir('self-src'); minimalValidSource(src);
    const before = readFileSync(join(src, 'LICENSE'), 'utf8');
    const r = runChecker(src, src, true);
    checkRejection('V15-D: stage == source is refused', r, 'must differ from the source tree');
    check('V15-D: source tree intact after self-stage refusal',
        existsSync(join(src, 'index.html')) && readFileSync(join(src, 'LICENSE'), 'utf8') === before);
    rmSync(src, { recursive: true, force: true });
}

// 8. --stage with stage as an ancestor of source is refused; both
// the source and unrelated files in the ancestor survive.
{
    const parent = tempDir('ancestor');
    const src = join(parent, 'src'); mkdirSync(src); minimalValidSource(src);
    writeFileSync(join(parent, 'unrelated.txt'), 'do not delete');
    const r = runChecker(src, parent, true);
    checkRejection('V15-D: stage as ancestor of source is refused', r, 'must not be an ancestor of the source tree');
    check('V15-D: source and unrelated ancestor files survive',
        existsSync(join(src, 'index.html')) &&
        readFileSync(join(parent, 'unrelated.txt'), 'utf8') === 'do not delete');
    rmSync(parent, { recursive: true, force: true });
}

// 9. A symlink alias of the source as the stage target is refused
// (realpath boundary); the source survives.
{
    const src = tempDir('alias-src'); minimalValidSource(src);
    const alias = join(tempDir('alias-parent'), 'link');
    let linked = true;
    try { symlinkSync(src, alias, 'dir'); } catch { linked = false; }
    if (!linked) { check('V15-D: symlink alias case (skipped: symlink unavailable)', true); }
    else {
        const r = runChecker(src, alias, true);
        checkRejection('V15-D: symlink alias of source as stage target is refused', r, 'must differ from the source tree');
        check('V15-D: source intact after alias refusal', existsSync(join(src, 'index.html')));
    }
    rmSync(src, { recursive: true, force: true });
}

// 10. A pre-existing non-empty folder the tool does not own is
// refused untouched.
{
    const src = tempDir('unowned-src'); minimalValidSource(src);
    const stg = tempDir('unowned-stg');
    writeFileSync(join(stg, 'precious.txt'), 'mine');
    const r = runChecker(src, stg, true);
    checkRejection('V15-D: unowned non-empty stage target is refused', r, 'not owned by this tool');
    check('V15-D: unowned folder content survives untouched',
        readFileSync(join(stg, 'precious.txt'), 'utf8') === 'mine' &&
        !existsSync(join(stg, 'index.html')));
    rmSync(src, { recursive: true, force: true }); rmSync(stg, { recursive: true, force: true });
}

console.log(`\nTests completed: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
