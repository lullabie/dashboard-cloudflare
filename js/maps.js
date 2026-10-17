/**
 * Maps Logic
 */
import { getData, saveData } from './store.js';

export function getPlaces() {
    const data = getData();
    return data.places || [];
}

export function savePlace(placeData) {
    const data = getData();
    if (!data.places) {
        data.places = [];
    }

    if (placeData.id) {
        const index = data.places.findIndex(p => p.id === placeData.id);
        if (index !== -1) {
            data.places[index] = { ...data.places[index], ...placeData };
        }
    } else {
        const newPlace = {
            id: 'place_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            ...placeData,
            createdAt: new Date().toISOString()
        };
        data.places.push(newPlace);
    }
    
    saveData(data);
}

export function deletePlace(placeId) {
    const data = getData();
    if (data.places) {
        data.places = data.places.filter(p => p.id !== placeId);
        saveData(data);
    }
}

/**
 * Generates an OpenStreetMap embed URL.
 * Calculates a bounding box encompassing all places, or centers on a specific place.
 * Adds a marker if an active place is provided.
 */
export function getMapEmbedUrl(places, activePlace = null) {
    if (!places || places.length === 0) return null;

    let baseUrl = 'https://www.openstreetmap.org/export/embed.html';
    let params = new URLSearchParams();

    if (places.length > 0) {
        // Calculate bounding box
        let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
        places.forEach(p => {
            const lat = parseFloat(p.lat);
            const lng = parseFloat(p.lng);
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
        });

        // Add some padding to the bounding box
        const latPadding = Math.max(0.01, (maxLat - minLat) * 0.1);
        const lngPadding = Math.max(0.01, (maxLng - minLng) * 0.1);
        
        const bbox = [
            minLng - lngPadding,
            minLat - latPadding,
            maxLng + lngPadding,
            maxLat + latPadding
        ].join(',');
        
        params.append('bbox', bbox);
        params.append('layer', 'mapnik');
    }

    if (activePlace) {
        params.append('marker', `${activePlace.lat},${activePlace.lng}`);
    }

    return `${baseUrl}?${params.toString()}`;
}

export function createPlaceElement(place, onEdit, onDelete, onClick, isActive) {
    const el = document.createElement('div');
    el.className = `place-item ${isActive ? 'active' : ''}`;
    
    const info = document.createElement('div');
    info.className = 'place-info';
    info.addEventListener('click', () => onClick(place));
    
    const dot = document.createElement('div');
    dot.className = 'place-color-dot';
    dot.style.backgroundColor = place.color || '#a3e635';
    
    const textContainer = document.createElement('div');
    
    const name = document.createElement('div');
    name.className = 'place-name';
    name.textContent = place.name;
    
    const coords = document.createElement('div');
    coords.className = 'place-coords';
    coords.textContent = `${parseFloat(place.lat).toFixed(4)}, ${parseFloat(place.lng).toFixed(4)}`;
    
    textContainer.appendChild(name);
    textContainer.appendChild(coords);
    
    info.appendChild(dot);
    info.appendChild(textContainer);
    
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    
    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn';
    editBtn.textContent = '✎';
    editBtn.title = 'Edit';
    editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        onEdit(place);
    });
    
    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn';
    delBtn.textContent = '×';
    delBtn.title = 'Delete';
    delBtn.style.color = 'var(--danger-color)';
    delBtn.style.borderColor = 'var(--danger-color)';
    delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete ${place.name}?`)) {
            onDelete(place.id);
        }
    });
    
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    
    el.appendChild(info);
    el.appendChild(actions);
    
    return el;
}
