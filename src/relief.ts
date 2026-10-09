// Shaded relief and sea depth for every map style, drawn from two small pictures that ship with the app
// (public/data/relief-shade.webp and relief-height.webp, made by scripts/build-relief.mjs from AWS Terrain Tiles).
// Nothing here calls an outside map service: both pictures are Web Mercator, so a map tile is just a rectangle of them.
import L from 'leaflet';

const base = `${import.meta.env.BASE_URL}data/`;
const loadImage = (name: string) => new Promise<HTMLImageElement | null>(res => {
  const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = base + name;
});

interface Pictures { shade: HTMLImageElement; height: HTMLImageElement }
let pictures: Promise<Pictures | null> | null = null;
/** Starts loading on first use; resolves to null if the files are missing, and the map then just goes without relief. */
export const reliefReady = () => pictures ??= Promise.all([loadImage('relief-shade.webp'), loadImage('relief-height.webp')])
  .then(([shade, height]) => (shade && height ? { shade, height } : null));

// relief-height.webp stores height as a signed square root: 0 = deepest sea (-11000 m), 255 = highest peak (8850 m)
const sq = (v: number) => Math.sign(v) * Math.sqrt(Math.abs(v));
const SQ_LO = sq(-11000), SQ_HI = sq(8850);
/** Metres above sea level for a height picture value (negative under the sea). */
export const metres = (byte: number) => { const v = SQ_LO + (byte / 255) * (SQ_HI - SQ_LO); return Math.sign(v) * v * v; };

let scratch: HTMLCanvasElement | null = null;
/** The part of a picture under map tile z/x/y, sampled onto a cells x cells grid (one value per cell, 0-255). */
function sample(img: HTMLImageElement, z: number, x: number, y: number, cells: number): Uint8ClampedArray {
  const cv = scratch ??= document.createElement('canvas');
  if (cv.width !== cells) { cv.width = cv.height = cells; }
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  const n = 2 ** z, span = img.width / n, wx = ((x % n) + n) % n;   // tiles repeat around the world
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, cells, cells);
  ctx.drawImage(img, wx * span, y * span, span, span, 0, 0, cells, cells);
  const d = ctx.getImageData(0, 0, cells, cells).data, out = new Uint8ClampedArray(cells * cells);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4];
  return out;
}
export interface TileRelief { shade: Uint8ClampedArray; height: Uint8ClampedArray }
export function reliefTile(p: Pictures, z: number, x: number, y: number, cells: number): TileRelief | null {
  if (y < 0 || y >= 2 ** z) return null;
  return { shade: sample(p.shade, z, x, y, cells), height: sample(p.height, z, x, y, cells) };
}

/** Height in metres at a point, from our bundled height picture. Null until the picture loads. */
export async function heightAt(lat: number, lng: number): Promise<number | null> {
  const p = await reliefReady();
  if (!p) return null;
  const img = p.height, w = img.width, h = img.height;
  const x = ((((lng + 180) / 360) % 1) + 1) % 1 * w;
  const merc = Math.log(Math.tan(Math.PI / 4 + (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 360));
  const y = (1 - merc / Math.PI) / 2 * h;
  const cv = scratch ??= document.createElement('canvas');
  if (cv.width !== 1) { cv.width = cv.height = 1; }
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, 1, 1);
  ctx.drawImage(img, Math.max(0, Math.min(w - 1, x)), Math.max(0, Math.min(h - 1, y)), 1, 1, 0, 0, 1, 1);
  return Math.round(metres(ctx.getImageData(0, 0, 1, 1).data[0]));
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
/** Ordered-dither threshold for a cell, in 0..1: the pixel-art look. */
export const bayer = (cx: number, cy: number) => BAYER[(cy & 3) * 4 + (cx & 3)];
const smooth = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Height of the snow line in metres: high in the tropics, sinking towards the poles. */
const snowLine = (lat: number) => { const a = Math.abs(lat); return a < 25 ? 5700 : a < 50 ? mix(5700, 2800, (a - 25) / 25) : Math.max(0, mix(2800, 0, (a - 50) / 30)); };
const ROCK = [150, 132, 112], SNOW = [246, 248, 252];

/** Lights and tints one land color: bare rock above the tree line, snow above the snow line, and sun and shadow from the shade picture.
 *  `rgb` is changed in place. `k` (0..1) fades the whole effect, `dither` is the cell's `bayer()` value. */
export function shadeLand(rgb: number[], shade: number, hb: number, lat: number, k: number, dither: number) {
  const m = metres(hb), snow = snowLine(lat);
  const tSnow = smooth((m - (snow - 450)) / 650), tRock = smooth((m - (snow - 1700)) / 1100) * 0.55 * (1 - tSnow);
  for (let c = 0; c < 3; c++) rgb[c] = mix(mix(rgb[c], ROCK[c], tRock * k), SNOW[c], tSnow * 0.92 * k);
  // sun and shadow in a few steps, so the hills look like pixel art instead of a smooth blur
  const l = Math.max(-0.9, Math.min(0.7, ((shade - 180) / 180) * 1.7)), STEP = 0.11;
  const f = 1 + (Math.floor(l / STEP + dither) * STEP) * 0.9 * k;
  for (let c = 0; c < 3; c++) rgb[c] = Math.max(0, Math.min(255, rgb[c] * f));
}

// ---------------------------------------------------------------------------------------------------------------------
// The sea floor: shallow shelves are light, the deep ocean is dark. Drawn under the country shapes.
// ---------------------------------------------------------------------------------------------------------------------
export interface SeaStyle { shallow: string; mid: string; deep: string; /** pixel-art bands instead of a smooth fade */ bands: boolean }
const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** Colors for a map style, made from its ocean color. */
export function seaStyleFor(ocean: string, bands: boolean): SeaStyle {
  const [r, g, b] = hex(ocean), dark = (r * 0.3 + g * 0.59 + b * 0.11) < 70;
  const to = (t: number[], k: number) => '#' + [r, g, b].map((v, i) => Math.round(mix(v, t[i], k)).toString(16).padStart(2, '0')).join('');
  return dark ? { shallow: to([109, 142, 163], 0.18), mid: ocean, deep: to([0, 4, 8], 0.45), bands }
    : { shallow: to([255, 255, 255], 0.3), mid: ocean, deep: to([22, 58, 84], 0.3), bands };
}

const SEA_BANDS = 7;
export class SeaLayer extends L.GridLayer {
  private style: SeaStyle;
  private colors: number[][] = [];
  constructor(style: SeaStyle, options: L.GridLayerOptions = {}) {
    super({ tileSize: 256, updateWhenZooming: false, keepBuffer: 1, ...options });
    this.style = style; this.palette();
  }
  setStyle(style: SeaStyle) { this.style = style; this.palette(); this.redraw(); }
  private palette() {
    const { shallow, mid, deep } = this.style, a = hex(shallow), b = hex(mid), c = hex(deep);
    // depth runs 0 m (the beach) to about 6000 m; the shelf (under ~200 m) is where the color changes fastest
    this.colors = Array.from({ length: 64 }, (_, i) => {
      const t = i / 63;
      return t < 0.25 ? a.map((v, k) => mix(v, b[k], t / 0.25)) : b.map((v, k) => mix(v, c[k], (t - 0.25) / 0.75));
    });
  }
  protected createTile(co: L.Coords, done: L.DoneCallback): HTMLElement {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    reliefReady().then(p => {
      const cells = this.style.bands ? 128 : 64, scale = 256 / cells;
      const t = p && reliefTile(p, co.z, co.x, co.y, cells);
      if (t) {
        const small = document.createElement('canvas'); small.width = small.height = cells;
        const sctx = small.getContext('2d')!, img = sctx.createImageData(cells, cells);
        for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
          const o = j * cells + i, m = metres(t.height[o]);
          if (m >= 0) continue;   // land: the country shapes cover it
          // depth 0..1 on a gentle curve, so the first few hundred metres already change color
          let d = Math.min(1, Math.sqrt(-m / 9000));
          if (this.style.bands) d = Math.min(1, Math.floor(d * SEA_BANDS + bayer(i, j)) / SEA_BANDS);
          const c = this.colors[Math.round(d * 63)];
          img.data[o * 4] = c[0]; img.data[o * 4 + 1] = c[1]; img.data[o * 4 + 2] = c[2]; img.data[o * 4 + 3] = 255;
        }
        sctx.putImageData(img, 0, 0);
        const ctx = cv.getContext('2d')!; ctx.imageSmoothingEnabled = !this.style.bands;
        ctx.drawImage(small, 0, 0, cells * scale, cells * scale);
      }
      done(undefined, cv);
    });
    return cv;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The flat styles (Paper, Atlas, Night): the same sun and shadow laid over their plain colors.
// ---------------------------------------------------------------------------------------------------------------------
export class ShadeLayer extends L.GridLayer {
  private strength: number;
  constructor(strength: number, options: L.GridLayerOptions = {}) {
    super({ tileSize: 256, updateWhenZooming: false, keepBuffer: 1, ...options });
    this.strength = strength;
  }
  setStrength(k: number) { this.strength = k; this.redraw(); }
  protected createTile(co: L.Coords, done: L.DoneCallback): HTMLElement {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    reliefReady().then(p => {
      const cells = 128, t = p && reliefTile(p, co.z, co.x, co.y, cells);
      if (t) {
        const small = document.createElement('canvas'); small.width = small.height = cells;
        const sctx = small.getContext('2d')!, img = sctx.createImageData(cells, cells);
        for (let o = 0; o < cells * cells; o++) {
          const s = (t.shade[o] - 180) / 180, hb = metres(t.height[o]);
          if (hb < 0) continue;   // the sea is flat
          // shadow is black, sunlit slopes are white, both faint; the highest ground also gets a little lighter
          const a = s < 0 ? Math.min(1, -s * 1.7) * 0.5 * this.strength : Math.min(1, s * 3) * 0.32 * this.strength;
          const v = s < 0 ? 0 : 255;
          img.data[o * 4] = img.data[o * 4 + 1] = img.data[o * 4 + 2] = v; img.data[o * 4 + 3] = Math.round(a * 255);
        }
        sctx.putImageData(img, 0, 0);
        const ctx = cv.getContext('2d')!; ctx.imageSmoothingEnabled = true; ctx.drawImage(small, 0, 0, 256, 256);
      }
      done(undefined, cv);
    });
    return cv;
  }
}
