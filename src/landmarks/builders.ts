import type { LandmarkBuilder, LandmarkDef } from './types';
import { buildDome } from './archetypes/dome';
import { buildPyramid } from './archetypes/pyramid';
import { buildEiffel } from './custom/eiffel';

const archetypes: Record<string, LandmarkBuilder> = {
  dome: buildDome,
  pyramid: buildPyramid,
};

const customs: Record<string, LandmarkBuilder> = {
  eiffel: buildEiffel,
};

const cache = new Map<string, ReturnType<LandmarkBuilder>>();

function cacheKey(def: LandmarkDef) {
  return `${def.archetype}:${def.customId ?? ''}:${JSON.stringify(def.params)}:${def.scale}`;
}

/** Builds or reuses a landmark group (geometry cached by archetype + params). */
export function buildLandmark(def: LandmarkDef) {
  const key = cacheKey(def);
  const hit = cache.get(key);
  if (hit) return hit.clone(true);
  const fn = def.archetype === 'custom' && def.customId ? customs[def.customId] : archetypes[def.archetype];
  if (!fn) throw new Error(`Unknown landmark builder: ${def.archetype}/${def.customId}`);
  const root = fn(def.params, def.scale);
  cache.set(key, root);
  return root.clone(true);
}

export function disposeLandmarkCache() {
  cache.forEach(g => g.traverse(o => {
    const m = o as import('three').Mesh;
    if (m.geometry) m.geometry.dispose();
    if (m.material) {
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach(x => x.dispose());
      else mat.dispose();
    }
  }));
  cache.clear();
}
