import { getData, saveData } from './store.js';
import { getTorontoMidnight } from './countdowns.js';

export function getCollegeData() {
    const data = getData();
    return data.college || { timetable: [], assignments: [], exams: [], fees: [] };
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
    return saveData(data);
}

export function deleteCollegeItem(type, id) {
    const data = getData();
    const collegeData = getCollegeData();
    
    collegeData[type] = collegeData[type].filter(i => i.id !== id);
    data.college = collegeData;
    return saveData(data);
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
        
    const header = document.createElement('div');
    header.className = 'card-header';
    
    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = item.title;
    
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    
    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn edit-btn';
    editBtn.textContent = '\u270E';
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'icon-btn delete-btn';
    deleteBtn.textContent = '\u00D7';
    
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    header.appendChild(title);
    header.appendChild(actions);
    
    const body = document.createElement('div');
    body.className = 'card-body';
    
    const dateDiv = document.createElement('div');
    dateDiv.style.marginBottom = '0.5rem';
    
    const strongDate = document.createElement('strong');
    strongDate.textContent = 'Date: ';
    dateDiv.appendChild(strongDate);
    
    const dateText = document.createTextNode(item.date + ' ');
    dateDiv.appendChild(dateText);
    
    const statusSpan = document.createElement('span');
    statusSpan.className = 'badge ' + colorClass;
    statusSpan.style.marginLeft = '0.5rem';
    statusSpan.textContent = statusText;
    dateDiv.appendChild(statusSpan);
    
    body.appendChild(dateDiv);
    
    const progressContainer = document.createElement('div');
    progressContainer.className = 'progress-bar-container';
    
    const progressFill = document.createElement('div');
    progressFill.className = 'progress-bar';
    progressFill.style.width = progressPercent + '%';
    progressFill.style.backgroundColor = daysLeft < 0 ? 'var(--danger-color)' : 'var(--accent-color)';
    progressContainer.appendChild(progressFill);
    
    body.appendChild(progressContainer);
    
    if (item.notes) {
        const notesDiv = document.createElement('div');
        notesDiv.style.fontSize = '0.85rem';
        notesDiv.style.color = 'var(--text-secondary)';
        notesDiv.style.marginTop = '0.5rem';
        notesDiv.textContent = item.notes;
        body.appendChild(notesDiv);
    }
    
    card.appendChild(header);
    card.appendChild(body);

    editBtn.addEventListener('click', () => onEdit(item, type));
    card.querySelector('.delete-btn').addEventListener('click', () => {
        if(confirm('Are you sure you want to delete this item?')) {
            onDelete(type, item.id);
        }
    });

    return card;
}