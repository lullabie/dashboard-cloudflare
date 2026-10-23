// dashboard-api refresh core — DESIGN REVIEW COPY.
// Status: not deployed. No KV namespace, Worker, or cron trigger exists for
// this code. It is published on the review branch so the contract in
// ../CONTRACT.md can be reviewed against real, testable source.
// Plain ES module with zero dependencies: the same file runs under the
// Workers runtime (via src/worker.js) and under Node for the tests in
// ../test/refresh.test.mjs (KV and fetch are injected).

export const SOURCE_ID = "cbc-topstories";
export const SOURCE_URL = "https://www.cbc.ca/webfeed/rss/rss-topstories";
export const CACHE_KEY = "news:topstories";
export const LOCK_KEY = "news:refresh-lock";
export const CRON_EXPRESSION = "*/15 * * * *";

export const BOUNDS = {
  fetchTimeoutMs: 8000,
  bodyCapBytes: 512 * 1024,
  maxItems: 20,
  titleMaxChars: 300,
  staleAfterSeconds: 1800,
  lockTtlSeconds: 600,
};

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#x27": "'" };

export function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(ENTITIES, name) ? ENTITIES[name] : m
  );
}

export function stripTags(text) {
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function tagText(block, tag) {
  const cdata = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, "i").exec(block);
  if (cdata) return cdata[1];
  const plain = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  return plain ? plain[1] : "";
}

// Parse the fixed CBC RSS source. Returns [] for anything that is not a
// feed with at least one usable item; the caller treats [] as an error and
// keeps last-good data.
export function parseRss(xml) {
  if (typeof xml !== "string" || !/<rss[\s>]/i.test(xml)) return [];
  const items = [];
  const itemRe = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < BOUNDS.maxItems) {
    const block = m[1];
    const title = stripTags(decodeEntities(tagText(block, "title"))).slice(0, BOUNDS.titleMaxChars);
    const link = decodeEntities(tagText(block, "link")).trim();
    const published = decodeEntities(tagText(block, "pubDate")).trim();
    if (title && /^https?:\/\//i.test(link)) items.push({ title, link, published });
  }
  return items;
}

// Read a fetch Response body with a hard byte cap. Oversize is an error,
// never a partial parse.
export async function readBodyCapped(response, capBytes = BOUNDS.bodyCapBytes) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > capBytes) {
    throw new Error(`oversize: content-length ${declared} > cap ${capBytes}`);
  }
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > capBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`oversize: body exceeded cap ${capBytes}`);
      }
      chunks.push(value);
    }
    const all = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { all.set(c, off); off += c.byteLength; }
    return new TextDecoder().decode(all);
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > capBytes) {
    throw new Error(`oversize: body exceeded cap ${capBytes}`);
  }
  return text;
}

export function emptyEnvelope(nowIso) {
  return {
    source: SOURCE_ID,
    source_url: SOURCE_URL,
    fetched_at: null,
    last_attempt_at: nowIso,
    status: "error",
    error: "no successful fetch yet",
    trigger: null,
    cron: null,
    items: [],
  };
}

// One refresh attempt. `trigger` is "scheduled" (cron handler, with the
// cron expression recorded) or "manual" (POST /api/refresh). The stored
// envelope always records which one produced it, so a scheduled execution
// is distinguishable from a manual invocation in the data itself.
//
// Overlap rule: a fresh lock (younger than lockTtlSeconds) makes the
// attempt a no-op — no fetch, no envelope write, outcome "skipped-overlap".
export async function performRefresh(env, { fetchFn, now, trigger, cron = null }) {
  const nowIso = now.toISOString();
  const lockRaw = await env.CACHE.get(LOCK_KEY);
  if (lockRaw) {
    try {
      const lock = JSON.parse(lockRaw);
      const ageMs = now.getTime() - Date.parse(lock.started_at);
      if (Number.isFinite(ageMs) && ageMs < BOUNDS.lockTtlSeconds * 1000) {
        return { outcome: "skipped-overlap", trigger, cron };
      }
    } catch { /* unreadable lock: fall through and take it over */ }
  }
  await env.CACHE.put(LOCK_KEY, JSON.stringify({ started_at: nowIso, trigger }),
    { expirationTtl: BOUNDS.lockTtlSeconds });
  try {
    const response = await fetchFn(SOURCE_URL, { signal: AbortSignal.timeout(BOUNDS.fetchTimeoutMs) });
    if (!response.ok) throw new Error(`http ${response.status}`);
    const body = await readBodyCapped(response);
    const items = parseRss(body);
    if (items.length === 0) throw new Error("parse: no usable items");
    const envelope = {
      source: SOURCE_ID,
      source_url: SOURCE_URL,
      fetched_at: nowIso,
      last_attempt_at: nowIso,
      status: "ok",
      error: null,
      trigger,
      cron,
      items,
    };
    await env.CACHE.put(CACHE_KEY, JSON.stringify(envelope));
    return { outcome: "ok", trigger, cron, envelope };
  } catch (err) {
    // Last-good retention: items and fetched_at from the previous envelope
    // are written back unchanged. Only attempt metadata moves.
    const message = String(err && err.message ? err.message : err).slice(0, 200);
    let prev = null;
    const raw = await env.CACHE.get(CACHE_KEY);
    if (raw) { try { prev = JSON.parse(raw); } catch { prev = null; } }
    const base = prev && Array.isArray(prev.items) ? prev : emptyEnvelope(nowIso);
    const envelope = {
      ...base,
      last_attempt_at: nowIso,
      status: "error",
      error: message,
      attempt_trigger: trigger,
      attempt_cron: cron,
    };
    await env.CACHE.put(CACHE_KEY, JSON.stringify(envelope));
    return { outcome: "error", trigger, cron, error: message, envelope };
  } finally {
    await env.CACHE.delete(LOCK_KEY);
  }
}

// Read path behind GET /api/news. The UI reads only this cache; it never
// triggers a fetch. Freshness metadata is computed at read time.
export async function readNews(env, { now }) {
  const raw = await env.CACHE.get(CACHE_KEY);
  let envelope = null;
  if (raw) { try { envelope = JSON.parse(raw); } catch { envelope = null; } }
  if (!envelope) envelope = emptyEnvelope(now.toISOString());
  const ageSeconds = envelope.fetched_at
    ? Math.max(0, Math.floor((now.getTime() - Date.parse(envelope.fetched_at)) / 1000))
    : null;
  return {
    ...envelope,
    age_seconds: ageSeconds,
    stale: ageSeconds === null || ageSeconds > BOUNDS.staleAfterSeconds,
  };
}
