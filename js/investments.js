import { getData, saveData } from './store.js';

function getInvestmentsData() {
    const data = getData();
    if (!data.investments) {
        data.investments = [];
    }
    return data;
}

export function getInvestments() {
    const data = getInvestmentsData();
    return JSON.parse(JSON.stringify(data.investments));
}

function parseNumber(val) {
    if (val === null || val === undefined || val === '') return 0;
    const num = Number(val);
    return isFinite(num) ? num : 0;
}

export async function saveInvestment(invData) {
    const doSave = async () => {
        const data = getInvestmentsData();
        const investments = data.investments;
        
        if (invData.id) {
            const existingIndex = investments.findIndex(i => i.id === invData.id);
            if (existingIndex === -1) {
                throw new Error("Conflict: Investment not found for update.");
            }
            investments[existingIndex] = {
                ...investments[existingIndex],
                ...invData,
                updatedAt: new Date().toISOString()
            };
        } else {
            const newInv = {
                id: 'inv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                ticker: invData.ticker || '',
                entryPrice: parseNumber(invData.entryPrice),
                currentPrice: parseNumber(invData.currentPrice),
                notes: invData.notes || '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            investments.push(newInv);
        }
        saveData(data);
    };

    if (typeof navigator !== 'undefined' && navigator.locks) {
        await navigator.locks.request('dashboard_data_lock', doSave);
    } else {
        await doSave();
    }
}

export async function deleteInvestment(id) {
    const doDelete = async () => {
        const data = getInvestmentsData();
        const investments = data.investments;
        const existingIndex = investments.findIndex(i => i.id === id);
        
        if (existingIndex === -1) {
            throw new Error("Conflict: Investment not found for deletion.");
        }
        
        investments.splice(existingIndex, 1);
        saveData(data);
    };

    if (typeof navigator !== 'undefined' && navigator.locks) {
        await navigator.locks.request('dashboard_data_lock', doDelete);
    } else {
        await doDelete();
    }
}

function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

export function createInvestmentCard(investment, onEdit, onDelete) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = investment.id;
    
    // Deep/shallow copy for event listeners to avoid mutating the original reference
    const inv = { ...investment };

    const ticker = escapeHtml(inv.ticker || 'Unknown');
    const notes = escapeHtml(inv.notes || '');
    
    const entryPrice = parseNumber(inv.entryPrice);
    const currentPrice = parseNumber(inv.currentPrice);

    card.innerHTML = `
        <div class="card-header" style="align-items: center; justify-content: space-between;">
            <div class="card-title">${ticker}</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary);">Manual Watchlist</div>
        </div>
        <div class="card-body">
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                <div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary);">Entry Price</div>
                    <div>$${entryPrice.toFixed(2)}</div>
                </div>
                <div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary);">Current Price</div>
                    <div>$${currentPrice.toFixed(2)}</div>
                </div>
            </div>
            ${notes ? `<div class="card-notes" style="font-size: 0.875rem; margin-top: 0.5rem;">${notes}</div>` : ''}
        </div>
        <div class="card-footer" style="justify-content: flex-end;">
            <div class="card-actions">
                <button class="icon-btn edit-btn">Edit</button>
                <button class="icon-btn delete-btn">Delete</button>
            </div>
        </div>
    `;

    const editBtn = card.querySelector('.edit-btn');
    const deleteBtn = card.querySelector('.delete-btn');

    editBtn.addEventListener('click', () => onEdit(inv));
    editBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(inv); }
    });

    deleteBtn.addEventListener('click', () => onDelete(inv.id));
    deleteBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDelete(inv.id); }
    });

    return card;
}