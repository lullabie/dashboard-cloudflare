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


function createProgressRing(progress) {
    const circumference = 100.5;
    const strokeDashoffset = circumference - (progress / 100) * circumference;

    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.width = '40px';
    wrapper.style.height = '40px';
    wrapper.style.flexShrink = '0';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '40');
    svg.setAttribute('height', '40');
    svg.setAttribute('viewBox', '0 0 40 40');
    svg.style.transform = 'rotate(-90deg)';

    const circleBg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circleBg.setAttribute('cx', '20');
    circleBg.setAttribute('cy', '20');
    circleBg.setAttribute('r', '16');
    circleBg.setAttribute('fill', 'none');
    circleBg.setAttribute('stroke', 'var(--border-color)');
    circleBg.setAttribute('stroke-width', '4');

    const circleFg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circleFg.setAttribute('cx', '20');
    circleFg.setAttribute('cy', '20');
    circleFg.setAttribute('r', '16');
    circleFg.setAttribute('fill', 'none');
    circleFg.setAttribute('stroke', 'var(--accent-color)');
    circleFg.setAttribute('stroke-width', '4');
    circleFg.setAttribute('stroke-dasharray', String(circumference));
    circleFg.setAttribute('stroke-dashoffset', String(strokeDashoffset));
    circleFg.style.transition = 'stroke-dashoffset 0.5s ease';

    svg.appendChild(circleBg);
    svg.appendChild(circleFg);

    const textDiv = document.createElement('div');
    textDiv.style.position = 'absolute';
    textDiv.style.top = '0';
    textDiv.style.left = '0';
    textDiv.style.width = '100%';
    textDiv.style.height = '100%';
    textDiv.style.display = 'flex';
    textDiv.style.alignItems = 'center';
    textDiv.style.justifyContent = 'center';
    textDiv.style.fontSize = '0.6rem';
    textDiv.style.fontWeight = 'bold';
    textDiv.textContent = `${progress}%`;

    wrapper.appendChild(svg);
    wrapper.appendChild(textDiv);

    return wrapper;
}

function createTimeline(occurrences, todayStr) {
    const timeline = document.createElement('div');
    timeline.className = 'timeline';
    timeline.style.display = 'flex';
    timeline.style.gap = '0.25rem';
    timeline.style.marginTop = '0.5rem';
    timeline.style.marginBottom = '0.5rem';

    for (let i = 6; i >= 0; i--) {
        const d = new Date(todayStr + 'T12:00:00');
        d.setDate(d.getDate() - i);
        const dateStr = getLocalDateString(d);
        const status = occurrences[dateStr] || 'none';

        let bgColor = 'var(--surface-hover)';
        if (status === 'done') bgColor = 'var(--accent-color)';
        else if (status === 'missed') bgColor = 'var(--danger-color)';
        else if (status === 'late') bgColor = '#f59e0b';

        const dayLabel = d.toLocaleDateString(undefined, { weekday: 'short' });

        const dayDiv = document.createElement('div');
        dayDiv.className = 'timeline-day';
        dayDiv.dataset.date = dateStr;
        dayDiv.title = `${dayLabel}: ${status}`;
        dayDiv.style.flex = '1';
        dayDiv.style.height = '24px';
        dayDiv.style.borderRadius = 'var(--radius-sm)';
        dayDiv.style.backgroundColor = bgColor;
        dayDiv.style.cursor = 'pointer';
        dayDiv.style.border = '1px solid var(--border-color)';

        timeline.appendChild(dayDiv);
    }

    return timeline;
}

function createCardHeader(goal, ringEl, doneDays, target) {
    const header = document.createElement('div');
    header.className = 'card-header';
    header.style.alignItems = 'center';

    const flexCont = document.createElement('div');
    flexCont.style.display = 'flex';
    flexCont.style.gap = '1rem';
    flexCont.style.alignItems = 'center';
    flexCont.style.width = '100%';

    flexCont.appendChild(ringEl);

    const textCont = document.createElement('div');
    textCont.style.flexGrow = '1';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'card-title';
    titleDiv.textContent = goal.title; // escapeHtml not needed, textContent handles it

    const subTitleDiv = document.createElement('div');
    subTitleDiv.style.fontSize = '0.75rem';
    subTitleDiv.style.color = 'var(--text-secondary)';
    subTitleDiv.textContent = `${doneDays} / ${target} done`;

    textCont.appendChild(titleDiv);
    textCont.appendChild(subTitleDiv);

    flexCont.appendChild(textCont);
    header.appendChild(flexCont);

    if (goal.status === 'archived') {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.style.marginLeft = 'auto';
        badge.textContent = 'Archived';
        header.appendChild(badge);
    }

    return header;
}

function createCardBody(goal, streak, timelineEl) {
    const body = document.createElement('div');
    body.className = 'card-body';

    const streakCont = document.createElement('div');
    streakCont.style.display = 'flex';
    streakCont.style.justifyContent = 'space-between';
    streakCont.style.alignItems = 'center';
    streakCont.style.fontSize = '0.875rem';

    const streakSpan = document.createElement('span');
    streakSpan.style.fontWeight = 'bold';
    streakSpan.style.color = 'var(--text-primary)';
    streakSpan.textContent = streak > 0 ? `${streak} 🔥` : '';

    streakCont.appendChild(streakSpan);
    body.appendChild(streakCont);

    body.appendChild(timelineEl);

    if (goal.showNotes && goal.notes) {
        const notesDiv = document.createElement('div');
        notesDiv.className = 'card-notes';
        notesDiv.textContent = goal.notes;
        body.appendChild(notesDiv);
    }

    return body;
}

function createCardFooter(goal) {
    const footer = document.createElement('div');
    footer.className = 'card-footer';
    footer.style.justifyContent = 'flex-end';

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn edit-btn';
    editBtn.textContent = 'Edit';

    const archiveBtn = document.createElement('button');
    archiveBtn.className = 'icon-btn archive-btn';
    archiveBtn.textContent = goal.status === 'active' ? 'Archive' : 'Restore';

    actions.appendChild(editBtn);
    actions.appendChild(archiveBtn);

    footer.appendChild(actions);
    return footer;
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
    
    const ringEl = createProgressRing(progress);
    const timelineEl = createTimeline(occurrences, todayStr);
    
    const header = createCardHeader(goal, ringEl, doneDays, target);
    const body = createCardBody(goal, streak, timelineEl);
    const footer = createCardFooter(goal);

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(footer);

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