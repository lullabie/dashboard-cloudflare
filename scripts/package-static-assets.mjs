#!/usr/bin/env node
// package-static-assets.mjs — exact staged-asset manifest check (V15).
//
// Replaces the v4 allowlist check, which passed a tree containing
// only LICENSE and a test fixture with no index.html (Codex V15,
// defect 6): ship rules ran before exclusions and a non-empty ship
// set was sufficient. This checker is exact:
//
//   1. EXCLUSIONS FIRST. A path under an excluded root or matching an
//      exclusion pattern can never ship, even if a ship rule matches.
//   2. EXACT MANIFEST. The expected ship set is computed from the
//      source tree. The staged folder must contain exactly that set:
//      a missing file fails, an extra file fails.
//   3. REQUIRED FILES. index.html, LICENSE, THIRD-PARTY-NOTICES.txt
//      and the app entry modules must be in the expected set.
//   4. DEPENDENCY CLOSURE. Every local reference from a staged file
//      (HTML src/href, CSS url()/@import, JS import/export specifier)
//      must resolve to a file inside the staged set.
//   5. FORBIDDEN files (credentials, secrets, env) never ship.
//
// --stage safety (V15 P1 fix, Codex review of 7883921): the old code
// ran rmSync(staged, {recursive:true}) before validating anything,
// so `--stage <src> <src>` deleted the source tree and an ancestor
// output could delete the whole source. The stage path now:
//   - validates the source (required, forbidden, unclassified)
//     BEFORE any output mutation; an invalid source exits 1 with the
//     output untouched;
//   - resolves real paths (deepest existing ancestor + remainder, so
//     symlink and junction aliases cannot bypass the boundary) and
//     rejects stage == source and stage as an ancestor of source;
//   - never recursively erases a folder it does not own. Ownership
//     is a sibling marker file (<staged>.pkg-owned.json) that lists
//     the files this tool staged. A pre-existing non-empty target
//     without a valid marker is refused untouched. A restage deletes
//     ONLY the files the marker lists; any other file present is
//     left in place (and then reported as EXTRA by verification).
//
// Usage:
//   node scripts/package-static-assets.mjs <source-tree> <staged-dir>
//   node scripts/package-static-assets.mjs --stage <source-tree> <staged-dir>
//
// --stage copies the expected set into <staged-dir> first, then runs
// the same verification. Deploys nothing. Exit 0 pass, 1 fail, 2 usage.

import { readdirSync, statSync, existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, rmdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve, dirname, basename, sep, isAbsolute, posix } from 'node:path';

const args = process.argv.slice(2);
const stageMode = args.includes('--stage');
const positional = args.filter((a) => a !== '--stage');
if (positional.length !== 2) {
    console.error('Usage: node scripts/package-static-assets.mjs [--stage] <source-tree> <staged-dir>');
    process.exit(2);
}
const source = resolve(positional[0]);
const staged = resolve(positional[1]);
if (!existsSync(source) || !statSync(source).isDirectory()) {
    console.error(`FAIL: source tree not found: ${source}`);
    process.exit(2);
}
if (!stageMode && (!existsSync(staged) || !statSync(staged).isDirectory())) {
    console.error(`FAIL: staged dir not found: ${staged}`);
    process.exit(2);
}

// Exclusions are evaluated BEFORE ship rules (V15 fix).
const excludedRules = [
    /^\.git(\/|$)/, /^node_modules(\/|$)/,
    /^docs(\/|$)/, /^qa(\/|$)/, /(^|\/)__tests__(\/|$)/,
    /^scripts(\/|$)/, /^\.github(\/|$)/,
    /\.md$/, /\.patch$/,
    /(^|\/)(MANIFEST|result|patch_manifest|summary|ledger)[^/]*$/i,
    /(^|\/)\.[^/]+$/, // dotfiles
];
const testLike = /(^|\/)[^/]*test[^/]*\.(js|mjs)$/i;
const shipRules = [
    /^index\.html$/,
    /^LICENSE$/,
    /^THIRD-PARTY-NOTICES\.txt$/,
    /^css\/.+\.css$/,
    /^js\/.+\.js$/,
];
const requiredFiles = [
    'index.html', 'LICENSE', 'THIRD-PARTY-NOTICES.txt',
    'js/main.js', 'js/store.js', 'js/chart.umd.js', 'css/app.css',
];
const forbidden = /(credential|secret|\.env|api[-_]?key|token)/i;

function walk(root, dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(root, p, out);
        else if (entry.isFile()) out.push(relative(root, p).split('\\').join('/'));
    }
    return out;
}

function classify(rel) {
    if (excludedRules.some((r) => r.test(rel)) || testLike.test(rel)) return 'excluded';
    if (shipRules.some((r) => r.test(rel))) return 'ship';
    return 'unclassified';
}

const sourceFiles = walk(source, source).sort();
const expected = [];
const unclassified = [];
for (const rel of sourceFiles) {
    const cls = classify(rel);
    if (cls === 'ship') expected.push(rel);
    else if (cls === 'unclassified') unclassified.push(rel);
}

const problems = [];
if (unclassified.length) {
    problems.push(`UNCLASSIFIED source files (neither ship nor excluded): ${unclassified.join(', ')}`);
}
for (const req of requiredFiles) {
    if (!expected.includes(req)) problems.push(`REQUIRED file missing from the expected ship set: ${req}`);
}
for (const rel of expected) {
    if (forbidden.test(rel)) problems.push(`FORBIDDEN file in ship set: ${rel}`);
}

function printHeader() {
    console.log(`Asset manifest check`);
    console.log(`  source: ${source}`);
    console.log(`  staged: ${staged}${stageMode ? ' (staged by this run)' : ''}`);
    console.log(`  expected ship set: ${expected.length} files`);
    for (const rel of expected) console.log(`    ${rel} (${statSync(join(source, rel)).size} B)`);
}
function failWithProblems() {
    printHeader();
    console.log(`\nFAIL (${problems.length}):`);
    for (const p of problems) console.log(`  ${p}`);
    process.exit(1);
}
function refuse(message) {
    console.error(`FAIL: ${message}`);
    process.exit(2);
}

// Resolve a path for boundary comparison: realpath the deepest
// existing ancestor, then append the remaining segments. A symlink
// or junction in the existing part cannot hide the true location.
function resolveReal(p) {
    let cur = resolve(p);
    const rest = [];
    while (!existsSync(cur)) {
        rest.unshift(basename(cur));
        const parent = dirname(cur);
        if (parent === cur) break;
        cur = parent;
    }
    let real = realpathSync(cur);
    for (const part of rest) real = join(real, part);
    return real;
}
function isWithin(child, parent) {
    const rel = relative(parent, child);
    return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

let stagedRoot = staged;
if (stageMode) {
    // Validate the source completely before touching the output.
    if (problems.length) failWithProblems();

    const realSource = realpathSync(source);
    const realStage = resolveReal(staged);
    if (realStage === realSource) {
        refuse(`stage dir must differ from the source tree (both resolve to ${realSource})`);
    }
    if (isWithin(realSource, realStage)) {
        refuse(`stage dir must not be an ancestor of the source tree (${realStage} contains ${realSource})`);
    }

    // Ownership: a pre-existing non-empty target is modified only if
    // a valid sibling marker proves this tool staged it earlier.
    const markerPath = `${realStage}.pkg-owned.json`;
    let previouslyStaged = [];
    if (existsSync(realStage)) {
        if (!statSync(realStage).isDirectory()) {
            refuse(`stage target exists and is not a directory: ${realStage}`);
        }
        const existing = walk(realStage, realStage);
        if (existing.length) {
            let marker = null;
            try { marker = JSON.parse(readFileSync(markerPath, 'utf8')); } catch { marker = null; }
            if (!marker || marker.tool !== 'package-static-assets' || !Array.isArray(marker.files)) {
                refuse(`stage target is a pre-existing folder not owned by this tool; refusing to modify it: ${realStage}`);
            }
            previouslyStaged = marker.files;
        }
    }

    // Delete ONLY the files the marker lists. Any other file present
    // is left in place; verification reports it as EXTRA.
    for (const rel of previouslyStaged) {
        const p = resolve(join(realStage, rel));
        if (isWithin(p, realStage) && existsSync(p) && statSync(p).isFile()) {
            rmSync(p, { force: true });
        }
    }
    // Prune directories left empty by those deletions, deepest
    // first, never the stage root itself.
    const dirs = new Set();
    for (const rel of previouslyStaged) {
        let d = dirname(join(realStage, rel));
        while (isWithin(d, realStage)) { dirs.add(d); d = dirname(d); }
    }
    for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
        // rmdirSync removes only an empty directory and throws
        // otherwise, so a folder refilled since the check survives.
        if (existsSync(d) && readdirSync(d).length === 0) rmdirSync(d);
    }

    if (!existsSync(realStage)) mkdirSync(realStage, { recursive: true });
    for (const rel of expected) {
        const dest = join(realStage, rel);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(join(source, rel), dest);
    }
    writeFileSync(markerPath, JSON.stringify({ tool: 'package-static-assets', files: expected }, null, 2) + '\n');
    stagedRoot = realStage;
}

if (!existsSync(stagedRoot) || !statSync(stagedRoot).isDirectory()) {
    console.error(`FAIL: staged dir not found: ${staged}`);
    process.exit(2);
}
const stagedFiles = walk(stagedRoot, stagedRoot).sort();
const expectedSet = new Set(expected);
const stagedSet = new Set(stagedFiles);
const missing = expected.filter((f) => !stagedSet.has(f));
const extra = stagedFiles.filter((f) => !expectedSet.has(f));
if (missing.length) problems.push(`MISSING from staged folder: ${missing.join(', ')}`);
if (extra.length) problems.push(`EXTRA in staged folder (not in the manifest): ${extra.join(', ')}`);

// Dependency closure over the staged set.
function localRefs(rel, content) {
    const refs = [];
    if (rel.endsWith('.html')) {
        for (const m of content.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)) refs.push(m[1]);
    } else if (rel.endsWith('.css')) {
        for (const m of content.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) refs.push(m[1]);
        for (const m of content.matchAll(/@import\s+['"]([^'"]+)['"]/g)) refs.push(m[1]);
    } else if (rel.endsWith('.js') || rel.endsWith('.mjs')) {
        // Static imports/exports are line-anchored statements; loose
        // matching false-positives on minified bundles and comments.
        for (const m of content.matchAll(/^\s*import\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/gm)) refs.push(m[1]);
        for (const m of content.matchAll(/^\s*export\s+[^'";]*?\sfrom\s*['"]([^'"]+)['"]/gm)) refs.push(m[1]);
        for (const m of content.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) refs.push(m[1]);
    }
    return refs.filter((r) => r && !/^(https?:|data:|#|mailto:|tel:)/i.test(r));
}
if (!missing.length && !extra.length) {
    for (const rel of stagedFiles) {
        const content = readFileSync(join(stagedRoot, rel), 'utf8');
        for (const ref of localRefs(rel, content)) {
            const target = posix.normalize(posix.join(posix.dirname(rel), ref.split(/[?#]/)[0]));
            if (!stagedSet.has(target)) {
                problems.push(`BROKEN reference: ${rel} -> ${ref} (resolves to ${target}, not in the staged set)`);
            }
        }
    }
}

printHeader();
if (problems.length) {
    console.log(`\nFAIL (${problems.length}):`);
    for (const p of problems) console.log(`  ${p}`);
    process.exit(1);
}
console.log(`\nResult: PASS — staged folder matches the exact manifest and every local reference resolves.`);
process.exit(0);
