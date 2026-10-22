// package-v15-manifest.test.mjs — V15 Lane D: the staged-asset
// manifest checker is exact (exclusions first, exact set equality,
// required files, dependency closure). Includes the Codex V15
// counterexample that the v4 checker passed.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = new URL('..', import.meta.url).pathname;
const script = join(repo, 'scripts/package-static-assets.mjs');

let passed = 0; let failed = 0;
const check = (name, cond, detail) => {
    if (cond) { console.log('PASS:', name); passed++; }
    else { console.error('FAIL:', name, detail); failed++; }
};
function runChecker(source, staged, stage) {
    const argv = [script];
    if (stage) argv.push('--stage');
    argv.push(source, staged);
    try {
        const out = execFileSync('node', argv, { encoding: 'utf8' });
        return { code: 0, out };
    } catch (e) {
        return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
    }
}
function tempDir(label) { return mkdtempSync(join(tmpdir(), `v15pkg-${label}-`)); }

// 1. Codex counterexample: LICENSE + a test fixture, no index.html.
// The v4 checker returned PASS here; the V15 checker must FAIL.
{
    const src = tempDir('counter-src'); const stg = tempDir('counter-stg');
    writeFileSync(join(src, 'LICENSE'), 'MIT');
    mkdirSync(join(src, 'js/__tests__'), { recursive: true });
    writeFileSync(join(src, 'js/__tests__/fixture.js'), 'export {};');
    const r = runChecker(src, stg, true);
    check('V15-D: counterexample tree (LICENSE + fixture, no index.html) FAILS', r.code === 1, r.out);
    check('V15-D: fixture under __tests__ is excluded even though it matches the js ship rule',
        !existsSync(join(stg, 'js/__tests__/fixture.js')), stg);
    rmSync(src, { recursive: true, force: true }); rmSync(stg, { recursive: true, force: true });
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
    check('V15-D: extra staged file FAILS', r.code === 1 && r.out.includes('EXTRA'), r.out);
    rmSync(join(realStaged, 'extra.js'), { force: true });
}

// 4. A missing file in the staged folder fails.
{
    rmSync(join(realStaged, 'js/store.js'), { force: true });
    const r = runChecker(repo, realStaged, false);
    check('V15-D: missing staged file FAILS', r.code === 1 && r.out.includes('MISSING'), r.out);
}

// 5. A broken local reference fails closure (set unchanged, content edited).
{
    const r0 = runChecker(repo, realStaged, true); // restage clean
    if (r0.code !== 0) { check('V15-D: restage for closure case', false, r0.out); }
    else {
        const mainPath = join(realStaged, 'js/main.js');
        const { readFileSync, writeFileSync: wf } = await import('node:fs');
        wf(mainPath, readFileSync(mainPath, 'utf8') + "\nimport './does-not-exist-v15.js';\n");
        const r = runChecker(repo, realStaged, false);
        check('V15-D: broken import reference FAILS closure', r.code === 1 && r.out.includes('BROKEN'), r.out);
    }
}
rmSync(work, { recursive: true, force: true });

console.log(`\nTests completed: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
