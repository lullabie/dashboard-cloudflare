#!/usr/bin/env node
// package-static-assets.mjs — asset allowlist check (Track E, v4).
// PREPARATION ONLY: lists what WOULD ship; deploys nothing.
//
// Usage: node scripts/package-static-assets.mjs <assembled-tree-path>
//
// Allowlist (ships): index.html, css/**, production js/** (excluding
// test files), LICENSE. See docs/review/DEPLOYMENT-ASSETS-V4.txt.
// Excluded (may exist, never ships): docs/, qa/, __tests__/, scripts/,
// .github/, *.md, *.patch, helper/result/ledger files, dotfiles.
// Forbidden anywhere in the ship set: credentials, secrets, env files.
// Exit is nonzero if any file is neither allowlisted nor excluded, or
// if a forbidden file would ship.

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const tree = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
if (!existsSync(tree) || !statSync(tree).isDirectory()) {
  console.error(`FAIL: assembled tree not found: ${tree}`);
  process.exit(2);
}

const shipRules = [
  /^index\.html$/,
  /^css\/.+\.css$/,
  /^js\/.+\.js$/,
  /^LICENSE$/,
];
const excludedRules = [
  /^\.git(\/|$)/, /^node_modules(\/|$)/,
  /^docs(\/|$)/, /^qa(\/|$)/, /(^|\/)__tests__(\/|$)/,
  /^scripts(\/|$)/, /^\.github(\/|$)/,
  /\.md$/, /\.patch$/, /\.txt$/,
  /(^|\/)(MANIFEST|result|patch_manifest|summary|ledger)[^/]*$/i,
  /(^|\/)\.[^/]+$/, // dotfiles
];
const testLike = /(^|\/)[^/]*test[^/]*\.(js|mjs)$/i;
const forbidden = /(credential|secret|\.env|api[-_]?key|token)/i;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile()) out.push(relative(tree, p).split('\\').join('/'));
  }
  return out;
}

const files = walk(tree).sort();
const ship = [], excluded = [], unclassified = [], violations = [];
for (const rel of files) {
  const ships = shipRules.some((r) => r.test(rel)) && !testLike.test(rel);
  if (ships) {
    if (forbidden.test(rel)) violations.push(rel);
    ship.push(rel);
  } else if (excludedRules.some((r) => r.test(rel)) || testLike.test(rel)) {
    excluded.push(rel);
  } else {
    unclassified.push(rel);
  }
}

console.log(`Asset check for ${tree}`);
console.log(`\nWOULD SHIP (${ship.length}):`);
for (const rel of ship) console.log(`  ${rel} (${statSync(join(tree, rel)).size} B)`);
console.log(`\nEXCLUDED (${excluded.length}): docs, qa, tests, scripts, CI, ledgers, helper files.`);
if (violations.length) {
  console.log(`\nFORBIDDEN IN SHIP SET (${violations.length}):`);
  for (const rel of violations) console.log(`  ${rel}`);
}
if (unclassified.length) {
  console.log(`\nUNCLASSIFIED — neither allowlisted nor excluded (${unclassified.length}):`);
  for (const rel of unclassified) console.log(`  ${rel}`);
}
const ok = violations.length === 0 && unclassified.length === 0 && ship.length > 0;
console.log(`\nResult: ${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
