/**
 * App Entry Point and UI Orchestration
 */

import { initStore, exportData, importData } from './store.js';
import { renderCountdowns, renderRadar } from './countdowns.js';
import { fetchAndRenderIndicators } from './indicators.js';
import { getGoals, saveGoal, toggleArchive, createGoalCard, cycleOccurrence } from './goals.js';
import { getPlaces, savePlace, deletePlace, getMapEmbedUrl, createPlaceElement } from './maps.js';

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
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const tabId = btn.dataset.tab;
            tabContents.forEach(c => {
                if(c.id === `${tabId}-container`) {
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

    // Escape closes any open modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!modal.classList.contains('hidden')) closeModal();
            if (!placeModal.classList.contains('hidden')) closePlaceModal();
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
    }

    // Initial render
    refreshUI();
});
