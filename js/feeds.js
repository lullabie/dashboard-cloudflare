import { getData, saveData } from './store.js';

// --- Mutator Helper ---
async function applyMutation(mutatorFn) {
    if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
        return await navigator.locks.request('dashboard_feeds_write', { mode: 'exclusive' }, async () => {
            const data = getData();
            const result = mutatorFn(data);
            if (result === false) return;
            return await saveData(data);
        });
    } else {
        const MAX_RETRIES = 5;
        let lastErr;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                const data = getData();
                const result = mutatorFn(data);
                if (result === false) return;
                return await saveData(data);
            } catch (err) {
                lastErr = err;
                // Wait briefly before retry
                await new Promise(r => setTimeout(r, 10 + Math.random() * 50));
            }
        }
        throw lastErr;
    }
}

export async function getNewsData() {
    let data = getData();
    if (!data.news) {
        await applyMutation((lockedData) => {
            if (!lockedData.news) {
                lockedData.news = {
                    sources: [],
                    cache: [],
                    manual: []
                };
            }
        });
        data = getData(); // re-read after potential init
    }
    return data.news;
}

// --- Source Management ---
export async function getSources() {
    return (await getNewsData()).sources;
}

export async function saveSource(sourceData) {
    return await applyMutation((data) => {
        if (!data.news) return false;
        const index = sourceData.id ? data.news.sources.findIndex(s => s.id === sourceData.id) : -1;
        if (index !== -1) {
            data.news.sources[index] = { ...data.news.sources[index], ...sourceData };
        } else {
            if (!sourceData.id) sourceData.id = 'source_' + Math.random().toString(36).substr(2, 9) + '_' + Math.random().toString(36).substr(2, 9);
            data.news.sources.push(sourceData);
        }
    });
}

export async function deleteSource(sourceId) {
    return await applyMutation((data) => {
        if (!data.news) return false;
        data.news.sources = data.news.sources.filter(s => s.id !== sourceId);
        data.news.cache = data.news.cache.filter(c => c.sourceId !== sourceId);
    });
}

// --- Manual Entry Management ---
export async function getManualEntries() {
    return (await getNewsData()).manual;
}

export async function saveManualEntry(entryData) {
    if (entryData.url && !isValidUrl(entryData.url)) {
        entryData.url = '';
    }
    return await applyMutation((data) => {
        if (!data.news) return false;
        const index = entryData.id ? data.news.manual.findIndex(m => m.id === entryData.id) : -1;
        if (index !== -1) {
            data.news.manual[index] = { ...data.news.manual[index], ...entryData };
        } else {
            if (!entryData.id) entryData.id = 'manual_' + Math.random().toString(36).substr(2, 9) + '_' + Math.random().toString(36).substr(2, 9);
            data.news.manual.push(entryData);
        }
    });
}

export async function deleteManualEntry(entryId) {
    return await applyMutation((data) => {
        if (!data.news) return false;
        data.news.manual = data.news.manual.filter(m => m.id !== entryId);
    });
}

// --- Fetch and Parse Logic ---

const ALLOWED_SCHEMES = ['http:', 'https:'];

function isValidUrl(urlString) {
    try {
        const url = new URL(urlString);
        return ALLOWED_SCHEMES.includes(url.protocol);
    } catch {
        return false;
    }
}

function parseFeed(xmlText, source) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    
    if (doc.querySelector('parsererror')) {
        throw new Error('Invalid XML format');
    }

    const isAtom = doc.querySelector('feed') !== null;
    const isRss = doc.querySelector('rss') !== null || doc.querySelector('rdf\\:RDF') !== null;
    if (!isAtom && !isRss) {
         throw new Error('Not a valid RSS/Atom feed');
    }

    let items = [];

    if (isAtom) {
        const entries = doc.querySelectorAll('entry');
        entries.forEach(entry => {
            const titleEl = entry.querySelector('title');
            const linkEl = entry.querySelector('link');
            const publishedEl = entry.querySelector('updated') || entry.querySelector('published');
            
            const title = titleEl ? titleEl.textContent : 'Untitled';
            let url = '';
            const alternateLink = entry.querySelector('link[rel="alternate"]');
            if (alternateLink) {
                 url = alternateLink.getAttribute('href');
            } else if (linkEl) {
                 url = linkEl.getAttribute('href') || linkEl.textContent;
            }
            
            if (isValidUrl(url)) {
                items.push({
                    id: 'item_' + Math.random().toString(36).substr(2, 9) + '_' + Math.random().toString(36).substr(2, 9),
                    sourceId: source.id,
                    title: title.trim(),
                    url: url.trim(),
                    published: publishedEl ? new Date(publishedEl.textContent).toISOString() : new Date().toISOString(),
                    category: source.category
                });
            }
        });
    } else { // RSS
        const rssItems = doc.querySelectorAll('item');
        rssItems.forEach(item => {
            const titleEl = item.querySelector('title');
            const linkEl = item.querySelector('link');
            const pubDateEl = item.querySelector('pubDate');
            
            const title = titleEl ? titleEl.textContent : 'Untitled';
            const url = linkEl ? linkEl.textContent : '';
            
            if (isValidUrl(url)) {
                items.push({
                    id: 'item_' + Math.random().toString(36).substr(2, 9) + '_' + Math.random().toString(36).substr(2, 9),
                    sourceId: source.id,
                    title: title.trim(),
                    url: url.trim(),
                    published: pubDateEl ? new Date(pubDateEl.textContent).toISOString() : new Date().toISOString(),
                    category: source.category
                });
            }
        });
    }

    // Deduplicate by URL
    const uniqueItems = [];
    const seenUrls = new Set();
    for (const item of items) {
        if (!seenUrls.has(item.url)) {
            seenUrls.add(item.url);
            uniqueItems.push(item);
        }
    }
    
    return uniqueItems;
}

export async function refreshFeeds(onProgress) {
    const initialNews = await getNewsData();
    const sources = [...initialNews.sources];
    
    // To limit concurrency to at most 4 requests
    const CONCURRENCY_LIMIT = 4;
    const activeTasks = new Set();
    const results = [];
    
    const maxBodyBytes = 1048576; // 1 MiB decoded cap
    
    for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        if (!isValidUrl(source.url)) {
            continue; // Will handle error during the queue process below if needed, or just let the main task run. Let's process it.
        }
        
        // Generate a request token
        const requestToken = 'req_' + Math.random().toString(36).substr(2, 9) + Math.random().toString(36).substr(2, 9);
        
        // Admit the token through a checked store mutation BEFORE fetch starts
        await applyMutation((data) => {
            if (!data.news) return false;
            const srcIdx = data.news.sources.findIndex(s => s.id === source.id && s.url === source.url);
            if (srcIdx !== -1) {
                data.news.sources[srcIdx]._lastUpdateToken = requestToken;
            }
        });
        
        // Create async task for fetch
        const fetchTask = async () => {
            if (onProgress) onProgress(`Refreshing ${source.name}...`);
            let status = 'error';
            let reason = '';
            let newItems = [];
            
            try {
                if (!isValidUrl(source.url)) {
                     throw new Error('Invalid source URL scheme');
                }
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000);
                
                let reader;
                
                try {
                    const response = await fetch(source.url, {
                        method: 'GET',
                        mode: 'cors',
                        cache: 'no-store',
                        signal: controller.signal
                    });
                    
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    
                    reader = response.body.getReader();
                    let bytesReceived = 0;
                    let chunks = [];
                    const decoder = new TextDecoder("utf-8");
                    let decodedText = "";
                    
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        bytesReceived += value.length;
                        if (bytesReceived > maxBodyBytes) {
                            throw new Error('Response exceeded 1 MiB size limit');
                        }
                        decodedText += decoder.decode(value, { stream: true });
                    }
                    decodedText += decoder.decode(); // flush
                    
                    newItems = parseFeed(decodedText, source);
                    
                    // Keep max 100 accepted items per source
                    newItems = newItems.slice(0, 100);
                    
                    status = 'ok';
                } finally {
                    clearTimeout(timeoutId);
                    if (reader && status !== 'ok') {
                        reader.cancel().catch(() => {});
                    }
                }
            } catch (error) {
                reason = error.message;
                if (error.name === 'AbortError') {
                    reason = 'Request timed out (15s)';
                } else if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
                    reason = 'CORS/Network error. Browser blocked access.';
                }
            }
            
            // Final checked mutation
            await applyMutation((data) => {
                if (!data.news) return false;
                const sIdx = data.news.sources.findIndex(s => s.id === source.id);
                if (sIdx !== -1) {
                    const currentSource = data.news.sources[sIdx];
                    // verify current source ID, config (URL), and request token
                    if (currentSource.url === source.url && currentSource.category === source.category && currentSource.name === source.name && currentSource._lastUpdateToken === requestToken) {
                        data.news.sources[sIdx] = { 
                            ...currentSource, 
                            status, 
                            reason, 
                            lastRefresh: new Date().toISOString() 
                        };
                        
                        if (status === 'ok') {
                            // Replace items for this source
                            data.news.cache = data.news.cache.filter(c => c.sourceId !== source.id);
                            data.news.cache.push(...newItems);
                        }
                    }
                }
            });
        };
        
        const p = fetchTask().finally(() => activeTasks.delete(p));
        activeTasks.add(p);
        results.push(p);
        
        if (activeTasks.size >= CONCURRENCY_LIMIT) {
            await Promise.race(activeTasks);
        }
    }
    
    await Promise.all(activeTasks);
}

// --- UI Rendering ---

export function createNewsCard(item, isManual, onDelete) {
    const card = document.createElement('div');
    card.className = 'card';
    
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'flex-start';
    
    const titleContainer = document.createElement('div');
    
    const titleEl = document.createElement('h3');
    titleEl.textContent = item.title;
    titleEl.style.marginBottom = '0.5rem';
    
    const linkEl = document.createElement('a');
    if (item.url && isValidUrl(item.url)) {
        linkEl.href = item.url;
    } else {
        linkEl.href = 'javascript:void(0)';
    }
    linkEl.textContent = 'View article';
    linkEl.target = '_blank';
    linkEl.rel = 'noopener noreferrer';
    linkEl.style.color = 'var(--accent-color)';
    linkEl.style.fontSize = '0.875rem';
    linkEl.style.textDecoration = 'none';
    
    titleContainer.appendChild(titleEl);
    titleContainer.appendChild(linkEl);
    
    const metaContainer = document.createElement('div');
    metaContainer.style.display = 'flex';
    metaContainer.style.flexDirection = 'column';
    metaContainer.style.alignItems = 'flex-end';
    metaContainer.style.gap = '0.5rem';

    const categoryBadge = document.createElement('span');
    categoryBadge.className = 'badge';
    let catText = item.category;
    if (item.category === 'global') catText = 'Global';
    else if (item.category === 'canada') catText = 'Canada';
    else if (item.category === 'public-immigration') catText = 'Public Immigration';
    categoryBadge.textContent = catText;
    
    const dateEl = document.createElement('div');
    dateEl.textContent = new Date(item.published).toLocaleDateString();
    dateEl.style.fontSize = '0.75rem';
    dateEl.style.color = 'var(--text-secondary)';
    
    metaContainer.appendChild(categoryBadge);
    metaContainer.appendChild(dateEl);
    
    if (isManual) {
        const btnDelete = document.createElement('button');
        btnDelete.textContent = 'Del';
        btnDelete.className = 'secondary-btn';
        btnDelete.style.padding = '0.125rem 0.25rem';
        btnDelete.style.fontSize = '0.75rem';
        btnDelete.style.color = 'var(--danger-color)';
        btnDelete.addEventListener('click', () => {
            if (confirm('Delete manual entry?')) {
                onDelete(item.id);
            }
        });
        metaContainer.appendChild(btnDelete);
    }
    
    header.appendChild(titleContainer);
    header.appendChild(metaContainer);
    card.appendChild(header);
    
    return card;
}

export function createSourceCard(source, onEdit, onDelete) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.display = 'flex';
    card.style.flexDirection = 'row';
    card.style.justifyContent = 'space-between';
    card.style.alignItems = 'center';
    
    const info = document.createElement('div');
    const nameEl = document.createElement('h3');
    nameEl.textContent = source.name;
    nameEl.style.marginBottom = '0.25rem';
    
    const detailsEl = document.createElement('div');
    detailsEl.style.fontSize = '0.75rem';
    detailsEl.style.color = 'var(--text-secondary)';
    detailsEl.textContent = `${source.category} | ${source.url}`;
    
    const statusEl = document.createElement('div');
    statusEl.style.fontSize = '0.75rem';
    statusEl.style.marginTop = '0.25rem';
    if (source.status === 'ok') {
        statusEl.textContent = `OK - Last refresh: ${new Date(source.lastRefresh).toLocaleString()}`;
        statusEl.style.color = 'var(--accent-color)';
    } else if (source.status === 'error') {
        statusEl.textContent = `Error: ${source.reason} - See console. (Cache preserved if available)`;
        statusEl.style.color = 'var(--danger-color)';
    } else {
        statusEl.textContent = 'Pending refresh';
    }
    
    info.appendChild(nameEl);
    info.appendChild(detailsEl);
    info.appendChild(statusEl);
    
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '0.5rem';
    
    const btnEdit = document.createElement('button');
    btnEdit.textContent = 'Edit';
    btnEdit.className = 'secondary-btn';
    btnEdit.addEventListener('click', () => onEdit(source));
    
    const btnDelete = document.createElement('button');
    btnDelete.textContent = 'Del';
    btnDelete.className = 'secondary-btn';
    btnDelete.style.color = 'var(--danger-color)';
    btnDelete.addEventListener('click', () => {
        if (confirm(`Delete source ${source.name}?`)) onDelete(source.id);
    });
    
    actions.appendChild(btnEdit);
    actions.appendChild(btnDelete);
    
    card.appendChild(info);
    card.appendChild(actions);
    
    return card;
}
