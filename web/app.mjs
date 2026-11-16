const get = name => document.getElementById(name);
const make = (tag, text, css = '') => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (css) element.className = css;
  return element;
};
const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const number = value => value.toLocaleString('en-CA');
const perPage = 20;
const mapLimit = 600;
const regionalView = { BC: [[53.5, -124.2], 5], NS: [[45.0, -63.5], 7] };
const map = L.map('map', {preferCanvas: true}).setView(...regionalView.BC);
const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
}).addTo(map);
const points = L.layerGroup().addTo(map);
const selectedPoint = L.layerGroup().addTo(map);
let manifest;
let active;
let index = [];
let rows = [];
let matches = [];
let page = 0;
let selection;
let controller;
let searchTimeout;

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
  const marked = new Set();
  let more = false;
  for (const row of matches) {
    const lat = row[0], lng = row[1];
    if (lat < view.getSouth() || lat > view.getNorth() || lng < view.getWest() || lng > view.getEast()) continue;
    const key = `${lat},${lng}`;
    if (marked.has(key)) continue;
    if (marked.size >= mapLimit) {
      more = true;
      break;
    }
    marked.add(key);
    const point = L.circleMarker([lat, lng], {
      color: '#16372b', weight: 1.4, fillColor: '#84e6b2', fillOpacity: .84, radius: 4,
    });
    point.on('click', () => show(row));
    point.bindTooltip(make('span', label(row)));
    point.addTo(points);
  }
  get('map-count').textContent = more ? `First ${number(mapLimit)} mapped points in view` : `${number(marked.size)} mapped points in view`;
}

function show(record, center = false) {
  selection = record;
  selectedPoint.clearLayers();
  const detail = get('detail');
  if (!record) {
    detail.replaceChildren(make('p', 'Select a result to inspect its frequencies and coordinates.', 'muted'));
    return;
  }
  const [lat, lng, tx, rx, , owner, licence, recordId, technology, secondary, status, date] = record;
  const fixed = active.kind === 'fixed';
  const fields = [
    ['Licensee', index[owner]], ['Licence or authorization', index[licence]], ['Source record ID', index[recordId]],
    ['Coordinates', `${lat}, ${lng}`], ['Transmit', frequency(tx)], ['Receive', frequency(rx)],
    [fixed ? 'ITU station class' : 'Licence category and technology', index[technology]],
    [fixed ? 'Call sign' : 'Reported station type', index[secondary]],
    ['Authorization status', index[status]], [fixed ? 'In-service date' : 'Date last changed', index[date]],
  ];
  const list = make('dl');
  for (const [key, value] of fields) if (value) list.append(make('dt', key), make('dd', value));
  const source = make('a', 'Official ISED source');
  source.href = manifest.source;
  detail.replaceChildren(make('h2', label(record)), make('p', `${active.province} · ${fixed ? 'Fixed service' : 'Terrestrial spectrum site'}`, 'meta'), list, source);
  L.circleMarker([lat, lng], {color: '#e6ffe9', weight: 3, fillColor: '#2f9367', fillOpacity: 1, radius: 8}).addTo(selectedPoint);
  if (center) map.setView([lat, lng], Math.max(map.getZoom(), 10));
  renderList();
}

function renderList() {
  const list = get('results');
  list.replaceChildren();
  for (const row of matches.slice(page * perPage, (page + 1) * perPage)) {
    const button = make('button', label(row), 'result');
    button.type = 'button';
    button.setAttribute('aria-current', String(row === selection));
    button.append(make('span', [bands(row), index[row[5]]].filter(Boolean).join(' · ')));
    button.addEventListener('click', () => show(row, true));
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
  page = 0;
  const query = normalize(get('query').value.trim()).split(/\s+/).filter(Boolean);
  const min = get('minimum').value === '' ? -Infinity : Number(get('minimum').value);
  const max = get('maximum').value === '' ? Infinity : Number(get('maximum').value);
  if (max < min) {
    matches = [];
    get('message').textContent = 'Maximum frequency must be at least the minimum.';
  } else {
    const normalized = query.length ? index.map(normalize) : null;
    matches = rows.filter(row => {
      if ((Number.isFinite(min) || Number.isFinite(max)) && !((row[2] !== null && row[2] >= min && row[2] <= max)
        || (row[3] !== null && row[3] >= min && row[3] <= max))) return false;
      if (!normalized) return true;
      const fields = row.slice(4).map(i => normalized[i]).join(' ');
      return query.every(word => fields.includes(word));
    });
    get('message').textContent = `${number(matches.length)} of ${number(rows.length)} records in this extract`;
  }
  if (selection && !matches.includes(selection)) show(null);
  renderList();
  renderMap();
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
  matches = [];
  page = 0;
  show(null);
  renderList();
  map.setView(...regionalView[province]);
  renderMap();
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

map.on('moveend', renderMap);
get('basemap').addEventListener('change', event => {
  if (event.target.checked) tiles.addTo(map);
  else map.removeLayer(tiles);
});
for (const field of ['province', 'kind']) get(field).addEventListener('change', load);
for (const field of ['query', 'minimum', 'maximum']) get(field).addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(filter, 200);
});
get('reset').addEventListener('click', () => {
  for (const field of ['query', 'minimum', 'maximum']) get(field).value = '';
  filter();
});
get('previous').addEventListener('click', () => { page--; renderList(); });
get('next').addEventListener('click', () => { page++; renderList(); });
get('export').addEventListener('click', () => {
  const header = ['province','extract','latitude','longitude','transmit_mhz','receive_mhz','location','licensee',
    'licence','record_id','class_or_technology','call_sign_or_station_type','authorization_status','source_record_date','extract_date'];
  const selectedRows = matches.slice(0, 10000).map(row => [active.province, active.kind, ...row.slice(0, 4),
    ...row.slice(4).map(i => index[i]), active.extractDate]);
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
  await load();
} catch {
  get('message').textContent = 'The extract manifest is unavailable. Reload or follow the official source below.';
}
