import * as THREE from 'three';
import { LANDMARKS, INFO, byId } from './registry';
import { buildModel } from './models';

/** Full-screen 3D view of one landmark: drag to turn, wheel to zoom, arrows for the next one. */
let root: HTMLDivElement | null = null;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let pivot: THREE.Group;
let current = 0;
let spin = true;
let yaw = 0.6, pitch = 0.42, dist = 2.6;
let raf = 0;
let onShow: ((id: string) => void) | null = null;

const q = <T extends HTMLElement>(sel: string) => root!.querySelector<T>(sel)!;

function build() {
  root = document.createElement('div');
  root.className = 'lm-viewer';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', '3D landmark');
  root.innerHTML = `
    <div class="lm-win">
      <button class="lm-close btn icon ghost" type="button" aria-label="Close">✕</button>
      <div class="lm-stage">
        <canvas class="lm-canvas"></canvas>
        <div class="lm-ctl">
          <button class="btn small lm-prev" type="button" aria-label="Previous landmark">‹</button>
          <button class="btn small lm-play" type="button" aria-label="Spin"></button>
          <button class="btn small lm-next" type="button" aria-label="Next landmark">›</button>
        </div>
        <p class="lm-tip">Drag to turn · scroll to zoom</p>
      </div>
      <div class="lm-side">
        <p class="lm-kind"></p>
        <h2 class="lm-name"></h2>
        <p class="lm-sub"></p>
        <p class="lm-blurb"></p>
        <dl class="lm-facts"></dl>
        <button class="btn primary lm-map" type="button">Show on map</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  const canvas = q<HTMLCanvasElement>('.lm-canvas');
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8aa90, 1.5));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.25);
  sun.position.set(-2, 3, 2.5);
  scene.add(sun);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.5, 48), new THREE.MeshBasicMaterial({ color: 0xe6dcc6, transparent: true, opacity: 0.9 }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -0.002;
  scene.add(disc);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.04, 64), new THREE.MeshBasicMaterial({ color: 0x9b8f77, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  scene.add(ring);
  pivot = new THREE.Group();
  scene.add(pivot);

  let drag: { x: number; y: number } | null = null;
  const pinch = new Map<number, { x: number; y: number }>();
  let pinchD = 0;
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag = { x: e.clientX, y: e.clientY };
    spin = false; refreshPlay();
  });
  canvas.addEventListener('pointermove', e => {
    if (!pinch.has(e.pointerId)) return;
    pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.size === 2) {
      const [a, b] = [...pinch.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchD) dist = Math.min(5, Math.max(1.4, dist * (pinchD / d)));
      pinchD = d;
    } else if (drag) {
      yaw -= (e.clientX - drag.x) * 0.008;
      pitch = Math.min(1.35, Math.max(0.05, pitch + (e.clientY - drag.y) * 0.006));
      drag = { x: e.clientX, y: e.clientY };
    }
  });
  const up = (e: PointerEvent) => { pinch.delete(e.pointerId); if (pinch.size < 2) pinchD = 0; if (!pinch.size) drag = null; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); dist = Math.min(5, Math.max(1.4, dist * (1 + e.deltaY * 0.001))); }, { passive: false });

  q('.lm-close').onclick = close;
  q('.lm-prev').onclick = () => go(-1);
  q('.lm-next').onclick = () => go(1);
  q('.lm-play').onclick = () => { spin = !spin; refreshPlay(); };
  q('.lm-map').onclick = () => { const id = LANDMARKS[current].id; close(); onShow?.(id); };
  root.addEventListener('pointerdown', e => { if (e.target === root) close(); });
  new ResizeObserver(fit).observe(q('.lm-stage'));
  document.addEventListener('keydown', e => {
    if (!root || root.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
  });
  window.addEventListener('resize', fit);
}

function refreshPlay() { q('.lm-play').textContent = spin ? 'Pause' : 'Spin'; }

function fit() {
  if (!root || root.hidden) return;
  const st = q('.lm-stage');
  const w = st.clientWidth, h = st.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 0.9 ? 40 : 30;
  camera.updateProjectionMatrix();
}

function show(i: number) {
  current = (i + LANDMARKS.length) % LANDMARKS.length;
  const def = LANDMARKS[current];
  pivot.clear();
  const m = buildModel(def.id);
  const h = m.userData.height as number;
  m.scale.multiplyScalar(1.15);
  pivot.add(m);
  pivot.userData.h = h * 1.15;
  q('.lm-name').textContent = def.name;
  q('.lm-sub').textContent = `${def.kind} · ${def.place}`;
  const info = INFO[def.id];
  q('.lm-kind').textContent = def.kind;
  q('.lm-blurb').textContent = info?.blurb ?? '';
  const dl = q('.lm-facts');
  dl.replaceChildren();
  for (const [k, v] of info?.facts ?? []) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  }
  refreshPlay();
}

function go(d: number) { show(current + d); }

function loop() {
  raf = requestAnimationFrame(loop);
  if (spin) yaw += 0.006;
  const hh = (pivot.userData.h as number) || 1;
  const r = dist * Math.max(1.3, hh * 1.25);
  camera.position.set(Math.sin(yaw) * Math.cos(pitch) * r, Math.sin(pitch) * r + hh * 0.35, Math.cos(yaw) * Math.cos(pitch) * r);
  camera.lookAt(0, hh * 0.4, 0);
  renderer.render(scene, camera);
}

export function openViewer(id: string, showOnMap: (id: string) => void) {
  if (!root) build();
  onShow = showOnMap;
  const i = LANDMARKS.findIndex(l => l.id === id);
  if (i < 0 || !byId(id)) return;
  root!.hidden = false;
  spin = true; yaw = 0.6; pitch = 0.42; dist = 2.6;
  document.body.classList.add('lm-open');
  fit();
  show(i);
  cancelAnimationFrame(raf);
  loop();
  q<HTMLButtonElement>('.lm-close').focus();
  requestAnimationFrame(fit);
}

export function close() {
  if (!root) return;
  root.hidden = true;
  cancelAnimationFrame(raf);
  document.body.classList.remove('lm-open');
}
