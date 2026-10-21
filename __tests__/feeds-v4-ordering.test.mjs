import assert from 'assert';
import fs from 'fs';
import path from 'path';

const feedsCode = fs.readFileSync(path.resolve('js/feeds.js'), 'utf8');

const mockStoreCode = `
    let storeData = { news: null };
    export const mockState = { saveDelay: 0, rejectSave: false };
    export function getData() { return JSON.parse(JSON.stringify(storeData)); }
    export async function saveData(data) {
        if (mockState.saveDelay) await new Promise(r => setTimeout(r, mockState.saveDelay));
        if (mockState.rejectSave) throw new Error("MOCK_REJECT");
        storeData = JSON.parse(JSON.stringify(data));
    }
    export function resetStore() { storeData = { news: null }; mockState.saveDelay = 0; mockState.rejectSave = false; }
`;

const mockStoreUrl = `data:text/javascript;base64,${Buffer.from(mockStoreCode).toString('base64')}`;
let testFeedsCode = feedsCode.replace(/import \{ getData, saveData \} from '\.\/store\.js';/, 
    `import { getData, saveData } from '${mockStoreUrl}';`);
const testFeedsUrl = `data:text/javascript;base64,${Buffer.from(testFeedsCode).toString('base64')}`;

const feedsModule = await import(testFeedsUrl);
const { refreshFeeds, getSources, saveSource, getNewsData } = feedsModule;

const storeModule = await import(mockStoreUrl);
const { resetStore, mockState, getData } = storeModule;

function setupMockLocks() {
    if (!globalThis.navigator) {
        Object.defineProperty(globalThis, 'navigator', { value: {}, writable: true, configurable: true });
    }
    Object.defineProperty(globalThis.navigator, 'locks', {
        value: { request: async (name, opts, cb) => await cb() },
        writable: true,
        configurable: true
    });
}

// We mock fetch for feeds
let fetchCalls = [];
let fetchResponses = {};

globalThis.fetch = async (url, opts) => {
    fetchCalls.push({ url, opts });
    if (fetchResponses[url]) {
        let resp = fetchResponses[url];
        if (resp.delay) {
            await new Promise(r => setTimeout(r, resp.delay));
        }
        if (resp.error) {
            throw new Error(resp.error);
        }
        
        let textResult = resp.text || '<rss><item><title>Test Title</title><link>http://example.com/article</link></item></rss>';
        let bodyChunks = resp.chunks || [textResult];
        
        let readerIndex = 0;
        const reader = resp.customReader ? resp.customReader(opts.signal) : {
            read: async () => {
                if (readerIndex >= bodyChunks.length) return { done: true };
                return { done: false, value: new TextEncoder().encode(bodyChunks[readerIndex++]) };
            },
            cancel: async () => {}
        };
        
        return {
            ok: resp.ok !== false,
            status: resp.status || 200,
            text: async () => textResult,
            body: { getReader: () => reader }
        };
    }
    
    return {
        ok: true,
        status: 200,
        text: async () => '<rss></rss>',
        body: { getReader: () => ({ read: async () => ({ done: true }) }) }
    };
};




import { TextDecoder as UtilTextDecoder } from 'util';
globalThis.TextDecoder = UtilTextDecoder;

globalThis.DOMParser = class {
    parseFromString(str, type) {
        if (str.includes('INVALID_XML')) {
            return { querySelector: (sel) => sel === 'parsererror' ? {} : null, querySelectorAll: () => [] };
        }
        return {
            querySelector: (sel) => {
                if (sel === 'parsererror') return null;
                if (sel === 'feed' && str.includes('<feed>')) return {};
                if (sel === 'rss' && str.includes('<rss>')) return {};
                return null;
            },
            querySelectorAll: (sel) => {
                if (sel === 'entry' && str.includes('<feed>')) {
                    return [{ querySelector: (s) => s === 'title' ? { textContent: 'Atom Title' } : s === 'link' ? { getAttribute: () => 'http://example.com/atom' } : null }];
                }
                if (sel === 'item' && str.includes('<rss>')) {
                    return [{ querySelector: (s) => s === 'title' ? { textContent: 'RSS Title' } : s === 'link' ? { textContent: 'http://example.com/rss' } : null }];
                }
                return [];
            }
        };
    }
};

async function runTests() {
    console.log("Running ordering tests...");
    setupMockLocks();
    resetStore();
    fetchCalls = [];
    fetchResponses = {};
    
    await getNewsData();
    await saveSource({ url: 'http://source1.com/rss', name: 'Source1' });
    let sources = await getSources();
    let s1 = sources[0];
    
    fetchResponses['http://source1.com/rss'] = { delay: 50 };
    let p1 = refreshFeeds();
    
    setTimeout(async () => {
        await saveSource({ id: s1.id, url: 'http://source2.com/rss', name: 'Source1 Updated' });
    }, 10);
    
    await p1;
    
    let data = getData();
    let currentS1 = data.news.sources.find(s => s.id === s1.id);
    assert.strictEqual(currentS1.url, 'http://source2.com/rss', 'Source should be updated');
    let cacheItems = data.news.cache.filter(c => c.sourceId === s1.id);
    assert.strictEqual(cacheItems.length, 0, 'Cache should be empty for changed source');
    
    // 3. Oversize body
    resetStore();
    await getNewsData();
    await saveSource({ url: 'http://oversize.com/rss', name: 'Oversize' });
    fetchResponses['http://oversize.com/rss'] = { chunks: ['<rss>'.padEnd(2000000, 'a')] };
    await refreshFeeds();
    data = getData();
    let overSource = data.news.sources[0];
    assert.strictEqual(overSource.status, 'error');
    assert.ok(overSource.reason.includes('1 MiB'), 'Reason should mention 1 MiB limit');
    
    // 4. Invalid XML / malformed
    resetStore();
    await getNewsData();
    await saveSource({ url: 'http://malformed.com/rss', name: 'Malformed' });
    fetchResponses['http://malformed.com/rss'] = { chunks: ['INVALID_XML'] };
    await refreshFeeds();
    data = getData();
    let malSource = data.news.sources[0];
    assert.strictEqual(malSource.status, 'error');
    assert.ok(malSource.reason.includes('Invalid XML format'));
    
    
    // V5-FEEDS-01: Headers arrive, the body stalls, the refresh settles at the deadline and the abort signal fires.
    resetStore();
    await getNewsData();
    await saveSource({ url: 'http://stall.com/rss', name: 'Stall' });
    let stallSourceId = (await getSources())[0].id;
    let signalAborted = false;
    
    fetchResponses['http://stall.com/rss'] = {
        // Headers arrive immediately
        // The body stalls
        chunks: [],
        delay: 0,
        text: '',
        customReader: (signal) => {
            let done = false;
            return {
                read: async () => {
                    if (done) return { done: true };
                    // Wait until aborted
                    await new Promise(r => {
                        if (signal.aborted) {
                            signalAborted = true;
                            r();
                        } else {
                            signal.addEventListener('abort', () => {
                                signalAborted = true;
                                r();
                            });
                        }
                    });
                    done = true;
                    let err = new Error('AbortError'); err.name = 'AbortError'; throw err;
                },
                cancel: async () => { done = true; }
            };
        }
    };
    
    let timeStart = Date.now();
    await refreshFeeds();
    let timeEnd = Date.now();
    data = getData();
    let stallSource = data.news.sources.find(s => s.id === stallSourceId);
    assert.strictEqual(stallSource.status, 'error', 'Stalled feed should error');
    assert.ok(stallSource.reason.includes('Request timed out'), 'Reason should mention timeout: ' + stallSource.reason);
    assert.ok(signalAborted, 'Abort signal must fire');
    assert.ok(timeEnd - timeStart >= 14900, 'Must have waited approximately 15 seconds');

    // V5-FEEDS-02: A category edit during an in-flight fetch blocks the stale commit
    resetStore();
    await getNewsData();
    await saveSource({ url: 'http://category.com/rss', name: 'CatTest', category: 'global' });
    let catSourceId = (await getSources())[0].id;
    
    fetchResponses['http://category.com/rss'] = {
        delay: 100, // delay fetch
        text: '<rss><item><title>Test</title><link>http://link.com</link></item></rss>'
    };
    
    let pCat = refreshFeeds();
    // Edit category during fetch
    setTimeout(async () => {
        await saveSource({ id: catSourceId, url: 'http://category.com/rss', name: 'CatTest', category: 'canada' });
    }, 20);
    
    await pCat;
    data = getData();
    let catSource = data.news.sources.find(s => s.id === catSourceId);
    assert.strictEqual(catSource.category, 'canada', 'Category should be canada');
    
    // The items should NOT be cached because the commit was stale due to category change
    let catCacheItems = data.news.cache.filter(c => c.sourceId === catSourceId);
    assert.strictEqual(catCacheItems.length, 0, 'Cache should be empty because category changed in flight');

    console.log("Ordering tests PASSED - MOCK");
}

runTests().catch(e => { console.error(e); process.exit(1); });
