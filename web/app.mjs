import {distancesFrom, filterRecords, normalize, parseNearby} from './search.mjs';

const get = name => document.getElementById(name);
const make = (tag, text, css = '') => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (css) element.className = css;
  return element;
};
const number = value => value.toLocaleString('en-CA');
const kilometres = value => `${value.toLocaleString('en-CA', {maximumFractionDigits: 2})} km`;
const perPage = 20;
const mapLimit = 600;
const regionalView = {
  AB: [[54.5, -114.8], 5],
  BC: [[53.5, -124.2], 5],
  MB: [[54.5, -98.5], 5],
  NB: [[46.6, -66.6], 7],
  NL: [[53, -59], 5],
  NS: [[45, -63.5], 7],
  NT: [[65, -119], 4],
  NU: [[68, -92], 3],
  ON: [[50, -84], 5],
  PE: [[46.35, -63.3], 8],
  QC: [[52, -71], 5],
  SK: [[54, -106], 5],
  YT: [[64, -135], 5],
};
const cities = {
  ab: ['AB', 53.55, -113.49],
  mb: ['MB', 49.9, -97.14],
  nb: ['NB', 45.96, -66.64],
  nl: ['NL', 47.56, -52.71],
  nt: ['NT', 62.45, -114.37],
  nu: ['NU', 63.75, -68.52],
  on: ['ON', 43.65, -79.38],
  pe: ['PE', 46.24, -63.13],
  qc: ['QC', 45.5, -73.57],
  sk: ['SK', 50.45, -104.62],
  yt: ['YT', 60.72, -135.05],
  vancouver: ['BC', 49.2827, -123.1207], langley: ['BC', 49.1044, -122.6600],
  victoria: ['BC', 48.4284, -123.3656], kelowna: ['BC', 49.8880, -119.4960],
  halifax: ['NS', 44.6488, -63.5752], sydney: ['NS', 46.1368, -60.1942],
  yarmouth: ['NS', 43.8375, -66.1176],
};
const map = L.map('map', {preferCanvas: true}).setView(...regionalView.BC);
const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
}).addTo(map);
const points = L.layerGroup().addTo(map);
const selectedPoint = L.layerGroup().addTo(map);
const radiusOverlay = L.layerGroup().addTo(map);
let manifest;
let active;
let index = [];
let normalizedIndex;
let rows = [];
let matches = [];
let page = 0;
let selection;
let controller;
let searchTimeout;
let nearby;
let distances;
let picking = false;
let mapQueued = false;

const label = row => index[row[4]] || `${row[0].toFixed(4)}, ${row[1].toFixed(4)}`;
const frequency = value => value === null ? '' : `${value.toLocaleString('en-CA', {maximumFractionDigits: 6})} MHz`;
const bands = row => [row[2] === null ? '' : 'TX ' + frequency(row[2]), row[3] === null ? '' : 'RX ' + frequency(row[3])].filter(Boolean).join(' · ') || 'Frequency not supplied';
const csv = value => {
  const text = String(value ?? '');
  return '"' + (/^[\t\r\n]|^\s*[=+@-]/.test(text) && typeof value !== 'number' ? "'" + text : text).replace(/"/g, '""') + '"';
};

function renderMap() {
  points.clearLayers();
  const view = map.getBounds();
  const south = view.getSouth(), north = view.getNorth(), west = view.getWest(), east = view.getEast();
  const marked = new Set();
  let more = false;
  for (const id of matches) {
    const row = rows[id];
    const lat = row[0], lng = row[1];
    if (lat < south || lat > north || lng < west || lng > east) continue;
    const key = `${lat},${lng}`;
    if (marked.has(key)) continue;
    if (marked.size >= mapLimit) {
      more = true;
      break;
    }
    marked.add(key);
    const point = L.circleMarker([lat, lng], {
      color: '#16372b', weight: 1.4, fillColor: '#84e6b2', fillOpacity: .84, radius: 4, bubblingMouseEvents: false,
    });
    point.on('click', event => picking ? pickAt(event.latlng) : show(id));
    point.bindTooltip(make('span', label(row)));
    point.addTo(points);
  }
  get('map-count').textContent = more ? `First ${number(mapLimit)} mapped points in view` : `${number(marked.size)} mapped points in view`;
}

function queueMap() {
  if (mapQueued) return;
  mapQueued = true;
  requestAnimationFrame(() => {
    mapQueued = false;
    renderMap();
  });
}

function renderDetail() {
  selectedPoint.clearLayers();
  const detail = get('detail');
  const record = rows[selection];
  if (!record) {
    detail.replaceChildren(make('p', 'Select a result to inspect its frequencies and coordinates.', 'muted'));
    return;
  }
  const [lat, lng, tx, rx, , owner, licence, recordId, technology, secondary, status, date] = record;
  const fixed = active.kind === 'fixed';
  const fields = [
    ['Licensee', index[owner]], ['Licence or authorization', index[licence]], ['Source record ID', index[recordId]],
    ['Coordinates', `${lat}, ${lng}`], ['Distance from search centre', distances ? kilometres(distances[selection]) : ''],
    ['Transmit', frequency(tx)], ['Receive', frequency(rx)],
    [fixed ? 'ITU station class' : 'Licence category and technology', index[technology]],
    [fixed ? 'Call sign' : 'Reported station type', index[secondary]],
    ['Authorization status', index[status]], [fixed ? 'In-service date' : 'Date last changed', index[date]],
  ];
  const list = make('dl');
  for (const [key, value] of fields) if (value) list.append(make('dt', key), make('dd', value));
  const source = make('a', 'Official ISED source');
  source.href = manifest.source;
  detail.replaceChildren(make('h2', label(record)), make('p', `${active.province} · ${fixed ? 'Fixed service' : 'Terrestrial spectrum site'}`, 'meta'), list, source);
  L.circleMarker([lat, lng], {color: '#e6ffe9', weight: 3, fillColor: '#2f9367', fillOpacity: 1, radius: 8, interactive: false}).addTo(selectedPoint);
}

function show(id, centre = false) {
  selection = id;
  renderDetail();
  if (centre) map.setView(rows[id].slice(0, 2), Math.max(map.getZoom(), 10));
  renderList();
}

function renderList() {
  const list = get('results');
  list.replaceChildren();
  for (const id of matches.slice(page * perPage, (page + 1) * perPage)) {
    const row = rows[id];
    const button = make('button', label(row), 'result');
    button.type = 'button';
    button.setAttribute('aria-current', String(id === selection));
    button.append(make('span', [distances && kilometres(distances[id]), bands(row), index[row[5]]].filter(Boolean).join(' · ')));
    button.addEventListener('click', () => show(id, true));
    const element = make('li');
    element.append(button);
    list.append(element);
  }
  const pages = Math.ceil(matches.length / perPage);
  get('count').textContent = number(matches.length);
  get('page').textContent = pages ? `Page ${number(page + 1)} / ${number(pages)}` : 'No matches';
  get('previous').disabled = page === 0;
  get('next').disabled = page + 1 >= pages;
  get('export').disabled = !matches.length;
}

function filter() {
  if (!rows.length) return;
  page = 0;
  const terms = [...new Set(normalize(get('query').value.trim()).split(/\s+/).filter(Boolean))];
  const min = get('minimum').value === '' ? -Infinity : Number(get('minimum').value);
  const max = get('maximum').value === '' ? Infinity : Number(get('maximum').value);
  if (max < min) {
    matches = [];
    get('message').textContent = 'Maximum frequency must be at least the minimum.';
  } else {
    if (terms.length) normalizedIndex ??= index.map(normalize);
    if (nearby) distances ??= distancesFrom(rows, nearby);
    matches = filterRecords(rows, normalizedIndex, {terms, minimum: min, maximum: max, radius: nearby?.radius, distances});
    get('message').textContent = `${number(matches.length)} of ${number(rows.length)} records in this extract${nearby ? ' · nearest first' : ''}`;
  }
  if (selection !== undefined) {
    if (!matches.includes(selection)) selection = undefined;
    renderDetail();
  }
  renderList();
  queueMap();
}

async function load() {
  controller?.abort();
  const attempt = new AbortController();
  controller = attempt;
  clearTimeout(searchTimeout);
  const province = get('province').value;
  const kind = get('kind').value;
  active = manifest.shards.find(shard => shard.kind === kind && shard.province === province);
  if (!active) return;
  rows = [];
  index = [];
  normalizedIndex = undefined;
  distances = undefined;
  matches = [];
  page = 0;
  show(undefined);
  if (!nearby) map.setView(...regionalView[province]);
  queueMap();
  get('source-date').textContent = `ISED · extract archive ${active.extractDate} · built ${manifest.built}`;
  get('message').textContent = `Loading ${number(active.count)} records for ${province}…`;
  try {
    const response = await fetch('./' + active.file, {signal: attempt.signal});
    if (!response.ok) throw Error('Extract file could not be loaded');
    const payload = await response.json();
    if (attempt !== controller) return;
    rows = payload.rows;
    index = payload.index;
    filter();
  } catch {
    if (attempt === controller) get('message').textContent = 'Could not load the extract. Change the selection or reload to retry.';
  }
}

function setPicking(value) {
  picking = value;
  get('pick-centre').setAttribute('aria-pressed', String(value));
  get('pick-centre').textContent = value ? 'Cancel map pick' : 'Pick search centre';
  get('map-instruction').hidden = !value;
  get('map').classList.toggle('picking', value);
}

function applyNearby() {
  const status = get('nearby-status');
  let next;
  try {
    next = parseNearby(get('nearby-coordinates').value, get('nearby-radius').valueAsNumber);
  } catch (error) {
    status.textContent = error.message;
    status.classList.add('invalid');
    return;
  }
  clearTimeout(searchTimeout);
  setPicking(false);
  if (next.lat !== nearby?.lat || next.lng !== nearby?.lng) distances = undefined;
  nearby = next;
  get('nearby-clear').disabled = false;
  status.classList.remove('invalid');
  status.textContent = `Within ${kilometres(nearby.radius)} of ${nearby.lat}, ${nearby.lng} in the selected extract.`;
  const centre = [nearby.lat, nearby.lng];
  radiusOverlay.clearLayers();
  if (Math.abs(nearby.lat) < 85) {
    const circle = L.circle(centre, {
      radius: nearby.radius * 1000, color: '#e9bb74', weight: 2, dashArray: '5 5', fillOpacity: .07, interactive: false,
    }).addTo(radiusOverlay);
    L.circleMarker(centre, {radius: 5, color: '#e9bb74', fillOpacity: 1, interactive: false}).addTo(radiusOverlay);
    map.fitBounds(circle.getBounds(), {padding: [20, 20], maxZoom: 14, animate: false});
  }
  const province = cities[get('nearby-city').value]?.[0];
  if (province && province !== get('province').value) {
    get('province').value = province;
    load();
  } else {
    filter();
  }
}

function pickAt(point) {
  const {lat, lng} = map.wrapLatLng(point);
  get('nearby-city').value = '';
  get('nearby-coordinates').value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  setPicking(false);
  applyNearby();
}

function clearNearby() {
  nearby = undefined;
  distances = undefined;
  radiusOverlay.clearLayers();
  setPicking(false);
  get('nearby-coordinates').value = '';
  get('nearby-city').value = '';
  get('nearby-clear').disabled = true;
  const status = get('nearby-status');
  status.classList.remove('invalid');
  status.textContent = 'Enter coordinates, choose a city or pick a centre on the map.';
}

map.on('moveend', queueMap);
map.on('click', event => {
  if (picking) pickAt(event.latlng);
});
get('pick-centre').addEventListener('click', () => setPicking(!picking));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && picking) setPicking(false);
});
get('nearby-form').addEventListener('submit', event => {
  event.preventDefault();
  applyNearby();
});
get('nearby-coordinates').addEventListener('input', () => { get('nearby-city').value = ''; });
get('nearby-city').addEventListener('change', event => {
  const city = cities[event.target.value];
  if (!city) return;
  const [, lat, lng] = city;
  get('nearby-coordinates').value = `${lat}, ${lng}`;
  applyNearby();
});
get('nearby-clear').addEventListener('click', () => {
  clearTimeout(searchTimeout);
  clearNearby();
  filter();
});
get('basemap').addEventListener('change', event => {
  if (event.target.checked) tiles.addTo(map);
  else map.removeLayer(tiles);
});
get('province').addEventListener('change', event => {
  clearNearby();
  load();
});
get('kind').addEventListener('change', load);
for (const field of ['query', 'minimum', 'maximum']) get(field).addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(filter, 200);
});
get('reset').addEventListener('click', () => {
  clearTimeout(searchTimeout);
  for (const field of ['query', 'minimum', 'maximum']) get(field).value = '';
  clearNearby();
  get('nearby-radius').value = '25';
  filter();
});
get('previous').addEventListener('click', () => { page--; renderList(); });
get('next').addEventListener('click', () => { page++; renderList(); });
get('export').addEventListener('click', () => {
  const header = ['province','extract','latitude','longitude','transmit_mhz','receive_mhz','location','licensee',
    'licence','record_id','class_or_technology','call_sign_or_station_type','authorization_status','source_record_date','extract_date'];
  if (nearby) header.push('distance_km', 'search_centre_latitude', 'search_centre_longitude', 'search_radius_km');
  const selectedRows = matches.slice(0, 10000).map(id => {
    const row = rows[id];
    const fields = [active.province, active.kind, ...row.slice(0, 4), ...row.slice(4).map(i => index[i]), active.extractDate];
    if (nearby) fields.push(Number(distances[id].toFixed(3)), nearby.lat, nearby.lng, nearby.radius);
    return fields;
  });
  const data = [header, ...selectedRows].map(row => row.map(csv).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([data], {type: 'text/csv;charset=utf-8'}));
  const anchor = make('a');
  anchor.href = url;
  anchor.download = `spectrum-atlas-${active.kind}-${active.province.toLowerCase()}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

try {
  const response = await fetch('./manifest.json');
  if (!response.ok) throw Error('Manifest not available');
  manifest = await response.json();
  get('controls').disabled = false;
  get('pick-centre').disabled = false;
  await load();
} catch {
  get('message').textContent = 'The extract manifest is unavailable. Reload or follow the official source below.';
}
