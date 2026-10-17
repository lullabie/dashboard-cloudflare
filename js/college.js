import { getData, saveData } from './store.js';
import { getTorontoMidnight } from './countdowns.js';

export function getCollegeData() {
    const data = getData();
    if (!data.college) {
        data.college = {
            timetable: [],
            assignments: [],
            exams: [],
            fees: []
        };
        saveData(data);
    }
    return data.college;
}

export function saveCollegeItem(type, item) {
    const data = getData();
    const collegeData = getCollegeData();
    
    if (item.id) {
        const index = collegeData[type].findIndex(i => i.id === item.id);
        if (index !== -1) {
            collegeData[type][index] = item;
        } else {
            collegeData[type].push(item);
        }
    } else {
        item.id = crypto.randomUUID();
        collegeData[type].push(item);
    }
    
    data.college = collegeData;
    saveData(data);
}

export function deleteCollegeItem(type, id) {
    const data = getData();
    const collegeData = getCollegeData();
    
    collegeData[type] = collegeData[type].filter(i => i.id !== id);
    data.college = collegeData;
    saveData(data);
}

export function createCollegeCard(item, type, onEdit, onDelete) {
    const daysLeft = getTorontoMidnight(item.date);
    let progressPercent = 0;
    
    let statusText = `${daysLeft} days left`;
    let colorClass = 'lime';
    
    if (daysLeft < 0) {
        progressPercent = 100;
        statusText = `${Math.abs(daysLeft)} days overdue`;
        colorClass = 'danger';
    } else if (daysLeft === 0) {
        progressPercent = 100;
        statusText = 'Due Today';
    } else {
        // Visual window of 90 days matching countdowns.js
        progressPercent = Math.max(0, Math.min(100, 100 - (daysLeft / 90) * 100));
    }

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
        <div class="card-header">
            <div class="card-title">${item.title}</div>
            <div class="card-actions">
                <button class="icon-btn edit-btn">\u270E</button>
                <button class="icon-btn delete-btn">\u00D7</button>
            </div>
        </div>
        <div class="card-body">
            <div style="margin-bottom: 0.5rem;">
                <strong>Date:</strong> ${item.date}
                <span class="badge ${colorClass}" style="margin-left: 0.5rem;">${statusText}</span>
            </div>
            <div class="progress-bar-container">
                <div class="progress-bar" style="width: ${progressPercent}%; background-color: ${daysLeft < 0 ? 'var(--danger-color)' : 'var(--accent-color)'}"></div>
            </div>
            ${item.notes ? `<div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.5rem;">${item.notes}</div>` : ''}
        </div>
    `;

    card.querySelector('.edit-btn').addEventListener('click', () => onEdit(item, type));
    card.querySelector('.delete-btn').addEventListener('click', () => {
        if(confirm('Are you sure you want to delete this item?')) {
            onDelete(type, item.id);
        }
    });

    return card;
}