import type * as THREE from 'three';

/** One entry in the bundled landmark catalog. */
export interface LandmarkDef {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Parametric shape id, or `custom` with `customId`. */
  archetype: string;
  customId?: string;
  params: Record<string, number | string | boolean>;
  /** First zoom level where the model appears. */
  minZoom: number;
  /** Footprint multiplier (normalized ~1 tile at minZoom). */
  scale: number;
}

export type ProjectPoint = (lat: number, lon: number) => { x: number; y: number } | null;

export type LandmarkBuilder = (params: LandmarkDef['params'], scale: number) => THREE.Group;
