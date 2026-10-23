/**
 * Bank of Canada Indicators Component
 * Fetches and displays CAD/INR and USD/CAD rates.
 */

const BOC_API_BASE = 'https://www.bankofcanada.ca/valet/observations';
const CACHE_KEY = 'dashboard_indicators_cache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const INDICATORS = [
    { id: 'FXCADINR', label: 'CAD/INR' },
    { id: 'FXUSDCAD', label: 'USD/CAD' }
];

function getCachedData() {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

function setCachedData(data) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (e) {
        console.error('Failed to save indicators to cache', e);
    }
}

async function fetchIndicator(seriesId) {
    // Fetch last 2 observations to calculate day-over-day change
    const url = `${BOC_API_BASE}/${seriesId}/json?recent=2`;
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json'
        }
    });
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    if (!data.observations || data.observations.length === 0) {
        throw new Error('No observations found');
    }
    
    const latest = data.observations[data.observations.length - 1];
    let previous = null;
    let change = null;
    
    if (data.observations.length > 1) {
        previous = data.observations[data.observations.length - 2];
        const latestVal = parseFloat(latest[seriesId].v);
        const previousVal = parseFloat(previous[seriesId].v);
        change = latestVal - previousVal;
    }
    
    return {
        value: parseFloat(latest[seriesId].v).toFixed(4),
        change: change !== null ? change.toFixed(4) : 'N/A',
        asOfDate: latest.d,
        timestamp: Date.now()
    };
}

function createIndicatorTile(indicator, data, isStale) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.position = 'relative'; // for absolute positioning of stale badge if needed
    
    let changeSymbol = '';
    let changeClass = '';

    if (data.change !== 'N/A') {
        const changeNum = parseFloat(data.change);
        if (changeNum > 0) {
            changeSymbol = '+';
            changeClass = ' is-positive'; // Lime
        } else if (changeNum < 0) {
            changeClass = ' is-negative'; // Red
        }
    }

    const staleBadgeHtml = isStale ? `<span class="badge amber badge-spaced">Stale</span>` : '';
    
    card.innerHTML = `
        <div class="card-header">
            <div class="card-title">${indicator.label}</div>
            ${staleBadgeHtml}
        </div>
        <div class="card-body">
            <div class="indicator-value">
                ${data.value}
            </div>
            <div class="indicator-change${changeClass}">
                ${changeSymbol}${data.change} DoD
            </div>
            <div class="indicator-asof">
                As of: ${data.asOfDate}
            </div>
        </div>
        <div class="card-footer card-footer-flush">
            <a class="source-link" href="https://www.bankofcanada.ca/" target="_blank" rel="noopener noreferrer">Source: bankofcanada.ca</a>
        </div>
    `;
    
    return card;
}

function createErrorTile(indicator) {
    const card = document.createElement('div');
    card.className = 'card';
    
    card.innerHTML = `
        <div class="card-header">
            <div class="card-title">${indicator.label}</div>
            <span class="badge danger badge-spaced">Error</span>
        </div>
        <div class="card-body card-body-center">
            <p class="unavailable-text">Unavailable</p>
        </div>
        <div class="card-footer card-footer-flush">
            <a class="source-link" href="https://www.bankofcanada.ca/" target="_blank" rel="noopener noreferrer">Source: bankofcanada.ca</a>
        </div>
    `;
    
    return card;
}

export async function fetchAndRenderIndicators(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    let cache = getCachedData() || {};
    let needsUpdate = false;
    
    // Check if we need to fetch
    for (const ind of INDICATORS) {
        if (!cache[ind.id] || (Date.now() - cache[ind.id].timestamp > CACHE_TTL_MS)) {
            needsUpdate = true;
            break;
        }
    }
    
    // Initial Render from cache if available, showing "Stale" if needsUpdate is true
    // Wait, the requirement says "Cache the last good values in localStorage; on fetch failure show a "stale" badge with the cached values, never blank."
    // It doesn't say show stale just because it's old BEFORE fetching. We will try fetching, if it fails, then we mark it stale.
    
    // Clear container and show skeleton or just empty?
    // "Fetch must never block page load (async, fire-and-forget with then-update)."
    
    // Optimistically render cache without stale badge first
    renderCurrentState(container, cache, false);
    
    if (needsUpdate || Object.keys(cache).length < INDICATORS.length) {
        const fetches = INDICATORS.map(async (ind) => {
            try {
                const data = await fetchIndicator(ind.id);
                cache[ind.id] = data;
                return { id: ind.id, success: true };
            } catch (error) {
                console.error(`Failed to fetch ${ind.id}:`, error);
                return { id: ind.id, success: false };
            }
        });
        
        const results = await Promise.allSettled(fetches);
        
        let fetchFailed = false;
        results.forEach(res => {
            if (res.status === 'rejected' || (res.status === 'fulfilled' && !res.value.success)) {
                fetchFailed = true;
            }
        });
        
        if (!fetchFailed) {
            setCachedData(cache);
        }
        
        // Re-render with new data or mark stale if failed
        renderCurrentState(container, cache, fetchFailed);
    }
}

function renderCurrentState(container, cache, fetchFailed) {
    container.innerHTML = '';
    
    INDICATORS.forEach(ind => {
        const cachedData = cache[ind.id];
        if (cachedData) {
            // It's stale if fetch failed OR if it's older than TTL (though if fetch failed it implicitly might be old)
            const isStale = fetchFailed; 
            container.appendChild(createIndicatorTile(ind, cachedData, isStale));
        } else {
            // Completely missing data + fetch failed
            container.appendChild(createErrorTile(ind));
        }
    });
}
