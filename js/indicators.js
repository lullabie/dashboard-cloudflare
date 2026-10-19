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

function isValidNumber(val) {
    if (val === null || val === undefined || String(val).trim() === '') return false;
    const num = Number(val);
    return isFinite(num);
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
        
        if (!isValidNumber(latest[seriesId].v) || !isValidNumber(previous[seriesId].v)) {
            throw new Error('Malformed numeric input');
        }
        
        const latestVal = Number(latest[seriesId].v);
        const previousVal = Number(previous[seriesId].v);
        change = latestVal - previousVal;
    } else {
        if (!isValidNumber(latest[seriesId].v)) {
            throw new Error('Malformed numeric input');
        }
    }
    
    return {
        value: Number(latest[seriesId].v).toFixed(4),
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
    let changeColor = 'var(--text-secondary)';
    
    if (data.change !== 'N/A') {
        const changeNum = parseFloat(data.change);
        if (changeNum > 0) {
            changeSymbol = '+';
            changeColor = 'var(--accent-color)'; // Lime
        } else if (changeNum < 0) {
            changeColor = 'var(--danger-color)'; // Red
        }
    }
    
    const staleBadgeHtml = isStale ? `<span class="badge amber" style="margin-left: 0.5rem;">Stale</span>` : '';
    
    card.innerHTML = `
        <div class="card-header">
            <div class="card-title">${indicator.label}</div>
            ${staleBadgeHtml}
        </div>
        <div class="card-body">
            <div style="font-size: 2rem; font-weight: 600; line-height: 1.2;">
                ${data.value}
            </div>
            <div style="font-size: 0.875rem; color: ${changeColor};">
                ${changeSymbol}${data.change} DoD
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 1rem;">
                As of: ${data.asOfDate}
            </div>
        </div>
        <div class="card-footer" style="margin-top: 0;">
            <a href="https://www.bankofcanada.ca/" target="_blank" rel="noopener noreferrer" style="color: var(--text-secondary); text-decoration: none; font-size: 0.75rem; border-bottom: 1px dotted var(--text-secondary);">Source: bankofcanada.ca</a>
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
            <span class="badge danger" style="margin-left: 0.5rem;">Error</span>
        </div>
        <div class="card-body" style="display: flex; align-items: center; justify-content: center;">
            <p style="color: var(--text-secondary); font-style: italic; margin: 0;">Unavailable</p>
        </div>
        <div class="card-footer" style="margin-top: 0;">
            <a href="https://www.bankofcanada.ca/" target="_blank" rel="noopener noreferrer" style="color: var(--text-secondary); text-decoration: none; font-size: 0.75rem; border-bottom: 1px dotted var(--text-secondary);">Source: bankofcanada.ca</a>
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
    
    // Initial Render from cache if available
    renderCurrentState(container, cache, new Set());
    
    if (needsUpdate || Object.keys(cache).length < INDICATORS.length) {
        const failedSeries = new Set();
        const fetches = INDICATORS.map(async (ind) => {
            try {
                const data = await fetchIndicator(ind.id);
                cache[ind.id] = data;
            } catch (error) {
                // Do not rethrow so Promise.all won't reject entirely
                failedSeries.add(ind.id);
            }
        });
        
        await Promise.all(fetches);
        
        // Always save to cache, the failed series will just keep their old values
        setCachedData(cache);
        
        // Re-render with new data or mark stale if failed
        renderCurrentState(container, cache, failedSeries);
    }
}

function renderCurrentState(container, cache, failedSeries) {
    container.innerHTML = '';
    
    INDICATORS.forEach(ind => {
        const cachedData = cache[ind.id];
        if (cachedData) {
            const isStale = failedSeries.has(ind.id); 
            container.appendChild(createIndicatorTile(ind, cachedData, isStale));
        } else {
            // Completely missing data + fetch failed (implicitly)
            container.appendChild(createErrorTile(ind));
        }
    });
}
