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
            if (!Array.isArray(existing.history)) existing.history = [];
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
    
    return saveData(data);
}

export function toggleArchive(goalId) {
    const data = getData();
    const goal = data.goals.find(g => g.id === goalId);
    if (goal) {
        if (!Array.isArray(goal.history)) goal.history = [];
        const newStatus = goal.status === 'active' ? 'archived' : 'active';
        goal.history.push({
            type: 'STATUS_CHANGE',
            timestamp: new Date().toISOString(),
            from: goal.status,
            to: newStatus
        });
        goal.status = newStatus;
        goal.updatedAt = new Date().toISOString();
        return saveData(data);
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

    if (!Array.isArray(goal.history)) goal.history = [];
    goal.history.push({
        type: 'OCCURRENCE_CHANGE',
        timestamp: new Date().toISOString(),
        date: dateStr,
        status: nextStatus
    });
    
    goal.updatedAt = new Date().toISOString();
    return saveData(data);
}

export function calculateStreak(occurrences, todayStr) {
    if (!occurrences) return 0;
    
    let streak = 0;
    // Use UTC noon to safely add/subtract days without timezone drift
    const today = new Date(todayStr + 'T12:00:00Z'); 
    
    let currentDate = new Date(today);
    const getCalendarDate = (d) => d.toISOString().split('T')[0];
    const todayStatus = occurrences[getCalendarDate(currentDate)];
    
    // If today was explicitly missed or late, the streak is dead.
    if (todayStatus === 'missed' || todayStatus === 'late') {
        return 0;
    }

    // Check if today is done.
    if (todayStatus === 'done') {
        streak++;
    }
    
    // Move to yesterday and go backwards
    currentDate.setUTCDate(currentDate.getUTCDate() - 1);

    while (true) {
        const dateStr = currentDate.toISOString().split('T')[0];
        if (occurrences[dateStr] === 'done') {
            streak++;
            currentDate.setUTCDate(currentDate.getUTCDate() - 1);
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
    const manualCheckIns = Array.isArray(goal.checkIns) ? goal.checkIns.length : (typeof goal.checkIns === 'number' ? goal.checkIns : 0);
    const doneDays = Object.values(occurrences).filter(status => status === 'done').length + manualCheckIns;

    // V15 contract: target is untrusted (an import can carry any
    // value, including a markup string). Coerce to a finite positive
    // number before display or arithmetic; never render the raw value.
    const targetNum = Number(goal.target);
    const target = Number.isFinite(targetNum) && targetNum > 0 ? targetNum : 1;
    const progress = Math.min(100, Math.round((doneDays / target) * 100));
    
    const todayStr = getLocalDateString(new Date());
    const streak = calculateStreak(occurrences, todayStr);
    
    // SVG Progress Ring (Lime on Black)
    // 2 * pi * r = 2 * Math.PI * 16 ~= 100.5
    const circumference = 100.5;
    const strokeDashoffset = circumference - (progress / 100) * circumference;
    
    const ringHtml = `
        <div class="goal-ring">
            <svg class="goal-ring-svg" width="40" height="40" viewBox="0 0 40 40">
                <circle cx="20" cy="20" r="16" fill="none" stroke="var(--border-color)" stroke-width="4"></circle>
                <circle class="goal-ring-progress" cx="20" cy="20" r="16" fill="none" stroke="var(--accent-color)" stroke-width="4" stroke-dasharray="${circumference}" stroke-dashoffset="${strokeDashoffset}"></circle>
            </svg>
            <div class="goal-ring-label">
                ${progress}%
            </div>
        </div>
    `;

    // History Timeline (last 7 days)
    let timelineHtml = '<div class="timeline">';
    for (let i = 6; i >= 0; i--) {
        const d = new Date(todayStr + 'T12:00:00Z');
        d.setUTCDate(d.getUTCDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        // Closed enum: an imported occurrence value is untrusted and
        // lands in a title attribute below; only known states pass.
        const rawStatus = occurrences[dateStr];
        const status = (rawStatus === 'done' || rawStatus === 'missed' || rawStatus === 'late') ? rawStatus : 'none';
        
        // Status color is a class toggle (CSP: no inline style strings).
        const statusClass = status === 'none' ? '' : ` is-${status}`;

        // Tooltip using title attribute for now
        const dayLabel = d.toLocaleDateString(undefined, { weekday: 'short' });
        timelineHtml += `
            <div class="timeline-day${statusClass}" data-date="${dateStr}" title="${dayLabel}: ${status}">
            </div>
        `;
    }
    timelineHtml += '</div>';

    // HTML Construction
    card.innerHTML = `
        <div class="card-header card-header-center">
            <div class="header-main">
                ${ringHtml}
                <div class="header-grow">
                    <div class="card-title">${escapeHtml(goal.title)}</div>
                    <div class="meta-text">${doneDays} / ${target} done</div>
                </div>
            </div>
            ${goal.status === 'archived' ? '<span class="badge badge-push">Archived</span>' : ''}
        </div>
        <div class="card-body">
            <div class="streak-row">
                <span class="streak-value">${streak > 0 ? streak + ' 🔥' : ''}</span>
            </div>
            ${timelineHtml}
            ${goal.showNotes && goal.notes ? `<div class="card-notes">${escapeHtml(goal.notes)}</div>` : ''}
        </div>
        <div class="card-footer card-footer-end">
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
    if (unsafe === null || unsafe === undefined) return '';
    return String(unsafe)
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}