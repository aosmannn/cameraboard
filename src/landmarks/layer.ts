import * as THREE from 'three';
import type L from 'leaflet';
import { LANDMARKS, type Landmark } from './registry';
import { buildModel } from './models';

interface Active { def: Landmark; root: THREE.Group; badge: HTMLButtonElement }

/**
 * Draws the 3D landmarks over the Leaflet map. One transparent WebGL canvas,
 * redrawn only when the map moves, and only models that are on screen.
 */
export class LandmarkLayer {
  private host = document.createElement('div');
  private badges = document.createElement('div');
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(0, 1, 1, 0, -2000, 2000);
  private active = new Map<string, Active>();
  private raf = 0;
  private size = { w: 0, h: 0 };

  constructor(private map: L.Map, private onOpen: (id: string) => void) {
    this.host.className = 'landmark-layer';
    this.badges.className = 'landmark-badges';
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);
    this.host.append(this.renderer.domElement, this.badges);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8796a8, 1.4));
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.1);
    sun.position.set(-0.7, 1, 0.9);
    this.scene.add(sun);
    map.getContainer().appendChild(this.host);
    const go = () => this.schedule();
    map.on('move zoom resize viewreset', go);
    this.schedule();
  }

  private schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  private draw() {
    const s = this.map.getSize();
    if (!s.x || !s.y) return;
    if (s.x !== this.size.w || s.y !== this.size.h) {
      this.size = { w: s.x, h: s.y };
      this.renderer.setSize(s.x, s.y, false);
      this.host.style.width = `${s.x}px`;
      this.host.style.height = `${s.y}px`;
      this.camera.right = s.x;
      this.camera.top = s.y;
      this.camera.updateProjectionMatrix();
    }
    const zoom = this.map.getZoom();
    const keep = new Set<string>();
    for (const def of LANDMARKS) {
      if (zoom < def.minZoom - 0.01) continue;
      const pt = this.map.latLngToContainerPoint([def.lat, def.lon]);
      if (pt.x < -120 || pt.y < -200 || pt.x > s.x + 120 || pt.y > s.y + 120) continue;
      keep.add(def.id);
      let a = this.active.get(def.id);
      if (!a) {
        const root = new THREE.Group();
        const model = buildModel(def.id);
        const h = model.userData.height as number;
        model.position.y = 0;
        root.add(model);
        const shade = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2, depthWrite: false }));
        shade.rotation.x = -Math.PI / 2;
        shade.position.y = 0.002;
        root.add(shade);
        root.userData.h = h;
        this.scene.add(root);
        const badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'landmark-badge';
        badge.setAttribute('aria-label', `Open ${def.name} in 3D`);
        const name = document.createElement('span');
        name.className = 'landmark-badge-name';
        name.textContent = def.name;
        const kind = document.createElement('span');
        kind.className = 'landmark-badge-kicker';
        kind.textContent = `${def.kind} · tap to view in 3D`;
        badge.append(name, kind);
        badge.onclick = () => this.onOpen(def.id);
        this.badges.appendChild(badge);
        a = { def, root, badge };
        this.active.set(def.id, a);
      }
      // grows a little as you zoom in, but never takes over the map
      const px = 76 * Math.min(2.2, Math.pow(1.35, zoom - def.minZoom));
      a.root.position.set(pt.x, s.y - pt.y, 0);
      a.root.scale.setScalar(px);
      a.root.rotation.set(-0.42, -0.5, 0);
      a.badge.style.transform = `translate(${Math.round(pt.x)}px, ${Math.round(pt.y + 4)}px) translate(-50%, 0)`;
      a.badge.style.opacity = String(Math.min(1, (zoom - def.minZoom + 0.6)));
    }
    for (const id of [...this.active.keys()]) {
      if (keep.has(id)) continue;
      const a = this.active.get(id)!;
      this.scene.remove(a.root);
      a.badge.remove();
      this.active.delete(id);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
