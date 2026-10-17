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

// --- Occurrences & History ---

export function getLocalDateString(date) {
    return new Intl.DateTimeFormat('en-CA', { 
        timeZone: 'America/Toronto',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
}

export function cycleOccurrence(goalId, dateStr) {
    const data = getData();
    const goal = data.goals.find(g => g.id === goalId);
    if (!goal) return;

    if (!goal.occurrences) {
        goal.occurrences = {};
    }

    const currentStatus = goal.occurrences[dateStr];
    let nextStatus = 'none';
    
    if (!currentStatus || currentStatus === 'none') nextStatus = 'done';
    else if (currentStatus === 'done') nextStatus = 'missed';
    else if (currentStatus === 'missed') nextStatus = 'late';
    else if (currentStatus === 'late') nextStatus = 'none';

    if (nextStatus === 'none') {
        delete goal.occurrences[dateStr];
    } else {
        goal.occurrences[dateStr] = nextStatus;
    }

    goal.history.push({
        type: 'OCCURRENCE_CHANGE',
        timestamp: new Date().toISOString(),
        date: dateStr,
        status: nextStatus
    });
    
    goal.updatedAt = new Date().toISOString();
    saveData(data);
}

export function calculateStreak(occurrences, todayStr) {
    if (!occurrences) return 0;
    
    let streak = 0;
    // We append noon so that it doesn't shift days due to minor timezone offsets 
    // when using Date object arithmetic. 'America/Toronto' is used for string generation.
    const today = new Date(todayStr + 'T12:00:00'); 
    
    let currentDate = new Date(today);
    const todayStatus = occurrences[getLocalDateString(currentDate)];
    
    // If today was explicitly missed or late, the streak is dead.
    if (todayStatus === 'missed' || todayStatus === 'late') {
        return 0;
    }

    // Check if today is done.
    if (todayStatus === 'done') {
        streak++;
    }
    
    // Move to yesterday and go backwards
    currentDate.setDate(currentDate.getDate() - 1);

    while (true) {
        const dateStr = getLocalDateString(currentDate);
        if (occurrences[dateStr] === 'done') {
            streak++;
            currentDate.setDate(currentDate.getDate() - 1);
        } else {
            break;
        }
    }
    
    return streak;
}

/**
 * Creates a DOM element for a goal card
 */
export function createGoalCard(goal, onEdit, onToggleArchive, onCycleOccurrence) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = goal.id;
    
    const occurrences = goal.occurrences || {};
    const doneDays = Object.values(occurrences).filter(status => status === 'done').length;

    const target = goal.target || 1;
    const progress = Math.min(100, Math.round((doneDays / target) * 100));
    
    const todayStr = getLocalDateString(new Date());
    const streak = calculateStreak(occurrences, todayStr);
    
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

    // History Timeline (last 7 days)
    let timelineHtml = '<div class="timeline" style="display: flex; gap: 0.25rem; margin-top: 0.5rem; margin-bottom: 0.5rem;">';
    for (let i = 6; i >= 0; i--) {
        const d = new Date(todayStr + 'T12:00:00');
        d.setDate(d.getDate() - i);
        const dateStr = getLocalDateString(d);
        const status = occurrences[dateStr] || 'none';
        
        let bgColor = 'var(--surface-hover)'; // default 'none'
        if (status === 'done') bgColor = 'var(--accent-color)';
        else if (status === 'missed') bgColor = 'var(--danger-color)';
        else if (status === 'late') bgColor = '#f59e0b'; // amber
        
        // Tooltip using title attribute for now
        const dayLabel = d.toLocaleDateString(undefined, { weekday: 'short' });
        timelineHtml += `
            <div class="timeline-day" data-date="${dateStr}" title="${dayLabel}: ${status}" 
                 style="flex: 1; height: 24px; border-radius: var(--radius-sm); background-color: ${bgColor}; cursor: pointer; border: 1px solid var(--border-color);">
            </div>
        `;
    }
    timelineHtml += '</div>';

    // HTML Construction
    card.innerHTML = `
        <div class="card-header" style="align-items: center;">
            <div style="display: flex; gap: 1rem; align-items: center; width: 100%;">
                ${ringHtml}
                <div style="flex-grow: 1;">
                    <div class="card-title">${escapeHtml(goal.title)}</div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary);">${doneDays} / ${target} done</div>
                </div>
            </div>
            ${goal.status === 'archived' ? '<span class="badge" style="margin-left: auto;">Archived</span>' : ''}
        </div>
        <div class="card-body">
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.875rem;">
                <span style="font-weight: bold; color: var(--text-primary);">${streak > 0 ? streak + ' 🔥' : ''}</span>
            </div>
            ${timelineHtml}
            ${goal.showNotes && goal.notes ? `<div class="card-notes">${escapeHtml(goal.notes)}</div>` : ''}
        </div>
        <div class="card-footer" style="justify-content: flex-end;">
            <div class="card-actions">
                <button class="icon-btn edit-btn">Edit</button>
                <button class="icon-btn archive-btn">${goal.status === 'active' ? 'Archive' : 'Restore'}</button>
            </div>
        </div>
    `;

    // Event Listeners
    if (goal.status === 'active') {
        const timelineDays = card.querySelectorAll('.timeline-day');
        timelineDays.forEach(dayEl => {
            dayEl.addEventListener('click', () => onCycleOccurrence(goal.id, dayEl.dataset.date));
            dayEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCycleOccurrence(goal.id, dayEl.dataset.date); }
            });
            // Make keyboard focusable
            dayEl.setAttribute('tabindex', '0');
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