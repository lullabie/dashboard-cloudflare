// jobs-v15-render.test.mjs — V15 Lane A, contract-review obligation:
// createJobCard renders every supported jobs shape without throwing
// and without mutating the record. Fields are carried verbatim by
// the store (docs/review/V15-CONTRACT.md), so a legacy title-only
// entry with no status, or a malformed non-string status, reaches
// the card as-is; a missing/non-string status renders as an honest
// "Unknown", never a crash (the pre-fix code called
// job.status.charAt unguarded). DOM is a recording stub [MOCK].

globalThis.window = { confirm: () => true, alert: () => {} };
globalThis.confirm = window.confirm;
globalThis.alert = window.alert;
Object.defineProperty(globalThis, 'crypto', { value: { randomUUID: () => 'uuid-' + Math.random() }, configurable: true });
globalThis.BroadcastChannel = class { constructor() {} postMessage() {} close() {} };
globalThis.indexedDB = { open: () => { const r = {}; setTimeout(() => { if (r.onerror) r.onerror(new Error('no db in test')); }, 0); return r; } };
globalThis.localStorage = { getItem: () => null };

const created = [];
function fakeElement(tag) {
    const el = {
        tagName: tag, className: '', style: {}, dataset: {}, children: [], _text: '',
        set textContent(v) { this._text = v; },
        get textContent() { return this._text; },
        setAttribute() {}, addEventListener() {},
        appendChild(c) { this.children.push(c); return c; },
        querySelector() { return fakeElement('div'); },
        querySelectorAll() { return []; }
    };
    created.push(el);
    return el;
}
globalThis.document = { createElement: (t) => fakeElement(t), body: { appendChild: () => {}, removeChild: () => {} } };

const jobs = await import('../js/jobs.js');

let passed = 0; let failed = 0;
const check = (name, cond, detail) => {
    if (cond) { console.log('PASS [MOCK]:', name); passed++; }
    else { console.error('FAIL [MOCK]:', name, detail); failed++; }
};
const texts = () => created.map((e) => e._text);

// 1. Current company/role form job.
created.length = 0;
const formJob = { id: 'job_form', company: 'Invented Co', role: 'Engineer', status: 'applied', location: 'toronto', date: '2026-10-01', notes: 'n' };
let threw = null;
try { jobs.createJobCard(formJob, () => {}, () => {}); } catch (e) { threw = e; }
check('V15-A: form job renders without throwing', threw === null, threw);
check('V15-A: form job badge shows its status', texts().includes('Applied'), texts());
check('V15-A: form job company renders as text', texts().includes('Invented Co'), texts());

// 2. Supported legacy: title-only, no status (Codex example shape).
created.length = 0;
const legacy = { id: 'job_example', title: 'Invented' };
threw = null;
try { jobs.createJobCard(legacy, () => {}, () => {}); } catch (e) { threw = e; }
check('V15-A: legacy title-only job renders without throwing', threw === null, threw);
check('V15-A: legacy job shows the title in the company position', texts().includes('Invented'), texts());
check('V15-A: missing status renders as honest Unknown', texts().includes('Unknown'), texts());
check('V15-A: rendering does not mutate the legacy record',
    !('status' in legacy) && legacy.title === 'Invented' && Object.keys(legacy).length === 2, legacy);

// 3. Malformed: non-string status object.
created.length = 0;
const statusObj = { odd: true };
const malformed = { id: 'job_example', company: 'Invented', status: statusObj };
threw = null;
try { jobs.createJobCard(malformed, () => {}, () => {}); } catch (e) { threw = e; }
check('V15-A: non-string status renders without throwing', threw === null, threw);
check('V15-A: non-string status renders as honest Unknown', texts().includes('Unknown'), texts());
check('V15-A: non-string status value is not mutated', malformed.status === statusObj, malformed);

console.log(`\nTests completed: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
