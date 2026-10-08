// Streets, railways, lakes, rivers and buildings for every map style, drawn live from OpenStreetMap data.
// Vector tiles: OpenFreeMap (free, no key), OpenMapTiles schema, data from OpenStreetMap contributors (ODbL).
// We only download the geometry and paint it ourselves in each style's own colors.
import L from 'leaflet';
import type { VectorTile } from '@mapbox/vector-tile';
import { loadVector, MAX_VECTOR_ZOOM } from './tiles';

const TILE = 256;

export interface StreetStyle {
  /** Lakes. `sea` also paints the ocean polygon, which would hide the sea relief and shading underneath, so every style leaves it off. */
  water: string; sea: boolean;
  river: string; rail: string;
  /** Building fill and outline. */
  building: [string, string];
  /** Thin shadow under the biggest roads. */
  casing: string;
  /** Road colors by importance; side streets, service roads and paths all use `minor`. */
  roads: { motorway: string; trunk: string; primary: string; secondary: string; minor: string };
}

// Terrain: light and thin on purpose, cream roads over the pixel relief
export const TERRAIN_STREETS: StreetStyle = {
  water: 'rgba(79,116,135,0.9)', sea: false, river: 'rgba(79,116,135,0.95)', rail: 'rgba(42,29,23,0.45)',
  building: ['rgba(230,197,149,0.95)', 'rgba(42,29,23,0.7)'], casing: 'rgba(42,29,23,0.16)',
  roads: { motorway: 'rgba(236,160,120,0.9)', trunk: 'rgba(240,190,150,0.85)', primary: 'rgba(255,250,240,0.8)', secondary: 'rgba(255,250,240,0.7)', minor: 'rgba(255,250,240,0.5)' }
};

// [first zoom, casing width, fill width, color key]. Roads appear one zoom after county and province lines (7.5), at 8.5.
type Road = [number, number, number, keyof StreetStyle['roads']];
const ROADS: Record<string, Road> = {
  motorway: [9, 3, 1.6, 'motorway'],
  trunk: [9, 3, 1.4, 'trunk'],
  primary: [9, 2.6, 1.2, 'primary'],
  secondary: [10, 0, 1, 'secondary'],
  tertiary: [11, 0, 0.9, 'secondary'],
  minor: [12, 0, 0.8, 'minor'],
  service: [14, 0, 0.6, 'minor'],
  track: [14, 0, 0.6, 'minor'],
  path: [15, 0, 0.5, 'minor']
};
const ORDER = ['path', 'track', 'service', 'minor', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway'];
const roadClass = (c: string) => c === 'busway' || c === 'raceway' ? 'service' : c in ROADS ? c : '';
const MIN_ROAD_ZOOM = 9;

export class StreetsLayer extends L.GridLayer {
  private style: StreetStyle;
  constructor(style: StreetStyle, options: L.GridLayerOptions = {}) {
    super({ tileSize: TILE, updateWhenZooming: false, keepBuffer: 2, minZoom: 4, ...options });
    this.style = style;
  }
  setStyle(style: StreetStyle) { this.style = style; this.redraw(); }

  protected createTile(c: L.Coords, done: L.DoneCallback): HTMLElement {
    const cv = document.createElement('canvas'); cv.width = cv.height = TILE;
    const n = 2 ** c.z;
    if (c.y < 0 || c.y >= n) { setTimeout(() => done(undefined, cv)); return cv; }
    const dz = Math.min(c.z, MAX_VECTOR_ZOOM), over = c.z - dz, k = 2 ** over;
    const tx = (((c.x >> over) % (2 ** dz)) + 2 ** dz) % 2 ** dz, ty = c.y >> over;
    const ox = (c.x - (c.x >> over) * k) * TILE, oy = (c.y - ty * k) * TILE;   // where our tile starts inside the stretched data tile
    loadVector(dz, tx, ty).then(vt => {
      if (vt) this.paint(cv, vt, c.z, k, ox, oy);
      done(undefined, cv);
    });
    return cv;
  }

  private paint(cv: HTMLCanvasElement, tile: VectorTile, z: number, k: number, ox: number, oy: number) {
    const ctx = cv.getContext('2d')!, S = this.style;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const trace = (f: any, scale: number) => {
      for (const ring of f.loadGeometry()) {
        ring.forEach((p: { x: number; y: number }, i: number) => {
          const x = p.x * scale - ox, y = p.y * scale - oy;
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        });
      }
    };
    const draw = (layerName: string, each: (f: any, scale: number) => void) => {
      const l = tile.layers[layerName]; if (!l) return;
      const scale = (TILE * k) / l.extent;
      for (let i = 0; i < l.length; i++) each(l.feature(i), scale);
    };

    // lakes and the sea inlets the elevation data misses
    ctx.fillStyle = S.water;
    if (z >= 5) draw('water', (f, s) => {
      if (f.type !== 3 || (!S.sea && f.properties.class === 'ocean')) return;
      ctx.beginPath(); trace(f, s); ctx.fill('evenodd');
    });
    // rivers
    if (z >= 8) {
      ctx.strokeStyle = S.river; ctx.lineWidth = z >= 12 ? 2 : 1;
      draw('waterway', (f, s) => {
        if (f.type !== 2 || (z < 10 && f.properties.class !== 'river')) return;
        ctx.beginPath(); trace(f, s); ctx.stroke();
      });
    }
    // buildings (only worth it close up)
    if (z >= 14) {
      ctx.fillStyle = S.building[0]; ctx.strokeStyle = S.building[1]; ctx.lineWidth = 0.7;
      draw('building', (f, s) => {
        if (f.type !== 3) return;
        ctx.beginPath(); trace(f, s); ctx.fill('evenodd'); ctx.stroke();
      });
    }
    // railways
    if (z >= MIN_ROAD_ZOOM) {
      ctx.strokeStyle = S.rail; ctx.lineWidth = 0.8; ctx.setLineDash([4, 3]);
      draw('transportation', (f, s) => {
        if (f.type !== 2 || f.properties.class !== 'rail' || (z < 10 && f.properties.service)) return;
        ctx.beginPath(); trace(f, s); ctx.stroke();
      });
      ctx.setLineDash([]);
    }
    // roads: every casing first, then the fills, smallest class at the bottom, bridges above
    const roads: { cls: string; f: any; s: number }[] = [];
    draw('transportation', (f, s) => {
      if (f.type !== 2) return;
      const cls = roadClass(f.properties.class);
      if (cls && z >= ROADS[cls][0] && !(z < 13 && f.properties.service)) roads.push({ cls, f, s });
    });
    roads.sort((a, b) => ORDER.indexOf(a.cls) - ORDER.indexOf(b.cls) || (a.f.properties.layer || 0) - (b.f.properties.layer || 0));
    const grow = Math.min(1.7, 0.8 + (z - MIN_ROAD_ZOOM) * 0.1);   // roads get a little wider as you zoom in
    for (const pass of [0, 1]) for (const { cls, f, s } of roads) {
      const [, casing, fill, key] = ROADS[cls];
      if (pass === 0 && !casing) continue;
      ctx.strokeStyle = pass === 0 ? S.casing : S.roads[key];
      ctx.lineWidth = (pass === 0 ? casing : fill) * grow;
      ctx.beginPath(); trace(f, s); ctx.stroke();
    }
  }
}
