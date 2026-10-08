// Shared download of OpenFreeMap vector tiles (OpenStreetMap data), so the relief and the streets reuse each other's tiles.
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
export const MAX_VECTOR_ZOOM = 14;

let template: Promise<string> | null = null;
/** The tile address changes with each weekly planet build, so ask the server for the current one. */
const address = () => (template ??= fetch(TILEJSON).then(r => r.json()).then(j => j.tiles[0] as string));

const cache = new Map<string, Promise<VectorTile | null>>();
/** One vector tile, or null if it is missing or the service is unreachable. Recent tiles are kept. */
export function loadVector(z: number, x: number, y: number): Promise<VectorTile | null> {
  const key = `${z}/${x}/${y}`;
  let p = cache.get(key);
  if (!p) {
    p = address().then(t => fetch(t.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))))
      .then(r => r.ok ? r.arrayBuffer() : null)
      .then(b => b ? new VectorTile(new PbfReader(b)) : null)
      .catch(() => null);
    cache.set(key, p);
    if (cache.size > 120) cache.delete(cache.keys().next().value!);
  }
  return p;
}
