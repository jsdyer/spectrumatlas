import assert from 'node:assert/strict';
import test from 'node:test';
import {distancesFrom, filterRecords, normalize, parseNearby} from '../web/search.mjs';

test('parses a decimal pair and rejects missing or out-of-range values', () => {
  assert.deepEqual(parseNearby(' 49.2827, −123.1207 ', 25), {lat: 49.2827, lng: -123.1207, radius: 25});
  assert.deepEqual(parseNearby('+44.65 -63.58', 0.1), {lat: 44.65, lng: -63.58, radius: 0.1});
  for (const invalid of ['', '49,', '91,-123', '49,-195', '0x32,-123', '1e2,2', '49,-123,25']) {
    assert.throws(() => parseNearby(invalid, 25), /latitude and longitude/);
  }
  for (const invalid of [NaN, Infinity, 0, 1000.1]) assert.throws(() => parseNearby('49,-123', invalid), /radius/);
});

test('computes distance across a one-degree arc and the antimeridian', () => {
  const [same, oneDegree, acrossDateline] = distancesFrom([[0, 179.5], [1, 179.5], [0, -179.5]], {lat: 0, lng: 179.5});
  assert.equal(same, 0);
  assert.ok(Math.abs(oneDegree - 111.195) < 0.01);
  assert.ok(Math.abs(acrossDateline - oneDegree) < 0.01);
});

test('composes radius, text and frequency filters and preserves distinct colocated records', () => {
  const index = ['', 'Halifax Radio', 'Réseau Operator', 'Other Site'].map(normalize);
  const rows = [
    [44.7, -63.6, 450, null, 1, 2],
    [44.65, -63.6, null, 455, 1, 2],
    [44.65, -63.6, 456, null, 1, 2],
    [44.65, -63.6, 900, null, 1, 2],
    [44.65, -63.6, 455, null, 3, 2],
    [45.2, -63.6, 455, null, 1, 2],
  ];
  const distances = distancesFrom(rows, {lat: 44.65, lng: -63.6});
  const filters = {terms: ['halifax', 'reseau'], minimum: 450, maximum: 460};
  assert.deepEqual(filterRecords(rows, index, {...filters, radius: 10, distances}), [1, 2, 0]);
  assert.deepEqual(filterRecords(rows, index, {...filters, radius: 3, distances}), [1, 2]);
  assert.deepEqual(filterRecords(rows, index, filters), [0, 1, 2, 5]);
  assert.deepEqual(filterRecords(rows, undefined, {terms: [], minimum: -Infinity, maximum: Infinity}), [0, 1, 2, 3, 4, 5]);
});
