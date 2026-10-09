import * as THREE from 'three';
import { makeMaterials } from './style';

/** Pedestal + soft halo so the model reads as a featured landmark on the map. */
export function wrapShowcase(model: THREE.Group): THREE.Group {
  const m = makeMaterials();
  const g = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.82, 0.1, 12), m.stoneDark);
  pad.position.y = 0.05;
  g.add(pad);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.78, 0.92, 20),
    new THREE.MeshBasicMaterial({ color: 0xfff4d0, transparent: true, opacity: 0.42, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.11;
  g.add(ring);
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(1.05, 20),
    new THREE.MeshBasicMaterial({ color: 0xffe8a8, transparent: true, opacity: 0.12, side: THREE.DoubleSide }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.105;
  g.add(glow);
  model.position.y = 0.12;
  g.add(model);
  return g;
}
