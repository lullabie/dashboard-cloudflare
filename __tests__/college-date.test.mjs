// College card invalid-date tests (V9-B finding 3). Run: node __tests__/college-date.test.mjs
// DOM is stubbed [MOCK]; createCollegeCard and getTorontoMidnight are the REAL modules.
// store.js is mocked via data-URL (same pattern as feeds-v4-contract.test.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class El {
  constructor(tag) {
    this.tagName = tag; this.className = ''; this.style = {}; this.children = [];
    this._text = ''; this._listeners = {};
  }
  set textContent(v) { this._text = String(v); }
  get textContent() {
    let t = this._text;
    for (const c of this.children) t += (c.textContent ?? '');
    return t;
  }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(ev, fn) { (this._listeners[ev] ||= []).push(fn); }
  querySelector(sel) {
    const cls = sel.startsWith('.') ? sel.slice(1) : null;
    for (const c of this.children) {
      if (cls && typeof c.className === 'string' && c.className.split(' ').includes(cls)) return c;
      if (c && typeof c.querySelector === 'function') { const r = c.querySelector(sel); if (r) return r; }
    }
    return null;
  }
  findByClass(cls) {
    if (typeof this.className === 'string' && this.className.split(' ').includes(cls)) return this;
    for (const c of this.children) { if (c && typeof c.findByClass === 'function') { const r = c.findByClass(cls); if (r) return r; } }
    return null;
  }
}
globalThis.document = {
  createElement: (tag) => new El(tag),
  createTextNode: (t) => ({ textContent: String(t), children: [] }),
};
globalThis.confirm = () => true;

const collegeCode = fs.readFileSync(path.join(root, 'js/college.js'), 'utf8');
const countdownsCode = fs.readFileSync(path.join(root, 'js/countdowns.js'), 'utf8');
const countdownsUrl = `data:text/javascript;base64,${Buffer.from(countdownsCode).toString('base64')}`;
const mockStoreCode = `export function getData(){ return { college:{timetable:[],assignments:[],exams:[],fees:[]} }; } export async function saveData(){}`;
const mockStoreUrl = `data:text/javascript;base64,${Buffer.from(mockStoreCode).toString('base64')}`;
const testCode = collegeCode
  .replace(/from '\.\/store\.js'/, `from '${mockStoreUrl}'`)
  .replace(/from '\.\/countdowns\.js'/, `from '${countdownsUrl}'`);
const { createCollegeCard } = await import(`data:text/javascript;base64,${Buffer.from(testCode).toString('base64')}`);

function torontoPlus(days) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' });
  const p = {}; fmt.formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
  const d = new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function render(item) {
  const card = createCollegeCard(item, 'assignments', () => {}, () => {});
  return {
    text: card.textContent,
    badge: card.findByClass('badge')?.textContent,
    width: card.findByClass('progress-bar')?.style.width,
  };
}

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS [MOCK]:', name); passed++; }
  catch (err) { console.error('FAIL [MOCK]:', name, '-', err.message); failed++; }
}

check('invalid date string: no NaN, badge Date not set, width 0%, raw date + title visible', () => {
  const r = render({ id: 'x', title: 'Essay', date: 'not-a-date' });
  assert.ok(!r.text.includes('NaN'), `card text contains NaN: ${r.text}`);
  assert.ok(!String(r.width).includes('NaN'), `width contains NaN: ${r.width}`);
  assert.equal(r.badge, 'Date not set');
  assert.equal(r.width, '0%');
  assert.ok(r.text.includes('not-a-date'), 'raw invalid date must stay visible');
  assert.ok(r.text.includes('Essay'), 'title must render');
});

check('missing date: no NaN/undefined, badge Date not set, width 0%, No date set line, title visible', () => {
  const r = render({ id: 'x', title: 'Essay' });
  assert.ok(!r.text.includes('NaN'), `card text contains NaN: ${r.text}`);
  assert.ok(!r.text.includes('undefined'), `card text contains undefined: ${r.text}`);
  assert.equal(r.badge, 'Date not set');
  assert.equal(r.width, '0%');
  assert.ok(r.text.includes('No date set'), `date line must show 'No date set': ${r.text}`);
  assert.ok(r.text.includes('Essay'), 'title must render');
});

check('valid future date: <n> days left, 0<width<=100, no NaN', () => {
  const r = render({ id: 'x', title: 'Essay', date: torontoPlus(10) });
  assert.equal(r.badge, '10 days left');
  const w = parseFloat(r.width);
  assert.ok(Number.isFinite(w) && w > 0 && w <= 100, `width out of range: ${r.width}`);
  assert.ok(!r.text.includes('NaN'));
});

check('overdue date: <n> days overdue', () => {
  const r = render({ id: 'x', title: 'Essay', date: torontoPlus(-5) });
  assert.equal(r.badge, '5 days overdue');
  assert.equal(r.width, '100%');
});

check('today: Due Today', () => {
  const r = render({ id: 'x', title: 'Essay', date: torontoPlus(0) });
  assert.equal(r.badge, 'Due Today');
  assert.equal(r.width, '100%');
});

console.log(`college-date: ${passed} passed, ${failed} failed [MOCK]`);
if (failed > 0) process.exit(1);
