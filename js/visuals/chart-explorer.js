import { getData, saveData, initStore } from '../store.js';

let instances = new Map();

/**
 * Interactive chart explorer
 * @param {HTMLElement} root - DOM element to render into
 * @param {Object} options - Configuration options
 * @param {Array} options.data - Array of data objects
 * @param {Array} options.columns - Array of string keys
 */
export function renderChartExplorer(root, { data, columns }) {
    // Deep copy to prevent mutating caller-provided data arguments
    const originalData = JSON.parse(JSON.stringify(data || []));
    
    const state = {
        sortCol: null,
        sortAsc: true,
        filterText: '',
        data: originalData
    };
    
    instances.set(root, state);
    
    root.innerHTML = '';
    
    const container = document.createElement('div');
    container.className = 'chart-explorer-container';
    container.style.cssText = 'background: #000; color: #a3e635; padding: 1rem; border-radius: 8px; font-family: sans-serif;';
    
    const controls = document.createElement('div');
    controls.style.cssText = 'margin-bottom: 1rem; display: flex; gap: 1rem;';
    
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Filter data...';
    searchInput.style.cssText = 'flex: 1; background: #222; color: #a3e635; border: 1px solid #a3e635; padding: 0.5rem; border-radius: 4px; box-sizing: border-box;';
    
    searchInput.addEventListener('input', (e) => {
        state.filterText = e.target.value.toLowerCase();
        renderTable(tableContainer, columns, state);
    });
    
    controls.appendChild(searchInput);
    container.appendChild(controls);
    
    const tableContainer = document.createElement('div');
    tableContainer.style.cssText = 'overflow-x: auto;';
    
    renderTable(tableContainer, columns, state);
    
    container.appendChild(tableContainer);
    root.appendChild(container);
}

function renderTable(container, columns, state) {
    container.innerHTML = '';
    
    let filteredData = state.data.filter(row => {
        if (!state.filterText) return true;
        return columns.some(col => {
            const val = row[col];
            return val !== undefined && val !== null && String(val).toLowerCase().includes(state.filterText);
        });
    });
    
    if (state.sortCol) {
        filteredData.sort((a, b) => {
            let valA = a[state.sortCol];
            let valB = b[state.sortCol];
            
            if (valA === valB) return 0;
            if (valA === undefined || valA === null) valA = '';
            if (valB === undefined || valB === null) valB = '';
            
            const cmp = valA > valB ? 1 : -1;
            return state.sortAsc ? cmp : -cmp;
        });
    }
    
    const table = document.createElement('table');
    table.style.cssText = 'width: 100%; border-collapse: collapse; text-align: left;';
    
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    
    columns.forEach(col => {
        const th = document.createElement('th');
        th.style.cssText = 'padding: 0.75rem 0.5rem; border-bottom: 2px solid #a3e635; cursor: pointer; user-select: none;';
        
        let label = col;
        if (state.sortCol === col) {
            label += state.sortAsc ? ' ▲' : ' ▼';
        }
        th.textContent = label;
        
        th.addEventListener('click', () => {
            if (state.sortCol === col) {
                if (state.sortAsc) {
                    state.sortAsc = false;
                } else {
                    state.sortCol = null;
                    state.sortAsc = true;
                }
            } else {
                state.sortCol = col;
                state.sortAsc = true;
            }
            renderTable(container, columns, state);
        });
        
        headerRow.appendChild(th);
    });
    
    const chartTh = document.createElement('th');
    chartTh.textContent = 'Visualization';
    chartTh.style.cssText = 'padding: 0.75rem 0.5rem; border-bottom: 2px solid #a3e635; width: 30%;';
    headerRow.appendChild(chartTh);
    
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    const tbody = document.createElement('tbody');
    
    if (filteredData.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = columns.length + 1;
        td.textContent = 'No data available';
        td.style.cssText = 'padding: 2rem; text-align: center; color: #888; font-style: italic;';
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        // Find maximum numeric value for chart scaling
        let maxVal = 0;
        filteredData.forEach(row => {
            columns.forEach(col => {
                const val = row[col];
                if (val !== null && val !== '' && isFinite(Number(val))) {
                    maxVal = Math.max(maxVal, Number(val));
                }
            });
        });
        if (maxVal === 0) maxVal = 1;
        
        filteredData.forEach(row => {
            const tr = document.createElement('tr');
            tr.style.cssText = 'border-bottom: 1px solid #333;';
            
            // Find a representative numeric value for the row
            let barValue = 0;
            for (let col of columns) {
                const val = row[col];
                if (val !== null && val !== '' && isFinite(Number(val))) {
                    barValue = Number(val);
                    break;
                }
            }
            
            columns.forEach(col => {
                const td = document.createElement('td');
                td.style.cssText = 'padding: 0.75rem 0.5rem;';
                const val = row[col];
                td.textContent = val !== undefined && val !== null ? val : '';
                tr.appendChild(td);
            });
            
            const chartTd = document.createElement('td');
            chartTd.style.cssText = 'padding: 0.75rem 0.5rem; vertical-align: middle;';
            
            const barContainer = document.createElement('div');
            barContainer.style.cssText = 'width: 100%; background: #222; height: 12px; border-radius: 6px; overflow: hidden;';
            
            const bar = document.createElement('div');
            const pct = Math.max(0, Math.min(100, (barValue / maxVal) * 100));
            bar.style.cssText = `width: ${pct}%; background: #a3e635; height: 100%; transition: width 0.3s ease-out;`;
            
            barContainer.appendChild(bar);
            chartTd.appendChild(barContainer);
            tr.appendChild(chartTd);
            
            tbody.appendChild(tr);
        });
    }
    
    table.appendChild(tbody);
    container.appendChild(table);
}

/**
 * Cleans up the chart explorer instance
 * @param {HTMLElement} root - The DOM element containing the explorer
 */
export function destroyChartExplorer(root) {
    if (!root) return;
    
    // Clean up DOM and event listeners by emptying HTML
    root.innerHTML = '';
    instances.delete(root);
}

// Example Mutator simulating R6 contract (just as template, not active data modification here)
export async function updateChartConfig(newConfig) {
    // R6 contract: conflict THROWS (never a conflict-object).
    // Mutators return awaited save; 
    const currentData = getData();
    if (currentData._locked) {
        throw new Error('Conflict: Configuration is currently locked');
    }
    currentData.chartConfig = newConfig;
    // simulating awaited save pattern
    return saveData(currentData);
}