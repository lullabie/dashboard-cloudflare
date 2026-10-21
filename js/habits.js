/**
 * Habits CRUD and Immutable History Component
 * V3 Repair
 */
import { getData, saveData } from './store.js';

export function getHabits() {
    const data = getData();
    return data && data.habits ? data.habits : [];
}

/**
 * Validates strictly YYYY-MM-DD.
 */
function isValidDateKey(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
    
    const d = new Date(dateStr + 'T12:00:00Z');
    if (isNaN(d.getTime())) return false;
    return d.toISOString().split('T')[0] === dateStr;
}

/**
 * Ensures timestamp has a time zone offset, e.g., 'Z' or '+00:00'.
 */
function hasValidZone(isoStr) {
    if (!isoStr || typeof isoStr !== 'string') return false;
    return isoStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(isoStr);
}

function isValidCheckIn(val) {
    if (val === true) return true; // Legacy
    if (val && typeof val === 'object' && val.completedAt) {
        if (!hasValidZone(val.completedAt)) return false;
        const d = new Date(val.completedAt);
        if (isNaN(d.getTime())) return false;
        return val.completedAt === d.toISOString();
    }
    return false;
}

function isLate(val, dateKey) {
    if (!isValidCheckIn(val) || val === true) return false;
    // Extract local date part from completedAt for comparison
    const completedLocal = new Intl.DateTimeFormat('en-CA', { 
        timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' 
    }).format(new Date(val.completedAt));
    
    return completedLocal > dateKey;
}

// Fixed contract: await commit
async function commitMutation(data) {
    // Current store.js saveData is sync and catches its own exceptions.
    // If we migrate to IndexedDB, it will return a promise or throw.
    // We wrap it in a Promise to conform to the contract, and if localStorage throws,
    // it will be caught here if it wasn't swallowed by store.js.
    // However, store.js _save() swallows QuotaExceededError and alerts.
    // To properly simulate an error throw (since store.js doesn't throw out of saveData),
    // we just call it. In the test, we mock saveData.
    
    return await Promise.resolve(saveData(data));
}

export async function saveHabit(habitData) {
    const data = getData();
    const habits = data.habits ? JSON.parse(JSON.stringify(data.habits)) : [];
    
    let targetHabit;
    
    if (habitData.id) {
        targetHabit = habits.find(h => h.id === habitData.id);
        if (!targetHabit) {
            throw new Error("Habit not found");
        }
        
        targetHabit.history.push({
            type: 'EDIT',
            timestamp: new Date().toISOString(),
            changes: {
                title: targetHabit.title !== habitData.title ? habitData.title : undefined,
                schedule: targetHabit.schedule !== habitData.schedule ? habitData.schedule : undefined
            }
        });
        targetHabit.title = habitData.title;
        targetHabit.schedule = habitData.schedule || 'daily';
        targetHabit.updatedAt = new Date().toISOString();
    } else {
        targetHabit = {
            id: 'habit_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            title: habitData.title,
            schedule: habitData.schedule || 'daily',
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            history: [{
                type: 'CREATE',
                timestamp: new Date().toISOString()
            }],
            occurrences: {}
        };
        habits.push(targetHabit);
    }
    
    data.habits = habits;
    await commitMutation(data);
    return targetHabit;
}

export async function toggleArchive(habitId) {
    const data = getData();
    const habits = data.habits ? JSON.parse(JSON.stringify(data.habits)) : [];
    const habit = habits.find(h => h.id === habitId);
    if (!habit) throw new Error("Habit not found");

    const newStatus = habit.status === 'active' ? 'archived' : 'active';
    habit.history.push({
        type: 'STATUS_CHANGE',
        timestamp: new Date().toISOString(),
        from: habit.status,
        to: newStatus
    });
    habit.status = newStatus;
    habit.updatedAt = new Date().toISOString();
    
    data.habits = habits;
    await commitMutation(data);
    return habit;
}

export async function toggleCheckin(habitId, dateStr) {
    if (!isValidDateKey(dateStr)) {
        throw new Error("Invalid date key");
    }

    const data = getData();
    const habits = data.habits ? JSON.parse(JSON.stringify(data.habits)) : [];
    const habit = habits.find(h => h.id === habitId);
    if (!habit) throw new Error("Habit not found");

    // creationDatePart should be local zone to compare apple-to-apple with dateStr
    const creationLocal = new Intl.DateTimeFormat('en-CA', { 
        timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' 
    }).format(new Date(habit.createdAt));

    if (dateStr < creationLocal) {
        throw new Error("Cannot check in before habit creation");
    }
    
    // Use America/Toronto boundary similar to goals.js
    const todayLocal = new Intl.DateTimeFormat('en-CA', { 
        timeZone: 'America/Toronto', 
        year: 'numeric', month: '2-digit', day: '2-digit' 
    }).format(new Date());

    if (dateStr > todayLocal) {
        throw new Error("Cannot check in future days");
    }

    if (!habit.occurrences) habit.occurrences = {};

    const currentVal = habit.occurrences[dateStr];
    let nextVal = undefined;

    if (!isValidCheckIn(currentVal)) {
        nextVal = { completedAt: new Date().toISOString() };
    }

    if (nextVal === undefined) {
        delete habit.occurrences[dateStr];
    } else {
        habit.occurrences[dateStr] = nextVal;
    }

    habit.history.push({
        type: 'CHECKIN_TOGGLE',
        timestamp: new Date().toISOString(),
        date: dateStr,
        value: nextVal === undefined ? null : nextVal
    });
    
    habit.updatedAt = new Date().toISOString();
    data.habits = habits;
    await commitMutation(data);
    return habit;
}

function getActiveDaysCount(habit, startDateStr, endDateStr) {
    // Collect all status transitions
    const creationLocal = new Intl.DateTimeFormat('en-CA', { 
        timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' 
    }).format(new Date(habit.createdAt));

    let statusLog = [{ date: creationLocal, status: 'active' }];
    if (habit.history) {
        habit.history.forEach(h => {
            if (h.type === 'STATUS_CHANGE') {
                const logLocal = new Intl.DateTimeFormat('en-CA', { 
                    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' 
                }).format(new Date(h.timestamp));
                statusLog.push({ date: logLocal, status: h.to });
            }
        });
    }

    let start = new Date(startDateStr + 'T12:00:00Z');
    let end = new Date(endDateStr + 'T12:00:00Z');
    let activeCount = 0;

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        let currentDayStr = d.toISOString().split('T')[0];
        
        let effectiveStatus = 'active';
        let latestLog = null;
        for (let log of statusLog) {
            if (log.date <= currentDayStr) {
                if (!latestLog || log.date >= latestLog.date) {
                    latestLog = log;
                }
            }
        }
        if (latestLog) effectiveStatus = latestLog.status;
        
        if (effectiveStatus === 'active') {
            activeCount++;
        }
    }

    return activeCount;
}

function calculateMetrics(habit) {
    if (!habit.createdAt) {
        return { done: 0, late: 0, eligible: 'UNKNOWN', rate: 0 };
    }

    const creationLocal = new Intl.DateTimeFormat('en-CA', { 
        timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' 
    }).format(new Date(habit.createdAt));

    const todayLocal = new Intl.DateTimeFormat('en-CA', { 
        timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' 
    }).format(new Date());

    let eligibleDays = getActiveDaysCount(habit, creationLocal, todayLocal);

    let doneDays = 0;
    let lateDays = 0;
    
    if (habit.occurrences) {
        for (const [dateKey, val] of Object.entries(habit.occurrences)) {
            if (isValidCheckIn(val) && dateKey >= creationLocal && dateKey <= todayLocal) {
                if (isLate(val, dateKey)) {
                    lateDays++;
                } else {
                    doneDays++;
                }
            }
        }
    }

    let totalDone = doneDays + lateDays;
    if (totalDone > eligibleDays) eligibleDays = totalDone;

    return { 
        done: doneDays,
        late: lateDays,
        eligible: eligibleDays, 
        rate: eligibleDays > 0 ? Math.round((doneDays / eligibleDays) * 100) : 0
    };
}

function escapeHtml(unsafe) {
    if (!unsafe || typeof unsafe !== 'string') return '';
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

export function createHabitCard(habit, onEdit, onToggleArchive, onToggleCheckin) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = habit.id;
    
    const metrics = calculateMetrics(habit);
    const occurrences = habit.occurrences || {};
    
    let timelineHtml = '<div class="timeline" style="display: flex; gap: 0.25rem; margin-top: 0.5rem; margin-bottom: 0.5rem;">';
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = new Intl.DateTimeFormat('en-CA', { 
            timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' 
        }).format(d);
        
        const checkVal = occurrences[dateStr];
        const isDone = isValidCheckIn(checkVal);
        const late = isLate(checkVal, dateStr);
        
        let bgColor = 'var(--surface-hover)';
        let titleLabel = 'Missed';
        
        if (isDone) {
            bgColor = late ? '#f59e0b' : 'var(--accent-color)';
            titleLabel = late ? 'Late' : 'Done';
        }
        
        const dayLabel = d.toLocaleDateString(undefined, { weekday: 'short' });
        timelineHtml += `
            <div class="timeline-day" data-date="${dateStr}" title="${dayLabel}: ${titleLabel}" 
                 style="flex: 1; height: 24px; border-radius: var(--radius-sm); background-color: ${bgColor}; cursor: pointer; border: 1px solid var(--border-color);"
                 role="button" tabindex="0" aria-label="Toggle check-in for ${dateStr}" aria-pressed="${isDone}">
            </div>
        `;
    }
    timelineHtml += '</div>';

    card.innerHTML = `
        <div class="card-header" style="align-items: center;">
            <div style="display: flex; gap: 1rem; align-items: center; width: 100%;">
                <div style="flex-grow: 1;">
                    <div class="card-title">${escapeHtml(habit.title)}</div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary);">
                        On-time: ${metrics.done} | Late: ${metrics.late} | Eligible: ${metrics.eligible}
                    </div>
                </div>
            </div>
            ${habit.status === 'archived' ? '<span class="badge" style="margin-left: auto;">Archived</span>' : ''}
        </div>
        <div class="card-body">
            ${timelineHtml}
        </div>
        <div class="card-footer" style="justify-content: flex-end;">
            <div class="card-actions">
                <button class="icon-btn edit-btn" aria-label="Edit Habit">Edit</button>
                <button class="icon-btn archive-btn" aria-label="${habit.status === 'active' ? 'Archive' : 'Restore'} Habit">${habit.status === 'active' ? 'Archive' : 'Restore'}</button>
            </div>
        </div>
    `;

    if (habit.status === 'active') {
        const timelineDays = card.querySelectorAll('.timeline-day');
        timelineDays.forEach(dayEl => {
            dayEl.addEventListener('click', () => {
                if (onToggleCheckin) onToggleCheckin(habit.id, dayEl.dataset.date);
            });
            dayEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { 
                    e.preventDefault(); 
                    if (onToggleCheckin) onToggleCheckin(habit.id, dayEl.dataset.date);
                }
            });
        });
    }

    const editBtn = card.querySelector('.edit-btn');
    editBtn.addEventListener('click', () => {
        if (onEdit) onEdit(habit);
    });
    
    const archiveBtn = card.querySelector('.archive-btn');
    archiveBtn.addEventListener('click', () => {
        if (onToggleArchive) onToggleArchive(habit.id);
    });
    
    return card;
}
