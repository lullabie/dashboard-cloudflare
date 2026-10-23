/**
 * Countdowns Component
 * Handles timezone pinning (America/Toronto) and rendering of countdown tiles.
 */

// Pinned timezone for deadlines
const TIMEZONE = 'America/Toronto';

const DEADLINES = [
    { id: 'fee-balance', title: 'Fee Balance Due', date: '2026-11-25' },
    { id: 'visa-upload', title: 'Visa-Document Upload Due', date: '2026-12-15' },
    { id: 'centennial-intake', title: 'Centennial Intake', date: '2027-01-11' }
];

// Fixed arbitrary start dates relative to deadlines just for visual progress bar.
// We'll assume a 90-day window for visual progress representation.
const VISUAL_WINDOW_DAYS = 90; 

export function getTorontoMidnight(isoDateString) {
    // We treat the deadline as midnight (start of day) in Toronto.
    // However, for countdowns, it often means end-of-day. Let's assume end-of-day 23:59:59.
    // A simpler approach for "days left" is to compute both in the same timezone.
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    
    // We can't directly parse '2026-11-25' as Toronto time in JS easily without a library,
    // but we can construct the UTC equivalent of Toronto midnight.
    // An easy approximation for "days left" is to calculate based on local system time 
    // and just use the date string, but the prompt says "store each deadline as date + explicit IANA zone (America/Toronto) and render days-left against that zone".
    
    // To calculate days left precisely according to Toronto timezone:
    // 1. Get current time
    const now = new Date();
    // 2. Format current time in Toronto to get "today's date" in Toronto
    const parts = formatter.formatToParts(now);
    const torontoDate = {};
    parts.forEach(p => { torontoDate[p.type] = p.value; });
    const todayTorontoStr = `${torontoDate.year}-${torontoDate.month}-${torontoDate.day}`;
    
    // 3. Simple diff between YYYY-MM-DD strings using UTC noon to avoid DST issues
    const todayUTC = new Date(`${todayTorontoStr}T12:00:00Z`);
    const deadlineUTC = new Date(`${isoDateString}T12:00:00Z`);
    
    const diffTime = deadlineUTC - todayUTC;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays;
}

function createCountdownTile(deadline) {
    const daysLeft = getTorontoMidnight(deadline.date);
    let progressPercent = 0;
    
    let statusText = `${daysLeft} days left`;
    let colorClass = 'lime'; // using our badge color theme roughly
    
    if (daysLeft < 0) {
        progressPercent = 100;
        statusText = `${Math.abs(daysLeft)} days overdue`;
        colorClass = 'danger'; // need to handle this in CSS if we want
    } else if (daysLeft === 0) {
        progressPercent = 100;
        statusText = 'Due Today';
    } else {
        // Calculate progress based on visual window
        progressPercent = Math.max(0, Math.min(100, 100 - (daysLeft / VISUAL_WINDOW_DAYS) * 100));
    }
    
    const card = document.createElement('div');
    card.className = 'card';

    const header = document.createElement('div');
    header.className = 'card-header';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'card-title';
    titleDiv.textContent = deadline.title;

    const badgeSpan = document.createElement('span');
    badgeSpan.className = `badge ${colorClass}`;
    badgeSpan.textContent = statusText;

    header.appendChild(titleDiv);
    header.appendChild(badgeSpan);

    const body = document.createElement('div');
    body.className = 'card-body';

    const labelDiv = document.createElement('div');
    labelDiv.className = 'countdown-label';

    const dueSpan = document.createElement('span');
    dueSpan.textContent = `Due: ${deadline.date}`;

    const zoneSpan = document.createElement('span');
    zoneSpan.textContent = `Zone: ${TIMEZONE}`;

    labelDiv.appendChild(dueSpan);
    labelDiv.appendChild(zoneSpan);

    const progressContainer = document.createElement('div');
    progressContainer.className = 'progress-bar-container';

    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    progressBar.style.width = `${progressPercent}%`;
    progressBar.style.backgroundColor = daysLeft < 0 ? 'var(--danger-color)' : 'var(--accent-color)';

    progressContainer.appendChild(progressBar);

    body.appendChild(labelDiv);
    body.appendChild(progressContainer);

    card.appendChild(header);
    card.appendChild(body);
    
    return card;
}

export function renderCountdowns(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '';
    DEADLINES.forEach(deadline => {
        container.appendChild(createCountdownTile(deadline));
    });
}

function createRadarRow(deadline) {
    const daysLeft = getTorontoMidnight(deadline.date);
    
    let statusText = `${daysLeft} days`;
    let colorClass = 'lime';
    let isOverdue = false;
    
    if (daysLeft < 0) {
        statusText = 'overdue';
        colorClass = 'danger';
        isOverdue = true;
    } else if (daysLeft === 0) {
        statusText = 'Due Today';
        colorClass = 'danger';
    } else if (daysLeft < 7) {
        colorClass = 'danger'; // red < 7 days
    } else if (daysLeft < 30) {
        colorClass = 'amber'; // amber < 30 days
    }
    
    const row = document.createElement('div');
    row.className = 'radar-row card';
    // Style radar rows to be more compact
    row.style.flexDirection = 'row';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';
    
    row.innerHTML = `
        <div style="display: flex; flex-direction: column;">
            <span style="font-weight: 600;">${deadline.title}</span>
            <span style="font-size: 0.75rem; color: var(--text-secondary);">Due: ${deadline.date}</span>
        </div>
        <span class="badge ${colorClass}">${statusText}</span>
    `;
    
    return { element: row, daysLeft: daysLeft, isOverdue: isOverdue };
}

export function renderRadar(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '';
    
    const radarItems = DEADLINES.map(createRadarRow);
    
    // Sort by urgency. Overdue items pinned to top.
    radarItems.sort((a, b) => {
        if (a.isOverdue && !b.isOverdue) return -1;
        if (!a.isOverdue && b.isOverdue) return 1;
        // if both or neither are overdue, sort by days left ascending
        return a.daysLeft - b.daysLeft;
    });
    
    radarItems.forEach(item => {
        container.appendChild(item.element);
    });
}