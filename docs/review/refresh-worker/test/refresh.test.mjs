// Tests for the refresh contract (../CONTRACT.md). Plain Node, no deps:
//   node --test docs/review/refresh-worker/test/refresh.test.mjs
// KV and fetch are fakes; nothing here touches the network or Cloudflare.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  performRefresh, readNews, parseRss,
  CACHE_KEY, LOCK_KEY, SOURCE_URL, BOUNDS,
} from "../src/refresh.js";
import worker from "../src/worker.js";

class FakeKV {
  constructor() { this.map = new Map(); }
  async get(k) { return this.map.has(k) ? this.map.get(k) : null; }
  async put(k, v) { this.map.set(k, String(v)); }
  async delete(k) { this.map.delete(k); }
}

const T0 = new Date("2026-10-23T00:00:00Z");
const minutesLater = (min) => new Date(T0.getTime() + min * 60000);

function rss(items) {
  const body = items.map((i) =>
    `<item><title>${i.title}</title><link>${i.link}</link><pubDate>${i.published}</pubDate></item>`).join("");
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>CBC</title>${body}</channel></rss>`;
}
const GOOD = rss([
  { title: "First story", link: "https://www.cbc.ca/news/1", published: "Fri, 23 Oct 2026 00:00:00 GMT" },
  { title: "Second <b>story</b> &amp; more", link: "https://www.cbc.ca/news/2", published: "Fri, 23 Oct 2026 00:05:00 GMT" },
]);

function okFetch(body = GOOD) {
  return async () => new Response(body, { status: 200, headers: { "Content-Type": "application/rss+xml" } });
}
async function stored(env) { return JSON.parse(await env.CACHE.get(CACHE_KEY)); }
async function seedGood(env) {
  const r = await performRefresh(env, { fetchFn: okFetch(), now: T0, trigger: "scheduled", cron: "*/15 * * * *" });
  assert.equal(r.outcome, "ok");
  return stored(env);
}

test("successful refresh stores parsed, bounded items", async () => {
  const env = { CACHE: new FakeKV() };
  const env2 = await seedGood(env);
  assert.equal(env2.items.length, 2);
  assert.equal(env2.items[1].title, "Second story & more"); // tags stripped, entity decoded
  assert.equal(env2.status, "ok");
  assert.equal(env2.fetched_at, T0.toISOString());
});

test("item cap and title truncation hold", async () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    title: "x".repeat(400) + i, link: `https://www.cbc.ca/news/${i}`, published: "Fri, 23 Oct 2026 00:00:00 GMT",
  }));
  const env = { CACHE: new FakeKV() };
  const r = await performRefresh(env, { fetchFn: okFetch(rss(many)), now: T0, trigger: "manual" });
  assert.equal(r.outcome, "ok");
  assert.equal(r.envelope.items.length, BOUNDS.maxItems);
  assert.ok(r.envelope.items.every((i) => i.title.length <= BOUNDS.titleMaxChars));
});

test("failed fetch cannot replace last-good data", async () => {
  const env = { CACHE: new FakeKV() };
  const good = await seedGood(env);
  const r = await performRefresh(env, {
    fetchFn: async () => { throw new Error("network down"); },
    now: minutesLater(15), trigger: "scheduled", cron: "*/15 * * * *",
  });
  assert.equal(r.outcome, "error");
  const after = await stored(env);
  assert.deepEqual(after.items, good.items);            // items untouched
  assert.equal(after.fetched_at, good.fetched_at);      // original success time kept
  assert.equal(after.status, "error");
  assert.match(after.error, /network down/);
  assert.equal(after.last_attempt_at, minutesLater(15).toISOString());
  assert.equal(after.attempt_trigger, "scheduled");
});

test("malformed body cannot replace last-good data", async () => {
  const env = { CACHE: new FakeKV() };
  const good = await seedGood(env);
  const r = await performRefresh(env, {
    fetchFn: okFetch("<html><body>not a feed</body></html>"),
    now: minutesLater(15), trigger: "scheduled", cron: "*/15 * * * *",
  });
  assert.equal(r.outcome, "error");
  assert.deepEqual((await stored(env)).items, good.items);
});

test("HTTP error and oversize body cannot replace last-good data", async () => {
  const env = { CACHE: new FakeKV() };
  const good = await seedGood(env);
  const r1 = await performRefresh(env, {
    fetchFn: async () => new Response("boom", { status: 500 }),
    now: minutesLater(15), trigger: "manual",
  });
  assert.equal(r1.outcome, "error");
  assert.match(r1.error, /http 500/);
  const big = "y".repeat(BOUNDS.bodyCapBytes + 1);
  const r2 = await performRefresh(env, {
    fetchFn: okFetch(`<rss version="2.0"><channel>${big}</channel></rss>`),
    now: minutesLater(30), trigger: "manual",
  });
  assert.equal(r2.outcome, "error");
  assert.match(r2.error, /oversize/);
  assert.deepEqual((await stored(env)).items, good.items);
});

test("failure before any success yields the empty-state envelope", async () => {
  const env = { CACHE: new FakeKV() };
  await performRefresh(env, {
    fetchFn: async () => { throw new Error("down"); }, now: T0, trigger: "scheduled", cron: "*/15 * * * *",
  });
  const view = await readNews(env, { now: T0 });
  assert.deepEqual(view.items, []);
  assert.equal(view.status, "error");
  assert.equal(view.stale, true);
});

test("UI reads the cache: GET /api/news returns the stored envelope with freshness", async () => {
  const env = { CACHE: new FakeKV() };
  const good = await seedGood(env);
  const res = await worker.fetch(new Request("https://dashboard-api.example/api/news"), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.items, good.items);   // exactly what the cache holds
  const freshView = await readNews(env, { now: T0 });
  assert.equal(freshView.age_seconds, 0);
  assert.equal(freshView.stale, false);
  const staleView = await readNews(env, { now: minutesLater(31) });
  assert.equal(staleView.age_seconds, 31 * 60);
  assert.equal(staleView.stale, true);        // two missed cycles
});

test("scheduled execution is distinguishable from manual invocation", async () => {
  const env = { CACHE: new FakeKV() };
  let ran;
  const ctx = { waitUntil: (p) => { ran = p; } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline in tests"); };
  try {
    await worker.scheduled({ cron: "*/15 * * * *", scheduledTime: T0.getTime() }, env, ctx);
    assert.ok(ran instanceof Promise);
    await ran; // failure is recorded in the envelope, not thrown
  } finally {
    globalThis.fetch = realFetch;
  }
  const envStored = await stored(env);
  assert.equal(envStored.attempt_trigger, "scheduled");
  assert.equal(envStored.attempt_cron, "*/15 * * * *");

  const env2 = { CACHE: new FakeKV() };
  const r = await performRefresh(env2, { fetchFn: okFetch(), now: T0, trigger: "manual", cron: null });
  assert.equal(r.envelope.trigger, "manual");
  assert.equal(r.envelope.cron, null);
});

test("overlap: a fresh lock makes the attempt a no-op", async () => {
  const env = { CACHE: new FakeKV() };
  const good = await seedGood(env);
  await env.CACHE.put(LOCK_KEY, JSON.stringify({ started_at: minutesLater(1).toISOString(), trigger: "scheduled" }));
  let fetchCalled = false;
  const r = await performRefresh(env, {
    fetchFn: async () => { fetchCalled = true; return new Response(GOOD); },
    now: minutesLater(1), trigger: "scheduled", cron: "*/15 * * * *",
  });
  assert.equal(r.outcome, "skipped-overlap");
  assert.equal(fetchCalled, false);
  assert.deepEqual(await stored(env), good);  // envelope untouched
});

test("parseRss rejects non-feeds and items without http links", () => {
  assert.deepEqual(parseRss("not xml at all"), []);
  assert.deepEqual(parseRss(rss([{ title: "x", link: "javascript:alert(1)", published: "" }])), []);
  assert.equal(parseRss(GOOD).length, 2);
  assert.equal(SOURCE_URL, "https://www.cbc.ca/webfeed/rss/rss-topstories");
});
