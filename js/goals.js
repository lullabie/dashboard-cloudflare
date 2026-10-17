/**
 * Goals CRUD and Immutable History Component
 */
import { getData, saveData } from './store.js';

export function getGoals() {
    return getData().goals || [];
}

export function saveGoal(goalData) {
    const data = getData();
    if (!data.goals) data.goals = [];
    
    if (goalData.id) {
        // Edit existing goal
        const index = data.goals.findIndex(g => g.id === goalData.id);
        if (index !== -1) {
            const existing = data.goals[index];
            // Immutable history: append edit event
            existing.history.push({
                type: 'EDIT',
                timestamp: new Date().toISOString(),
                changes: {
                    title: existing.title !== goalData.title ? goalData.title : undefined,
                    notes: existing.notes !== goalData.notes ? goalData.notes : undefined,
                    target: existing.target !== goalData.target ? goalData.target : undefined,
                    showNotes: existing.showNotes !== goalData.showNotes ? goalData.showNotes : undefined
                }
            });
            existing.title = goalData.title;
            existing.notes = goalData.notes;
            existing.target = goalData.target;
            existing.showNotes = goalData.showNotes;
            existing.updatedAt = new Date().toISOString();
        }
    } else {
        // Create new goal
        const newGoal = {
            id: 'goal_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            title: goalData.title,
            notes: goalData.notes || '',
            target: goalData.target || 1,
            showNotes: goalData.showNotes || false,
            status: 'active', // active, archived
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            history: [{
                type: 'CREATE',
                timestamp: new Date().toISOString()
            }],
            checkIns: [] // manual check-ins
        };
        data.goals.push(newGoal);
    }
    
    saveData(data);
}

export function toggleArchive(goalId) {
    const data = getData();
    const goal = data.goals.find(g => g.id === goalId);
    if (goal) {
        const newStatus = goal.status === 'active' ? 'archived' : 'active';
        goal.history.push({
            type: 'STATUS_CHANGE',
            timestamp: new Date().toISOString(),
            from: goal.status,
            to: newStatus
        });
        goal.status = newStatus;
        goal.updatedAt = new Date().toISOString();
        saveData(data);
    }
}

export function checkInGoal(goalId, note = '') {
    const data = getData();
    const goal = data.goals.find(g => g.id === goalId);
    if (goal) {
        goal.checkIns.push({
            timestamp: new Date().toISOString(),
            note: note
        });
        goal.history.push({
            type: 'CHECK_IN',
            timestamp: new Date().toISOString()
        });
        goal.updatedAt = new Date().toISOString();
        saveData(data);
    }
}

/**
 * Creates a DOM element for a goal card
 */
export function createGoalCard(goal, onEdit, onToggleArchive, onCheckIn) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = goal.id;
    
    const lastCheckIn = goal.checkIns.length > 0 
        ? new Date(goal.checkIns[goal.checkIns.length - 1].timestamp).toLocaleDateString() 
        : 'Never';

    const target = goal.target || 1;
    const progress = Math.min(100, Math.round((goal.checkIns.length / target) * 100));
    
    // SVG Progress Ring (Lime on Black)
    // 2 * pi * r = 2 * Math.PI * 16 ~= 100.5
    const circumference = 100.5;
    const strokeDashoffset = circumference - (progress / 100) * circumference;
    
    const ringHtml = `
        <div style="position: relative; width: 40px; height: 40px; flex-shrink: 0;">
            <svg width="40" height="40" viewBox="0 0 40 40" style="transform: rotate(-90deg);">
                <circle cx="20" cy="20" r="16" fill="none" stroke="var(--border-color)" stroke-width="4"></circle>
                <circle cx="20" cy="20" r="16" fill="none" stroke="var(--accent-color)" stroke-width="4" stroke-dasharray="${circumference}" stroke-dashoffset="${strokeDashoffset}" style="transition: stroke-dashoffset 0.5s ease;"></circle>
            </svg>
            <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 0.6rem; font-weight: bold;">
                ${progress}%
            </div>
        </div>
    `;

    // HTML Construction
    card.innerHTML = `
        <div class="card-header" style="align-items: center;">
            <div style="display: flex; gap: 1rem; align-items: center; width: 100%;">
                ${ringHtml}
                <div style="flex-grow: 1;">
                    <div class="card-title">${escapeHtml(goal.title)}</div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary);">${goal.checkIns.length} / ${target} check-ins</div>
                </div>
            </div>
            ${goal.status === 'archived' ? '<span class="badge" style="margin-left: auto;">Archived</span>' : ''}
        </div>
        <div class="card-body">
            <p style="font-size: 0.875rem; margin-bottom: 0; margin-top: 0.5rem;">Last Check-in: ${lastCheckIn}</p>
            ${goal.showNotes && goal.notes ? `<div class="card-notes">${escapeHtml(goal.notes)}</div>` : ''}
        </div>
        <div class="card-footer">
            <div class="card-actions">
                ${goal.status === 'active' ? `<button class="icon-btn check-in-btn">Check In</button>` : ''}
            </div>
            <div class="card-actions">
                <button class="icon-btn edit-btn">Edit</button>
                <button class="icon-btn archive-btn">${goal.status === 'active' ? 'Archive' : 'Restore'}</button>
            </div>
        </div>
    `;

    // Event Listeners
    if (goal.status === 'active') {
        const checkInBtn = card.querySelector('.check-in-btn');
        checkInBtn.addEventListener('click', () => onCheckIn(goal.id));
        checkInBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCheckIn(goal.id); }
        });
    }
    const editBtn = card.querySelector('.edit-btn');
    editBtn.addEventListener('click', () => onEdit(goal));
    editBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(goal); }
    });
    
    const archiveBtn = card.querySelector('.archive-btn');
    archiveBtn.addEventListener('click', () => onToggleArchive(goal.id));
    archiveBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleArchive(goal.id); }
    });
    
    return card;
}

// Utility to prevent XSS in our plain vanilla JS app
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}