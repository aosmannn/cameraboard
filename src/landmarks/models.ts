import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/*
 * Every landmark is built from code: boxes, cylinders, spheres and revolved
 * profiles. No downloaded models and no outside services. Each one is merged
 * down to a few meshes (one per color) so a dozen of them cost almost nothing
 * to draw while you pan and zoom.
 */

const mats = new Map<string, THREE.Material>();
function mat(color: number, glow = 0): THREE.Material {
  const k = `${color}:${glow}`;
  let m = mats.get(k);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true, emissive: glow ? color : 0x000000, emissiveIntensity: glow, side: THREE.DoubleSide });
    mats.set(k, m);
  }
  return m;
}

interface Part { geo: THREE.BufferGeometry; color: number; glow: number }
class Kit {
  parts: Part[] = [];
  add(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, glow = 0, rot?: [number, number, number], scale?: [number, number, number]) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot ?? [0, 0, 0]))),
      new THREE.Vector3(...(scale ?? [1, 1, 1])));
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    g.deleteAttribute('uv');
    this.parts.push({ geo: g, color, glow });
  }
  /** Box standing on y (its base), centered on x/z. */
  box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0, glow = 0, ry = 0) {
    this.add(new THREE.BoxGeometry(w, h, d), color, x, y + h / 2, z, glow, [0, ry, 0]);
  }
  cyl(rTop: number, rBot: number, h: number, color: number, x = 0, y = 0, z = 0, seg = 16, glow = 0) {
    this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), color, x, y + h / 2, z, glow);
  }
  cone(r: number, h: number, color: number, x = 0, y = 0, z = 0, seg = 16, ry = 0) {
    this.add(new THREE.ConeGeometry(r, h, seg), color, x, y + h / 2, z, 0, [0, ry, 0]);
  }
  /** Upper half of a sphere (a dome) sitting on y. */
  dome(r: number, color: number, x = 0, y = 0, z = 0, sy = 1, seg = 18, glow = 0) {
    this.add(new THREE.SphereGeometry(r, seg, Math.ceil(seg / 2), 0, Math.PI * 2, 0, Math.PI / 2), color, x, y, z, glow, undefined, [1, sy, 1]);
  }
  ball(r: number, color: number, x = 0, y = 0, z = 0, seg = 12, sy = 1) {
    this.add(new THREE.SphereGeometry(r, seg, seg - 2), color, x, y, z, 0, undefined, [1, sy, 1]);
  }
  /** Revolve a profile of [radius, height] points around the vertical axis. */
  lathe(pts: [number, number][], color: number, x = 0, y = 0, z = 0, seg = 16, glow = 0) {
    this.add(new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), seg), color, x, y, z, glow);
  }
  /** A round beam between two points. */
  beam(a: [number, number, number], b: [number, number, number], r: number, color: number, seg = 5) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const mid = va.clone().add(vb).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    const e = new THREE.Euler().setFromQuaternion(q);
    this.add(new THREE.CylinderGeometry(r, r, len, seg), color, mid.x, mid.y, mid.z, 0, [e.x, e.y, e.z]);
  }
  tube(points: THREE.Vector3[], r: number, color: number) {
    this.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 40, r, 4), color);
  }
  prism(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) {
    const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
    this.add(new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }), color, x, y, z - d / 2);
  }
  /** Merge by color and normalize so every landmark fits the same size. */
  finish(): THREE.Group {
    const byColor = new Map<string, Part[]>();
    for (const p of this.parts) {
      const k = `${p.color}:${p.glow}`;
      (byColor.get(k) ?? byColor.set(k, []).get(k)!).push(p);
    }
    const g = new THREE.Group();
    for (const list of byColor.values()) {
      const geo = mergeGeometries(list.map(p => p.geo), false);
      if (geo) g.add(new THREE.Mesh(geo, mat(list[0].color, list[0].glow)));
    }
    const box = new THREE.Box3().setFromObject(g);
    const size = box.getSize(new THREE.Vector3());
    const fit = 1 / Math.max(size.y, size.x * 0.8, size.z * 0.8);
    const c = box.getCenter(new THREE.Vector3());
    g.children.forEach(m => { m.position.set(-c.x, -box.min.y, -c.z); });
    const wrap = new THREE.Group();
    wrap.add(g);
    wrap.scale.setScalar(fit);
    wrap.userData.height = size.y * fit;
    return wrap;
  }
}

const STONE = 0xcdbfa6, MARBLE = 0xf3efe6, DARK = 0x4a4540, GLASS = 0x9bc1d8, GOLD = 0xd4a83a, WIN = 0xffe9a8;
const SAND = 0xd9c08a, COPPER = 0x78b8a2, GRASS = 0x7ea36a, WATER = 0x6aa0b5;
const TAU = Math.PI * 2;

type Builder = () => Kit;

/** An arched opening (dark) facing +z at the origin; rotate with ry. */
function arch(k: Kit, w: number, h: number, x: number, y: number, z: number, ry: number, color = DARK, depth = 0.02) {
  const sh = new THREE.Shape();
  sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(w / 2, h - w / 2);
  sh.absarc(0, h - w / 2, w / 2, 0, Math.PI, false); sh.lineTo(-w / 2, 0);
  k.add(new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false }), color, x, y, z, 0, [0, ry, 0]);
}
/** Spread n things evenly around a ring (on an ellipse if zr differs). */
function around(n: number, r: number, fn: (x: number, z: number, a: number) => void, zr = r, a0 = 0) {
  for (let i = 0; i < n; i++) { const a = a0 + (i / n) * TAU; fn(Math.cos(a) * r, Math.sin(a) * zr, a); }
}

// ---------- Eiffel Tower: curved legs, three platforms, lattice ----------
const eiffel: Builder = () => {
  const k = new Kit(), iron = 0x8a735b, dk = 0x6c5a47;
  const hw = (y: number) => 0.19 * Math.exp(-3.4 * y) + 0.004;
  const P = (sx: number, sz: number, y: number): [number, number, number] => [sx * hw(y), y, sz * hw(y)];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
  const steps = [0, 0.04, 0.08, 0.12, 0.17, 0.22, 0.28, 0.35, 0.45, 0.55, 0.66, 0.75, 0.84, 0.92];
  for (const [sx, sz] of corners) for (let i = 0; i < steps.length - 1; i++) {
    const r = 0.014 * (1 - steps[i] * 0.8);
    k.beam(P(sx, sz, steps[i]), P(sx, sz, steps[i + 1]), r, iron);
  }
  for (let c = 0; c < 4; c++) {
    const [ax, az] = corners[c], [bx, bz] = corners[(c + 1) % 4];
    for (let i = 0; i < steps.length - 1; i++) {
      const flip = i % 2 === 0;
      const p = flip ? [ax, az] : [bx, bz], q = flip ? [bx, bz] : [ax, az];
      const r = 0.0045;
      k.beam(P(p[0], p[1], steps[i]), P(q[0], q[1], steps[i + 1]), r, dk, 3);
      k.beam(P(q[0], q[1], steps[i]), P(p[0], p[1], steps[i + 1]), r, dk, 3);
      if (steps[i] > 0.1) k.beam(P(ax, az, steps[i]), P(bx, bz, steps[i]), r, dk, 3);
    }
    // the big arch that joins each pair of legs
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, y = 0.095 * Math.sin(Math.PI * t) ** 0.55;
      const a0 = P(ax, az, 0), b0 = P(bx, bz, 0);
      pts.push(new THREE.Vector3(a0[0] + (b0[0] - a0[0]) * t, y, a0[2] + (b0[2] - a0[2]) * t));
    }
    k.tube(pts, 0.007, dk);
  }
  const deck = (y: number, w: number, t = 0.012) => {
    k.box(w, t, w, iron, 0, y, 0);
    k.box(w * 1.05, 0.004, w * 1.05, dk, 0, y + t, 0);
  };
  deck(0.17, 0.2); deck(0.35, 0.12); deck(0.84, 0.035, 0.02);
  k.cyl(0.012, 0.016, 0.07, iron, 0, 0.86, 0, 8);
  k.cone(0.008, 0.07, iron, 0, 0.93, 0, 6);
  k.cyl(0.0015, 0.0015, 0.04, dk, 0, 1.0, 0, 3);
  return k;
};

// ---------- Giza: stepped courses, Sphinx, dunes ----------
const giza: Builder = () => {
  const k = new Kit();
  k.box(3.2, 0.03, 2.4, SAND, 0, -0.03, 0);
  const pyr = (side: number, x: number, z: number, cap = 0) => {
    const n = 16, h = side * 0.64;
    for (let i = 0; i < n; i++) {
      const w = side * (1 - i / n), hh = h / n;
      k.box(w, hh, w, i % 2 ? 0xdcc08b : 0xcfb07a, x, i * hh, z, 0, 0.0);
    }
    if (cap) k.cone(side * cap * 0.72, h * cap, 0xe8dcc0, x, h * (1 - cap), z, 4, Math.PI / 4);
  };
  pyr(1.15, 0, 0);
  pyr(1.08, 1.3, -0.55, 0.22);
  pyr(0.52, 2.3, -1.05);
  for (let i = 0; i < 3; i++) pyr(0.2, -1.05 + i * 0.3, -0.9);
  // Sphinx: lion body, paws, head with headdress
  const c = 0xcaa970;
  k.box(0.46, 0.14, 0.16, c, -0.9, 0, 0.9);
  k.box(0.2, 0.04, 0.05, c, -0.62, 0, 0.84); k.box(0.2, 0.04, 0.05, c, -0.62, 0, 0.96);
  k.box(0.1, 0.17, 0.12, c, -0.74, 0.1, 0.9);
  k.box(0.13, 0.1, 0.16, 0xb9955e, -0.74, 0.26, 0.9);
  // dunes
  for (const [x, z, r] of [[-1.4, -0.2, 0.5], [1.1, 0.9, 0.55], [2.0, 0.6, 0.4]] as const)
    k.dome(r, 0xe2c994, x, -0.02, z, 0.1, 12);
  return k;
};

// ---------- Taj Mahal ----------
const taj: Builder = () => {
  const k = new Kit(), red = 0xb4573f;
  k.box(2.6, 0.02, 1.9, 0x86a86e, 0, -0.02, 0);
  k.box(1.5, 0.12, 1.5, 0xe9e2d2, 0, 0, 0);          // plinth
  k.box(1.0, 0.36, 1.0, MARBLE, 0, 0.12, 0);          // chamfered main block
  k.box(1.0, 0.36, 1.0, MARBLE, 0, 0.12, 0, 0, Math.PI / 4);
  k.box(0.72, 0.36, 0.72, MARBLE, 0, 0.12, 0, 0, Math.PI / 4);
  for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const x = Math.sin(ry) * 0.5, z = Math.cos(ry) * 0.5;
    k.box(0.4, 0.42, 0.03, MARBLE, x, 0.12, z, 0, ry);
    arch(k, 0.22, 0.34, x + Math.sin(ry) * 0.02, 0.14, z + Math.cos(ry) * 0.02, ry, 0x6e6a66);
  }
  k.cyl(0.24, 0.26, 0.16, MARBLE, 0, 0.48, 0, 24);
  k.lathe([[0.001, 0], [0.22, 0], [0.31, 0.1], [0.34, 0.22], [0.29, 0.34], [0.19, 0.45], [0.08, 0.54], [0.03, 0.6], [0.001, 0.62]], MARBLE, 0, 0.62, 0, 28);
  k.cyl(0.006, 0.01, 0.18, GOLD, 0, 1.2, 0, 6);
  k.ball(0.014, GOLD, 0, 1.3, 0, 6);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * 0.4, z = sz * 0.4;
    k.cyl(0.05, 0.055, 0.1, MARBLE, x, 0.48, z, 8);
    k.lathe([[0.001, 0], [0.06, 0.01], [0.075, 0.05], [0.05, 0.1], [0.001, 0.14]], MARBLE, x, 0.58, z, 10);
    // minaret with three balconies and a domed pavilion on top
    const mx = sx * 0.96, mz = sz * 0.96;
    k.box(0.22, 0.14, 0.22, MARBLE, mx, 0, mz);
    k.cyl(0.055, 0.065, 0.78, MARBLE, mx, 0.14, mz, 12);
    for (const y of [0.34, 0.54, 0.74]) k.cyl(0.09, 0.09, 0.02, 0xd9d2c0, mx, y, mz, 12);
    k.cyl(0.05, 0.05, 0.08, MARBLE, mx, 0.92, mz, 8);
    k.lathe([[0.001, 0], [0.07, 0.0], [0.07, 0.02], [0.05, 0.08], [0.001, 0.13]], MARBLE, mx, 1.0, mz, 10);
  }
  // red sandstone mosque and guest house with three domes each
  for (const s of [-1, 1]) {
    k.box(0.36, 0.2, 0.9, red, s * 1.15, 0, 0.02);
    for (let i = -1; i <= 1; i++) k.dome(0.1, MARBLE, s * 1.15, 0.2, 0.02 + i * 0.28, 1, 12);
  }
  // long reflecting pool with garden walkway
  k.box(0.16, 0.012, 1.0, WATER, 0, 0, 1.1, 0.15);
  k.box(0.07, 0.01, 1.0, 0xe9e2d2, 0.16, 0.002, 1.1); k.box(0.07, 0.01, 1.0, 0xe9e2d2, -0.16, 0.002, 1.1);
  return k;
};

// ---------- Statue of Liberty on Fort Wood ----------
const liberty: Builder = () => {
  const k = new Kit(), cu = COPPER, st = 0xc9c2b2;
  // eleven-point star fort
  const star: THREE.Vector2[] = [];
  for (let i = 0; i < 22; i++) { const r = i % 2 ? 0.55 : 0.8; star.push(new THREE.Vector2(Math.cos((i / 22) * TAU) * r, Math.sin((i / 22) * TAU) * r)); }
  k.add(new THREE.ExtrudeGeometry(new THREE.Shape(star), { depth: 0.1, bevelEnabled: false }), 0xa39b8a, 0, 0, 0, 0, [-Math.PI / 2, 0, 0]);
  k.box(0.7, 0.08, 0.7, st, 0, 0.1, 0);
  k.box(0.52, 0.2, 0.52, 0xd3cdbf, 0, 0.18, 0);
  k.box(0.42, 0.36, 0.42, 0xe0dbcf, 0, 0.38, 0);
  k.box(0.5, 0.04, 0.5, st, 0, 0.74, 0);
  for (const [dx, dz] of [[0.2, 0.2], [-0.2, 0.2], [0.2, -0.2], [-0.2, -0.2]] as const) k.box(0.04, 0.3, 0.04, 0xc7c0b0, dx * 1.05, 0.4, dz * 1.05);
  // robed figure
  k.lathe([[0.001, 0], [0.2, 0], [0.22, 0.12], [0.17, 0.35], [0.14, 0.55], [0.14, 0.72], [0.1, 0.8], [0.001, 0.82]], cu, 0, 0.78, 0, 12);
  k.cyl(0.04, 0.05, 0.08, cu, 0, 1.6, 0, 8);
  k.ball(0.07, cu, 0, 1.68, 0, 10);
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * 0.5 + (i / 6) * Math.PI;
    k.beam([Math.sin(a) * 0.05, 1.72 + Math.cos(a) * 0.01, Math.cos(a) * 0.05], [Math.sin(a) * 0.17, 1.72 + Math.cos(a * 0.8) * 0.06, Math.cos(a) * 0.08], 0.008, cu, 4);
  }
  // raised right arm with torch, left arm with tablet
  k.beam([0.1, 1.52, 0], [0.2, 1.98, 0.02], 0.032, cu, 6);
  k.cyl(0.05, 0.03, 0.04, GOLD, 0.2, 1.98, 0.02, 8);
  k.lathe([[0.001, 0], [0.05, 0.03], [0.045, 0.1], [0.001, 0.17]], GOLD, 0.2, 2.02, 0.02, 8, 0.5);
  k.beam([-0.1, 1.4, 0], [-0.17, 1.2, 0.1], 0.028, cu, 6);
  k.box(0.13, 0.19, 0.03, cu, -0.19, 1.05, 0.12, 0, 0.3);
  return k;
};

// ---------- Sydney Opera House: pairs of sails on a podium ----------
const opera: Builder = () => {
  const k = new Kit(), w = 0xf6f2e8;
  k.box(2.6, 0.12, 1.3, 0xd8cfbf, 0, 0, 0);
  k.box(0.8, 0.05, 0.4, 0xcbc2b0, 0, 0.12, 0.85);  // steps
  const sail = (x: number, z: number, big: number, face: 1 | -1, lean: number) => {
    // an eighth of a sphere is exactly the shape of an opera-house shell
    const g = new THREE.SphereGeometry(1, 18, 12, 0, Math.PI / 2, 0, Math.PI / 2);
    g.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0.7, 1, 0, 0, 0, 0, 1));
    k.add(g, w, x, 0.12, z, 0, [0, face > 0 ? -Math.PI / 2 : Math.PI / 2, lean], [0.55 * big, 1.15 * big, 0.55 * big]);
  };
  // concert hall (left) and opera theatre (right): sails face each other in pairs
  const row = (x0: number, zc: number, n: number, s0: number) => {
    for (let i = 0; i < n; i++) {
      const big = s0 * (1 - i * 0.16), x = x0 + i * 0.34;
      sail(x, zc - 0.1, big, 1, 0.0);
      sail(x + 0.04, zc + 0.12, big * 0.92, -1, 0.0);
    }
  };
  row(-0.95, -0.12, 4, 1.0);
  row(0.35, 0.1, 3, 0.8);
  k.box(0.9, 0.2, 0.06, 0x3b5a70, -0.5, 0.12, 0.5, 0.18); k.box(0.7, 0.16, 0.06, 0x3b5a70, 0.75, 0.12, 0.55, 0.18);
  k.box(1.6, 0.008, 1.4, WATER, 0, -0.01, 0.05, 0.1);
  return k;
};

// ---------- Christ the Redeemer on Corcovado ----------
const christ: Builder = () => {
  const k = new Kit(), w = 0xefece3;
  k.lathe([[0.001, -0.05], [1.2, -0.05], [0.9, 0.15], [0.5, 0.34], [0.22, 0.46], [0.18, 0.5]], 0x5f8d57, 0, 0, 0, 14);
  k.lathe([[0.001, 0], [0.5, 0], [0.4, 0.1], [0.22, 0.2]], 0x7c8f6e, 0, -0.02, 0, 10);
  k.box(0.2, 0.24, 0.2, 0xd4cfc2, 0, 0.5, 0);
  k.box(0.16, 0.12, 0.16, 0xe0dbcf, 0, 0.74, 0);
  // robe, shoulders, arms spread, head
  k.lathe([[0.001, 0], [0.075, 0], [0.085, 0.08], [0.06, 0.34], [0.05, 0.5], [0.06, 0.56], [0.001, 0.58]], w, 0, 0.86, 0, 12);
  k.beam([-0.5, 1.37, 0], [0.5, 1.37, 0], 0.036, w, 8);
  k.beam([-0.5, 1.37, 0], [-0.55, 1.3, 0.0], 0.032, w, 8); k.beam([0.5, 1.37, 0], [0.55, 1.3, 0.0], 0.032, w, 8);
  k.beam([0, 1.3, 0.0], [0, 1.37, 0], 0.07, w, 8);
  k.ball(0.052, w, 0, 1.47, 0, 10);
  k.cone(0.055, 0.045, w, 0, 1.49, 0, 8);
  return k;
};

// ---------- Burj Khalifa: three wings spiraling in ----------
const burj: Builder = () => {
  const k = new Kit(), g = 0xa6c3d4, g2 = 0xc8d9e4;
  k.box(1.0, 0.04, 1.0, 0xcdbf9d, 0, -0.04, 0);
  k.box(0.7, 0.06, 0.7, 0xb8b0a0, 0, 0, 0);
  const tiers = [0.5, 0.45, 0.42, 0.4, 0.36, 0.34, 0.3];
  let y = 0.06, len = 0.2;
  tiers.forEach((h, t) => {
    for (let i = 0; i < 3; i++) {
      if (t >= 6 && i > 0) continue;
      const a = (i / 3) * TAU + t * 0.0;
      const l = len - (i + t) % 3 * 0.015;
      k.box(0.075, h, l * 1.0, i % 2 ? g : g2, Math.cos(a) * l * 0.5, y, Math.sin(a) * l * 0.5, 0.08, -a + Math.PI / 2);
    }
    k.cyl(0.07 - t * 0.006, 0.075 - t * 0.006, h, g2, 0, y, 0, 6, 0.08);
    y += h * 0.92; len -= 0.026;
  });
  k.lathe([[0.04, 0], [0.032, 0.25], [0.02, 0.5], [0.01, 0.8], [0.001, 1.0]], 0xdfe5ea, 0, y - 0.04, 0, 6);
  return k;
};

// ---------- Big Ben (Elizabeth Tower) with the Palace of Westminster ----------
const bigben: Builder = () => {
  const k = new Kit(), s = 0xd8c28f, rf = 0x5c6f78;
  k.box(2.6, 0.01, 1.4, WATER, 0, -0.01, 0.9, 0.12);
  k.box(2.0, 0.34, 0.44, s, 1.0, 0, 0);
  k.box(1.96, 0.1, 0.4, 0x7f8e92, 1.0, 0.34, 0);
  for (let i = 0; i < 14; i++) { k.box(0.045, 0.14, 0.06, s, 0.1 + i * 0.136, 0.34, 0.2); k.cone(0.03, 0.08, rf, 0.1 + i * 0.136, 0.48, 0.2, 4); }
  k.box(0.34, 0.9, 0.34, s, 2.05, 0, 0);          // Victoria tower
  k.cone(0.2, 0.24, rf, 2.05, 0.9, 0, 4, Math.PI / 4);
  k.box(0.22, 1.1, 0.22, s, 0, 0, 0);               // shaft
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) k.box(0.04, 1.1, 0.04, 0xc8b078, dx * 0.12, 0, dz * 0.12);
  k.box(0.27, 0.34, 0.27, s, 0, 1.1, 0);            // clock stage
  for (const [dx, dz, ry] of [[0, 1, 0], [0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]] as const) {
    k.add(new THREE.CylinderGeometry(0.095, 0.095, 0.02, 20), 0xf4ecd0, dx * 0.14, 1.28, dz * 0.14, 0.5, [dz ? Math.PI / 2 : 0, 0, dz ? 0 : Math.PI / 2]);
    k.add(new THREE.TorusGeometry(0.095, 0.01, 6, 20), 0x2c3a2a, dx * 0.15, 1.28, dz * 0.15, 0, [0, ry, 0]);
  }
  k.box(0.3, 0.05, 0.3, 0xb89a56, 0, 1.44, 0);
  k.box(0.24, 0.26, 0.24, s, 0, 1.49, 0);           // belfry
  for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) arch(k, 0.06, 0.16, Math.sin(ry) * 0.12, 1.53, Math.cos(ry) * 0.12, ry, 0x3f3a35, 0.005);
  k.cone(0.2, 0.32, rf, 0, 1.75, 0, 4, Math.PI / 4);
  k.cone(0.04, 0.12, GOLD, 0, 2.0, 0, 4);
  k.cyl(0.004, 0.004, 0.12, GOLD, 0, 2.1, 0, 3);
  return k;
};

// ---------- Colosseum: arcades, attic, broken outer wall ----------
const colosseum: Builder = () => {
  const k = new Kit(), tra = 0xd9c9a3, tra2 = 0xc9b78d;
  const E = 0.83;
  const wall = (r: number, h: number, y: number, c: number, a0: number, len: number) =>
    k.add(new THREE.CylinderGeometry(r, r, h, 64, 1, true, a0, len), c, 0, y + h / 2, 0, 0, undefined, [1, 1, E]);
  const full = Math.PI * 2, brk = Math.PI * 0.62;       // part of the outer wall is missing
  // outer ring (intact over most of the circle)
  wall(1.0, 0.76, 0, tra, brk, full - brk);
  // inner ring is lower, visible where the outer wall is gone
  wall(0.8, 0.5, 0, tra2, 0, brk);
  for (const [y, r, n] of [[0.03, 1.0, 64], [0.27, 1.0, 64], [0.5, 1.0, 64]] as const) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * full + 0.0;
      if (a < brk && y > 0.1) continue;
      k.box(0.055, 0.12, 0.02, 0x6a5b47, Math.cos(a) * r, y + 0.03, Math.sin(a) * r * E, 0, -a + Math.PI / 2);
      k.box(0.012, 0.2, 0.025, 0xe2d4b0, Math.cos(a + 0.05) * (r + 0.005), y, Math.sin(a + 0.05) * (r + 0.005) * E, 0, -a + Math.PI / 2);
    }
  }
  wall(1.0, 0.04, 0.76, 0xb69e72, brk, full - brk);
  // seating bowl and arena
  k.add(new THREE.CylinderGeometry(0.78, 0.45, 0.5, 48, 1, true), 0xb89a6a, 0, 0.25, 0, 0, undefined, [1, 1, E]);
  k.add(new THREE.CircleGeometry(0.45, 40), 0xdcc48f, 0, 0.03, 0, 0, [-Math.PI / 2, 0, 0], [1, 1, E]);
  for (let i = -3; i <= 3; i++) k.box(0.014, 0.012, 0.58, 0x7e6a4a, i * 0.1, 0.03, 0);
  for (let i = -2; i <= 2; i++) k.box(0.8, 0.012, 0.014, 0x7e6a4a, 0, 0.03, i * 0.1);
  return k;
};

// ---------- St. Peter's Basilica with Bernini's colonnade ----------
const stpeters: Builder = () => {
  const k = new Kit(), tr = 0xe3d8bd, dm = 0xa3adb3;
  k.box(2.6, 0.02, 2.4, 0xd4c7a8, 0, -0.02, 0.5);
  // nave and facade
  k.box(0.9, 0.34, 1.3, tr, 0, 0, -0.4);
  k.box(1.5, 0.4, 0.2, tr, 0, 0, 0.35);
  k.box(1.5, 0.08, 0.22, 0xd9ceb0, 0, 0.4, 0.35);
  for (let i = 0; i < 8; i++) k.cyl(0.026, 0.026, 0.32, 0xf2ead8, -0.62 + i * 0.177, 0.02, 0.48, 8);
  k.box(1.4, 0.04, 0.12, 0xe9dfc6, 0, 0.34, 0.48);
  k.prism(1.3, 0.1, 0.1, 0xe9dfc6, 0, 0.38, 0.48);
  for (let i = 0; i < 13; i++) k.box(0.025, 0.07, 0.02, 0xd4c9ac, -0.7 + i * 0.117, 0.48, 0.46);
  // drum, columns, ribbed dome and lantern
  k.cyl(0.36, 0.4, 0.4, tr, 0, 0.34, -0.2, 32);
  around(16, 0.37, (x, z) => k.cyl(0.015, 0.015, 0.3, 0xf2ead8, x, 0.4, z - 0.2, 5));
  k.lathe([[0.37, 0], [0.34, 0.1], [0.27, 0.22], [0.17, 0.34], [0.09, 0.4], [0.001, 0.44]], dm, 0, 0.74, -0.2, 32);
  around(16, 0.3, (x, z, a) => k.beam([x, 0.78, z - 0.2], [x * 0.2, 1.17, (z) * 0.2 - 0.2], 0.007, 0xd8d2c4, 3));
  k.cyl(0.05, 0.06, 0.1, tr, 0, 1.15, -0.2, 8);
  k.cone(0.045, 0.1, tr, 0, 1.25, -0.2, 8);
  k.box(0.01, 0.1, 0.01, GOLD, 0, 1.33, -0.2); k.box(0.05, 0.01, 0.01, GOLD, 0, 1.38, -0.2);
  for (const s of [-1, 1]) k.dome(0.09, dm, s * 0.42, 0.34, -0.55, 1.1, 12);
  // the piazza: two curved colonnades and an obelisk
  for (const s of [-1, 1]) for (const rr of [0.9, 1.0, 1.1]) {
    for (let i = 0; i <= 14; i++) {
      const a = (-0.2 + (i / 14) * 1.5) * Math.PI;
      const x = s * Math.cos(a) * rr * 1.15, z = 1.0 + Math.sin(a) * rr * 0.7;
      if (Math.sin(a) < -0.1) continue;
      k.cyl(0.012, 0.012, 0.16, 0xe5dbc2, x, 0, z, 5);
    }
  }
  k.box(0.012, 0.22, 0.012, 0xcfc2a4, 0, 0, 1.1);
  return k;
};

// ---------- Leaning Tower of Pisa with the cathedral ----------
const pisa: Builder = () => {
  const k = new Kit(), m = 0xf1ecdf;
  k.box(2.4, 0.03, 1.6, 0x8aa86a, 0, -0.03, 0);
  k.box(1.1, 0.22, 0.34, m, -0.7, 0, 0.0);
  k.box(0.34, 0.22, 0.9, m, -0.7, 0, 0.0);
  k.cyl(0.14, 0.15, 0.2, m, -0.7, 0.22, 0, 14);
  k.dome(0.14, 0x8a98a2, -0.7, 0.42, 0, 1, 12);
  k.cyl(0.2, 0.22, 0.28, m, -0.4, 0, 0.62, 18);
  k.dome(0.2, 0x9a6b50, -0.4, 0.28, 0.62, 0.9, 14);
  const t = new Kit();
  for (let i = 0; i < 8; i++) {
    const y = i * 0.14, r = i === 0 ? 0.16 : 0.15;
    t.cyl(r - 0.005, r, 0.12, m, 0, y, 0, 20);
    if (i) around(14, r + 0.012, (x, z) => t.cyl(0.011, 0.011, 0.1, 0xfffaf0, x, y + 0.01, z, 5));
    t.cyl(r + 0.01, r + 0.01, 0.018, 0xcfc8b6, 0, y + 0.12, 0, 20);
  }
  t.cyl(0.1, 0.11, 0.1, m, 0, 1.12, 0, 14);
  t.dome(0.1, 0x9a6b50, 0, 1.22, 0, 0.7, 12);
  for (const p of t.parts) { p.geo.rotateZ(-0.07); p.geo.translate(0.25, 0, 0); k.parts.push(p); }
  return k;
};

// ---------- Sagrada Família ----------
const sagrada: Builder = () => {
  const k = new Kit(), s = 0xd2bf9a, dk = 0xb9a47c;
  k.box(1.5, 0.25, 0.6, s, 0, 0, 0);
  const spire = (x: number, z: number, h: number, r: number, c = 0xd89a4a) => {
    k.lathe([[r, 0], [r * 0.95, h * 0.5], [r * 0.7, h * 0.8], [r * 0.45, h * 0.93], [0.001, h]], s, x, 0.25, z, 8);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU; k.box(r * 0.2, h * 0.3, r * 0.2, dk, x + Math.cos(a) * r, 0.25 + h * 0.28, z + Math.sin(a) * r); }
    k.ball(r * 0.5, c, x, 0.25 + h * 0.96, z, 8);
  };
  // Nativity facade: four tall bell towers
  for (let i = 0; i < 4; i++) spire(-0.5 + i * 0.33, 0.32, 1.0 + (i % 2) * 0.1, 0.075);
  for (let i = 0; i < 4; i++) spire(-0.5 + i * 0.33, -0.32, 1.0 + ((i + 1) % 2) * 0.1, 0.075);
  // the tall central towers
  spire(0, 0, 1.75, 0.12, 0xe8d4a0);
  for (const [x, z] of [[-0.3, 0], [0.3, 0], [0, 0.22], [0, -0.22]] as const) spire(x, z, 1.3, 0.085, 0x5fa37a);
  return k;
};

// ---------- St. Basil's Cathedral ----------
const basil: Builder = () => {
  const k = new Kit();
  k.box(1.6, 0.02, 1.4, 0xbdb9b0, 0, -0.02, 0);
  k.box(1.3, 0.4, 1.0, 0xb94c3a, 0, 0, 0);
  for (let i = 0; i < 9; i++) k.box(0.1, 0.04, 0.02, 0xf1e9d8, -0.52 + i * 0.13, 0.28, 0.51);
  const onion = (x: number, z: number, y: number, r: number, c: number, c2: number) => {
    k.lathe([[0.001, 0], [r * 0.5, 0.02], [r, r * 0.8], [r * 0.95, r * 1.3], [r * 0.55, r * 1.9], [r * 0.18, r * 2.5], [0.001, r * 2.9]], c, x, y, z, 16);
    k.lathe([[0.001, 0.01], [r * 0.5, 0.03], [r * 1.02, r * 0.8], [r * 0.5, r * 1.9], [0.001, r * 2.9]], c2, x, y, z, 5);
    k.ball(r * 0.14, GOLD, x, y + r * 3.0, z, 6);
  };
  k.cyl(0.19, 0.21, 0.7, 0xb94c3a, 0, 0.4, 0, 8);          // tent-roofed central church
  k.cone(0.2, 0.6, 0x2f7a5a, 0, 1.1, 0, 8);
  k.cyl(0.05, 0.05, 0.1, 0xf1e9d8, 0, 1.7, 0, 8);
  onion(0, 0, 1.8, 0.07, GOLD, 0x2f7a5a);
  const cols: [number, number][] = [[0xc0392b, 0xf1e9d8], [0x2f7a5a, 0xe0b030], [0xe0b030, 0x2a6fb0], [0x2a6fb0, 0xf1e9d8], [0xc0392b, 0xe0b030], [0x2f7a5a, 0xf1e9d8], [0xe0b030, 0xc0392b], [0x2a6fb0, 0xe0b030]];
  around(8, 0.5, (x, z, a) => {
    const i = Math.round(a / TAU * 8) % 8;
    k.cyl(0.085, 0.095, 0.32, 0xe9e0d0, x, 0.4, z * 0.8, 8);
    onion(x, z * 0.8, 0.72, 0.1, cols[i][0], cols[i][1]);
  }, 0.5, Math.PI / 8);
  return k;
};

// ---------- Parthenon: 8 x 17 Doric columns, pediments, Acropolis rock ----------
const parthenon: Builder = () => {
  const k = new Kit(), m = 0xe9dec4;
  k.lathe([[0.001, -0.3], [1.45, -0.3], [1.3, -0.1], [1.15, 0.05]], 0xa79a82, 0, 0, 0, 12);
  k.add(new THREE.CylinderGeometry(1.0, 1.1, 0.12, 4), 0x9b8f77, 0, -0.06, 0, 0, [0, Math.PI / 4, 0], [1.1, 1, 0.6]);
  k.box(1.9, 0.04, 0.95, 0xd3c8ac, 0, 0.0, 0);
  k.box(1.8, 0.04, 0.85, 0xdcd1b5, 0, 0.04, 0);
  k.box(1.7, 0.04, 0.75, 0xe2d7bb, 0, 0.08, 0);
  const W = 1.5, D = 0.6, cy = (x: number, z: number) => k.cyl(0.032, 0.04, 0.42, m, x, 0.12, z, 10);
  for (let i = 0; i < 8; i++) { const x = -W / 2 + (W / 7) * i; cy(x, D / 2); cy(x, -D / 2); }
  for (let i = 1; i < 16; i++) { const z = -D / 2 + (D / 16) * i; cy(-W / 2, z); cy(W / 2, z); }
  k.box(1.1, 0.34, 0.34, 0xe3d8bd, 0, 0.12, 0);          // inner cella
  k.box(W + 0.16, 0.07, D + 0.16, 0xdfd4b8, 0, 0.54, 0);
  k.box(W + 0.16, 0.06, D + 0.16, 0xd2c6a8, 0, 0.61, 0);
  k.prism(D + 0.16, 0.17, W + 0.2, 0xe3d8bd, 0, 0.67, 0);
  k.prism(D + 0.16, 0.17, W + 0.2, 0xe3d8bd, 0, 0.67, 0);
  return k;
};

// ---------- Stonehenge ----------
const stonehenge: Builder = () => {
  const k = new Kit(), s = 0x9a9588;
  k.cyl(1.4, 1.4, 0.03, 0x86a566, 0, -0.03, 0, 40);
  k.lathe([[1.15, 0], [1.2, 0.04], [1.28, 0.0]], 0x7a9558, 0, 0, 0, 40);
  const n = 30;
  around(n, 0.8, (x, z, a) => {
    k.box(0.1, 0.34, 0.06, s, x, 0, z, 0, -a + Math.PI / 2);
    const a2 = a + TAU / n, mx = (x + Math.cos(a2) * 0.8) / 2, mz = (z + Math.sin(a2) * 0.8) / 2;
    k.box(0.15, 0.05, 0.07, 0xaaa597, mx * 0.99, 0.34, mz * 0.99, 0, -(a + a2) / 2 + Math.PI / 2);
  });
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI * 0.45 + (i / 4) * Math.PI * 0.9 + Math.PI;
    const x = Math.cos(a) * 0.42, z = Math.sin(a) * 0.42, ry = -a + Math.PI / 2;
    k.box(0.09, 0.46, 0.07, s, x + Math.cos(a + Math.PI / 2) * 0.07, 0, z + Math.sin(a + Math.PI / 2) * 0.07, 0, ry);
    k.box(0.09, 0.46, 0.07, s, x - Math.cos(a + Math.PI / 2) * 0.07, 0, z - Math.sin(a + Math.PI / 2) * 0.07, 0, ry);
    k.box(0.27, 0.06, 0.08, 0xaaa597, x, 0.46, z, 0, ry);
  }
  around(19, 0.6, (x, z) => k.box(0.04, 0.14, 0.04, 0x7f8b94, x, 0, z));
  k.box(0.06, 0.24, 0.06, s, 1.12, 0, -0.2, 0, 0.3);
  return k;
};

// ---------- Petronas Towers ----------
const petronas: Builder = () => {
  const k = new Kit(), steel = 0xc2ced8, glass = 0x8ba7bd;
  const tower = (sx: number) => {
    const tiers: [number, number][] = [[0.3, 0.5], [0.26, 0.4], [0.22, 0.36], [0.18, 0.32], [0.14, 0.3], [0.1, 0.26]];
    let y = 0;
    for (const [w, h] of tiers) {
      k.box(w, h, w, glass, sx, y, 0, 0.1); k.box(w, h, w, glass, sx, y, 0, 0.1, Math.PI / 4);
      around(8, w * 0.62, (x, z) => k.cyl(0.04 + w * 0.12, 0.04 + w * 0.12, h * 1.0, steel, sx + x, y, z, 10));
      for (let i = 1; i < 6; i++) k.cyl(w * 0.9, w * 0.9, 0.012, 0xe9eff3, sx, y + (h / 6) * i, 0, 8);
      y += h * 0.98;
    }
    k.cyl(0.05, 0.08, 0.12, steel, sx, y, 0, 12);
    k.cone(0.05, 0.3, steel, sx, y + 0.12, 0, 12);
    k.cyl(0.004, 0.004, 0.3, 0xdfe5ea, sx, y + 0.4, 0, 3);
  };
  tower(-0.4); tower(0.4);
  k.box(0.52, 0.05, 0.07, steel, 0, 0.82, 0);                       // skybridge
  k.beam([-0.15, 0.7, 0], [0, 0.82, 0], 0.012, steel, 4); k.beam([0.15, 0.7, 0], [0, 0.82, 0], 0.012, steel, 4);
  k.box(1.5, 0.05, 0.8, 0xbdb4a2, 0, -0.05, 0);
  return k;
};

// ---------- Angkor Wat: galleries, moat, five lotus towers ----------
const angkor: Builder = () => {
  const k = new Kit(), s = 0xb7a57f, t2 = 0xcdbd98;
  k.box(2.4, 0.02, 2.0, 0x6f9266, 0, -0.04, 0);
  k.box(2.4, 0.015, 2.0, WATER, 0, -0.03, 0, 0.1);
  k.box(1.9, 0.04, 1.5, 0x6f9266, 0, -0.02, 0);
  k.box(0.28, 0.02, 0.36, 0xc2b18f, 0, -0.01, 1.07);
  const gallery = (w: number, d: number, y: number, h: number, c: number) => {
    k.box(w, h, 0.07, c, 0, y, d / 2); k.box(w, h, 0.07, c, 0, y, -d / 2);
    k.box(0.07, h, d, c, w / 2, y, 0); k.box(0.07, h, d, c, -w / 2, y, 0);
    k.box(w, 0.02, 0.1, 0x9d8e6c, 0, y + h, d / 2); k.box(w, 0.02, 0.1, 0x9d8e6c, 0, y + h, -d / 2);
    k.box(0.1, 0.02, d, 0x9d8e6c, w / 2, y + h, 0); k.box(0.1, 0.02, d, 0x9d8e6c, -w / 2, y + h, 0);
  };
  gallery(1.7, 1.3, 0, 0.14, s);
  k.box(1.2, 0.2, 0.9, t2, 0, 0.14, 0);
  gallery(1.1, 0.8, 0.14, 0.14, s);
  k.box(0.66, 0.2, 0.5, 0xd4c4a0, 0, 0.28, 0);
  const tower = (x: number, z: number, h: number, r: number, y0: number) => {
    k.box(r * 1.8, h * 0.28, r * 1.8, 0xd6c7a4, x, y0, z);
    k.lathe([[r * 0.95, 0], [r * 0.85, h * 0.18], [r * 0.9, h * 0.24], [r * 0.7, h * 0.4], [r * 0.72, h * 0.46], [r * 0.5, h * 0.62], [r * 0.3, h * 0.78], [0.001, h * 0.95]], 0xc7b58f, x, y0 + h * 0.28, z, 8);
  };
  tower(0, 0, 0.95, 0.15, 0.48);
  for (const [x, z] of [[-0.25, -0.18], [0.25, -0.18], [-0.25, 0.18], [0.25, 0.18]] as const) tower(x, z, 0.5, 0.08, 0.28);
  for (const [x, z] of [[-0.85, -0.65], [0.85, -0.65], [-0.85, 0.65], [0.85, 0.65]] as const) tower(x, z, 0.38, 0.07, 0.0);
  return k;
};

// ---------- Chichén Itzá: El Castillo ----------
const chichen: Builder = () => {
  const k = new Kit(), s = 0xd2c7a6;
  k.box(1.8, 0.03, 1.8, 0x7d9d5a, 0, -0.03, 0);
  for (let i = 0; i < 9; i++) {
    const w = 1.2 - i * 0.115;
    k.box(w, 0.075, w, i % 2 ? 0xc9bd9a : s, 0, i * 0.075, 0);
  }
  k.box(0.3, 0.2, 0.3, 0xd9ceb0, 0, 0.675, 0);
  k.box(0.32, 0.03, 0.32, 0xbdb190, 0, 0.875, 0);
  arch(k, 0.1, 0.12, 0, 0.69, 0.152, 0, 0x403a33, 0.01);
  // four stairways with balustrades
  for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const x = Math.sin(ry) * 0.64, z = Math.cos(ry) * 0.64;
    k.add(new THREE.BoxGeometry(0.2, 0.0, 0.0), 0, 0, 0, 0);
    const g = new THREE.BoxGeometry(0.18, 0.68, 0.025);
    k.add(g, 0xbfb392, x * 0.99, 0.34 - 0.0, z * 0.99, 0, [Math.sin(ry) !== 0 ? 0 : -0.9, ry + (Math.sin(ry) !== 0 ? 0 : 0), 0]);
  }
  return k;
};

// ---------- Golden Gate Bridge ----------
const goldengate: Builder = () => {
  const k = new Kit(), red = 0xc4402b;
  k.box(4.4, 0.01, 1.4, WATER, 0, -0.02, 0, 0.1);
  k.box(4.4, 0.03, 0.1, 0x6f6a64, 0, 0.14, 0);
  k.box(4.4, 0.012, 0.07, red, 0, 0.12, 0);
  k.add(new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, Math.PI / 2), 0x6f8d57, -2.2, -0.05, -0.3, 0, undefined, [0.9, 0.35, 0.5]);
  k.add(new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, Math.PI / 2), 0x8a8f55, 2.2, -0.05, 0.3, 0, undefined, [0.9, 0.3, 0.5]);
  const H = 0.72;
  for (const x of [-0.9, 0.9]) {
    for (const z of [-0.055, 0.055]) {
      k.beam([x - 0.02 * (z > 0 ? 1 : 1), 0.0, z], [x - 0.005, H, z], 0.016, red, 6);
      k.beam([x + 0.02, 0.0, z], [x + 0.005, H, z], 0.016, red, 6);
    }
    for (const y of [0.2, 0.34, 0.48, 0.6, 0.7]) k.box(0.05, 0.022, 0.15, red, x, y, 0);
    for (let y = 0.2; y < 0.7; y += 0.14) { k.beam([x - 0.02, y, -0.055], [x + 0.02, y + 0.14, 0.055], 0.004, red, 3); k.beam([x + 0.02, y, -0.055], [x - 0.02, y + 0.14, 0.055], 0.004, red, 3); }
  }
  for (const z of [-0.07, 0.07]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 30; i++) {
      const x = -2.1 + (i / 30) * 4.2, ax = Math.abs(x);
      const y = ax <= 0.9 ? 0.2 + (H - 0.2) * (x / 0.9) ** 2 : H - (ax - 0.9) * 0.45;
      pts.push(new THREE.Vector3(x, Math.max(0.15, y), z));
    }
    k.tube(pts, 0.008, red);
    for (let i = -14; i <= 14; i++) {
      const x = i * 0.0625, y = 0.2 + (H - 0.2) * (x / 0.9) ** 2;
      if (Math.abs(x) < 0.9) k.beam([x, 0.14, z], [x, y, z], 0.0025, red, 3);
    }
  }
  return k;
};

// ---------- Space Needle ----------
const needle: Builder = () => {
  const k = new Kit(), w = 0xeeece4;
  const legs = 3;
  for (let i = 0; i < legs; i++) {
    const a = (i / legs) * TAU, b = a + 0.25;
    for (const aa of [a, b]) {
      const prof = (y: number) => 0.2 - 0.17 * Math.sin(Math.PI * Math.min(1, y / 1.0)) ** 1.0 + 0.0;
      let prev: [number, number, number] | null = null;
      for (let s = 0; s <= 10; s++) {
        const y = (s / 10) * 0.98, r = 0.2 * Math.abs(1 - 2 * (y / 0.98)) ** 1.4 * 0.9 + 0.045 - (0.0 * prof(y));
        const rr = Math.max(0.045, 0.2 * (0.25 + 0.75 * Math.abs(1 - 2 * y / 0.98) ** 1.3) * (y < 0.49 ? 1 : 0.85));
        const cur: [number, number, number] = [Math.cos(aa) * rr + (r * 0), y, Math.sin(aa) * rr];
        if (prev) k.beam(prev, cur, 0.012, w, 5);
        prev = cur;
      }
    }
    for (let s = 1; s < 10; s += 2) {
      const y = (s / 10) * 0.98, rr = Math.max(0.045, 0.2 * (0.25 + 0.75 * Math.abs(1 - 2 * y / 0.98) ** 1.3) * (y < 0.49 ? 1 : 0.85));
      k.beam([Math.cos(a) * rr, y, Math.sin(a) * rr], [Math.cos(a + 0.25) * rr, y, Math.sin(a + 0.25) * rr], 0.005, w, 3);
    }
  }
  k.cyl(0.04, 0.04, 0.6, w, 0, 0.98, 0, 10);
  k.lathe([[0.001, 0], [0.1, 0.02], [0.3, 0.07], [0.42, 0.14], [0.36, 0.2], [0.001, 0.2]], 0xd5d1c2, 0, 0.84, 0, 28);
  k.cyl(0.38, 0.38, 0.07, 0x8fb4c8, 0, 0.99, 0, 28, 0.2);
  k.cyl(0.3, 0.3, 0.025, 0xb9672a, 0, 1.06, 0, 28);
  k.cyl(0.24, 0.3, 0.04, 0xe3dfd2, 0, 1.085, 0, 28);
  k.cyl(0.012, 0.03, 0.4, w, 0, 1.12, 0, 6);
  k.box(1.0, 0.02, 1.0, 0x9cae8d, 0, -0.02, 0);
  return k;
};

// ---------- Christ keeps proportion; Opera keeps its shells; names are registered below ----------
const BUILDERS: Record<string, Builder> = {
  eiffel, giza, taj, liberty, opera, christ, burj, bigben, colosseum, stpeters, pisa,
  sagrada, basil, parthenon, stonehenge, petronas, angkor, chichen, goldengate, needle,
};

const cache = new Map<string, THREE.Group>();
export function hasModel(id: string) { return id in BUILDERS; }
/** A fresh copy of a landmark, about one unit tall. Geometry is shared. */
export function buildModel(id: string): THREE.Group {
  let g = cache.get(id);
  if (!g) { g = BUILDERS[id]().finish(); cache.set(id, g); }
  return g.clone(true);
}
