const radians = Math.PI / 180;
const earthRadiusKm = 6371.0088;
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

export const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

export function parseNearby(text, radius) {
  const pair = text.trim().replaceAll('−', '-').split(/\s*,\s*|\s+/);
  const [lat, lng] = pair.map(Number);
  if (pair.length !== 2 || !pair.every(value => decimal.test(value)) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw Error('Enter decimal latitude and longitude, such as 49.2827, -123.1207.');
  }
  if (!Number.isFinite(radius) || radius < 0.1 || radius > 1000) {
    throw Error('Enter a radius between 0.1 and 1,000 kilometres.');
  }
  return {lat, lng, radius};
}

export function distancesFrom(rows, {lat, lng}) {
  const centreLat = lat * radians;
  const centreLng = lng * radians;
  const centreCos = Math.cos(centreLat);
  return Float64Array.from(rows, row => {
    const rowLat = row[0] * radians;
    const sinLat = Math.sin((rowLat - centreLat) / 2);
    const sinLng = Math.sin((row[1] * radians - centreLng) / 2);
    const h = sinLat * sinLat + centreCos * Math.cos(rowLat) * sinLng * sinLng;
    return 2 * earthRadiusKm * Math.asin(Math.sqrt(Math.min(1, h)));
  });
}

export function filterRecords(rows, fields, {terms, minimum, maximum, radius, distances}) {
  const boundedFrequency = Number.isFinite(minimum) || Number.isFinite(maximum);
  const matches = [];
  for (let i = 0; i < rows.length; i++) {
    if (distances && distances[i] > radius) continue;
    const row = rows[i];
    const tx = row[2], rx = row[3];
    if (boundedFrequency && !((tx !== null && tx >= minimum && tx <= maximum)
      || (rx !== null && rx >= minimum && rx <= maximum))) continue;
    if (terms.length && !terms.every(term => {
      for (let field = 4; field < row.length; field++) {
        if (fields[row[field]].includes(term)) return true;
      }
      return false;
    })) continue;
    matches.push(i);
  }
  if (distances) matches.sort((a, b) => distances[a] - distances[b] || a - b);
  return matches;
}
