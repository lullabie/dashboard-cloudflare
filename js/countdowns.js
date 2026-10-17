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

function getTorontoMidnight(isoDateString) {
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
    card.innerHTML = `
        <div class="card-header">
            <div class="card-title">${deadline.title}</div>
            <span class="badge ${colorClass}">${statusText}</span>
        </div>
        <div class="card-body">
            <div class="countdown-label">
                <span>Due: ${deadline.date}</span>
                <span>Zone: ${TIMEZONE}</span>
            </div>
            <div class="progress-bar-container">
                <div class="progress-bar" style="width: ${progressPercent}%; background-color: ${daysLeft < 0 ? 'var(--danger-color)' : 'var(--accent-color)'}"></div>
            </div>
        </div>
    `;
    
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