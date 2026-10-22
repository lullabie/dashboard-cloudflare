// main-v15-guard.test.mjs — V15 Lane C: stale-modal guard wiring and
// the honest indicators panel. Source-level checks [STATIC]; the
// behavioral proof (two-tab open-modal conflict in a real browser)
// is the Lane E audit-regression spec.

import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

let passed = 0; let failed = 0;
const check = (name, cond, detail) => {
    if (cond) { console.log('PASS [STATIC]:', name); passed++; }
    else { console.error('FAIL [STATIC]:', name, detail); failed++; }
};

check('V15-C: baseline guard helpers exist',
    main.includes('function captureModalBaseline') && main.includes('function modalBaselineConflict') && main.includes('function staleModalBlock'));

for (const kind of ['goal', 'place', 'job', 'investment', 'habit']) {
    check(`V15-C: ${kind} modal captures a baseline at open`,
        main.includes(`captureModalBaseline('${kind}'`));
    check(`V15-C: ${kind} submit is blocked on a stale baseline`,
        main.includes(`staleModalBlock('${kind}'`));
    check(`V15-C: ${kind} modal clears its baseline at close`,
        main.includes(`clearModalBaseline('${kind}')`));
}

check('V15-C: conflict message keeps the draft and states nothing was saved',
    main.includes('Your draft is still in the form and nothing was saved'));

check('V15-C: blank indicators canvas removed from index.html',
    !html.includes('id="indicators-chart"'));
check('V15-C: false FX-trend alt text removed',
    !html.includes('Line chart showing FX trends'));
check('V15-C: indicators cards container retained',
    html.includes('id="indicators-container"'));

console.log(`\nTests completed: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
