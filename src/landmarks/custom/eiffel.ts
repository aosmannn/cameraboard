import * as THREE from 'three';
import type { LandmarkBuilder } from '../types';
import { makeMaterials } from '../style';

/** Tapered lattice tower — parametric, not to real height. */
export const buildEiffel: LandmarkBuilder = (_params, scale) => {
  const m = makeMaterials();
  const g = new THREE.Group();
  const s = scale;

  const legs = (x: number, z: number) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(s * 0.08, s * 0.55, s * 0.08), m.metal);
    leg.position.set(x, s * 0.28, z);
    leg.rotation.x = x > 0 ? -0.22 : 0.22;
    leg.rotation.z = z > 0 ? 0.22 : -0.22;
    g.add(leg);
  };
  legs(-s * 0.22, -s * 0.22);
  legs(s * 0.22, -s * 0.22);
  legs(-s * 0.22, s * 0.22);
  legs(s * 0.22, s * 0.22);

  for (const [y, w] of [[0.45, 0.38], [0.62, 0.28], [0.78, 0.18], [0.92, 0.08]] as const) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(s * w, s * 0.04, s * w), m.metal);
    deck.position.y = s * y;
    g.add(deck);
  }
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.02, s * 0.05, s * 0.22, 6), m.metal);
  spire.position.y = s * 1.05;
  g.add(spire);

  // Low segment count lattice hints (four angled struts per level)
  const strutGeo = new THREE.BoxGeometry(s * 0.02, s * 0.18, s * 0.02);
  for (let i = 0; i < 4; i++) {
    const strut = new THREE.Mesh(strutGeo, m.stoneDark);
    const a = (i / 4) * Math.PI * 2;
    strut.position.set(Math.cos(a) * s * 0.15, s * 0.5, Math.sin(a) * s * 0.15);
    strut.rotation.y = a;
    strut.rotation.z = 0.35;
    g.add(strut);
  }
  return g;
};
