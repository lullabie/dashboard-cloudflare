#!/usr/bin/env node
// run-review-tests.mjs — the single review test command (Track E, v4).
//
// Usage: node scripts/run-review-tests.mjs <assembled-tree-path>
//
// Discovers the actual lane test files in the assembled tree, runs each
// one with Node from the tree root, enumerates it by name with its
// result, and exits nonzero if any required test fails or none are
// found. Nothing here prints a success claim without executing the file.
//
// Discovery: every *.test.js / *.test.mjs under __tests__/, plus any
// file whose name matches *test*.js / *test*.mjs elsewhere in the tree
// (excluding .git and node_modules).
// Special case: __tests__/store_validation.test.js is the legacy store
// acceptance runner and requires the store.js path as an argument.

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename, resolve } from 'node:path';

const tree = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
if (!existsSync(tree) || !statSync(tree).isDirectory()) {
  console.error(`FAIL: assembled tree not found: ${tree}`);
  process.exit(2);
}

const SKIP_DIRS = new Set(['.git', 'node_modules']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out);
    } else if (entry.isFile()) {
      const p = join(dir, entry.name);
      const rel = relative(tree, p);
      const inTestsDir = rel.split(/[\\/]/).includes('__tests__');
      if ((inTestsDir && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')))
          || entry.name.endsWith('.test.js') || entry.name.endsWith('.test.mjs')) {
        out.push(p);
      }
    }
  }
  return out;
}

const tests = [...new Set(walk(tree))].sort();
if (tests.length === 0) {
  console.error(`FAIL: no test files discovered under ${tree}`);
  process.exit(1);
}

console.log(`Review tests: ${tests.length} file(s) under ${tree}`);
let failed = 0;
for (const file of tests) {
  const rel = relative(tree, file);
  const args = [file];
  if (basename(file) === 'store_validation.test.js') {
    args.push(join(tree, 'js', 'store.js')); // legacy runner requires the store.js path
  }
  const r = spawnSync(process.execPath, args, { cwd: tree, encoding: 'utf8', timeout: 180000 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const caseLines = out.split('\n').filter((l) => /\b(PASS|FAIL)\b/.test(l));
  console.log(`\n[TEST] ${rel}`);
  for (const line of caseLines) console.log(`  ${line.trim()}`);
  const ok = r.status === 0;
  if (!ok) failed += 1;
  console.log(`[RESULT] ${rel}: ${ok ? 'PASS' : `FAIL (exit ${r.status ?? 'signal ' + r.signal})`}`);
}

console.log(`\nSummary: ${tests.length - failed}/${tests.length} test file(s) passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
