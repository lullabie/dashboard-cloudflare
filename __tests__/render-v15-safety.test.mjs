// render-v15-safety.test.mjs — V15 Lane B: renderers treat every
// field as untrusted (contract: docs/review/V15-CONTRACT.md).
// Uses a recording DOM stub [MOCK]: innerHTML is captured verbatim so
// the tests can prove a raw field value never reaches the markup.

globalThis.window = { confirm: () => true, alert: () => {} };
globalThis.confirm = window.confirm;
globalThis.alert = window.alert;
Object.defineProperty(globalThis, 'crypto', { value: { randomUUID: () => 'uuid-' + Math.random() }, configurable: true });
globalThis.BroadcastChannel = class { constructor() {} postMessage() {} close() {} };
globalThis.indexedDB = { open: () => { const r = {}; setTimeout(() => { if (r.onerror) r.onerror(new Error('no db in test')); }, 0); return r; } };
globalThis.localStorage = { getItem: () => null };

function fakeElement() {
    return {
        className: '', dataset: {}, style: {}, innerHTML: '', textContent: '',
        children: [],
        setAttribute() {}, addEventListener() {},
        appendChild(c) { this.children.push(c); return c; },
        querySelector() { return fakeElement(); },
        querySelectorAll() { return []; }
    };
}
globalThis.document = { createElement: () => fakeElement(), body: { appendChild: () => {}, removeChild: () => {} } };

const goals = await import('../js/goals.js');
const habits = await import('../js/habits.js');

let passed = 0; let failed = 0;
const check = (name, cond, detail) => {
    if (cond) { console.log('PASS [MOCK]:', name); passed++; }
    else { console.error('FAIL [MOCK]:', name, detail); failed++; }
};

// 1. Markup-string goal target: coerced, never rendered raw.
const markupGoal = {
    id: 'goal_markup', title: 'Markup Goal', notes: '', target: '<b id="audit-markup-marker">Invented markup</b>',
    showNotes: false, status: 'active', history: [], checkIns: [], occurrences: {}
};
const card1 = goals.createGoalCard(markupGoal, () => {}, () => {}, () => {});
check('V15-B: markup target never reaches card HTML raw',
    !card1.innerHTML.includes('<b id="audit-markup-marker">'), card1.innerHTML);
check('V15-B: coerced fallback target rendered (0 / 1 done)',
    card1.innerHTML.includes('0 / 1 done'), card1.innerHTML);

// 2. Numeric-string target coerces to the number.
const numGoal = { ...markupGoal, id: 'goal_num', target: '30', occurrences: {} };
const card2 = goals.createGoalCard(numGoal, () => {}, () => {}, () => {});
check('V15-B: numeric-string target renders as the number (0 / 30 done)',
    card2.innerHTML.includes('0 / 30 done'), card2.innerHTML);

// 3. Hostile occurrence status: closed enum keeps it out of the title attr.
const hostileGoal = {
    ...markupGoal, id: 'goal_hostile', target: 7,
    occurrences: { [goals.getLocalDateString(new Date())]: 'done" onmouseover="alert(1)' }
};
const card3 = goals.createGoalCard(hostileGoal, () => {}, () => {}, () => {});
check('V15-B: hostile occurrence status never reaches the timeline title attribute',
    !card3.innerHTML.includes('onmouseover'), card3.innerHTML);

// 4. Malformed habit (invalid createdAt): no throw, UNKNOWN safe state.
let card4 = null; let threw = null;
try {
    card4 = habits.createHabitCard(
        { id: 'habit_bad', title: 'Bad Date', createdAt: 'invalid', status: 'active', history: [], occurrences: {} },
        () => {}, () => {}, () => {});
} catch (e) { threw = e; }
check('V15-B: invalid createdAt habit renders without throwing', threw === null && !!card4, threw);
check('V15-B: invalid createdAt shows the UNKNOWN eligibility safe state',
    !!card4 && card4.innerHTML.includes('Eligible: UNKNOWN'), card4 && card4.innerHTML);

// 5. Habit with malformed history entries still renders.
let card5 = null; threw = null;
try {
    card5 = habits.createHabitCard(
        { id: 'habit_hist', title: 'Hist', createdAt: new Date().toISOString(), status: 'active',
          history: [{ type: 'STATUS_CHANGE', timestamp: 'not-a-date', to: 'archived' }, null, 'junk'],
          occurrences: {} },
        () => {}, () => {}, () => {});
} catch (e) { threw = e; }
check('V15-B: malformed history timestamps render without throwing', threw === null && !!card5, threw);

// 6. Non-string titles coerce to text instead of throwing.
let card6 = null; threw = null;
try {
    card6 = goals.createGoalCard({ ...markupGoal, id: 'goal_t', title: 42, target: 2 }, () => {}, () => {}, () => {});
} catch (e) { threw = e; }
check('V15-B: non-string goal title renders as text', threw === null && !!card6 && card6.innerHTML.includes('42'), threw);

console.log(`\nTests completed: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
