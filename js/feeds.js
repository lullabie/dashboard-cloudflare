import { getData, saveData } from './store.js';

export async function getNewsData() {
    const data = getData();
    if (!data.news) {
        data.news = {
            sources: [], // { id, name, url, category, lastRefresh, status, reason }
            cache: [], // { id, sourceId, title, url, published, category }
            manual: [] // { id, title, url, published, category }
        };
        await saveData(data);
    }
    return data.news;
}

async function saveNewsData(newsData) {
    const data = getData();
    data.news = newsData;
    return await saveData(data);
}

// --- Source Management ---
export async function getSources() {
    return (await getNewsData()).sources;
}

export async function saveSource(sourceData) {
    const news = await getNewsData();
    if (sourceData.id) {
        const index = news.sources.findIndex(s => s.id === sourceData.id);
        if (index !== -1) {
            news.sources[index] = { ...news.sources[index], ...sourceData };
        }
    } else {
        sourceData.id = 'source_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        news.sources.push(sourceData);
    }
    return await saveNewsData(news);
}

export async function deleteSource(sourceId) {
    const news = await getNewsData();
    news.sources = news.sources.filter(s => s.id !== sourceId);
    news.cache = news.cache.filter(c => c.sourceId !== sourceId);
    return await saveNewsData(news);
}

// --- Manual Entry Management ---
export async function getManualEntries() {
    return (await getNewsData()).manual;
}

export async function saveManualEntry(entryData) {
    const news = await getNewsData();
    if (entryData.id) {
        const index = news.manual.findIndex(m => m.id === entryData.id);
        if (index !== -1) {
            news.manual[index] = { ...news.manual[index], ...entryData };
        }
    } else {
        entryData.id = 'manual_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        news.manual.push(entryData);
    }
    return await saveNewsData(news);
}

export async function deleteManualEntry(entryId) {
    const news = await getNewsData();
    news.manual = news.manual.filter(m => m.id !== entryId);
    return await saveNewsData(news);
}

// --- Fetch and Parse Logic ---

let _refreshGeneration = 0;
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

    const items = [];

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
                    id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
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
                    id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
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
    const currentGen = ++_refreshGeneration;
    const initialNews = await getNewsData();
    const sources = [...initialNews.sources];

    const cacheUpdates = [];
    const sourceUpdates = {};

    for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        if (onProgress) onProgress(`Refreshing ${source.name}...`);

        try {
            if (!isValidUrl(source.url)) {
                 throw new Error('Invalid source URL scheme');
            }

            // Native fetch with CORS
            const response = await fetch(source.url, {
                method: 'GET',
                mode: 'cors',
                cache: 'no-store'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const text = await response.text();
            const newItems = parseFeed(text, source);

            cacheUpdates.push({ sourceId: source.id, items: newItems, originalUrl: source.url, gen: currentGen });
            sourceUpdates[source.id] = { status: 'ok', reason: '', lastRefresh: new Date().toISOString(), gen: currentGen, originalUrl: source.url };
        } catch (error) {
            let reason = error.message;
            if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
                reason = 'CORS/Network error. Browser blocked access.';
            }
            sourceUpdates[source.id] = { status: 'error', reason: reason, gen: currentGen, originalUrl: source.url };
        }
    }

    // Update store with latest state to preserve concurrent manual edits
    const latestNews = await getNewsData();

    // Initialize or read refresh track on sources
    for (const s of latestNews.sources) {
        if (typeof s._lastUpdateGen === 'undefined') s._lastUpdateGen = 0;
    }

    for (const update of cacheUpdates) {
        const currentSource = latestNews.sources.find(s => s.id === update.sourceId);
        // Gate cache writes on both (a) URL identity and (b) generation currency
        if (currentSource && currentSource.url === update.originalUrl) {
            if (update.gen >= (currentSource._lastUpdateGen || 0)) {
                latestNews.cache = latestNews.cache.filter(c => c.sourceId !== update.sourceId);
                latestNews.cache.push(...update.items);
            }
        }
    }

    for (let i = 0; i < latestNews.sources.length; i++) {
        const s = latestNews.sources[i];
        const update = sourceUpdates[s.id];
        // Gate status writes on both (a) URL identity and (b) generation currency
        if (update && s.url === update.originalUrl) {
            if (update.gen >= (s._lastUpdateGen || 0)) {
                latestNews.sources[i] = { ...s, status: update.status, reason: update.reason, lastRefresh: update.lastRefresh || s.lastRefresh, _lastUpdateGen: update.gen };
            }
        }
    }

    return await saveNewsData(latestNews);
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
    linkEl.href = item.url;
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
