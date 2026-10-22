// Lane F v6 chart tests. Run: node --test __tests__/charts.test.mjs
// The test uses a small DOM stub and a fake Chart class.
// The test uses invented data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

class El {
  constructor(id = '') {
    this.id = id;
    this.attrs = {};
    this.textContent = '';
    this.parentElement = null;
    this._innerHTML = '';
    this._canvas = null;
  }
  setAttribute(name, value) { this.attrs[name] = value; }
  getAttribute(name) { return this.attrs[name]; }
  set innerHTML(value) {
    this._innerHTML = value;
    if (this._canvas) { byId.delete(this._canvas.id); this._canvas = null; }
    const match = /<canvas id="([^"]+)"/.exec(value);
    if (match) {
      const canvas = new El(match[1]);
      canvas.parentElement = this;
      this._canvas = canvas;
      byId.set(canvas.id, canvas);
    }
  }
  get innerHTML() { return this._innerHTML; }
  querySelector(selector) {
    if (selector === 'canvas') return this._canvas;
    return null;
  }
}

const byId = new Map();
const hosts = new Map();

globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = {
  getElementById: (id) => byId.get(id) ?? null,
  querySelector: (selector) => {
    const match = /\[data-chart-host="([^"]+)"\]/.exec(selector);
    return match ? (hosts.get(match[1]) ?? null) : null;
  },
};

class FakeChart {
  static instances = [];
  constructor(canvas, config) {
    this.canvas = canvas;
    this.type = config.type;
    this.data = config.data;
    this.options = config.options;
    this.updateCount = 0;
    this.destroyed = false;
    FakeChart.instances.push(this);
  }
  update() { this.updateCount += 1; }
  destroy() { this.destroyed = true; }
}
globalThis.Chart = FakeChart;

const charts = await import('../js/visuals/charts.js');
const { renderJobsChart, renderCollegeChart, renderInvestmentsChart, renderIndicatorsChart } = charts;

function makeHost(canvasId) {
  byId.clear();
  const container = new El(canvasId + '-host');
  const canvas = new El(canvasId);
  canvas.parentElement = container;
  container._canvas = canvas;
  container._innerHTML = '<canvas id="' + canvasId + '"></canvas>';
  byId.set(canvasId, canvas);
  const alt = new El(canvasId + '-alt');
  byId.set(alt.id, alt);
  hosts.set(canvasId, container);
  return { container, canvas, alt };
}

test('exports exist', () => {
  assert.equal(typeof renderJobsChart, 'function');
  assert.equal(typeof renderCollegeChart, 'function');
  assert.equal(typeof renderInvestmentsChart, 'function');
  assert.equal(typeof renderIndicatorsChart, 'function');
});

test('jobs: counts, labels and config match the call-site contract', () => {
  FakeChart.instances = [];
  makeHost('jobs-cfg');
  renderJobsChart('jobs-cfg', [
    { status: 'applied' }, { status: 'applied' }, { status: 'interview' }, { status: 'mystery' },
  ], () => {});
  assert.equal(FakeChart.instances.length, 1);
  const chart = FakeChart.instances[0];
  assert.equal(chart.type, 'bar');
  assert.equal(chart.options.indexAxis, 'y');
  assert.deepEqual(chart.data.labels, ['Applied', 'Interview', 'Offer', 'Rejected', 'Other']);
  assert.deepEqual(chart.data.datasets[0].data, [2, 1, 0, 0, 1]);
});

test('jobs: alt text carries the counts after a data render', () => {
  FakeChart.instances = [];
  const { alt } = makeHost('jobs-alt');
  renderJobsChart('jobs-alt', [{ status: 'offer' }], () => {});
  assert.match(alt.textContent, /Offer: 1/);
  assert.match(alt.textContent, /Applied: 0/);
});

test('jobs: filter callback receives the raw status key', () => {
  FakeChart.instances = [];
  const seen = [];
  makeHost('jobs-cb');
  renderJobsChart('jobs-cb', [{ status: 'applied' }], (status) => seen.push(status));
  const onClick = FakeChart.instances[0].options.onClick;
  onClick({}, [{ index: 1 }]);
  onClick({}, [{ index: 4 }]);
  onClick({}, []);
  onClick({}, null);
  assert.deepEqual(seen, ['interview', 'other']);
});

test('jobs: no callback does not throw on click', () => {
  FakeChart.instances = [];
  makeHost('jobs-nocb');
  renderJobsChart('jobs-nocb', [{ status: 'applied' }]);
  assert.doesNotThrow(() => FakeChart.instances[0].options.onClick({}, [{ index: 0 }]));
});

test('jobs: empty data renders the empty state and no chart', () => {
  FakeChart.instances = [];
  const { container, alt } = makeHost('jobs-empty');
  renderJobsChart('jobs-empty', [], () => {});
  assert.equal(FakeChart.instances.length, 0);
  assert.match(container.innerHTML, /No jobs found to display/);
  assert.match(alt.textContent, /No jobs found/);
});

test('jobs: malformed input never throws', () => {
  FakeChart.instances = [];
  makeHost('jobs-bad');
  for (const bad of [null, undefined, 'text', 42, {}, true]) {
    assert.doesNotThrow(() => renderJobsChart('jobs-missing-' + String(bad), bad, () => {}));
    assert.doesNotThrow(() => renderJobsChart('jobs-bad', bad, () => {}));
  }
  FakeChart.instances = [];
  renderJobsChart('jobs-bad', [null, {}, { status: null }], () => {});
  assert.equal(FakeChart.instances.length, 1);
  assert.deepEqual(FakeChart.instances[0].data.datasets[0].data, [0, 0, 0, 0, 3]);
});

test('jobs: second render updates the same chart instance', () => {
  FakeChart.instances = [];
  makeHost('jobs-upd');
  renderJobsChart('jobs-upd', [{ status: 'applied' }], () => {});
  renderJobsChart('jobs-upd', [{ status: 'applied' }, { status: 'offer' }, { status: 'offer' }], () => {});
  assert.equal(FakeChart.instances.length, 1);
  assert.equal(FakeChart.instances[0].updateCount, 1);
  assert.deepEqual(FakeChart.instances[0].data.datasets[0].data, [1, 0, 2, 0, 0]);
});

test('jobs: missing canvas and missing host returns without a throw', () => {
  byId.clear();
  hosts.clear();
  assert.doesNotThrow(() => renderJobsChart('no-such-chart', [{ status: 'applied' }], () => {}));
});

test('jobs: Chart missing renders the fallback text', () => {
  FakeChart.instances = [];
  const { container } = makeHost('jobs-nochart');
  const saved = globalThis.Chart;
  globalThis.Chart = undefined;
  try {
    assert.doesNotThrow(() => renderJobsChart('jobs-nochart', [{ status: 'applied' }], () => {}));
    assert.match(container.innerHTML, /Chart library unavailable/);
  } finally {
    globalThis.Chart = saved;
  }
});

test('college: assignments and exams bucket by ISO week', () => {
  FakeChart.instances = [];
  makeHost('college-week');
  renderCollegeChart('college-week', {
    timetable: [],
    assignments: [{ date: '2026-01-05' }, { date: '2026-01-07' }],
    exams: [{ date: '2026-01-12' }],
    fees: [],
  });
  assert.equal(FakeChart.instances.length, 1);
  const chart = FakeChart.instances[0];
  assert.equal(chart.data.labels.length, 2);
  for (const label of chart.data.labels) assert.match(label, /^\d{4}-W\d{2}$/);
  assert.deepEqual(chart.data.datasets[0].data, [2, 1]);
});

test('college: empty and malformed input never throws', () => {
  FakeChart.instances = [];
  const { container } = makeHost('college-bad');
  for (const bad of [null, undefined, 42, 'text', {}, { assignments: 42 }, { assignments: [null] }]) {
    assert.doesNotThrow(() => renderCollegeChart('college-bad', bad));
  }
  assert.match(container.innerHTML, /No upcoming academic work/);
});

test('college: invalid or missing dates bucket under Unknown and never throw', () => {
  FakeChart.instances = [];
  makeHost('college-unknown');
  assert.doesNotThrow(() => renderCollegeChart('college-unknown', { assignments: [{ date: 'not-a-date' }, {}] }));
  assert.equal(FakeChart.instances.length, 1);
  assert.deepEqual(FakeChart.instances[0].data.labels, ['Unknown']);
  assert.deepEqual(FakeChart.instances[0].data.datasets[0].data, [2]);
});

test('college: Chart missing renders the fallback text', () => {
  const { container } = makeHost('college-nochart');
  const saved = globalThis.Chart;
  globalThis.Chart = undefined;
  try {
    assert.doesNotThrow(() => renderCollegeChart('college-nochart', { assignments: [{ date: '2026-01-05' }] }));
    assert.match(container.innerHTML, /Chart library unavailable/);
  } finally {
    globalThis.Chart = saved;
  }
});

test('investments: entry and current series map with zero and malformed values', () => {
  FakeChart.instances = [];
  makeHost('inv-map');
  renderInvestmentsChart('inv-map', [
    { ticker: 'AAA', entry: 10, current: 12 },
    { ticker: 'BBB', entry: 0, current: 0 },
    { entry: 'bad', current: null },
    null,
  ]);
  assert.equal(FakeChart.instances.length, 1);
  const chart = FakeChart.instances[0];
  assert.deepEqual(chart.data.labels, ['AAA', 'BBB', '', '']);
  assert.deepEqual(chart.data.datasets[0].data, [10, 0, null, null]);
  assert.deepEqual(chart.data.datasets[1].data, [12, 0, null, null]);
  assert.equal(chart.data.datasets[0].label, 'Entry Price');
  assert.equal(chart.data.datasets[1].label, 'Current Price');
});

test('investments: empty and malformed input never throws', () => {
  FakeChart.instances = [];
  const { container } = makeHost('inv-bad');
  for (const bad of [null, undefined, 42, 'text', {}]) {
    assert.doesNotThrow(() => renderInvestmentsChart('inv-bad', bad));
  }
  assert.equal(FakeChart.instances.length, 0);
  assert.match(container.innerHTML, /No investments to chart/);
});

test('investments: Chart missing renders the fallback text', () => {
  const { container } = makeHost('inv-nochart');
  const saved = globalThis.Chart;
  globalThis.Chart = undefined;
  try {
    assert.doesNotThrow(() => renderInvestmentsChart('inv-nochart', [{ ticker: 'AAA', entry: 1, current: 2 }]));
    assert.match(container.innerHTML, /Chart library unavailable/);
  } finally {
    globalThis.Chart = saved;
  }
});

test('indicators: malformed history never throws', () => {
  makeHost('indicators-bad');
  for (const bad of [null, undefined, 42, {}, { FXCADINR: null }, { FXCADINR: { history: 'x' } }, { FXCADINR: { history: [null, { date: '2026-01-01', value: 'bad' }] } }]) {
    assert.doesNotThrow(() => renderIndicatorsChart('indicators-bad', bad));
  }
});
