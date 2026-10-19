const STATE = new WeakMap();

function createEl(tag, className, textContent) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (textContent) el.textContent = textContent;
  return el;
}

function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (e) {
    return false;
  }
}

export function renderDeadlineTimeline(root, { items = [], asOf = new Date(), timeZone = 'UTC' } = {}) {
  if (!root) return;

  destroyDeadlineTimeline(root);

  let validAsOf = asOf != null ? new Date(asOf) : new Date();
  if (isNaN(validAsOf.getTime())) {
    validAsOf = new Date();
  }

  const validTimeZone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  
  const validItemsArray = Array.isArray(items) ? items : [];

  const state = {
    filter: 'all', // all, overdue, upcoming
    expandedIds: new Set(),
    // Deep copy to prevent mutating caller items
    items: validItemsArray.map(item => ({ ...item })),
    asOf: validAsOf,
    timeZone: validTimeZone,
    rootListeners: [],
    rowListeners: []
  };

  STATE.set(root, state);

  // Normalize dates and determine overdue/upcoming
  const validItems = [];
  state.items.forEach(item => {
    if (!item || typeof item.due !== 'string') return;
    
    // If it's date only (length 10 e.g., YYYY-MM-DD), parse it in the local timezone (effectively start of day in that tz)
    // or we can treat it as UTC midnight. Let's just create a Date object and check if it's past `asOf`.
    let itemDate;
    const isDateOnly = item.due.length === 10;
    
    if (isDateOnly) {
      // Parse as midnight in the target timezone. To do this without complex libraries, 
      // we can construct an ISO string that assumes the local time of the timezone, 
      // but standard Date doesn't easily let us parse "YYYY-MM-DD" into a specific timezone natively.
      // Easiest vanilla way for date-only is to compare YYYY-MM-DD string with `asOf` formatted in target timezone.
      const asOfStr = state.asOf.toLocaleDateString('en-CA', { timeZone: state.timeZone }); // YYYY-MM-DD
      
      // Let's create a rough date for sorting
      // YYYY-MM-DD as UTC so it sorts consistently
      itemDate = new Date(`${item.due}T00:00:00Z`);
      
      if (isNaN(itemDate.getTime())) return; // reject invalid dates

      // Ensure the exact original YYYY-MM-DD string isn't an impossible date parsed weirdly (e.g. 2026-13-45)
      if (itemDate.toISOString().slice(0, 10) !== item.due) return;
      
      item.isOverdue = item.due < asOfStr;
      
      // Date-only deadlines must maintain their calendar date regardless of the target timeZone.
      // We parse as UTC and format with timeZone: 'UTC' to guarantee the calendar date is preserved exactly.
      item.displayDate = new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'
      }).format(itemDate);
      item.displayTime = '';
    } else {
      itemDate = new Date(item.due);
      if (isNaN(itemDate.getTime())) return; // reject invalid dates
      
      // Ensure full ISO timestamps aren't impossible dates rolled over (e.g. 2026-02-30T12:00:00Z -> Mar 2)
      // Extract the YYYY-MM-DD from the input string if it looks like an ISO date
      const match = item.due.match(/^(\d{4}-\d{2}-\d{2})T/);
      if (match) {
         // Create a pure UTC midnight date from just the calendar portion to verify calendar validity
         // independently of the time/timezone offset.
         const calendarOnlyDate = new Date(`${match[1]}T00:00:00Z`);
         if (isNaN(calendarOnlyDate.getTime()) || calendarOnlyDate.toISOString().slice(0, 10) !== match[1]) return;
      }

      item.isOverdue = itemDate < state.asOf;
      
      item.displayDate = new Intl.DateTimeFormat('en-US', {
        timeZone: state.timeZone, month: 'short', day: 'numeric', year: 'numeric'
      }).format(itemDate);
      item.displayTime = new Intl.DateTimeFormat('en-US', {
        timeZone: state.timeZone, hour: 'numeric', minute: '2-digit'
      }).format(itemDate);
    }
    item.parsedDate = itemDate;
    validItems.push(item);
  });

  state.items = validItems;
  state.items.sort((a, b) => a.parsedDate - b.parsedDate);

  const container = createEl('div', 'deadline-timeline');
  
  const header = createEl('div', 'timeline-header');
  
  const filterLabel = createEl('label', 'timeline-filter-label', 'Filter:');
  const filterId = 'timeline-filter-select-' + Math.random().toString(36).substr(2, 9);
  filterLabel.setAttribute('for', filterId);
  
  const filterSelect = createEl('select', 'timeline-filter');
  filterSelect.id = filterId;
  
  ['all', 'overdue', 'upcoming'].forEach(val => {
    const opt = createEl('option', '', val.charAt(0).toUpperCase() + val.slice(1));
    opt.value = val;
    filterSelect.appendChild(opt);
  });
  
  const onFilterChange = (e) => {
    state.filter = e.target.value;
    updateList(root, listContainer, state);
  };
  filterSelect.addEventListener('change', onFilterChange);
  state.rootListeners.push({ el: filterSelect, type: 'change', fn: onFilterChange });

  header.appendChild(filterLabel);
  header.appendChild(filterSelect);
  container.appendChild(header);

  const listContainer = createEl('div', 'timeline-list-container');
  container.appendChild(listContainer);

  root.appendChild(container);
  updateList(root, listContainer, state);
}

function updateList(root, listContainer, state) {
  // Capture focus before rebuild
  let focusRestorationId = null;
  if (document.activeElement && root.contains(document.activeElement)) {
    const btn = document.activeElement.closest('.item-expand-btn');
    if (btn) {
      focusRestorationId = btn.getAttribute('data-item-id');
    }
  }

  // Prune detached row listeners before rebuild
  state.rowListeners.forEach(({ el, type, fn }) => {
    el.removeEventListener(type, fn);
  });
  state.rowListeners = [];

  listContainer.innerHTML = '';

  const filtered = state.items.filter(item => {
    if (state.filter === 'overdue') return item.isOverdue;
    if (state.filter === 'upcoming') return !item.isOverdue;
    return true;
  });

  if (filtered.length === 0) {
    const empty = createEl('div', 'timeline-empty', 'No deadlines');
    listContainer.appendChild(empty);
    return;
  }

  const ol = createEl('ol', 'timeline-list');
  
  filtered.forEach(item => {
    const li = createEl('li', `timeline-item ${item.isOverdue ? 'overdue' : 'upcoming'}`);
    
    const header = createEl('div', 'item-header');
    
    // Expand button
    const isExpanded = state.expandedIds.has(item.id);
    const btn = createEl('button', 'item-expand-btn', isExpanded ? '−' : '+');
    btn.setAttribute('aria-expanded', isExpanded);
    btn.setAttribute('aria-controls', `desc-${item.id}`);
    btn.setAttribute('aria-label', (isExpanded ? 'Collapse ' : 'Expand ') + item.title);
    btn.setAttribute('data-item-id', item.id);
    
    const onToggle = () => {
      if (state.expandedIds.has(item.id)) {
        state.expandedIds.delete(item.id);
      } else {
        state.expandedIds.add(item.id);
      }
      updateList(root, listContainer, state);
    };
    btn.addEventListener('click', onToggle);
    state.rowListeners.push({ el: btn, type: 'click', fn: onToggle });

    const onKeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle();
      }
    };
    btn.addEventListener('keydown', onKeydown);
    state.rowListeners.push({ el: btn, type: 'keydown', fn: onKeydown });

    const titleDiv = createEl('div', 'item-title', item.title);
    const dateDiv = createEl('div', 'item-date', `${item.displayDate} ${item.displayTime}`.trim());
    
    if (item.isOverdue) {
      dateDiv.style.color = '#ef4444'; // Red for overdue
    } else {
      dateDiv.style.color = '#a3e635'; // Lime accent
    }

    header.appendChild(btn);
    header.appendChild(titleDiv);
    header.appendChild(dateDiv);
    
    li.appendChild(header);

    if (state.expandedIds.has(item.id)) {
      const details = createEl('div', 'item-details');
      details.id = `desc-${item.id}`;
      
      const statusP = createEl('p', '', `Status: ${item.status}`);
      const sourceP = createEl('p', '', `Source: ${item.source}`);
      
      details.appendChild(statusP);
      details.appendChild(sourceP);
      li.appendChild(details);
    }

    ol.appendChild(li);
  });

  listContainer.appendChild(ol);
  
  if (focusRestorationId !== null) {
    const restoredBtn = root.querySelector(`.item-expand-btn[data-item-id="${focusRestorationId}"]`);
    if (restoredBtn && restoredBtn.focus) {
      restoredBtn.focus();
    }
  }
}

export function destroyDeadlineTimeline(root) {
  if (!root) return;
  const state = STATE.get(root);
  if (state) {
    state.rootListeners.forEach(({ el, type, fn }) => {
      el.removeEventListener(type, fn);
    });
    state.rowListeners.forEach(({ el, type, fn }) => {
      el.removeEventListener(type, fn);
    });
    STATE.delete(root);
  }
  root.innerHTML = '';
}