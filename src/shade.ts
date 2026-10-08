// Extra detail for the flat map styles (Paper, Atlas, Night): hillshading over the land, and sea depth in the water.
// Heights come from the same Terrarium elevation tiles as the Terrain style (public data: SRTM, GEBCO, ETOPO1 and others).
import L from 'leaflet';
import { loadElevation } from './relief';

const TILE = 256;
const MAX_DATA_ZOOM = 13;
const hex = (h: number): number[] => [h >> 16, (h >> 8) & 255, h & 255];
export const rgb = hex;

export interface ShadeStyle {
  /** How strong the hillshade is on land, 0 to 1. */
  land: number;
  /** How much of that strength goes to the sunny side (default 1). Lower it on dark styles so highlights don't wash out the colors. */
  light?: number;
  /** Sea color just off the coast and in the deepest trenches. */
  seaShallow: number[]; seaDeep: number[];
}

/** One layer, two jobs: `land` paints soft light and shadow on top of the countries; `sea` paints depth under them. */
export class ShadeLayer extends L.GridLayer {
  private style: ShadeStyle;
  constructor(private part: 'land' | 'sea', style: ShadeStyle, options: L.GridLayerOptions = {}) {
    super({ tileSize: TILE, updateWhenZooming: false, keepBuffer: 2, ...options });
    this.style = style;
  }
  setStyle(style: ShadeStyle) { this.style = style; this.redraw(); }

  protected createTile(c: L.Coords, done: L.DoneCallback): HTMLElement {
    const cv = document.createElement('canvas'); cv.width = cv.height = TILE;
    const n = 2 ** c.z;
    if (c.y < 0 || c.y >= n) { setTimeout(() => done(undefined, cv)); return cv; }
    const dz = Math.min(c.z, MAX_DATA_ZOOM), over = c.z - dz, k = 2 ** over;
    const tx = (((c.x >> over) % (2 ** dz)) + 2 ** dz) % 2 ** dz, ty = c.y >> over;
    const sub = TILE / k, ox = (c.x - (c.x >> over) * k) * sub, oy = (c.y - ty * k) * sub;
    loadElevation(dz, tx, ty).then(e => {
      if (e) this.paint(cv, e, c.z, c.y, dz, ox, oy, sub);
      done(undefined, cv);
    });
    return cv;
  }

  private paint(cv: HTMLCanvasElement, e: Float32Array, z: number, ty: number, dz: number, ox: number, oy: number, sub: number) {
    const step = sub / TILE, S = this.style, land = this.part === 'land';
    const at = (x: number, y: number) => e[Math.min(TILE - 1, Math.max(0, y)) * TILE + Math.min(TILE - 1, Math.max(0, x))];
    const h = new Float32Array(TILE * TILE);
    for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
      const sx = ox + (i + 0.5) * step - 0.5, sy = oy + (j + 0.5) * step - 0.5;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      h[j * TILE + i] = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    }
    const hAt = (x: number, y: number) => h[Math.min(TILE - 1, Math.max(0, y)) * TILE + Math.min(TILE - 1, Math.max(0, x))];
    const img = new ImageData(TILE, TILE), n = 2 ** z, worldM = 40075016.686;
    for (let j = 0; j < TILE; j++) {
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (ty + (j + 0.5) / TILE) / n)));
      const mpp = (worldM / n / TILE) * Math.cos(lat);
      // zoomed out, each pixel is a big area and slopes flatten, so shade harder to keep ranges visible
      const boost = 1 + Math.min(3.2, Math.max(0, 0.45 * Math.log2(mpp / 250)));
      for (let i = 0; i < TILE; i++) {
        const v = h[j * TILE + i], o = (j * TILE + i) * 4;
        if (land) {
          if (v <= 0) continue;
          const dx = (hAt(i + 1, j) - hAt(i - 1, j)) / (2 * mpp), dy = (hAt(i, j + 1) - hAt(i, j - 1)) / (2 * mpp);
          const s = Math.max(-1, Math.min(1, (-dx - dy) * 2.6 * boost));   // light from the north-west
          const lit = s > 0;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = lit ? 255 : 0;
          img.data[o + 3] = Math.round(Math.abs(s) * S.land * (lit ? 150 * (S.light ?? 1) : 215));
        } else {
          if (v > 0) continue;
          const t = Math.min(1, Math.sqrt(-v / 6000));     // quick drop-off near the coast, slow in the deep
          for (let q = 0; q < 3; q++) img.data[o + q] = S.seaShallow[q] + (S.seaDeep[q] - S.seaShallow[q]) * t;
          img.data[o + 3] = 255;
        }
      }
    }
    cv.getContext('2d')!.putImageData(img, 0, 0);
  }
}
