/**
 * App Entry Point and UI Orchestration
 */

import { initStore, exportData, importData, exportDraft } from './store.js';
import { renderCountdowns, renderRadar } from './countdowns.js';
import { fetchAndRenderIndicators } from './indicators.js';
import { getGoals, saveGoal, toggleArchive, createGoalCard, cycleOccurrence } from './goals.js';
import { getHabits, saveHabit, toggleArchive as toggleHabitArchive, toggleCheckin as toggleHabitCheckin, createHabitCard } from './habits.js';
import { getPlaces, savePlace, deletePlace, getMapEmbedUrl, createPlaceElement } from './maps.js';
import { getCollegeData, saveCollegeItem, deleteCollegeItem, createCollegeCard } from './college.js';
import { getJobs, saveJob, deleteJob, createJobCard } from './jobs.js';
import { getInvestments, saveInvestment, deleteInvestment, createInvestmentCard } from './investments.js';
import { renderJobsChart, renderCollegeChart, renderInvestmentsChart } from './visuals/charts.js';
import { renderChartExplorer, destroyChartExplorer } from './visuals/chart-explorer.js';
import { renderDeadlineTimeline, destroyDeadlineTimeline } from './visuals/deadline-timeline.js';
import { renderProgressSummary, destroyProgressSummary } from './visuals/progress-summary.js';
import { getNewsData, getSources, saveSource, deleteSource, getManualEntries, saveManualEntry, deleteManualEntry, refreshFeeds, createNewsCard, createSourceCard } from './feeds.js';


let lastFocusedElement = null;
let renderEpoch = 0;
function getActiveView() { return document.querySelector('.view.active')?.id; }

const dialogStack = [];

function trapFocus(modalEl) {
    const focusableSelectors = 'a[href]:not([disabled]), button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    
    modalEl.addEventListener('keydown', function(e) {
        const focusableEls = Array.from(modalEl.querySelectorAll(focusableSelectors)).filter(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden';
        });
        if (focusableEls.length === 0) return;
        
        const firstFocusableEl = focusableEls[0];
        const lastFocusableEl = focusableEls[focusableEls.length - 1];

        if (e.key === 'Tab' || e.keyCode === 9) {
            if (e.shiftKey) { 
                if (document.activeElement === firstFocusableEl || document.activeElement === modalEl) {
                    lastFocusableEl.focus();
                    e.preventDefault();
                }
            } else { 
                if (document.activeElement === lastFocusableEl) {
                    firstFocusableEl.focus();
                    e.preventDefault();
                }
            }
        } else if (e.key === 'Escape' || e.keyCode === 27) {
            closeDialog(modalEl.id);
            e.preventDefault();
        }
    });
}

function openDialog(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    
    dialogStack.push({
        id: modalId,
        previousFocus: document.activeElement
    });
    
    modal.classList.remove('hidden');
    
    if (dialogStack.length === 1) {
        const appContent = document.getElementById('app-content');
        const appHeader = document.querySelector('.app-header');
        if (appContent) appContent.setAttribute('inert', '');
        if (appHeader) appHeader.setAttribute('inert', '');
    } else {
        const prevDialogId = dialogStack[dialogStack.length - 2].id;
        const prevModal = document.getElementById(prevDialogId);
        if (prevModal) prevModal.setAttribute('inert', '');
    }
    
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    if (!modal._focusTrapped) {
        trapFocus(modal);
        modal._focusTrapped = true;
    }
}

function closeDialog(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    
    if (dialogStack.length > 0 && dialogStack[dialogStack.length - 1].id === modalId) {
        const state = dialogStack.pop();
        modal.classList.add('hidden');
        
        if (dialogStack.length === 0) {
            const appContent = document.getElementById('app-content');
            const appHeader = document.querySelector('.app-header');
            if (appContent) appContent.removeAttribute('inert');
            if (appHeader) appHeader.removeAttribute('inert');
        } else {
            const prevDialogId = dialogStack[dialogStack.length - 1].id;
            const prevModal = document.getElementById(prevDialogId);
            if (prevModal) prevModal.removeAttribute('inert');
        }
        
        if (state.previousFocus) {
            state.previousFocus.focus();
        }
    } else {
        modal.classList.add('hidden');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize Data
    let storeStatus;
    try {
        storeStatus = await initStore();
    } catch (e) {
        storeStatus = { status: 'degraded', error: e.message };
    }

    if (storeStatus && storeStatus.status === 'degraded') {
        const banner = document.createElement('div');
        banner.style.backgroundColor = 'var(--danger-color, #ef4444)';
        banner.style.color = '#fff';
        banner.style.padding = '0.5rem';
        banner.style.textAlign = 'center';
        banner.style.position = 'sticky';
        banner.style.top = '0';
        banner.style.zIndex = '9999';
        banner.textContent = 'Storage is degraded: ' + (storeStatus.error || 'Unknown error') + '. Saves will be rejected.';
        document.body.prepend(banner);
    }

    // Runs a store mutation, surfacing quota failures and cross-tab
    // conflicts to the user instead of failing silently.
    async function runMutation(promise, after) {
        if (storeStatus && storeStatus.status === 'degraded') {
            alert('Save rejected: Storage is in a degraded state.');
            return;
        }
        let result;
        try {
            result = await promise;
        } catch (e) {
            console.error('Save failed:', e);
            alert('Could not save: ' + (e && e.message ? e.message : e));
            return false;
        }
        if (result && result.conflict) {
            alert('Another tab changed the data first. Your latest change was downloaded as a draft; please re-apply it.');
        }
        if (after) after();
        return true;
    }
    
    // UI Elements - Navigation
    const navBtns = document.querySelectorAll('.nav-btn');
    const views = document.querySelectorAll('.view');
    
    // UI Elements - Goals View Tabs
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    // UI Elements - Goal Form Modal
    const modal = document.getElementById('goal-modal');
    const modalTitle = document.getElementById('modal-title');
    const goalForm = document.getElementById('goal-form');
    const goalIdInput = document.getElementById('goal-id');
    const goalTitleInput = document.getElementById('goal-title');
    const goalNotesInput = document.getElementById('goal-notes');
    const goalTargetInput = document.getElementById('goal-target');
    const goalShowNotesInput = document.getElementById('goal-show-notes');
    const btnCancelModal = document.getElementById('btn-cancel-modal');
    const btnCreateGoal = document.getElementById('btn-create-goal');
    
    // UI Elements - Maps
    const placeModal = document.getElementById('place-modal');
    const placeModalTitle = document.getElementById('place-modal-title');
    const placeForm = document.getElementById('place-form');
    const placeIdInput = document.getElementById('place-id');
    const placeNameInput = document.getElementById('place-name');
    const placeLatInput = document.getElementById('place-lat');
    const placeLngInput = document.getElementById('place-lng');
    const placeColorInput = document.getElementById('place-color');
    const btnCancelPlaceModal = document.getElementById('btn-cancel-place-modal');
    const btnCreatePlace = document.getElementById('btn-create-place');
    const placesList = document.getElementById('places-list');
    const mapContainer = document.getElementById('map-container');
    let activePlaceId = null;

    // College Elements
    const collegeModal = document.getElementById('college-modal');
    const collegeModalTitle = document.getElementById('college-modal-title');
    const collegeForm = document.getElementById('college-form');
    const collegeItemIdInput = document.getElementById('college-item-id');
    const collegeItemTypeInput = document.getElementById('college-item-type');
    const collegeItemTitleInput = document.getElementById('college-item-title');
    const collegeItemDateInput = document.getElementById('college-item-date');
    const collegeItemNotesInput = document.getElementById('college-item-notes');
    const btnCreateCollegeItem = document.getElementById('btn-create-college-item');
    const btnCancelCollegeModal = document.getElementById('btn-cancel-college-modal');
    
    // Jobs Elements
    const jobModal = document.getElementById('job-modal');
    const jobModalTitle = document.getElementById('job-modal-title');
    const jobForm = document.getElementById('job-form');
    const jobIdInput = document.getElementById('job-id');
    const jobCompanyInput = document.getElementById('job-company');
    const jobRoleInput = document.getElementById('job-role');
    const jobStatusInput = document.getElementById('job-status');
    const jobLocationInput = document.getElementById('job-location');
    const jobDateInput = document.getElementById('job-date');
    const jobNotesInput = document.getElementById('job-notes');
    const btnCreateJob = document.getElementById('btn-create-job');
    const btnCancelJobModal = document.getElementById('btn-cancel-job-modal');
    const jobsContainer = document.getElementById('jobs-container');
    const jobStatusFilter = document.getElementById('job-status-filter');
    const jobLocationFilter = document.getElementById('job-location-filter');

    // Habits Elements
    const habitModal = document.getElementById('habit-modal');
    const habitModalTitle = document.getElementById('habit-modal-title');
    const habitForm = document.getElementById('habit-form');
    const habitIdInput = document.getElementById('habit-id');
    const habitNameInput = document.getElementById('habit-name');
    const btnCreateHabit = document.getElementById('btn-create-habit');
    const btnCancelHabitModal = document.getElementById('btn-cancel-habit-modal');

    // Investments Elements
    const investmentModal = document.getElementById('investment-modal');
    const investmentModalTitle = document.getElementById('investment-modal-title');
    const investmentForm = document.getElementById('investment-form');
    const investmentIdInput = document.getElementById('investment-id');
    const investmentTickerInput = document.getElementById('investment-ticker');
    const investmentEntryInput = document.getElementById('investment-entry');
    const investmentCurrentInput = document.getElementById('investment-current');
    const investmentNotesInput = document.getElementById('investment-notes');
    const btnCreateInvestment = document.getElementById('btn-create-investment');
    const btnCancelInvestmentModal = document.getElementById('btn-cancel-investment-modal');
    const investmentsContainer = document.getElementById('investments-container');

    // Settings Actions
    const btnExport = document.getElementById('btn-export');
    const btnExportDraft = document.getElementById('btn-export-draft');
    const btnReloadLatest = document.getElementById('btn-reload-latest');
    const importFileInput = document.getElementById('import-file');
    
    // UI Elements - News View
    const newsContainer = document.getElementById('news-container');
    const newsCategoryFilter = document.getElementById('news-category-filter');
    const btnRefreshNews = document.getElementById('btn-refresh-news');
    const btnManageSources = document.getElementById('btn-manage-sources');
    const btnAddManualNews = document.getElementById('btn-add-manual-news');
    const newsStatusBar = document.getElementById('news-status-bar');

    // UI Elements - News Modals
    const newsSourceModal = document.getElementById('news-source-modal');
    const newsSourceForm = document.getElementById('news-source-form');
    const newsSourceModalTitle = document.getElementById('news-source-modal-title');
    const newsSourceIdInput = document.getElementById('news-source-id');
    const newsSourceNameInput = document.getElementById('news-source-name');
    const newsSourceUrlInput = document.getElementById('news-source-url');
    const newsSourceCategoryInput = document.getElementById('news-source-category');
    const btnCancelNewsSourceModal = document.getElementById('btn-cancel-news-source-modal');

    const newsSourcesListModal = document.getElementById('news-sources-list-modal');
    const newsSourcesContainer = document.getElementById('news-sources-container');
    const btnAddSource = document.getElementById('btn-add-source');
    const btnCloseSourcesListModal = document.getElementById('btn-close-sources-list-modal');

    const newsManualModal = document.getElementById('news-manual-modal');
    const newsManualForm = document.getElementById('news-manual-form');
    const newsManualModalTitle = document.getElementById('news-manual-modal-title');
    const newsManualIdInput = document.getElementById('news-manual-id');
    const newsManualTitleInput = document.getElementById('news-manual-title');
    const newsManualUrlInput = document.getElementById('news-manual-url');
    const newsManualDateInput = document.getElementById('news-manual-date');
    const newsManualCategoryInput = document.getElementById('news-manual-category');
    const btnCancelNewsManualModal = document.getElementById('btn-cancel-news-manual-modal');

    // --- Routing / Navigation ---
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            handleNavClick(btn);
        });
        btn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleNavClick(btn);
            }
        });
    });

    function handleNavClick(btn) {
            renderEpoch++;
            const activeView = getActiveView();
            // Destroy outgoing
            if (activeView === 'view-today') {
                const el = document.getElementById('progress-summary-root');
                if (el && typeof destroyProgressSummary === 'function') destroyProgressSummary(el);
            }
            if (activeView === 'view-college') {
                const el = document.getElementById('college-deadline-timeline-root');
                if (el && typeof destroyDeadlineTimeline === 'function') destroyDeadlineTimeline(el);
            }
            if (activeView === 'view-jobs') {
                const el = document.getElementById('jobs-explorer-root');
                if (el && typeof destroyChartExplorer === 'function') destroyChartExplorer(el);
            }
            if (activeView === 'view-investments') {
                const el = document.getElementById('investments-explorer-root');
                if (el && typeof destroyChartExplorer === 'function') destroyChartExplorer(el);
            }

            // Update active state on buttons
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Show corresponding view
            const viewId = `view-${btn.dataset.view}`;
            views.forEach(v => {
                if(v.id === viewId) {
                    v.classList.remove('hidden');
                    v.classList.add('active');
                } else {
                    v.classList.remove('active');
                    v.classList.add('hidden');
                }
            });
            
            // Re-render data when changing views
            refreshUI();
    }

    // --- Goal Tabs ---
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            handleTabClick(btn);
        });
        btn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleTabClick(btn);
            }
        });
    });

    function handleTabClick(btn) {
            // Find parent view to scope tabs (Goals vs College)
            const parentView = btn.closest('.view');
            const localTabBtns = parentView.querySelectorAll('.tab-btn');
            const localTabContents = parentView.querySelectorAll('.tab-content');

            localTabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const tabId = btn.dataset.tab;
            
            // Goals tabs vs College tabs have slightly different ID structures
            localTabContents.forEach(c => {
                if(c.id === `${tabId}-container` || c.id === `college-${tabId}-container`) {
                    c.classList.remove('hidden');
                    c.classList.add('active');
                } else {
                    c.classList.remove('active');
                    c.classList.add('hidden');
                }
            });
    }

    // --- Settings / Durability ---
    btnExport.addEventListener('click', () => {
        exportData();
    });

    btnExportDraft.addEventListener('click', () => {
        exportDraft();
    });

    btnReloadLatest.addEventListener('click', () => {
        const confirmed = confirm('This will reload the latest data from storage and discard any unsaved draft in memory. Continue?');
        if (confirmed) {
            window.location.reload();
        }
    });

    importFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        e.target.value = ''; // Support cancel/rejection/repeat selection
        if (file) {
            importData(file, () => {
                refreshUI();
            });
        }
    });
    const btnImportTrigger = document.getElementById('btn-import-trigger');
    if (btnImportTrigger) {
        btnImportTrigger.addEventListener('click', () => importFileInput.click());
    }

    // --- Goal Modal Operations ---
    function openModal(goal = null) {
        if (goal) {
            modalTitle.textContent = 'Edit Goal';
            goalIdInput.value = goal.id;
            goalTitleInput.value = goal.title;
            goalNotesInput.value = goal.notes || '';
            goalTargetInput.value = goal.target || 1;
            goalShowNotesInput.checked = goal.showNotes || false;
        } else {
            modalTitle.textContent = 'Create Goal';
            goalForm.reset();
            goalIdInput.value = '';
        }
        openDialog('goal-modal');
        goalTitleInput.focus();
    }

    function closeModal() {
        closeDialog('goal-modal');
        goalForm.reset();
    }

    btnCreateGoal.addEventListener('click', () => openModal());
    btnCancelModal.addEventListener('click', closeModal);

    goalForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const goalData = {
            id: goalIdInput.value || null,
            title: goalTitleInput.value.trim(),
            notes: goalNotesInput.value.trim(),
            target: parseInt(goalTargetInput.value) || 1,
            showNotes: goalShowNotesInput.checked
        };
        
        await runMutation(saveGoal(goalData), () => { closeModal(); refreshUI(); });
    });

    // --- Place Modal Operations ---
    function openPlaceModal(place = null) {
        if (place) {
            placeModalTitle.textContent = 'Edit Place';
            placeIdInput.value = place.id;
            placeNameInput.value = place.name;
            placeLatInput.value = place.lat;
            placeLngInput.value = place.lng;
            placeColorInput.value = place.color || '#a3e635';
        } else {
            placeModalTitle.textContent = 'Add Place';
            placeForm.reset();
            placeIdInput.value = '';
            placeColorInput.value = '#a3e635';
        }
        openDialog('place-modal');
        placeNameInput.focus();
    }

    function closePlaceModal() {
        closeDialog('place-modal');
        placeForm.reset();
    }

    // --- Job Modal Operations ---
    function openJobModal(job = null) {
        if (job) {
            jobModalTitle.textContent = 'Edit Job';
            jobIdInput.value = job.id;
            jobCompanyInput.value = job.company;
            jobRoleInput.value = job.role;
            jobStatusInput.value = job.status;
            jobLocationInput.value = job.location;
            jobDateInput.value = job.date;
            jobNotesInput.value = job.notes || '';
        } else {
            jobModalTitle.textContent = 'Add Job';
            jobForm.reset();
            jobIdInput.value = '';
            jobDateInput.value = '';
        }
        openDialog('job-modal');
        jobCompanyInput.focus();
    }

    function closeJobModal() {
        closeDialog('job-modal');
        jobForm.reset();
    }

    btnCreateJob.addEventListener('click', () => openJobModal());
    btnCancelJobModal.addEventListener('click', closeJobModal);

    jobForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const jobData = {
            id: jobIdInput.value || null,
            company: jobCompanyInput.value.trim(),
            role: jobRoleInput.value.trim(),
            status: jobStatusInput.value,
            location: jobLocationInput.value,
            date: jobDateInput.value || (() => {
                const parts = new Intl.DateTimeFormat('en-US', {
                    timeZone: 'America/Toronto',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }).formatToParts(new Date());
                const year = parts.find(p => p.type === 'year').value;
                const month = parts.find(p => p.type === 'month').value;
                const day = parts.find(p => p.type === 'day').value;
                return `${year}-${month}-${day}`;
            })(),
            notes: jobNotesInput.value.trim()
        };
        await runMutation(saveJob(jobData), () => { closeJobModal(); refreshUI(); });
    });

    jobStatusFilter.addEventListener('change', () => refreshUI());
    const handleChartJobFilter = (status) => { if(jobStatusFilter.value !== status) { jobStatusFilter.value = status; refreshUI(); } };
    jobLocationFilter.addEventListener('change', () => refreshUI());

    // --- Investment Modal Operations ---
    function openInvestmentModal(investment = null) {
        if (investment) {
            investmentModalTitle.textContent = 'Edit Investment';
            investmentIdInput.value = investment.id;
            investmentTickerInput.value = investment.ticker;
            investmentEntryInput.value = investment.entry;
            investmentCurrentInput.value = investment.current;
            investmentNotesInput.value = investment.notes || '';
        } else {
            investmentModalTitle.textContent = 'Add Investment';
            investmentForm.reset();
            investmentIdInput.value = '';
        }
        openDialog('investment-modal');
        investmentTickerInput.focus();
    }

    function closeInvestmentModal() {
        closeDialog('investment-modal');
        investmentForm.reset();
    }

    btnCreateInvestment.addEventListener('click', () => openInvestmentModal());
    btnCancelInvestmentModal.addEventListener('click', closeInvestmentModal);

    investmentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const investmentData = {
            id: investmentIdInput.value || null,
            ticker: investmentTickerInput.value.trim(),
            entry: parseFloat(investmentEntryInput.value),
            current: parseFloat(investmentCurrentInput.value),
            notes: investmentNotesInput.value.trim()
        };
        await runMutation(saveInvestment(investmentData), () => { closeInvestmentModal(); refreshUI(); });
    });

    // --- Habit Event Listeners ---
    btnCreateHabit.addEventListener('click', () => openHabitModal());
    btnCancelHabitModal.addEventListener('click', closeHabitModal);
    habitForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const habitData = {
            id: habitIdInput.value || null,
            name: habitNameInput.value
        };
        await runMutation(saveHabit(habitData), () => { closeHabitModal(); refreshUI(); });
    });

    // --- College Modal Operations ---
    function openCollegeModal(item = null, type = 'timetable') {
        if (item) {
            collegeModalTitle.textContent = 'Edit College Item';
            collegeItemIdInput.value = item.id;
            collegeItemTypeInput.value = type;
            collegeItemTitleInput.value = item.title;
            collegeItemDateInput.value = item.date;
            collegeItemNotesInput.value = item.notes || '';
            collegeItemTypeInput.disabled = true; // Can't change type when editing
        } else {
            collegeModalTitle.textContent = 'Add College Item';
            collegeForm.reset();
            collegeItemIdInput.value = '';
            
            // Try to set type based on active tab
            const activeTabBtn = document.querySelector('#view-college .tab-btn.active');
            if (activeTabBtn) {
                collegeItemTypeInput.value = activeTabBtn.dataset.tab;
            }
            collegeItemTypeInput.disabled = false;
        }
        openDialog('college-modal');
        collegeItemTitleInput.focus();
    }

    function closeCollegeModal() {
        closeDialog('college-modal');
        collegeForm.reset();
    }

    btnCreateCollegeItem.addEventListener('click', () => openCollegeModal());
    btnCancelCollegeModal.addEventListener('click', closeCollegeModal);

    collegeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const type = collegeItemTypeInput.value;
        const itemData = {
            id: collegeItemIdInput.value || null,
            title: collegeItemTitleInput.value.trim(),
            date: collegeItemDateInput.value || (() => {
                const parts = new Intl.DateTimeFormat('en-US', {
                    timeZone: 'America/Toronto',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }).formatToParts(new Date());
                const year = parts.find(p => p.type === 'year').value;
                const month = parts.find(p => p.type === 'month').value;
                const day = parts.find(p => p.type === 'day').value;
                return `${year}-${month}-${day}`;
            })(),
            notes: collegeItemNotesInput.value.trim()
        };
        
        await runMutation(saveCollegeItem(type, itemData), () => { closeCollegeModal(); refreshUI(); });
    });

    // --- News Modals and Logic ---
    function openNewsSourcesListModal() {
        openDialog('news-sources-list-modal');
        renderNewsSourcesList();
    }

    function closeNewsSourcesListModal() {
        closeDialog('news-sources-list-modal');
    }

    async function renderNewsSourcesList() {
        newsSourcesContainer.replaceChildren();
        const sources = await getSources();
        if (sources.length === 0) {
            
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-state';
        emptyDiv.textContent = 'No sources configured.';
        newsSourcesContainer.appendChild(emptyDiv);
    
        } else {
            sources.forEach(source => {
                newsSourcesContainer.appendChild(createSourceCard(
                    source,
                    (s) => { openNewsSourceModal(s); },
                    async (id) => { await runMutation(deleteSource(id), () => { renderNewsSourcesList(); refreshUI(); }); }
                ));
            });
        }
    }

    function openNewsSourceModal(source = null) {
        if (source) {
            newsSourceModalTitle.textContent = 'Edit Source';
            newsSourceIdInput.value = source.id;
            newsSourceNameInput.value = source.name;
            newsSourceUrlInput.value = source.url;
            newsSourceCategoryInput.value = source.category;
        } else {
            newsSourceModalTitle.textContent = 'Add Source';
            newsSourceForm.reset();
            newsSourceIdInput.value = '';
        }
        openDialog('news-source-modal');
        newsSourceNameInput.focus();
    }

    function closeNewsSourceModal() {
        closeDialog('news-source-modal');
        newsSourceForm.reset();
    }

    function openNewsManualModal(entry = null) {
        if (entry) {
            newsManualModalTitle.textContent = 'Edit Manual Entry';
            newsManualIdInput.value = entry.id;
            newsManualTitleInput.value = entry.title;
            newsManualUrlInput.value = entry.url;
            newsManualDateInput.value = entry.published.split('T')[0];
            newsManualCategoryInput.value = entry.category;
        } else {
            newsManualModalTitle.textContent = 'Add Manual Entry';
            newsManualForm.reset();
            newsManualIdInput.value = '';
            newsManualDateInput.value = '';
        }
        openDialog('news-manual-modal');
        newsManualTitleInput.focus();
    }

    function closeNewsManualModal() {
        closeDialog('news-manual-modal');
        newsManualForm.reset();
    }

    btnManageSources.addEventListener('click', () => openNewsSourcesListModal());
    btnCloseSourcesListModal.addEventListener('click', () => closeNewsSourcesListModal());
    if (btnAddSource) btnAddSource.addEventListener('click', () => openNewsSourceModal());
    btnCancelNewsSourceModal.addEventListener('click', () => closeNewsSourceModal());
    
    newsSourceForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const saveSourcePromise = saveSource({
            id: newsSourceIdInput.value || null,
            name: newsSourceNameInput.value.trim(),
            url: newsSourceUrlInput.value.trim(),
            category: newsSourceCategoryInput.value
        });
        await runMutation(saveSourcePromise, () => { closeNewsSourceModal(); renderNewsSourcesList(); refreshUI(); });
    });

    btnAddManualNews.addEventListener('click', () => openNewsManualModal());
    btnCancelNewsManualModal.addEventListener('click', () => closeNewsManualModal());

    newsManualForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const saveManualPromise = saveManualEntry({
            id: newsManualIdInput.value || null,
            title: newsManualTitleInput.value.trim(),
            url: newsManualUrlInput.value.trim(),
            published: newsManualDateInput.value || (() => {
                const parts = new Intl.DateTimeFormat('en-US', {
                    timeZone: 'America/Toronto',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }).formatToParts(new Date());
                const year = parts.find(p => p.type === 'year').value;
                const month = parts.find(p => p.type === 'month').value;
                const day = parts.find(p => p.type === 'day').value;
                return `${year}-${month}-${day}`;
            })(),
            category: newsManualCategoryInput.value
        });
        await runMutation(saveManualPromise, () => { closeNewsManualModal(); refreshUI(); });
    });

    btnRefreshNews.addEventListener('click', async () => {
        btnRefreshNews.disabled = true;
        btnRefreshNews.textContent = 'Refreshing...';
        newsStatusBar.textContent = 'Refreshing feeds...';
        try {
            await refreshFeeds((msg) => { newsStatusBar.textContent = msg; });
            newsStatusBar.textContent = 'Refresh complete at ' + new Date().toLocaleTimeString();
        } catch (error) {
            newsStatusBar.textContent = 'Refresh failed: ' + error.message;
        } finally {
            btnRefreshNews.disabled = false;
            btnRefreshNews.textContent = 'Refresh Feeds';
            refreshUI();
        }
    });

    newsCategoryFilter.addEventListener('change', () => refreshUI());

    function openHabitModal(habit = null) {
        if (habit) {
            habitModalTitle.textContent = 'Edit Habit';
            habitIdInput.value = habit.id;
            habitNameInput.value = habit.name;
        } else {
            habitModalTitle.textContent = 'Create Habit';
            habitForm.reset();
            habitIdInput.value = '';
        }
        openDialog('habit-modal');
        habitNameInput.focus();
    }
    
    function closeHabitModal() {
        closeDialog('habit-modal');
        habitForm.reset();
        habitIdInput.value = '';
    }

    // Escape closes any open modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal:not(.hidden)').forEach(m => {
                closeDialog(m.id);
            });
        }
    });

    btnCreatePlace.addEventListener('click', () => openPlaceModal());
    btnCancelPlaceModal.addEventListener('click', closePlaceModal);

    placeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const placeData = {
            id: placeIdInput.value || null,
            name: placeNameInput.value.trim(),
            lat: parseFloat(placeLatInput.value),
            lng: parseFloat(placeLngInput.value),
            color: placeColorInput.value.trim() || '#a3e635'
        };
        
        await runMutation(savePlace(placeData), () => { closePlaceModal(); refreshUI(); });
    });
    
    // --- Maps Callbacks ---
    const handleEditPlace = (place) => openPlaceModal(place);
    const handleDeletePlace = async (placeId) => {
        if (activePlaceId === placeId) activePlaceId = null;
        await runMutation(deletePlace(placeId), () => refreshUI());
    };
    const handleClickPlace = (place) => {
        activePlaceId = place.id;
        refreshUI();
    };

    // --- Goal Callbacks ---
    const handleEdit = (goal) => openModal(goal);
    const handleToggleArchive = async (goalId) => {
        await runMutation(toggleArchive(goalId), () => refreshUI());
    };
    const handleCycleOccurrence = async (goalId, dateStr) => {
        await runMutation(cycleOccurrence(goalId, dateStr), () => refreshUI());
    };
    
    // --- Job Callbacks ---
    const handleEditJob = (job) => openJobModal(job);
    const handleDeleteJob = async (jobId) => {
        await runMutation(deleteJob(jobId), () => refreshUI());
    };

    // --- Habit Callbacks ---
    const handleEditHabit = (habit) => openHabitModal(habit);
    const handleToggleHabitArchive = async (habitId) => {
        await runMutation(toggleHabitArchive(habitId), () => refreshUI());
    };
    const handleToggleHabitCheckin = async (habitId, dateStr) => {
        await runMutation(toggleHabitCheckin(habitId, dateStr), () => refreshUI());
    };

    // --- College Callbacks ---
    const handleEditCollege = (item, type) => openCollegeModal(item, type);
    const handleDeleteCollege = async (type, itemId) => {
        await runMutation(deleteCollegeItem(type, itemId), () => refreshUI());
    };

    // --- Investment Callbacks ---
    const handleEditInvestment = (investment) => openInvestmentModal(investment);
    const handleDeleteInvestment = async (investmentId) => {
        await runMutation(deleteInvestment(investmentId), () => refreshUI());
    };

    // --- Rendering Orchestration ---
    async function refreshUI() {
        renderEpoch++;
        const currentEpoch = renderEpoch;
        const activeView = getActiveView();
        
        // Fetch Data
        async function safeFetch(getter, fallback) {
            try { return (await getter()) || fallback; } catch (e) { return fallback; }
        }
        const [allJobsRaw, allHabits, collegeData, newsData] = await Promise.all([
            safeFetch(getJobs, []),
            safeFetch(getHabits, []),
            safeFetch(getCollegeData, { timetable: [], assignments: [], exams: [], fees: [] }),
            safeFetch(getNewsData, { cache: [], manual: [] })
        ]);
        
        if (renderEpoch !== currentEpoch || getActiveView() !== activeView) return;
        const allJobs = allJobsRaw || [];

        // Countdowns
        renderCountdowns('countdowns-container');
        
        // Radar
        renderRadar('radar-container');
        
        // Indicators (async fire-and-forget)
        fetchAndRenderIndicators('indicators-container');
        
        // Goals Data
        const allGoals = getGoals();
        const activeGoals = allGoals.filter(g => g.status === 'active');
        const archivedGoals = allGoals.filter(g => g.status === 'archived');
        
        // Today View Container
        const todayGoalsContainer = document.getElementById('today-goals-container');
        todayGoalsContainer.replaceChildren();
        if (activeGoals.length === 0) {
            
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-state';
        emptyDiv.textContent = 'No active goals for today. Enjoy your day!';
        todayGoalsContainer.appendChild(emptyDiv);
    
        } else {
            activeGoals.forEach(g => {
                todayGoalsContainer.appendChild(createGoalCard(g, handleEdit, handleToggleArchive, handleCycleOccurrence));
            });
        }
        
        // Goals View - Active Container
        const activeGoalsContainer = document.getElementById('active-goals-container');
        activeGoalsContainer.replaceChildren();
        if (activeGoals.length === 0) {
            
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-state';
        emptyDiv.textContent = 'You have no active goals.';
        activeGoalsContainer.appendChild(emptyDiv);
    
        } else {
            activeGoals.forEach(g => {
                activeGoalsContainer.appendChild(createGoalCard(g, handleEdit, handleToggleArchive, handleCycleOccurrence));
            });
        }
        
        // Goals View - Archived Container
        const archivedGoalsContainer = document.getElementById('archived-goals-container');
        archivedGoalsContainer.replaceChildren();
        if (archivedGoals.length === 0) {
            
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-state';
        emptyDiv.textContent = 'Archive is empty.';
        archivedGoalsContainer.appendChild(emptyDiv);
    
        } else {
            archivedGoals.forEach(g => {
                archivedGoalsContainer.appendChild(createGoalCard(g, handleEdit, handleToggleArchive, handleCycleOccurrence));
            });
        }
        
        // Maps View
        const allPlaces = getPlaces();
        placesList.replaceChildren();
        
        mapContainer.replaceChildren();
        if (allPlaces.length === 0) {
            
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-state';
        emptyDiv.textContent = 'No places added yet. Add a place to see it on the map.';
        mapContainer.appendChild(emptyDiv);
    
        } else {
            const activePlace = allPlaces.find(p => p.id === activePlaceId) || null;
            
            allPlaces.forEach(p => {
                const isActive = p.id === activePlaceId;
                placesList.appendChild(createPlaceElement(p, handleEditPlace, handleDeletePlace, handleClickPlace, isActive));
            });
            
            const embedUrl = getMapEmbedUrl(allPlaces, activePlace);
            if (embedUrl) {
                
                const iframe = document.createElement('iframe');
                iframe.src = embedUrl;
                iframe.allowFullscreen = true;
                mapContainer.appendChild(iframe);

            }
        }
        
        // Jobs View
        // const allJobs = ...
        const activeStatusFilter = jobStatusFilter.value;
        const activeLocationFilter = jobLocationFilter.value;
        let filteredJobs = allJobs;
        if (activeStatusFilter !== 'all') { filteredJobs = filteredJobs.filter(j => j.status === activeStatusFilter); }
        if (activeLocationFilter !== 'all') { filteredJobs = filteredJobs.filter(j => j.location === activeLocationFilter); }
        filteredJobs.sort((a, b) => new Date(b.date) - new Date(a.date));
        jobsContainer.replaceChildren();
        if (filteredJobs.length === 0) {
            
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-state';
        emptyDiv.textContent = 'No jobs found matching the criteria.';
        jobsContainer.appendChild(emptyDiv);
    
        } else {
            filteredJobs.forEach(job => { jobsContainer.appendChild(createJobCard(job, handleEditJob, handleDeleteJob)); });
        }
        renderJobsChart('jobs-chart', allJobs, handleChartJobFilter);

        // Investments View
        const allInvestments = getInvestments() || [];
        investmentsContainer.replaceChildren();
        if (allInvestments.length === 0) {
            
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-state';
        emptyDiv.textContent = 'No investments added to watchlist yet.';
        investmentsContainer.appendChild(emptyDiv);
    
        } else {
            allInvestments.forEach(inv => {
                investmentsContainer.appendChild(createInvestmentCard(inv, handleEditInvestment, handleDeleteInvestment));
            });
        }
        renderInvestmentsChart('investments-chart', allInvestments);

        // Habits View
        // const allHabits = ...
        const activeHabits = allHabits.filter(h => !h.archived);
        const archivedHabits = allHabits.filter(h => h.archived);
        
        const activeHabitsContainer = document.getElementById('active-habits-container');
        activeHabitsContainer.replaceChildren();
        if (activeHabits.length === 0) {
            
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-state';
        emptyDiv.textContent = 'No active habits. Create one to get started!';
        activeHabitsContainer.appendChild(emptyDiv);
    
        } else {
            activeHabits.forEach(h => {
                activeHabitsContainer.appendChild(createHabitCard(h, handleEditHabit, handleToggleHabitArchive, handleToggleHabitCheckin));
            });
        }
        
        const archivedHabitsContainer = document.getElementById('archived-habits-container');
        archivedHabitsContainer.replaceChildren();
        if (archivedHabits.length === 0) {
            
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-state';
        emptyDiv.textContent = 'Archive is empty.';
        archivedHabitsContainer.appendChild(emptyDiv);
    
        } else {
            archivedHabits.forEach(h => {
                archivedHabitsContainer.appendChild(createHabitCard(h, handleEditHabit, handleToggleHabitArchive, handleToggleHabitCheckin));
            });
        }

        // College View

        renderCollegeChart('college-chart', collegeData);
        ['timetable', 'assignments', 'exams', 'fees'].forEach(type => {
            const container = document.getElementById(`college-${type}-container`);
            if (!container) return;
            
            container.replaceChildren();
            const items = collegeData[type] || [];
            
            if (items.length === 0) {
                
                const emptyDiv = document.createElement('div');
                emptyDiv.className = 'empty-state';
                emptyDiv.textContent = `No ${type} added yet.`;
                container.appendChild(emptyDiv);

            } else {
                // Sort by date mostly
                items.sort((a, b) => new Date(a.date) - new Date(b.date));
                items.forEach(item => {
                    container.appendChild(createCollegeCard(item, type, handleEditCollege, handleDeleteCollege));
                });
            }
        });

        // News View
        // const newsData = ...
        const activeNewsCategory = newsCategoryFilter.value;
        let allNewsItems = [];
        
        // Add cache and manual entries
        allNewsItems.push(...newsData.cache.map(c => ({ ...c, isManual: false })));
        allNewsItems.push(...newsData.manual.map(m => ({ ...m, isManual: true })));
        
        // Filter
        if (activeNewsCategory !== 'all') {
            allNewsItems = allNewsItems.filter(item => item.category === activeNewsCategory);
        }
        
        // Sort descending by date
        allNewsItems.sort((a, b) => new Date(b.published) - new Date(a.published));
        
        newsContainer.replaceChildren();
        if (allNewsItems.length === 0) {
            
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-state';
        emptyDiv.textContent = 'No news found for this category.';
        newsContainer.appendChild(emptyDiv);
    
        } else {
            allNewsItems.forEach(item => {
                newsContainer.appendChild(createNewsCard(item, item.isManual, async (id) => {
                    await runMutation(deleteManualEntry(id), () => refreshUI());
                }));
            });
        }

        // --- VISUAL MODULES ---
        if (activeView === 'view-today') {
            const progSummaryContainer = document.getElementById('progress-summary-root');
            if (progSummaryContainer && typeof allHabits !== 'undefined' && typeof allGoals !== 'undefined') {
                destroyProgressSummary(progSummaryContainer);
                renderProgressSummary(progSummaryContainer, {
                    goals: allGoals,
                    habits: allHabits,
                    asOf: new Date(),
                    timeZone: "America/Toronto"
                });
                const card = progSummaryContainer.querySelector('.progress-summary-card');
                if (card) card.classList.add('vu-card');
                const h3s = progSummaryContainer.querySelectorAll('h3');
                h3s.forEach(h => h.classList.add('vu-title'));
            }
        }

        if (activeView === 'view-college') {
            const collegeTimelineContainer = document.getElementById('college-deadline-timeline-root');
            if (collegeTimelineContainer && typeof collegeData !== 'undefined') {
                destroyDeadlineTimeline(collegeTimelineContainer);
                const timelineItems = [];
                ['assignments', 'exams'].forEach(col => {
                    (collegeData[col] || []).forEach(record => {
                        timelineItems.push({
                            due: record.date,
                            title: record.title,
                            id: `college:${col}:${record.id}`,
                            source: col === 'assignments' ? 'assignment' : 'exam'
                        });
                    });
                });
                renderDeadlineTimeline(collegeTimelineContainer, { items: timelineItems, asOf: new Date(), timeZone: 'America/Toronto' });
                const tlCard = collegeTimelineContainer.querySelector('.deadline-timeline') || collegeTimelineContainer.querySelector('#deadline-timeline');
                if (tlCard) {
                    tlCard.id = 'deadline-timeline';
                    tlCard.classList.add('vu-card');
                }
                const h3s = collegeTimelineContainer.querySelectorAll('h3');
                h3s.forEach(h => h.classList.add('vu-title'));
                const headers = collegeTimelineContainer.querySelectorAll('.timeline-header');
                headers.forEach(h => h.classList.add('vu-text'));
                const empty = collegeTimelineContainer.querySelectorAll('.timeline-empty');
                empty.forEach(h => h.classList.add('vu-text'));
            }
        }

        if (activeView === 'view-jobs') {
            const jobsExplorerContainer = document.getElementById('jobs-explorer-root');
            if (jobsExplorerContainer && typeof allJobs !== 'undefined') {
                let savedFocus = null;
                const active = document.activeElement;
                if (active && jobsExplorerContainer.contains(active)) {
                    savedFocus = {
                        identity: active.getAttribute('aria-label') || active.textContent || active.tagName,
                        value: active.value,
                        selStart: active.selectionStart,
                        selEnd: active.selectionEnd
                    };
                }
                destroyChartExplorer(jobsExplorerContainer);
                renderChartExplorer(jobsExplorerContainer, {
                    chartId: 'jobs-explorer',
                    title: 'Jobs Data',
                    data: allJobs,
                    columns: ['company', 'role', 'status', 'location', 'date', 'notes']
                });
                const container = jobsExplorerContainer.querySelector('.chart-explorer-container');
                if (container) container.classList.add('vu-card');
                const title = jobsExplorerContainer.querySelector('h3');
                if (title) title.classList.add('vu-title');
                const summary = jobsExplorerContainer.querySelector('.chart-summary');
                if (summary) summary.classList.add('vu-text');
                const buttons = jobsExplorerContainer.querySelectorAll('button');
                buttons.forEach(b => b.classList.add('vu-button'));
                
                if (savedFocus) {
                    let toFocus = Array.from(jobsExplorerContainer.querySelectorAll('input, button')).find(el => {
                        return el.getAttribute('aria-label') === savedFocus.identity || el.textContent === savedFocus.identity || el.tagName === savedFocus.identity;
                    });
                    if (toFocus) {
                        if (savedFocus.value !== undefined) {
                            toFocus.value = savedFocus.value;
                            // Trigger input event to re-apply filter on the new DOM
                            toFocus.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                        if (savedFocus.selStart !== undefined && savedFocus.selEnd !== undefined) {
                            try { toFocus.setSelectionRange(savedFocus.selStart, savedFocus.selEnd); } catch(e) {}
                        }
                        toFocus.focus();
                    }
                }
            }
        }

        if (activeView === 'view-investments') {
            const invExplorerContainer = document.getElementById('investments-explorer-root');
            if (invExplorerContainer && typeof allInvestments !== 'undefined') {
                let savedFocus = null;
                const active = document.activeElement;
                if (active && invExplorerContainer.contains(active)) {
                    savedFocus = {
                        identity: active.getAttribute('aria-label') || active.textContent || active.tagName,
                        value: active.value,
                        selStart: active.selectionStart,
                        selEnd: active.selectionEnd
                    };
                }
                destroyChartExplorer(invExplorerContainer);
                renderChartExplorer(invExplorerContainer, {
                    chartId: 'investments-explorer',
                    title: 'Investments Data',
                    data: allInvestments,
                    columns: ['ticker', 'entry', 'current', 'notes']
                });
                const container = invExplorerContainer.querySelector('.chart-explorer-container');
                if (container) container.classList.add('vu-card');
                const title = invExplorerContainer.querySelector('h3');
                if (title) title.classList.add('vu-title');
                const summary = invExplorerContainer.querySelector('.chart-summary');
                if (summary) summary.classList.add('vu-text');
                const buttons = invExplorerContainer.querySelectorAll('button');
                buttons.forEach(b => b.classList.add('vu-button'));
                
                if (savedFocus) {
                    let toFocus = Array.from(invExplorerContainer.querySelectorAll('input, button')).find(el => {
                        return el.getAttribute('aria-label') === savedFocus.identity || el.textContent === savedFocus.identity || el.tagName === savedFocus.identity;
                    });
                    if (toFocus) {
                        if (savedFocus.value !== undefined) {
                            toFocus.value = savedFocus.value;
                            toFocus.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                        if (savedFocus.selStart !== undefined && savedFocus.selEnd !== undefined) {
                            try { toFocus.setSelectionRange(savedFocus.selStart, savedFocus.selEnd); } catch(e) {}
                        }
                        toFocus.focus();
                    }
                }
            }
        }
    }


    // Initial render
    refreshUI();

    // Midnight Rollover via Binary Search
    let midnightTimeout = null;
    function scheduleMidnightRefresh() {
        if (midnightTimeout) clearTimeout(midnightTimeout);
        const now = Date.now();
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Toronto',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric'
        });
        function getDateKey(ts) {
            const parts = formatter.formatToParts(new Date(ts));
            const y = parts.find(p => p.type === 'year').value;
            const m = parts.find(p => p.type === 'month').value;
            const d = parts.find(p => p.type === 'day').value;
            return `${y}-${m}-${d}`;
        }
        const nowKey = getDateKey(now);
        let low = now;
        let high = now + 36 * 60 * 60 * 1000;
        while (high - low > 1) {
            const mid = low + Math.floor((high - low) / 2);
            if (getDateKey(mid) === nowKey) {
                low = mid;
            } else {
                high = mid;
            }
        }
        const boundary = high;
        const delay = boundary - now + 25;
        midnightTimeout = setTimeout(() => {
            refreshUI();
            scheduleMidnightRefresh();
        }, delay);
    }
    scheduleMidnightRefresh();

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            scheduleMidnightRefresh();
            refreshUI();
        }
    });


    window.addEventListener('pagehide', () => {
        if (midnightTimeout) {
            clearTimeout(midnightTimeout);
            midnightTimeout = null;
        }
        renderEpoch++;
        const activeView = getActiveView();
        if (activeView === 'view-today') {
            const el = document.getElementById('progress-summary-root');
            if (el && typeof destroyProgressSummary === 'function') destroyProgressSummary(el);
        }
        if (activeView === 'view-college') {
            const el = document.getElementById('college-deadline-timeline-root');
            if (el && typeof destroyDeadlineTimeline === 'function') destroyDeadlineTimeline(el);
        }
        if (activeView === 'view-jobs') {
            const el = document.getElementById('jobs-explorer-root');
            if (el && typeof destroyChartExplorer === 'function') destroyChartExplorer(el);
        }
        if (activeView === 'view-investments') {
            const el = document.getElementById('investments-explorer-root');
            if (el && typeof destroyChartExplorer === 'function') destroyChartExplorer(el);
        }
    });

    window.addEventListener('pageshow', (e) => {
        scheduleMidnightRefresh();
        refreshUI();
    });
});
