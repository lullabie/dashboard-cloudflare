// feed-responses.mjs — TEST HARNESS ONLY.
// Deterministic fake feed responses for Track D QA preparation.
// Barriers let a test hold one response while it releases another, so response
// order is controlled by the test, not by timers alone.

const textEncoder = new TextEncoder();

export function byteLength(text) {
  return textEncoder.encode(text).length;
}

export function createBarrier(label = 'barrier') {
  let releaseFn;
  let released = false;
  const promise = new Promise((resolve) => {
    releaseFn = () => {
      if (!released) {
        released = true;
        resolve(label);
      }
    };
  });
  return {
    label,
    promise,
    release: releaseFn,
    get released() {
      return released;
    },
  };
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function buildRssXml({ title = 'Example Feed', link = 'https://example.com/', items = [] } = {}) {
  const itemXml = items
    .map(
      (item) => `    <item>\n      <title>${escapeXml(item.title)}</title>\n      <link>${escapeXml(item.url)}</link>\n      <guid>${escapeXml(item.id)}</guid>\n      <pubDate>${escapeXml(item.publishedAt ?? 'Wed, 21 Oct 2026 01:00:00 GMT')}</pubDate>\n      <description>${escapeXml(item.summary ?? '')}</description>\n    </item>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>${escapeXml(title)}</title>\n    <link>${escapeXml(link)}</link>\n${itemXml}\n  </channel>\n</rss>\n`;
}

export function buildMalformedXml() {
  return '<?xml version="1.0"?><rss><channel><title>Broken Example</title><item><title>Missing close tags';
}

export function buildOversizeBody(minBytes = 1024 * 1024 + 1) {
  const header = '<?xml version="1.0"?><rss><channel><title>Oversize Example</title><!--';
  const footer = '--></channel></rss>';
  const fillerLength = Math.max(0, minBytes - byteLength(header) - byteLength(footer));
  return header + 'x'.repeat(fillerLength) + footer;
}

export function exceedsByteCap(body, capBytes = 1024 * 1024) {
  return byteLength(body) > capBytes;
}

// Create one fake fetch response. If a barrier is supplied, the response does
// not resolve until the barrier is released.
export async function fakeFeedResponse({
  body,
  status = 200,
  contentType = 'application/rss+xml; charset=utf-8',
  barrier = null,
  signal = null,
} = {}) {
  if (barrier) await barrier.promise;
  if (signal?.aborted) {
    const error = new Error('Injected fetch abort');
    error.name = 'AbortError';
    throw error;
  }
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

// A fetch-like function with a timeout. It rejects with TimeoutError when the
// response does not settle inside timeoutMs. Tests use a held barrier to make
// the timeout deterministic.
export async function fetchWithTimeout(fetchFn, url, { timeoutMs = 15000, signal = null } = {}) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Injected feed fetch timeout after ${timeoutMs}ms`);
      error.name = 'TimeoutError';
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([fetchFn(url, { signal: controller.signal }), timeout]);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// Plan shape:
// { 'https://example.com/a.xml': { body, barrier, status, contentType }, ... }
// The returned object exposes fetch plus per-URL barriers for release control.
export function createOrderedFeedServer(plan) {
  const barriers = new Map();
  const calls = [];

  for (const [url, entry] of Object.entries(plan)) {
    barriers.set(url, entry.barrier ?? createBarrier(url));
  }

  async function fetch(url, options = {}) {
    calls.push({ url, at: calls.length + 1 });
    const entry = plan[url];
    if (!entry) {
      return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }
    return fakeFeedResponse({
      body: entry.body,
      status: entry.status ?? 200,
      contentType: entry.contentType ?? 'application/rss+xml; charset=utf-8',
      barrier: barriers.get(url),
      signal: options.signal ?? null,
    });
  }

  return {
    fetch,
    calls: () => [...calls],
    release(url) {
      const barrier = barriers.get(url);
      if (!barrier) throw new Error(`No barrier for URL: ${url}`);
      barrier.release();
    },
    releaseAll() {
      for (const barrier of barriers.values()) barrier.release();
    },
  };
}

export function standardFeedPlan() {
  const olderBarrier = createBarrier('older-response');
  const newerBarrier = createBarrier('newer-response');
  return {
    barriers: { olderBarrier, newerBarrier },
    plan: {
      'https://example.com/older.xml': {
        barrier: olderBarrier,
        body: buildRssXml({
          title: 'Example Older',
          items: [
            {
              id: 'item-old-001',
              title: 'Older invented item',
              url: 'https://example.com/articles/older',
              summary: 'Older response. It must not replace a newer accepted result.',
            },
          ],
        }),
      },
      'https://example.com/newer.xml': {
        barrier: newerBarrier,
        body: buildRssXml({
          title: 'Example Newer',
          items: [
            {
              id: 'item-new-001',
              title: 'Newer invented item',
              url: 'https://example.com/articles/newer',
              summary: 'Newer response. It wins under request ordering.',
            },
          ],
        }),
      },
      'https://example.com/oversize.xml': { body: buildOversizeBody() },
      'https://example.com/malformed.xml': { body: buildMalformedXml() },
    },
  };
}
