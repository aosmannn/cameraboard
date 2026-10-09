import * as THREE from 'three';
import type { LandmarkBuilder } from '../types';
import { makeMaterials } from '../style';

/** Stepped drum + hemisphere — St. Peter's–style landmark silhouette. */
export const buildDome: LandmarkBuilder = (params, scale) => {
  const m = makeMaterials();
  const g = new THREE.Group();
  const s = scale * (Number(params.height ?? 1) || 1);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.55, s * 0.6, s * 0.35, 10), m.stone);
  drum.position.y = s * 0.18;
  g.add(drum);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(s * 0.52, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.roof);
  dome.position.y = s * 0.35;
  g.add(dome);
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.08, s * 0.1, s * 0.18, 8), m.gold);
  lantern.position.y = s * 0.78;
  g.add(lantern);
  const cross = new THREE.Mesh(new THREE.BoxGeometry(s * 0.04, s * 0.22, s * 0.04), m.gold);
  cross.position.y = s * 0.95;
  g.add(cross);
  // Anchor at ground: group origin is base center
  g.position.y = 0;
  return g;
};
