import * as THREE from 'three';
import type L from 'leaflet';
import { LANDMARKS } from './registry';
import { buildLandmark } from './builders';
import { addLights, makeMaterials, setFog, palette } from './style';
import type { LandmarkDef, ProjectPoint } from './types';

interface Active {
  def: LandmarkDef;
  root: THREE.Group;
}

/**
 * WebGL overlay synced to Leaflet 2D pan/zoom (no pitch/bearing).
 * Canvas covers the map container; lat/lng → container pixels via project().
 */
export class LandmarkLayer {
  private map: L.Map;
  private host: HTMLDivElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private active = new Map<string, Active>();
  private mats = makeMaterials();
  private raf = 0;
  private attached = false;

  constructor(map: L.Map) {
    this.map = map;
    this.host = document.createElement('div');
    this.host.className = 'landmark-layer';
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);
    this.host.appendChild(this.renderer.domElement);
    this.camera = new THREE.OrthographicCamera(0, 1, 0, 1, -800, 800);
    addLights(this.scene);
    setFog(this.scene, this.mats.fogColor);
  }

  attach() {
    if (this.attached) return;
    this.attached = true;
    this.map.getContainer().appendChild(this.host);
    const tick = () => { this.sync(this.project.bind(this), this.map.getZoom()); };
    this.map.on('move zoom resize moveend zoomend zoomanim', tick);
    window.addEventListener('resize', tick);
    tick();
  }

  destroy() {
    if (!this.attached) return;
    this.attached = false;
    this.host.remove();
    this.clearActive();
    this.renderer.dispose();
  }

  setFogColor(hex: number) {
    setFog(this.scene, hex);
    this.mats = makeMaterials(hex);
  }

  /** Leaflet container projection; null when far off-screen. */
  private project(lat: number, lon: number): { x: number; y: number } | null {
    const size = this.map.getSize();
    const pad = 120;
    const pt = this.map.latLngToContainerPoint([lat, lon]);
    if (pt.x < -pad || pt.y < -pad || pt.x > size.x + pad || pt.y > size.y + pad) return null;
    return { x: pt.x, y: pt.y };
  }

  sync(project: ProjectPoint, zoom: number) {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.draw(project, zoom));
  }

  private draw(project: ProjectPoint, zoom: number) {
    const w = this.map.getSize().x, h = this.map.getSize().y;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.host.style.width = `${w}px`;
    this.host.style.height = `${h}px`;
    this.camera.left = 0;
    this.camera.right = w;
    this.camera.top = 0;
    this.camera.bottom = h;
    this.camera.updateProjectionMatrix();

    const keep = new Set<string>();
    for (const def of LANDMARKS) {
      if (zoom < def.minZoom) continue;
      const pt = project(def.lat, def.lon);
      if (!pt) {
        this.drop(def.id);
        continue;
      }
      keep.add(def.id);
      let entry = this.active.get(def.id);
      if (!entry) {
        const root = buildLandmark(def);
        this.scene.add(root);
        entry = { def, root };
        this.active.set(def.id, entry);
      }
      const zScale = Math.pow(2, zoom - def.minZoom);
      const s = def.scale * 0.022 * zScale;
      entry.root.position.set(pt.x, pt.y, 0);
      entry.root.scale.setScalar(s);
      // slight isometric tilt toward the “camera” (Apple-ish showcase)
      entry.root.rotation.x = -0.42;
      entry.root.rotation.y = 0.35;
    }
    for (const id of [...this.active.keys()]) if (!keep.has(id)) this.drop(id);
    this.renderer.render(this.scene, this.camera);
  }

  private drop(id: string) {
    const a = this.active.get(id);
    if (!a) return;
    this.scene.remove(a.root);
    this.active.delete(id);
  }

  private clearActive() {
    for (const id of [...this.active.keys()]) this.drop(id);
  }
}

/** Default fog tint when Terrain ocean is active. */
export const defaultLandmarkFog = palette.fog;
