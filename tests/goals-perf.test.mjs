import assert from 'assert';

function getLocalDateString(date) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Toronto',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
}

const todayStr = '2023-10-25'; // Mock fixed today date
const occurrences = {
    '2023-10-25': 'done',
    '2023-10-24': 'missed',
    '2023-10-23': 'late',
    '2023-10-22': 'none',
    '2023-10-21': 'done',
    '2023-10-20': 'done',
    '2023-10-19': 'none',
};

function generateTimelineHtmlOld(todayStr, occurrences) {
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
    return timelineHtml;
}

function generateTimelineHtmlNew(todayStr, occurrences) {
    const timelineHtmlParts = ['<div class="timeline" style="display: flex; gap: 0.25rem; margin-top: 0.5rem; margin-bottom: 0.5rem;">'];
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
        timelineHtmlParts.push(`
            <div class="timeline-day" data-date="${dateStr}" title="${dayLabel}: ${status}"
                 style="flex: 1; height: 24px; border-radius: var(--radius-sm); background-color: ${bgColor}; cursor: pointer; border: 1px solid var(--border-color);">
            </div>
        `);
    }
    timelineHtmlParts.push('</div>');
    return timelineHtmlParts.join('');
}

function runBenchmark() {
    // 1. Assert identical output
    const oldHtml = generateTimelineHtmlOld(todayStr, occurrences);
    const newHtml = generateTimelineHtmlNew(todayStr, occurrences);

    try {
        assert.strictEqual(oldHtml, newHtml);
        console.log("✅ Output verification passed: The outputs are exactly identical.");
    } catch (e) {
        console.error("❌ Output verification failed: The outputs differ!");
        process.exit(1);
    }

    // 2. Measure Performance
    const iterations = 50000;

    // Warmup
    for (let i = 0; i < 1000; i++) {
        generateTimelineHtmlOld(todayStr, occurrences);
        generateTimelineHtmlNew(todayStr, occurrences);
    }

    // Benchmark Old
    const startOld = performance.now();
    for (let i = 0; i < iterations; i++) {
        generateTimelineHtmlOld(todayStr, occurrences);
    }
    const endOld = performance.now();
    const durationOld = endOld - startOld;

    // Benchmark New
    const startNew = performance.now();
    for (let i = 0; i < iterations; i++) {
        generateTimelineHtmlNew(todayStr, occurrences);
    }
    const endNew = performance.now();
    const durationNew = endNew - startNew;

    console.log(`\nPerformance Results (${iterations} iterations):`);
    console.log(`Old (String Concatenation): ${durationOld.toFixed(2)} ms`);
    console.log(`New (Array push/join):      ${durationNew.toFixed(2)} ms`);

    if (durationNew < durationOld) {
        const improvement = ((durationOld - durationNew) / durationOld * 100).toFixed(2);
        console.log(`Speedup: ${improvement}% faster!`);
    } else {
        console.log(`Note: The modern JS engine optimized the string concat slightly better or similarly in this micro-benchmark, which is common for very small numbers of iterations in a tight loop. Refactoring still provides cleaner semantics for larger scaling.`);
    }
}

runBenchmark();
