import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Isolate travel rules from Leaflet's browser rendering. Use two known countries.
const bundle = await build({
  entryPoints: ['src/travel.ts'], bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'country-fixture', setup(b) {
    b.onResolve({ filter: /^\.\/world$/ }, () => ({ path: 'world', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const countryAt = (lat, lng) => lat > 40 && lat < 52 && lng > -5 && lng < 9 ? 'France' : 'Vietnam';` }));
  } }],
});
const travel = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const storage = new Map();
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) };
const photo = (id, lat, lng, date = '2024-01-01') => ({ id, lat, lng, date, img: 'test-photo' });
const paris = photo('paris', 48.8566, 2.3522);
const lyon = photo('lyon', 45.764, 4.8357);
const item = overrides => travel.newBucketItem({ title: 'Paris', kind: 'city', country: 'France', lat: 48.8566, lng: 2.3522, ...overrides });

test('city requires a nearby photo, not just the same country', () => {
  assert.equal(travel.matchBucketHits([item({})], [lyon]).length, 0);
  assert.equal(travel.matchBucketHits([item({})], [paris])[0].photoId, 'paris');
});
test('country matches anywhere in the country; experiences stay manual', () => {
  assert.equal(travel.matchBucketHits([item({ kind: 'country' })], [lyon]).length, 1);
  assert.equal(travel.matchBucketHits([item({ kind: 'experience' })], [paris]).length, 0);
  assert.equal(travel.matchBucketHits([item({ lat: null, lng: null })], [paris]).length, 0);
});
test('done items, empty cards and unplaced photos are ignored', () => {
  assert.equal(travel.matchBucketHits([{ ...item({}), status: 'done' }], [paris]).length, 0);
  assert.equal(travel.matchBucketHits([item({})], [{ ...paris, img: null }, { ...paris, lat: null }]).length, 0);
});
test('photo visits update counts and dates after photo removal', () => {
  storage.clear();
  let visits = travel.syncVisitsFromPhotos([paris, { ...lyon, date: '2025-01-01' }]);
  assert.equal(visits[0].photoCount, 2);
  visits = travel.syncVisitsFromPhotos([{ ...lyon, date: '2025-01-01' }]);
  assert.equal(visits[0].photoCount, 1);
  assert.match(visits[0].firstAt, /^2025/);
  assert.deepEqual(travel.syncVisitsFromPhotos([]), []);
});
test('manual visits survive photo removal without stale counts', () => {
  storage.clear(); travel.toggleManualVisit('France');
  assert.equal(travel.syncVisitsFromPhotos([paris])[0].photoCount, 1);
  const visits = travel.syncVisitsFromPhotos([]);
  assert.equal(visits[0].source, 'manual'); assert.equal(visits[0].photoCount, 0);
  assert.deepEqual(travel.toggleManualVisit('France'), []);
});
test('invalid photo dates do not crash travel rendering', () => {
  storage.clear();
  assert.doesNotThrow(() => travel.syncVisitsFromPhotos([{ ...paris, date: 'invalid' }]));
});
test('saved bucket items survive a storage round trip', () => {
  storage.clear(); const items = [item({})];
  travel.saveBucket(items); assert.deepEqual(travel.loadBucket(), items);
});

test('explicitly reopened items are not auto-completed on refresh', () => {
  assert.equal(travel.matchBucketHits([{ ...item({}), autoComplete: false }], [paris]).length, 0);
});
