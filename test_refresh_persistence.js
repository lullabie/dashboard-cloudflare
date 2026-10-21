class MockLocalStorage {
  constructor() { this.store = {}; }
  getItem(key) { return this.store[key] || null; }
  setItem(key, value) { this.store[key] = value.toString(); }
  removeItem(key) { delete this.store[key]; }
}
global.localStorage = new MockLocalStorage();
Object.defineProperty(global, 'navigator', {
    value: { locks: { request: async (name, opts, fn) => fn() } },
    configurable: true
});

import { getNewsData, refreshFeeds, saveManualEntry, saveSource, deleteSource } from './js/feeds.js';
import { saveData, getData } from './js/store.js';

async function test() {
    console.log("=== TESTS: refresh persistence ===");

    // Initialize root data
    let news = await getNewsData();
    news.sources = [];
    news.cache = [];
    news.manual = [];
    await saveData({ news });

    // Save sources via proper creation path to get real IDs
    await saveSource({ name: 'Source 1', url: 'http://src1.com', category: 'global' });
    await saveSource({ name: 'Source 2 (HTML)', url: 'http://src2.com', category: 'global' });
    await saveSource({ name: 'Source 3', url: 'http://src3.com', category: 'global' });
    await saveSource({ name: 'Source Delete', url: 'http://src-delete.com', category: 'global' });
    await saveSource({ name: 'Source Network Fail', url: 'http://src-fail.com', category: 'global' });

    news = await getNewsData();
    const src1Id = news.sources.find(s => s.url === 'http://src1.com').id;
    const src2Id = news.sources.find(s => s.url === 'http://src2.com').id;
    const src3Id = news.sources.find(s => s.url === 'http://src3.com').id;
    const srcDeleteId = news.sources.find(s => s.url === 'http://src-delete.com').id;
    const srcFailId = news.sources.find(s => s.url === 'http://src-fail.com').id;

    // Setup existing cache for src2 to ensure it is NOT wiped when HTML is fetched
    news.cache.push({ id: 'item_src2', sourceId: src2Id, title: 'Valid Old Item', url: 'http://src2.com/item', published: new Date().toISOString(), category: 'global' });
    // Setup existing cache for network fail to ensure it is NOT wiped
    news.cache.push({ id: 'item_fail', sourceId: srcFailId, title: 'Old Fail Cache', url: 'http://src-fail.com/item', published: new Date().toISOString(), category: 'global' });

    await saveData({ news });

    global.DOMParser = class {
        parseFromString(text, type) {
            const isHtml = text.includes('<html>');
            const isRss = text.includes('<rss>');
            const isAtom = text.includes('<feed>');

            return {
                querySelector: (q) => {
                    if (q === 'parsererror') return null;
                    if (q === 'feed') return isAtom ? {} : null;
                    if (q === 'rss') return isRss ? {} : null;
                    if (q === 'rdf\\:RDF') return null;
                    return null;
                },
                querySelectorAll: (q) => {
                    if (q === 'entry' && isAtom) {
                        return [{
                            querySelector: (sel) => {
                                if (sel === 'title') return { textContent: 'Atom Item' };
                                if (sel === 'link[rel="alternate"]') return { getAttribute: () => 'http://atom.alternate' };
                                if (sel === 'link') return { getAttribute: () => 'http://atom.self' };
                                return null;
                            }
                        }];
                    }
                    if (q === 'item' && isRss) return [];
                    return [];
                }
            };
        }
    };

    let newerRefreshDone = false;

    global.fetch = async (url) => {
        // Asynchronous delay simulating network latency

        if (url === 'http://src1-changed.com') {
             throw new Error('Offline changed');
        }

        if (url === 'http://src1.com') {
             // Simulate user adding manual entry during refresh
             await saveManualEntry({ title: 'Manual 1', url: 'http://m.com', published: new Date().toISOString(), category: 'global' });

             // Simulate user changing URL of src1
             await saveSource({ id: src1Id, name: 'Source 1 Modified', url: 'http://src1-changed.com', category: 'global' });

             return { ok: true, text: async () => '<feed><entry><title>A</title></entry></feed>' };
        }

        if (url === 'http://src2.com') {
             // HTML-shaped XML
             return { ok: true, text: async () => '<html><body>Welcome</body></html>' };
        }

        if (url === 'http://src-fail.com') {
            throw new Error("Network offline");
        }

        if (url === 'http://src-delete.com') {
             await deleteSource(srcDeleteId);
             return { ok: true, text: async () => '<rss></rss>' };
        }

        if (url === 'http://src3.com') {
             if (!newerRefreshDone) {
                 newerRefreshDone = true;
                 await refreshFeeds();
             }
             return { ok: true, text: async () => '<rss></rss>' };
        }

        return { ok: true, text: async () => '<rss></rss>' };
    };

    // Trigger OLDER refresh
    await refreshFeeds();

    const finalNews = await getNewsData();
    let failures = 0;

    // Evaluate 7 criteria
    if (!finalNews.manual.find(m => m.title === 'Manual 1')) {
        console.error("FAIL: Manual entry lost."); failures++;
    } else { console.log("PASS: Manual entry retained."); }

    const deletedSourceCache = finalNews.cache.filter(c => c.sourceId === srcDeleteId);
    if (deletedSourceCache.length > 0 || finalNews.sources.find(s => s.id === srcDeleteId)) {
        console.error("FAIL: Deleted source or its cache is present."); failures++;
    } else { console.log("PASS: Deleted source absent."); }

    const failCache = finalNews.cache.filter(c => c.sourceId === srcFailId);
    if (failCache.length === 0) {
        console.error("FAIL: Network fail wiped out cache."); failures++;
    } else { console.log("PASS: Network fail cache retained."); }

    const src1Cache = finalNews.cache.filter(c => c.sourceId === src1Id);
    const src1Obj = finalNews.sources.find(s => s.id === src1Id);
    if (src1Cache.length > 0) {
        console.error("FAIL: Changed-URL cache was not discarded."); failures++;
    } else { console.log("PASS: Changed-URL cache discarded."); }

    if (src1Obj.status === 'ok') {
        console.error("FAIL: Changed-URL status incorrectly flipped to 'ok'."); failures++;
    } else { console.log("PASS: Changed-URL status guarded correctly."); }

    const src2Cache = finalNews.cache.filter(c => c.sourceId === src2Id);
    if (src2Cache.length === 0) {
        console.error("FAIL: HTML-shaped XML cleared cache."); failures++;
    } else { console.log("PASS: HTML-shaped XML clears cache rejected."); }

    // For overlap: if newer wins, the current src3 source object should have _lastUpdateGen > 0.
    const src3Obj = finalNews.sources.find(s => s.id === src3Id);
    if (!src3Obj._lastUpdateGen || src3Obj._lastUpdateGen !== 2) {
        console.error("FAIL: Overlapping refresh ordering incorrect (older won). Gen:", src3Obj._lastUpdateGen); failures++;
    } else { console.log("PASS: Overlapping refresh (newer wins) enforced."); }

    if (failures > 0) {
        process.exit(1);
    }
}

test().catch(e => { console.error(e); process.exit(1); });
