/**
 * Jobs Data and UI Helpers
 */
import { getData, saveData } from './store.js';

export function getJobs() {
    const data = getData();
    if (!data.jobs) {
        data.jobs = [];
        saveData(data);
    }
    return data.jobs;
}

export function saveJob(jobData) {
    const data = getData();
    if (!data.jobs) data.jobs = [];
    if (jobData.id) {
        const index = data.jobs.findIndex(j => j.id === jobData.id);
        if (index !== -1) {
            data.jobs[index] = { ...data.jobs[index], ...jobData };
        }
    } else {
        jobData.id = 'job_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        data.jobs.push(jobData);
    }
    saveData(data);
}

export function deleteJob(jobId) {
    const data = getData();
    if (!data.jobs) return;
    data.jobs = data.jobs.filter(j => j.id !== jobId);
    saveData(data);
}

export function createJobCard(job, onEdit, onDelete) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.position = 'relative';
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'flex-start';
    const titleContainer = document.createElement('div');
    const companyEl = document.createElement('h3');
    companyEl.textContent = job.company;
    companyEl.style.marginBottom = '0.25rem';
    const roleEl = document.createElement('div');
    roleEl.textContent = job.role;
    roleEl.style.color = 'var(--text-secondary)';
    roleEl.style.fontSize = '0.875rem';
    roleEl.style.marginBottom = '0.5rem';
    titleContainer.appendChild(companyEl);
    titleContainer.appendChild(roleEl);
    const statusBadge = document.createElement('span');
    statusBadge.textContent = job.status.charAt(0).toUpperCase() + job.status.slice(1);
    statusBadge.style.fontSize = '0.75rem';
    statusBadge.style.padding = '0.125rem 0.375rem';
    statusBadge.style.borderRadius = 'var(--radius-sm)';
    statusBadge.style.backgroundColor = 'var(--surface-hover)';
    statusBadge.style.border = '1px solid var(--border-color)';
    statusBadge.style.marginLeft = '0.5rem';
    if (job.status === 'applied') { statusBadge.style.borderColor = '#3b82f6'; statusBadge.style.color = '#93c5fd'; }
    else if (job.status === 'interview') { statusBadge.style.borderColor = '#eab308'; statusBadge.style.color = '#fde047'; }
    else if (job.status === 'offer') { statusBadge.style.borderColor = 'var(--accent-color)'; statusBadge.style.color = 'var(--accent-hover)'; }
    else if (job.status === 'rejected') { statusBadge.style.borderColor = 'var(--danger-color)'; statusBadge.style.color = '#fca5a5'; }
    titleContainer.appendChild(statusBadge);
    header.appendChild(titleContainer);
    const actionsEl = document.createElement('div');
    actionsEl.style.display = 'flex';
    actionsEl.style.gap = '0.5rem';
    const btnEdit = document.createElement('button');
    btnEdit.textContent = 'Edit';
    btnEdit.className = 'secondary-btn';
    btnEdit.style.padding = '0.25rem 0.5rem';
    btnEdit.style.fontSize = '0.75rem';
    btnEdit.addEventListener('click', () => onEdit(job));
    const btnDelete = document.createElement('button');
    btnDelete.textContent = 'Del';
    btnDelete.className = 'secondary-btn';
    btnDelete.style.padding = '0.25rem 0.5rem';
    btnDelete.style.fontSize = '0.75rem';
    btnDelete.style.color = 'var(--danger-color)';
    btnDelete.addEventListener('click', () => { if(confirm('Delete job application at ' + job.company + '?')) { onDelete(job.id); } });
    actionsEl.appendChild(btnEdit);
    actionsEl.appendChild(btnDelete);
    header.appendChild(actionsEl);
    card.appendChild(header);
    const detailsEl = document.createElement('div');
    detailsEl.style.display = 'grid';
    detailsEl.style.gridTemplateColumns = '1fr 1fr';
    detailsEl.style.gap = '0.5rem';
    detailsEl.style.fontSize = '0.875rem';
    detailsEl.style.marginTop = '0.5rem';
    detailsEl.style.paddingTop = '0.5rem';
    detailsEl.style.borderTop = '1px solid var(--border-color)';
    const locationEl = document.createElement('div');
    let formattedLocation = job.location;
    if (job.location === 'remote-canada') formattedLocation = 'Remote Canada';
    else if (job.location === 'toronto') formattedLocation = 'Toronto';
    else if (job.location === 'vancouver') formattedLocation = 'Vancouver';
    else formattedLocation = 'Other';
    locationEl.textContent = '📍 ' + formattedLocation;
    const dateEl = document.createElement('div');
    dateEl.textContent = '📅 ' + job.date;
    dateEl.style.textAlign = 'right';
    detailsEl.appendChild(locationEl);
    detailsEl.appendChild(dateEl);
    card.appendChild(detailsEl);
    if (job.notes) {
        const notesEl = document.createElement('div');
        notesEl.textContent = job.notes;
        notesEl.style.marginTop = '0.5rem';
        notesEl.style.fontSize = '0.875rem';
        notesEl.style.color = 'var(--text-secondary)';
        notesEl.style.fontStyle = 'italic';
        card.appendChild(notesEl);
    }
    return card;
}
