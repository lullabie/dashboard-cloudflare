const chartInstances = {};

function destroyChart(canvasId) {
    if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
        delete chartInstances[canvasId];
    }
}

const COMMON_OPTIONS = {
    animation: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : undefined,
    responsive: true,
    maintainAspectRatio: false,
    color: '#a3a3a3',
    plugins: {
        legend: { labels: { color: '#a3a3a3' } },
        title: { color: '#f5f5f5' }
    },
    scales: {
        x: { ticks: { color: '#a3a3a3' }, grid: { color: '#333' } },
        y: { ticks: { color: '#a3a3a3' }, grid: { color: '#333' } }
    }
};

const COMMON_OPTIONS_ZERO = {
    ...COMMON_OPTIONS,
    scales: {
        x: { ticks: { color: '#a3a3a3' }, grid: { color: '#333' } },
        y: { ticks: { color: '#a3a3a3' }, grid: { color: '#333' }, beginAtZero: true }
    }
};

export function renderJobsChart(canvasId, jobsData, onClickStage) {
    let canvas = document.getElementById(canvasId);
    let container;
    if (canvas) {
        container = canvas.parentElement;
        container.setAttribute('data-chart-host', canvasId);
    } else {
        container = document.querySelector(`[data-chart-host="${canvasId}"]`);
        if (!container) return;
    }
    
    // F-I1: Check for Chart.js availability
    if (typeof Chart === 'undefined') {
        destroyChart(canvasId);
        container.innerHTML = '<div class="empty-state">Chart library unavailable. Data available in tabular format.</div>';
        return;
    }
    
    if (!jobsData || jobsData.length === 0) {
        destroyChart(canvasId);
        container.innerHTML = '<div class="empty-state">No jobs found to display.</div>';
        return;
    } else {
        const hasCanvas = container.querySelector('canvas');
        if (!hasCanvas) {
            container.innerHTML = `<canvas id="${canvasId}"></canvas>`;
            canvas = document.getElementById(canvasId);
        }
    }

    const counts = { applied: 0, interview: 0, offer: 0, rejected: 0, other: 0 };
    (jobsData || []).forEach(job => {
        if (counts[job.status] !== undefined) counts[job.status]++;
        else counts.other++;
    });
    
    const labels = ['Applied', 'Interview', 'Offer', 'Rejected', 'Other'];
    const data = [counts.applied, counts.interview, counts.offer, counts.rejected, counts.other];
    const rawKeys = ['applied', 'interview', 'offer', 'rejected', 'other'];
    
    if (chartInstances[canvasId]) {
        chartInstances[canvasId].data.datasets[0].data = data;
        chartInstances[canvasId].update();
    } else {
        chartInstances[canvasId] = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Jobs by Status',
                    data: data,
                    backgroundColor: '#a3e635',
                    borderWidth: 0
                }]
            },
            options: {
                ...COMMON_OPTIONS_ZERO,
                indexAxis: 'y',
                plugins: {
                    ...COMMON_OPTIONS_ZERO.plugins,
                    title: { display: true, text: 'Current Status Distribution', color: '#f5f5f5' }
                },
                onClick: (e, elements) => {
                    if (elements && elements.length > 0 && onClickStage) {
                        const index = elements[0].index;
                        onClickStage(rawKeys[index]);
                    }
                }
            }
        });
    }
}

function getWeekString(dateString) {
    if (!dateString) return 'Unknown';
    const d = new Date(dateString + 'T12:00:00');
    if (isNaN(d.getTime())) return 'Unknown';
    
    const target = new Date(d.valueOf());
    const dayNr = (d.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
    const week = 1 + Math.ceil((firstThursday - target) / 604800000);
    return target.getFullYear() + '-W' + String(week).padStart(2, '0');
}

export function renderCollegeChart(canvasId, collegeData) {
    let canvas = document.getElementById(canvasId);
    let container;
    if (canvas) {
        container = canvas.parentElement;
        container.setAttribute('data-chart-host', canvasId);
    } else {
        container = document.querySelector(`[data-chart-host="${canvasId}"]`);
        if (!container) return;
    }
    
    // F-I1: Check for Chart.js availability
    if (typeof Chart === 'undefined') {
        destroyChart(canvasId);
        container.innerHTML = '<div class="empty-state">Chart library unavailable. Data available in tabular format.</div>';
        return;
    }
    
    const weekCounts = {};
    const processItems = (items) => {
        (items || []).forEach(item => {
            const week = getWeekString(item.date);
            if (!weekCounts[week]) weekCounts[week] = 0;
            weekCounts[week]++;
        });
    };
    
    if (collegeData) {
        processItems(collegeData.assignments);
        processItems(collegeData.exams);
    }
    
    if (Object.keys(weekCounts).length === 0) {
        destroyChart(canvasId);
        container.innerHTML = '<div class="empty-state">No upcoming academic work to chart.</div>';
        return;
    } else {
        const hasCanvas = container.querySelector('canvas');
        if (!hasCanvas) {
            container.innerHTML = `<canvas id="${canvasId}"></canvas>`;
            canvas = document.getElementById(canvasId);
        }
    }
    
    const sortedWeeks = Object.keys(weekCounts).sort();
    const data = sortedWeeks.map(w => weekCounts[w]);
    
    if (chartInstances[canvasId]) {
        chartInstances[canvasId].data.labels = sortedWeeks;
        chartInstances[canvasId].data.datasets[0].data = data;
        chartInstances[canvasId].update();
    } else {
        chartInstances[canvasId] = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: sortedWeeks,
                datasets: [{
                    label: 'Assignments & Exams Due',
                    data: data,
                    backgroundColor: '#a3e635',
                    borderWidth: 0
                }]
            },
            options: {
                ...COMMON_OPTIONS_ZERO,
                plugins: {
                    ...COMMON_OPTIONS_ZERO.plugins,
                    title: { display: true, text: 'Upcoming Academic Workload', color: '#f5f5f5' }
                }
            }
        });
    }
}

function parsePrice(val) {
    if (val === null || val === undefined || val === '') return null;
    const num = parseFloat(val);
    return isNaN(num) ? null : num;
}

export function renderInvestmentsChart(canvasId, investmentsData) {
    let canvas = document.getElementById(canvasId);
    let container;
    if (canvas) {
        container = canvas.parentElement;
        container.setAttribute('data-chart-host', canvasId);
    } else {
        container = document.querySelector(`[data-chart-host="${canvasId}"]`);
        if (!container) return;
    }
    
    // F-I1: Check for Chart.js availability
    if (typeof Chart === 'undefined') {
        destroyChart(canvasId);
        container.innerHTML = '<div class="empty-state">Chart library unavailable. Data available in tabular format.</div>';
        return;
    }
    
    if (!investmentsData || investmentsData.length === 0) {
        destroyChart(canvasId);
        container.innerHTML = '<div class="empty-state">No investments to chart.</div>';
        return;
    } else {
        const hasCanvas = container.querySelector('canvas');
        if (!hasCanvas) {
            container.innerHTML = `<canvas id="${canvasId}"></canvas>`;
            canvas = document.getElementById(canvasId);
        }
    }

    const labels = [];
    const entries = [];
    const currents = [];
    
    (investmentsData || []).forEach(inv => {
        labels.push(inv.ticker);
        entries.push(parsePrice(inv.entry));
        currents.push(parsePrice(inv.current));
    });
    
    if (chartInstances[canvasId]) {
        chartInstances[canvasId].data.labels = labels;
        chartInstances[canvasId].data.datasets[0].data = entries;
        chartInstances[canvasId].data.datasets[1].data = currents;
        chartInstances[canvasId].update();
    } else {
        chartInstances[canvasId] = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    { label: 'Entry Price', data: entries, backgroundColor: '#a3a3a3', borderWidth: 0 },
                    { label: 'Current Price', data: currents, backgroundColor: '#a3e635', borderWidth: 0 }
                ]
            },
            options: {
                ...COMMON_OPTIONS_ZERO,
                plugins: {
                    ...COMMON_OPTIONS_ZERO.plugins,
                    title: { display: true, text: 'Manual Watchlist Values', color: '#f5f5f5' }
                }
            }
        });
    }
}

export function renderIndicatorsChart(canvasId, historyData) {
    let canvas = document.getElementById(canvasId);
    let container;
    if (canvas) {
        container = canvas.parentElement;
        container.setAttribute('data-chart-host', canvasId);
    } else {
        container = document.querySelector(`[data-chart-host="${canvasId}"]`);
        if (!container) return;
    }
    
    // F-I1: Check for Chart.js availability
    if (typeof Chart === 'undefined') {
        destroyChart(canvasId);
        container.innerHTML = '<div class="empty-state">Chart library unavailable. Data available in tabular format.</div>';
        return;
    }
    
    const seriesIds = historyData ? Object.keys(historyData) : [];
    if (seriesIds.length === 0) {
        destroyChart(canvasId);
        container.innerHTML = '<div class="empty-state">No indicators to chart.</div>';
        return;
    } else {
        const hasCanvas = container.querySelector('canvas');
        if (!hasCanvas) {
            container.innerHTML = `<canvas id="${canvasId}"></canvas>`;
            canvas = document.getElementById(canvasId);
        }
    }
    
    const dateSet = new Set();
    seriesIds.forEach(id => {
        historyData[id].history.forEach(obs => dateSet.add(obs.date));
    });
    
    const sortedDates = Array.from(dateSet).sort();
    const hasTrend = sortedDates.length >= 2;

    const datasets = seriesIds.map((id, index) => {
        const seriesInfo = historyData[id];
        const dataPoints = sortedDates.map(d => {
            const found = seriesInfo.history.find(obs => obs.date === d);
            return found ? (isNaN(parseFloat(found.value)) ? null : parseFloat(found.value)) : null;
        });
        
        return {
            label: id === 'FXCADINR' ? 'CAD/INR' : (id === 'FXUSDCAD' ? 'USD/CAD' : id),
            data: dataPoints,
            borderColor: index === 0 ? '#a3e635' : '#3b82f6',
            backgroundColor: index === 0 ? '#a3e635' : '#3b82f6',
            tension: 0.1,
            spanGaps: true
        };
    });
    
    if (chartInstances[canvasId]) {
        chartInstances[canvasId].data.labels = sortedDates;
        chartInstances[canvasId].data.datasets = datasets;
        chartInstances[canvasId].options.plugins.subtitle.display = !hasTrend;
        chartInstances[canvasId].update();
    } else {
        chartInstances[canvasId] = new Chart(canvas, {
            type: 'line',
            data: {
                labels: sortedDates,
                datasets: datasets
            },
            options: {
                ...COMMON_OPTIONS,
                scales: {
                    x: { ticks: { color: '#a3a3a3' }, grid: { color: '#333' } },
                    y: { ticks: { color: '#a3a3a3' }, grid: { color: '#333' }, beginAtZero: false }
                },
                plugins: {
                    ...COMMON_OPTIONS.plugins,
                    title: { display: true, text: 'FX Trends', color: '#f5f5f5' },
                    subtitle: { display: !hasTrend, text: 'Trend needs more data', color: '#ef4444', font: { style: 'italic' } }
                }
            }
        });
    }
}