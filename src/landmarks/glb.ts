import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { buildModel, hasModel } from './models';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

/** Turn the model after loading, when the file's front is not toward +z. */
const SPIN: Record<string, number> = {};

const done = new Map<string, Promise<THREE.Group>>();

function normalize(scene: THREE.Group, id: string): THREE.Group {
  scene.rotation.y = SPIN[id] ?? 0;
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const fit = 1 / Math.max(size.y, size.x * 0.8, size.z * 0.8);
  const inner = new THREE.Group();
  inner.add(scene);
  scene.position.set(-c.x, -box.min.y, -c.z);
  const wrap = new THREE.Group();
  wrap.add(inner);
  wrap.scale.setScalar(fit);
  wrap.userData.height = size.y * fit;
  wrap.userData.width = Math.max(size.x, size.z) * fit;
  wrap.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const s = mat as THREE.MeshStandardMaterial;
      if (s.isMeshStandardMaterial) { s.metalness = Math.min(s.metalness, 0.15); s.roughness = Math.max(s.roughness, 0.6); }
    }
  });
  return wrap;
}

/**
 * A landmark ready to place: the downloaded model if its file loads,
 * otherwise the one built from code. Geometry is shared between copies.
 */
export function loadModel(id: string): Promise<THREE.Group> {
  let p = done.get(id);
  if (!p) {
    p = loader.loadAsync(`${import.meta.env.BASE_URL}models/landmarks/${id}.glb`)
      .then(g => normalize(g.scene, id))
      .catch(() => (hasModel(id) ? buildModel(id) : new THREE.Group()));
    done.set(id, p);
  }
  return p.then(g => g.clone(true));
}
