/**
 * App Entry Point and UI Orchestration
 */

import { initStore, exportData, importData } from './store.js';
import { renderCountdowns, renderRadar } from './countdowns.js';
import { fetchAndRenderIndicators } from './indicators.js';
import { getGoals, saveGoal, toggleArchive, createGoalCard, cycleOccurrence } from './goals.js';
import { getPlaces, savePlace, deletePlace, getMapEmbedUrl, createPlaceElement } from './maps.js';
import { getCollegeData, saveCollegeItem, deleteCollegeItem, createCollegeCard } from './college.js';
import { getJobs, saveJob, deleteJob, createJobCard } from './jobs.js';

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Data
    initStore();
    
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


    // Settings Actions
    const btnExport = document.getElementById('btn-export');
    const importFileInput = document.getElementById('import-file');

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

    importFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            importData(file, () => {
                refreshUI();
                importFileInput.value = ''; // Reset input
            });
        }
    });

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
        modal.classList.remove('hidden');
        goalTitleInput.focus();
    }

    function closeModal() {
        modal.classList.add('hidden');
        goalForm.reset();
    }

    btnCreateGoal.addEventListener('click', () => openModal());
    btnCancelModal.addEventListener('click', closeModal);

    goalForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const goalData = {
            id: goalIdInput.value || null,
            title: goalTitleInput.value.trim(),
            notes: goalNotesInput.value.trim(),
            target: parseInt(goalTargetInput.value) || 1,
            showNotes: goalShowNotesInput.checked
        };
        
        saveGoal(goalData);
        closeModal();
        refreshUI();
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
        placeModal.classList.remove('hidden');
        placeNameInput.focus();
    }

    function closePlaceModal() {
        placeModal.classList.add('hidden');
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
            jobDateInput.value = new Date().toISOString().split('T')[0];
        }
        jobModal.classList.remove('hidden');
        jobCompanyInput.focus();
    }

    function closeJobModal() {
        jobModal.classList.add('hidden');
        jobForm.reset();
    }

    btnCreateJob.addEventListener('click', () => openJobModal());
    btnCancelJobModal.addEventListener('click', closeJobModal);

    jobForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const jobData = {
            id: jobIdInput.value || null,
            company: jobCompanyInput.value.trim(),
            role: jobRoleInput.value.trim(),
            status: jobStatusInput.value,
            location: jobLocationInput.value,
            date: jobDateInput.value,
            notes: jobNotesInput.value.trim()
        };
        saveJob(jobData);
        closeJobModal();
        refreshUI();
    });

    jobStatusFilter.addEventListener('change', () => refreshUI());
    jobLocationFilter.addEventListener('change', () => refreshUI());

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
        collegeModal.classList.remove('hidden');
        collegeItemTitleInput.focus();
    }

    function closeCollegeModal() {
        collegeModal.classList.add('hidden');
        collegeForm.reset();
    }

    btnCreateCollegeItem.addEventListener('click', () => openCollegeModal());
    btnCancelCollegeModal.addEventListener('click', closeCollegeModal);

    collegeForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const type = collegeItemTypeInput.value;
        const itemData = {
            id: collegeItemIdInput.value || null,
            title: collegeItemTitleInput.value.trim(),
            date: collegeItemDateInput.value,
            notes: collegeItemNotesInput.value.trim()
        };
        
        saveCollegeItem(type, itemData);
        closeCollegeModal();
        refreshUI();
    });

    // Escape closes any open modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!modal.classList.contains('hidden')) closeModal();
            if (!placeModal.classList.contains('hidden')) closePlaceModal();
            if (!collegeModal.classList.contains('hidden')) closeCollegeModal();
            if (!jobModal.classList.contains('hidden')) closeJobModal();
        }
    });

    btnCreatePlace.addEventListener('click', () => openPlaceModal());
    btnCancelPlaceModal.addEventListener('click', closePlaceModal);

    placeForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const placeData = {
            id: placeIdInput.value || null,
            name: placeNameInput.value.trim(),
            lat: parseFloat(placeLatInput.value),
            lng: parseFloat(placeLngInput.value),
            color: placeColorInput.value.trim() || '#a3e635'
        };
        
        savePlace(placeData);
        closePlaceModal();
        refreshUI();
    });
    
    // --- Maps Callbacks ---
    const handleEditPlace = (place) => openPlaceModal(place);
    const handleDeletePlace = (placeId) => {
        if (activePlaceId === placeId) activePlaceId = null;
        deletePlace(placeId);
        refreshUI();
    };
    const handleClickPlace = (place) => {
        activePlaceId = place.id;
        refreshUI();
    };

    // --- Goal Callbacks ---
    const handleEdit = (goal) => openModal(goal);
    const handleToggleArchive = (goalId) => {
        toggleArchive(goalId);
        refreshUI();
    };
    const handleCycleOccurrence = (goalId, dateStr) => {
        cycleOccurrence(goalId, dateStr);
        refreshUI();
    };
    
    // --- Job Callbacks ---
    const handleEditJob = (job) => openJobModal(job);
    const handleDeleteJob = (jobId) => {
        deleteJob(jobId);
        refreshUI();
    };

    // --- College Callbacks ---
    const handleEditCollege = (item, type) => openCollegeModal(item, type);
    const handleDeleteCollege = (type, itemId) => {
        deleteCollegeItem(type, itemId);
        refreshUI();
    };

    // --- Rendering Orchestration ---
    function refreshUI() {
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
        todayGoalsContainer.innerHTML = '';
        if (activeGoals.length === 0) {
            todayGoalsContainer.innerHTML = '<div class="empty-state">No active goals for today. Enjoy your day!</div>';
        } else {
            activeGoals.forEach(g => {
                todayGoalsContainer.appendChild(createGoalCard(g, handleEdit, handleToggleArchive, handleCycleOccurrence));
            });
        }
        
        // Goals View - Active Container
        const activeGoalsContainer = document.getElementById('active-goals-container');
        activeGoalsContainer.innerHTML = '';
        if (activeGoals.length === 0) {
            activeGoalsContainer.innerHTML = '<div class="empty-state">You have no active goals.</div>';
        } else {
            activeGoals.forEach(g => {
                activeGoalsContainer.appendChild(createGoalCard(g, handleEdit, handleToggleArchive, handleCycleOccurrence));
            });
        }
        
        // Goals View - Archived Container
        const archivedGoalsContainer = document.getElementById('archived-goals-container');
        archivedGoalsContainer.innerHTML = '';
        if (archivedGoals.length === 0) {
            archivedGoalsContainer.innerHTML = '<div class="empty-state">Archive is empty.</div>';
        } else {
            archivedGoals.forEach(g => {
                archivedGoalsContainer.appendChild(createGoalCard(g, handleEdit, handleToggleArchive, handleCycleOccurrence));
            });
        }
        
        // Maps View
        const allPlaces = getPlaces();
        placesList.innerHTML = '';
        
        if (allPlaces.length === 0) {
            mapContainer.innerHTML = '<div class="empty-state">No places added yet. Add a place to see it on the map.</div>';
        } else {
            const activePlace = allPlaces.find(p => p.id === activePlaceId) || null;
            
            allPlaces.forEach(p => {
                const isActive = p.id === activePlaceId;
                placesList.appendChild(createPlaceElement(p, handleEditPlace, handleDeletePlace, handleClickPlace, isActive));
            });
            
            const embedUrl = getMapEmbedUrl(allPlaces, activePlace);
            if (embedUrl) {
                mapContainer.innerHTML = `<iframe src="${embedUrl}" allowfullscreen></iframe>`;
            }
        }
        
        // Jobs View
        const allJobs = getJobs() || [];
        const activeStatusFilter = jobStatusFilter.value;
        const activeLocationFilter = jobLocationFilter.value;
        let filteredJobs = allJobs;
        if (activeStatusFilter !== 'all') { filteredJobs = filteredJobs.filter(j => j.status === activeStatusFilter); }
        if (activeLocationFilter !== 'all') { filteredJobs = filteredJobs.filter(j => j.location === activeLocationFilter); }
        filteredJobs.sort((a, b) => new Date(b.date) - new Date(a.date));
        jobsContainer.innerHTML = '';
        if (filteredJobs.length === 0) {
            jobsContainer.innerHTML = '<div class="empty-state">No jobs found matching the criteria.</div>';
        } else {
            filteredJobs.forEach(job => { jobsContainer.appendChild(createJobCard(job, handleEditJob, handleDeleteJob)); });
        }

        // College View
        const collegeData = getCollegeData();
        ['timetable', 'assignments', 'exams', 'fees'].forEach(type => {
            const container = document.getElementById(`college-${type}-container`);
            if (!container) return;
            
            container.innerHTML = '';
            const items = collegeData[type] || [];
            
            if (items.length === 0) {
                container.innerHTML = `<div class="empty-state">No ${type} added yet.</div>`;
            } else {
                // Sort by date mostly
                items.sort((a, b) => new Date(a.date) - new Date(b.date));
                items.forEach(item => {
                    container.appendChild(createCollegeCard(item, type, handleEditCollege, handleDeleteCollege));
                });
            }
        });
    }

    // Initial render
    refreshUI();
});
