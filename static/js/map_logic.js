const NANTES = { lat: 47.2184, lng: -1.5536 };
const PHOTON = 'https://photon.komoot.io';
const NANTES_BBOX = '-1.80,47.08,-1.35,47.35';
const POI_COLORS = { Parc: '#78D700', Eau: '#44A6E3' };
const DEFAULT_POI_COLOR = '#FF8C12';

const map = L.map('map', { zoomControl: false }).setView([NANTES.lat, NANTES.lng], 13);
L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
}).addTo(map);

const statusText = document.getElementById('status');
const resultsEl = document.getElementById('results');
const departTimeInput = document.getElementById('departTime');
const detourSelect = document.getElementById('detourSelect');
const natureCheck = document.getElementById('natureCheck');
const cultureCheck = document.getElementById('cultureCheck');
const pmrCheck = document.getElementById('pmrCheck'); // NOUVEAU
const loadingScreen = document.getElementById('loading-screen');
const dayOptions = document.getElementById('dayOptions');
const nightMessage = document.getElementById('nightMessage');

const places = {
    start: { input: document.getElementById('startAddress'), list: document.getElementById('startSuggestions'), coords: null, marker: null },
    end: { input: document.getElementById('endAddress'), list: document.getElementById('endSuggestions'), coords: null, marker: null }
};

let routeLayer = null;

const formatHour = (date) => date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
if (departTimeInput) departTimeInput.value = formatHour(new Date());

if (natureCheck && cultureCheck) {
    natureCheck.addEventListener('click', (e) => {
        if (!natureCheck.checked) e.preventDefault();
        else cultureCheck.checked = false;
    });
    cultureCheck.addEventListener('click', (e) => {
        if (!cultureCheck.checked) e.preventDefault(); 
        else natureCheck.checked = false;
    });
}

function setStatus(message, isError = false) {
    if (!statusText) return;
    statusText.textContent = message;
    statusText.classList.toggle('error', isError);
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function isNight(timeStr) {
    if (!timeStr) return false;
    const [h, m] = timeStr.split(':').map(Number);
    const month = new Date().getMonth(); 
    const sunset = [17.5, 18.5, 19.5, 20.5, 21.5, 22.0, 21.5, 21.0, 20.0, 19.0, 17.5, 17.0];
    const sunrise = [8.5, 8.0, 7.5, 7.0, 6.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.0, 8.5];
    const timeFloat = h + m / 60;
    return timeFloat >= sunset[month] || timeFloat < sunrise[month];
}

function updateVisibility() {
    if (!departTimeInput || !dayOptions || !nightMessage) return;
    const night = isNight(departTimeInput.value);
    if (night) {
        dayOptions.style.display = 'none';
        nightMessage.style.display = 'block';
    } else {
        dayOptions.style.display = 'contents';
        nightMessage.style.display = 'none';
    }
}

if (departTimeInput) {
    departTimeInput.addEventListener('change', updateVisibility);
    updateVisibility();
}

function formatFeature(feature) {
    const p = feature.properties;
    const street = [p.housenumber, p.street].filter(Boolean).join(' ');
    const city = p.city || p.district || '';
    const main = p.name || street || city;
    const sub = [p.name ? street : '', city].filter(Boolean).join(', ');
    return { main, sub, lat: feature.geometry.coordinates[1], lng: feature.geometry.coordinates[0] };
}

const fullLabel = (item) => [item.main, item.sub].filter(Boolean).join(', ');

async function searchPlaces(query, limit = 5) {
    const params = new URLSearchParams({ q: query, lat: NANTES.lat, lon: NANTES.lng, bbox: NANTES_BBOX, limit, lang: 'fr' });
    const res = await fetch(`${PHOTON}/api/?${params}`);
    if (!res.ok) throw new Error(`Photon ${res.status}`);
    const data = await res.json();
    return (data.features || []).map(formatFeature);
}

async function reverseGeocode({ lat, lng }) {
    try {
        const params = new URLSearchParams({ lat, lon: lng, lang: 'fr' });
        const res = await fetch(`${PHOTON}/reverse?${params}`);
        const data = await res.json();
        if (data.features && data.features.length) return fullLabel(formatFeature(data.features[0]));
    } catch (err) {}
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function setPlace(key, coords, label) {
    const place = places[key];
    place.coords = coords;
    if (label !== undefined) place.input.value = label;
    if (place.marker) map.removeLayer(place.marker);
    place.marker = null;
    if (!coords) return;

    place.marker = L.marker([coords.lat, coords.lng], {
        draggable: true,
        icon: L.divIcon({ className: `pin pin-${key}`, iconSize: [20, 20], iconAnchor: [10, 10] })
    }).addTo(map);

    place.marker.on('dragend', async () => {
        const { lat, lng } = place.marker.getLatLng();
        place.coords = { lat, lng };
        place.input.value = await reverseGeocode(place.coords);
    });
}

async function resolvePlace(key) {
    const place = places[key];
    if (place.coords) return true;
    const query = place.input.value.trim();
    if (!query) return false;
    const [first] = await searchPlaces(query, 1).catch(() => []);
    if (!first) return false;
    setPlace(key, { lat: first.lat, lng: first.lng }, fullLabel(first));
    return true;
}

function setupAutocomplete(key) {
    const place = places[key];
    if (!place.input || !place.list) return; 

    let timer = null, items = [], active = -1;

    const close = () => { place.list.replaceChildren(); place.list.hidden = true; items = []; active = -1; };
    
    const choose = (item) => { 
        close(); 
        setPlace(key, { lat: item.lat, lng: item.lng }, fullLabel(item)); 
        map.panTo([item.lat, item.lng]); 
    };

    const render = () => {
        place.list.replaceChildren(...items.map((item, i) => {
            const li = el('li', i === active ? 'active' : '');
            li.append(el('strong', '', item.main), el('small', '', item.sub));
            li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(item); });
            return li;
        }));
        place.list.hidden = items.length === 0;
    };

    place.input.addEventListener('input', () => {
        place.coords = null;
        clearTimeout(timer);
        const query = place.input.value.trim();
        if (query.length < 2) { close(); return; }
        timer = setTimeout(async () => {
            const found = await searchPlaces(query).catch(() => []);
            if (place.input.value.trim() !== query) return;
            items = found; active = -1; render();
        }, 250);
    });

    place.input.addEventListener('keydown', (e) => {
        if (place.list.hidden || !items.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; render(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; render(); }
        else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(items[active]); }
        else if (e.key === 'Escape') close();
    });
    
    place.input.addEventListener('blur', close);
}

setupAutocomplete('start'); setupAutocomplete('end');

const locateBtn = document.getElementById('locateBtn');
if (locateBtn) {
    locateBtn.addEventListener('click', () => {
        if (!navigator.geolocation) { setStatus("Géolocalisation indisponible.", true); return; }
        setStatus("Localisation en cours...");
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                setPlace('start', coords, 'Ma position');
                map.setView([coords.lat, coords.lng], 16);
                setStatus('');
            },
            () => setStatus("Impossible de vous localiser.", true),
            { enableHighAccuracy: true, timeout: 10000 }
        );
    });
}

const swapBtn = document.getElementById('swapBtn');
if (swapBtn) {
    swapBtn.addEventListener('click', () => {
        const start = { coords: places.start.coords, label: places.start.input.value };
        const end = { coords: places.end.coords, label: places.end.input.value };
        setPlace('start', end.coords, end.label); setPlace('end', start.coords, start.label);
    });
}

const routeForm = document.getElementById('routeForm');
if (routeForm) {
    routeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!places.start.input.value.trim() || !places.end.input.value.trim()) { setStatus("Renseignez le départ et l'arrivée.", true); return; }
        
        if (!(await resolvePlace('start'))) { setStatus("Départ introuvable.", true); return; }
        if (!(await resolvePlace('end'))) { setStatus("Arrivée introuvable.", true); return; }
        calculateAndDrawRoute();
    });
}

map.on('click', async (e) => {
    const coords = { lat: e.latlng.lat, lng: e.latlng.lng };
    let key = places.start.coords && !places.end.coords ? 'end' : 'start';
    if (key === 'start') { clearRoute(); setPlace('end', null, ''); }
    setPlace(key, coords, "Recherche...");
    places[key].input.value = await reverseGeocode(coords);
    if (key === 'start') setStatus("Cliquez pour définir l'arrivée.");
});

function clearRoute() {
    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = null; 
    if (resultsEl) resultsEl.replaceChildren();
}

async function calculateAndDrawRoute() {
    const start = places.start.coords;
    const end = places.end.coords;
    
    const isNightTime = departTimeInput ? isNight(departTimeInput.value) : false;
    const mode = isNightTime ? "nuit" : "jour";
    
    const mapTiles = document.querySelector('.leaflet-layer');
    if (mapTiles) mapTiles.style.filter = isNightTime ? 'invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%)' : 'none';
    
    const detour = isNightTime || !detourSelect ? 0 : detourSelect.value;
    
    let theme = "nature"; 
    if (cultureCheck && cultureCheck.checked) theme = "culture";
    if (isNightTime) theme = "none";
    
    // NOUVEAU : Récupération du paramètre PMR
    const pmr = pmrCheck ? pmrCheck.checked : false;

    const params = new URLSearchParams();
    params.append("lat_start", start.lat);
    params.append("lon_start", start.lng);
    params.append("lat_end", end.lat);
    params.append("lon_end", end.lng);
    params.append("detour_min", detour);
    params.append("mode", mode);
    params.append("theme", theme);
    params.append("pmr", pmr);

    setStatus(""); 
    if (loadingScreen) loadingScreen.classList.remove('hidden');

    try {
        const res = await fetch(`/api/route?${params}`);
        const data = await res.json();
        
        if (loadingScreen) loadingScreen.classList.add('hidden');
        if (data.error) { setStatus("Erreur : " + data.error, true); return; }

        clearRoute();
        const poiLayers = drawRoute(data);
        renderResults(data, poiLayers, isNightTime);
    } catch (err) {
        if (loadingScreen) loadingScreen.classList.add('hidden');
        setStatus("Erreur serveur.", true);
    }
}

function drawRoute(data) {
    const poiLayers = [];
    routeLayer = L.geoJSON(data, {
        style: (f) => f.properties.type === 'Route'
            ? { color: '#78D700', weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round' }
            : undefined,
            
        pointToLayer: (f, latlng) => {
            return L.circleMarker(latlng, {
                radius: 7, fillColor: POI_COLORS[f.properties.type] || DEFAULT_POI_COLOR,
                color: '#002300', weight: 2, opacity: 1, fillOpacity: 0.9
            });
        },
        onEachFeature: (f, layer) => {
            if (f.geometry.type !== 'Point') return;
            
            const popup = el('div');
            popup.style.textAlign = 'center';
            popup.append(el('strong', '', f.properties.nom), el('br'), el('small', '', f.properties.type));
            
            if (f.properties.type === 'Parc') {
                const ul = el('ul');
                ul.style.listStyle = 'none'; ul.style.padding = '0'; ul.style.margin = '10px 0 0 0';
                ul.style.fontSize = '12px'; ul.style.textAlign = 'left'; ul.style.color = '#5f6b66';
                
                const formatData = (val) => (!val || val === 'NON' || val.toLowerCase() === 'nan') ? 'Non' : (val === 'OUI' ? 'Oui' : val);
                
                ul.append(el('li', '', `🚰 Eau : ${formatData(f.properties.eau)}`));
                ul.append(el('li', '', `🐕 Chiens : ${formatData(f.properties.chiens)}`));
                ul.append(el('li', '', `🚻 Toilettes : ${formatData(f.properties.sanitaires)}`));
                
                popup.append(ul);
            }
            
            layer.bindPopup(popup);
            poiLayers.push({ feature: f, layer });
        }
    }).addTo(map);

    map.fitBounds(routeLayer.getBounds(), { padding: [50, 50] });
    return poiLayers;
}

function renderResults(data, poiLayers, isNightTime) {
    const route = data.features.find((f) => f.properties.type === 'Route');
    if (!route) return;

    const { time_min, distance_m, calories, co2_saved, steps } = route.properties;
    const minutes = Math.round(time_min);
    const [h, m] = (departTimeInput && departTimeInput.value ? departTimeInput.value : formatHour(new Date())).split(':').map(Number);
    const departure = new Date(); departure.setHours(h, m, 0, 0);
    const arrival = new Date(departure.getTime() + minutes * 60000);

    const card = el('article', 'journey');
    
    if (isNightTime) {
        const nightBanner = el('div');
        nightBanner.style.backgroundColor = '#002300';
        nightBanner.style.color = '#78D700';
        nightBanner.style.padding = '10px 14px';
        nightBanner.style.borderRadius = '8px';
        nightBanner.style.marginBottom = '12px';
        nightBanner.style.fontSize = '13.5px';
        nightBanner.innerHTML = '🌙 <b>Trajet nocturne sécurisé</b><br><span style="color: #d6dbd8; font-size: 12.5px;">Nous privilégions les grands axes et les zones éclairées.</span>';
        card.append(nightBanner);
    }

    const head = el('div', 'journey-head');
    head.append(
        el('span', 'journey-hours', `${formatHour(departure)} → ${formatHour(arrival)}`),
        el('span', 'journey-duration', `${minutes} min`)
    );
    card.append(head, el('div', 'journey-mode', `\u{1F6B6} Marche · ${(distance_m / 1000).toFixed(2).replace('.', ',')} km`));

    const stats = el('ul', 'journey-stats');
    if (steps !== undefined) stats.append(el('li', '', `👣 ${steps} pas`));
    if (calories !== undefined) stats.append(el('li', '', `🔥 ${calories} kcal`));
    if (co2_saved !== undefined) stats.append(el('li', '', `🍃 ${co2_saved} g CO₂ évités`));
    card.append(stats);

    const timeline = el('ol', 'timeline');
    timeline.append(el('li', 'tl-start', `Départ : ${places.start.input.value}`));
    
    poiLayers.forEach(({ feature, layer }) => {
        const li = el('li', 'tl-poi');
        li.style.setProperty('--poi-color', POI_COLORS[feature.properties.type] || DEFAULT_POI_COLOR);
        li.append(el('span', '', feature.properties.nom));
        li.addEventListener('click', () => { map.setView(layer.getLatLng(), 16); layer.openPopup(); });
        timeline.append(li);
    });
    
    timeline.append(el('li', 'tl-end', `Arrivée : ${places.end.input.value}`));
    card.append(timeline);
    if (resultsEl) resultsEl.replaceChildren(card);
}