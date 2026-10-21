/**
 * Progress Summary Widget
 * Renders completion stats for goals and habits.
 */

function isValidDate(d) {
    return d instanceof Date && !isNaN(d.getTime());
}

export function renderProgressSummary(root, { goals = [], habits = [], asOf, timeZone = 'America/Toronto' }) {
    if (!root || !(root instanceof Element)) {
        throw new Error("Invalid root element provided to renderProgressSummary.");
    }
    
    // Strict roundtrip validation of asOf
    if (!isValidDate(asOf)) {
        throw new Error("Invalid asOf Date object.");
    }
    const isoStr = asOf.toISOString();
    const roundTrip = new Date(isoStr);
    if (isoStr !== roundTrip.toISOString()) {
        throw new Error("Date roundtrip validation failed.");
    }

    // Format date string for occurrence lookups (yyyy-mm-dd in given timezone)
    const asOfLocalStr = new Intl.DateTimeFormat('en-CA', { 
        timeZone: timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(asOf);

    // Deep copy data to prevent mutation
    const safeGoals = JSON.parse(JSON.stringify(goals));
    const safeHabits = JSON.parse(JSON.stringify(habits));

    // Calculate goals stats
    const activeGoals = safeGoals.filter(g => {
        if (g.createdAt && new Date(g.createdAt) > asOf) return false;
        let isActive = g.status === 'active' && !g.archived;
        if (g.history && Array.isArray(g.history)) {
            const pastEvents = g.history.filter(h => new Date(h.timestamp) <= asOf && h.type === 'STATUS_CHANGE');
            if (pastEvents.length > 0) {
                // Evaluate the most recent event up to the asOf date
                pastEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                isActive = pastEvents[0].to === 'active';
            } else if (g.history.some(h => new Date(h.timestamp) <= asOf && h.type === 'CREATE')) {
                isActive = true;
            } else if (g.history.some(h => new Date(h.timestamp) > asOf)) {
                isActive = true;
            }
        }
        return isActive;
    });
    let goalsTotal = activeGoals.length;
    let goalsDone = 0;
    
    activeGoals.forEach(g => {
        const occurrences = g.occurrences || {};
        if (occurrences[asOfLocalStr] === 'done') {
            goalsDone++;
        }
    });

    // Calculate habits stats (same logic as goals based on constraints)
    const activeHabits = safeHabits.filter(h => {
        if (h.createdAt && new Date(h.createdAt) > asOf) return false;
        let isActive = h.status === 'active' && !h.archived;
        if (h.history && Array.isArray(h.history)) {
            const pastEvents = h.history.filter(hist => new Date(hist.timestamp) <= asOf && hist.type === 'STATUS_CHANGE');
            if (pastEvents.length > 0) {
                pastEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                isActive = pastEvents[0].to === 'active';
            } else if (h.history.some(hist => new Date(hist.timestamp) <= asOf && hist.type === 'CREATE')) {
                isActive = true;
            } else if (h.history.some(hist => new Date(hist.timestamp) > asOf)) {
                isActive = true;
            }
        }
        return isActive;
    });
    let habitsTotal = activeHabits.length;
    let habitsDone = 0;

    activeHabits.forEach(h => {
        const occurrences = h.occurrences || {};
        const val = occurrences[asOfLocalStr];
        let isCompleted = false;
        
        if (val === 'done' || val === true) {
            isCompleted = true;
        } else if (val && typeof val === 'object' && val.completedAt) {
            const iso = val.completedAt;
            // Validate roundtrip
            const d = new Date(iso);
            if (!isNaN(d.getTime()) && d.toISOString() === iso) {
                isCompleted = true;
            }
        }
        
        if (isCompleted) {
            habitsDone++;
        }
    });

    // Render using vanilla JS DOM APIs to prevent XSS
    root.innerHTML = ''; // Clear previous content safely
    
    const container = document.createElement('div');
    container.className = 'progress-summary-container card';
    
    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = `Progress Summary for ${asOfLocalStr}`;
    
    const statsContainer = document.createElement('div');
    statsContainer.className = 'card-body';
    statsContainer.style.display = 'flex';
    statsContainer.style.flexDirection = 'column';
    statsContainer.style.gap = '0.5rem';

    // Goals Stat
    const goalsStat = document.createElement('div');
    goalsStat.style.display = 'flex';
    goalsStat.style.justifyContent = 'space-between';
    
    const goalsLabel = document.createElement('span');
    goalsLabel.textContent = 'Goals Completed:';
    
    const goalsValue = document.createElement('span');
    goalsValue.style.fontWeight = 'bold';
    goalsValue.style.color = 'var(--text-primary)';
    goalsValue.textContent = `${goalsDone} / ${goalsTotal}`;
    
    goalsStat.appendChild(goalsLabel);
    goalsStat.appendChild(goalsValue);

    // Habits Stat
    const habitsStat = document.createElement('div');
    habitsStat.style.display = 'flex';
    habitsStat.style.justifyContent = 'space-between';
    
    const habitsLabel = document.createElement('span');
    habitsLabel.textContent = 'Habits Completed:';
    
    const habitsValue = document.createElement('span');
    habitsValue.style.fontWeight = 'bold';
    habitsValue.style.color = 'var(--text-primary)';
    habitsValue.textContent = `${habitsDone} / ${habitsTotal}`;
    
    habitsStat.appendChild(habitsLabel);
    habitsStat.appendChild(habitsValue);

    statsContainer.appendChild(goalsStat);
    statsContainer.appendChild(habitsStat);
    
    container.appendChild(title);
    container.appendChild(statsContainer);
    
    root.appendChild(container);
}

export function destroyProgressSummary(root) {
    if (root && root instanceof Element) {
        root.innerHTML = ''; // This natively removes event listeners of children in most browsers when garbage collected
    }
}
