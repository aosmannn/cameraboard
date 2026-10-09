import * as THREE from 'three';
import type { LandmarkBuilder } from '../types';
import { makeMaterials } from '../style';

/** Four-sided pyramid with a warm capstone. */
export const buildPyramid: LandmarkBuilder = (params, scale) => {
  const m = makeMaterials();
  const g = new THREE.Group();
  const s = scale * (Number(params.height ?? 1) || 1);
  const geo = new THREE.ConeGeometry(s * 0.72, s * 1, 4, 1);
  geo.rotateY(Math.PI / 4);
  const body = new THREE.Mesh(geo, m.sand);
  body.position.y = s * 0.5;
  g.add(body);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(s * 0.12, s * 0.12, s * 0.12), m.gold);
  cap.position.y = s * 0.98;
  g.add(cap);
  return g;
};
