/**
 * Storage and Durability Layer
 * Manages localStorage, seeded state, and one-click JSON export/import.
 */

const STORAGE_KEY = 'dashboard_data';
const SCHEMA_VERSION = 1;
const APP_IDENTIFIER = 'dashboard';

// Seed state when no data exists
const SEED_STATE = {
    goals: [],
    places: [],
    college: {
        timetable: [],
        assignments: [],
        exams: [],
        fees: []
    }
};

// Ensure data is loaded
let currentData = null;

export function initStore() {
    const rawData = localStorage.getItem(STORAGE_KEY);
    if (!rawData) {
        currentData = JSON.parse(JSON.stringify(SEED_STATE));
        _save();
    } else {
        try {
            currentData = JSON.parse(rawData);
        } catch (e) {
            console.error("Failed to parse local storage, falling back to seed", e);
            currentData = JSON.parse(JSON.stringify(SEED_STATE));
        }
    }
}

function _save() {
    if (!currentData) return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(currentData));
    } catch (e) {
        // Handle quota exceeded gracefully (5 MiB budget)
        console.error("Failed to save data. Budget might be exceeded.", e);
        alert("Warning: Could not save data. Browser storage limit might be reached.");
    }
}

export function getData() {
    if (!currentData) initStore();
    return currentData;
}

export function saveData(data) {
    currentData = data;
    _save();
}

/**
 * Downloads a JSON file with the current data wrapped in an envelope.
 */
export function exportData() {
    if (!currentData) initStore();
    
    const envelope = {
        app: APP_IDENTIFIER,
        schemaVersion: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        data: currentData
    };
    
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `dashboard-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    
    // Cleanup
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

/**
 * Reads a JSON file, validates the envelope, and safely overwrites local storage.
 * @param {File} file - The selected JSON file
 * @param {Function} onComplete - Callback after import
 */
export function importData(file, onComplete) {
    const reader = new FileReader();
    
    reader.onload = (e) => {
        try {
            const result = JSON.parse(e.target.result);
            
            // Loud validation
            if (!result || typeof result !== 'object') {
                throw new Error("Invalid JSON format");
            }
            if (result.app !== APP_IDENTIFIER) {
                throw new Error(`Unknown app identifier: ${result.app}. Expected '${APP_IDENTIFIER}'.`);
            }
            if (result.schemaVersion !== SCHEMA_VERSION) {
                throw new Error(`Unknown schema version: ${result.schemaVersion}. Supported version is ${SCHEMA_VERSION}.`);
            }
            if (!result.data || typeof result.data !== 'object') {
                throw new Error("Missing or invalid 'data' payload in export file.");
            }
            
            const goalCount = Array.isArray(result.data.goals) ? result.data.goals.length : 0;
            const previewMsg = `Restore preview:\n\nExported at: ${result.exportedAt}\nGoals found: ${goalCount}\n\nWarning: This will completely replace your current local data. Are you sure you want to proceed?`;
            
            if (confirm(previewMsg)) {
                currentData = result.data;
                _save();
                alert("Data imported successfully.");
                if (onComplete) onComplete();
            }
            
        } catch (err) {
            alert(`Import failed: ${err.message}`);
            console.error("Import error:", err);
        }
    };
    
    reader.onerror = () => {
        alert("Failed to read file.");
    };
    
    reader.readAsText(file);
}