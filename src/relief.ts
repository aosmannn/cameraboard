// Pixel-art terrain for the Terrain theme, drawn live so it stays sharp at every zoom. Three data sources:
//  - heights: Mapzen/AWS "Terrarium" elevation tiles (public data: SRTM, GEBCO, ETOPO1 and others)
//  - climate zones: a world grid made from Natural Earth II land cover (public/data/biomes.png, public domain)
//  - local detail: OpenStreetMap land cover and land use (forests, fields, marsh, sand, rock, ice, towns), from zoom 7
// Each map tile is turned into 64 x 64 chunky squares: zone color, then altitude (tree line, bare rock, snow), steep
// cliffs, local land cover, hillshade, and ordered dithering for the pixel look.
import L from 'leaflet';
import type { VectorTile } from '@mapbox/vector-tile';
import { loadVector, MAX_VECTOR_ZOOM } from './tiles';

const SOURCE = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const MAX_DATA_ZOOM = 13;    // deeper than this the height tile is simply stretched
const LOCAL_FROM = 7;        // OpenStreetMap land cover is only worth fetching from this zoom
const TILE = 256;
const CELL = 4;              // one chunky square is CELL x CELL screen pixels
const N = TILE / CELL;

const hex = (h: number): number[] => [h >> 16, (h >> 8) & 255, h & 255];
const mix = (a: number[], b: number[], t: number, out: number[] = [0, 0, 0]) => {
  for (let k = 0; k < 3; k++) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
};
const smooth = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

// ---- climate zones: the numbers match scripts/build-biomes.mjs ----
const ZONE = [
  0xeef4f8, // 0 ice
  0xb4b29a, // 1 tundra (arctic and high plateaus)
  0x5c7a63, // 2 boreal forest (taiga)
  0x84a665, // 3 temperate forest
  0x46834f, // 4 tropical rainforest
  0xbcb96c, // 5 savanna and open woodland
  0xcfc47c, // 6 grassland and steppe
  0xcdb384, // 7 semi-arid scrub
  0xe9d39b, // 8 sandy desert
  0xc79163  // 9 rocky desert
].map(hex);
const ZONE_ICE = 0;

// bare mountain rock, from the tree line up to the snow line: grey scree, Claude orange, terracotta, dark brown
const ROCK = [[0, 0xb8a58e], [0.3, 0xd97757], [0.62, 0xa04b32], [0.88, 0x6b3425], [1, 0xf4f1ea]]
  .map(([t, c]) => [t, hex(c as number)] as [number, number[]]);
function rock(t: number, out: number[]) {
  t = Math.min(1, Math.max(0, t));
  let i = 0; while (i < ROCK.length - 2 && t > ROCK[i + 1][0]) i++;
  const [a, ca] = ROCK[i], [b, cb] = ROCK[i + 1];
  return mix(ca, cb, (t - a) / (b - a), out);
}
const CLIFF = hex(0x8f7d6b);   // steep faces: canyon walls, gorges, ridge crests
const SEA = ([
  [0, 0x6c8ea0], [200, 0x4f7487], [1000, 0x3b5a6c], [2500, 0x2c4553], [4500, 0x1f3039], [7000, 0x141f26]
] as [number, number][]).map(([m, c]) => [m, hex(c)] as [number, number[]]);
function sea(depth: number, out: number[]) {
  let i = 0; while (i < SEA.length - 2 && depth > SEA[i + 1][0]) i++;
  const [a, ca] = SEA[i], [b, cb] = SEA[i + 1];
  return mix(ca, cb, Math.round(Math.min(1, Math.max(0, (depth - a) / (b - a))) * 2) / 2, out);
}

// ---- local land cover from OpenStreetMap ----
const LC = { none: 0, wood: 1, grass: 2, farm: 3, wet: 4, sand: 5, rock: 6, ice: 7, urban: 8, orchard: 9 };
const LC_ID = (id: number) => `rgb(${id * 20 + 10},0,0)`;
const LC_CLASS: Record<string, number> = { wood: LC.wood, grass: LC.grass, farmland: LC.farm, wetland: LC.wet, sand: LC.sand, rock: LC.rock, ice: LC.ice };
const LANDUSE: Record<string, number> = {
  residential: LC.urban, suburb: LC.urban, neighbourhood: LC.urban, quarter: LC.urban, commercial: LC.urban, industrial: LC.urban,
  retail: LC.urban, school: LC.urban, college: LC.urban, university: LC.urban, hospital: LC.urban, railway: LC.urban,
  cemetery: LC.grass, quarry: LC.rock, garages: LC.urban
};
const LC_COLOR: Record<number, number[]> = {
  [LC.grass]: hex(0xb3c477), [LC.sand]: hex(0xecd7a0), [LC.ice]: hex(0xeef4f8), [LC.urban]: hex(0xc4b8ab)
};
const FIELD = [hex(0xd6d28c), hex(0xc8d085), hex(0xdccb8a), hex(0xcbc77f)];
const hash = (a: number, b: number) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; };

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// ---- the climate zone grid ----
let zones: Uint8Array | null = null, zw = 0, zh = 0;
const zonesReady: Promise<void> = new Promise(res => {
  const im = new Image();
  im.onload = () => {
    zw = im.width; zh = im.height;
    const c = document.createElement('canvas'); c.width = zw; c.height = zh;
    const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, zw, zh).data; zones = new Uint8Array(zw * zh);
    for (let i = 0; i < zones.length; i++) zones[i] = d[i * 4];
    res();
  };
  im.onerror = () => res();
  im.src = `${import.meta.env.BASE_URL}data/biomes.png`;
});
/** Smooth blend of the four nearest zone grid points, so zones fade into each other like real ecotones. */
function zoneColor(lat: number, lng: number, out: number[]) {
  if (!zones) return mix(ZONE[3], ZONE[3], 0, out);   // grid not loaded: plain forest green
  const u = ((lng + 180) / 360) * zw - 0.5, v = ((90 - lat) / 180) * zh - 0.5;
  const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
  const at = (x: number, y: number) => ZONE[zones![Math.min(zh - 1, Math.max(0, y)) * zw + (((x % zw) + zw) % zw)]];
  const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
  for (let k = 0; k < 3; k++) out[k] = (a[k] * (1 - fx) + b[k] * fx) * (1 - fy) + (c[k] * (1 - fx) + d[k] * fx) * fy;
  return out;
}

/** Where trees stop growing and where permanent snow starts, in meters, for a latitude. */
const treeLine = (lat: number) => Math.max(250, 4300 - 62 * Math.max(0, Math.abs(lat) - 10));
const snowLine = (lat: number) => Math.max(900, 5600 - 50 * Math.max(0, Math.abs(lat) - 5));

// ---- decoding ----
const scratch = document.createElement('canvas');
scratch.width = scratch.height = TILE;
const sctx = scratch.getContext('2d', { willReadFrequently: true })!;

/** One Terrarium tile exactly as downloaded: elevation in meters, or null if the tile is missing. */
function loadRaw(z: number, x: number, y: number): Promise<Float32Array | null> {
  return new Promise(res => {
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => {
      sctx.clearRect(0, 0, TILE, TILE); sctx.drawImage(im, 0, 0);
      const d = sctx.getImageData(0, 0, TILE, TILE).data, e = new Float32Array(TILE * TILE);
      for (let i = 0; i < e.length; i++) e[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
      res(e);
    };
    im.onerror = () => res(null);
    im.src = SOURCE(z, x, y);
  });
}

/** Reads a coarser tile as if it were stretched over the finer one: `levels` zoom steps up, finer tile at (x, y). */
function stretched(src: Float32Array, x: number, y: number, levels: number) {
  const k = 2 ** levels, ox = (x & (k - 1)) * TILE, oy = (y & (k - 1)) * TILE;
  const at = (px: number, py: number) => src[Math.min(TILE - 1, Math.max(0, py)) * TILE + Math.min(TILE - 1, Math.max(0, px))];
  return (i: number, j: number) => {
    const sx = (ox + i + 0.5) / k - 0.5, sy = (oy + j + 0.5) / k - 0.5, x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  };
}

const checked = new Map<string, Promise<Float32Array | null>>();
/**
 * Elevation in meters for a Terrarium tile, checked against its coarser parent tiles. The free tiles have two flaws:
 *  - some tiles hold wrong land (at zoom 8, east of 178.6 degrees near Fiji, open sea reads as land), and
 *  - from zoom 9 up, ocean often has no depth at all (flat zero, or a few meters below it).
 * A tile that clearly disagrees with its parent about land and sea is replaced by the parent's data, and flat sea
 * takes its depth from the zoom 7 tile above it.
 */
function loadAws(z: number, x: number, y: number): Promise<Float32Array | null> {
  const key = `${z}/${x}/${y}`;
  let p = checked.get(key);
  if (!p) {
    p = verified(z, x, y);
    checked.set(key, p);
    if (checked.size > 120) checked.delete(checked.keys().next().value!);
  }
  return p;
}
/** A zoom 8 or 9 tile rebuilt from the zoom 10 tiles inside it, each squeezed down to its share of the tile. */
async function fromZoom10(z: number, x: number, y: number): Promise<Float32Array | null> {
  const k = 2 ** (10 - z), part = TILE / k;
  const subs = await Promise.all(Array.from({ length: k * k }, (_, n) => loadRaw(10, x * k + (n % k), y * k + Math.floor(n / k))));
  if (subs.some(t => !t)) return null;
  const out = new Float32Array(TILE * TILE);
  subs.forEach((t, n) => {
    const ox = (n % k) * part, oy = Math.floor(n / k) * part;
    for (let j = 0; j < part; j++) for (let i = 0; i < part; i++) {
      let sum = 0;
      for (let q = 0; q < k; q++) for (let p = 0; p < k; p++) sum += t![(j * k + q) * TILE + i * k + p];
      out[(oy + j) * TILE + ox + i] = sum / (k * k);
    }
  });
  return out;
}

async function verified(z: number, x: number, y: number): Promise<Float32Array | null> {
  const [e, parent, deep] = await Promise.all([
    loadRaw(z, x, y),
    z > 5 ? loadAws(z - 1, x >> 1, y >> 1) : null,
    z >= 8 ? loadAws(7, x >> (z - 7), y >> (z - 7)) : null
  ]);
  if (!e) return null;
  let out = e;
  // The last strip before the date line (east of 178.6 degrees) has wrong land at zoom 8 and 9 (Fiji, East Cape of New
  // Zealand), sometimes only a little, so those tiles are always rebuilt from the good zoom 10 tiles.
  const n = 2 ** z;
  if (z >= 8 && z <= 9 && x >= n - (n >> 8)) {
    const fine = await fromZoom10(z, x, y);
    if (fine) {
      // land comes from zoom 10; the sea keeps this tile's own depth (it matches the tiles next to it), and only the
      // false land turns into sea, taking its depth from the tile above
      const up = parent ? stretched(parent, x, y, 1) : null;
      out = new Float32Array(TILE * TILE);
      for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
        const k = j * TILE + i, f = fine[k], r = e[k];
        if (f > 0) out[k] = f;
        else if (r <= 0) out[k] = r;
        else { const hp = up ? up(i, j) : -5; out[k] = hp < 0 ? hp : -5; }
      }
    }
  }
  if (parent && out === e) {
    const up = stretched(parent, x, y, 1);
    let disagree = 0, sure = 0;
    for (let j = 4; j < TILE; j += 16) for (let i = 4; i < TILE; i += 16) {
      const hp = up(i, j);
      if (Math.abs(hp) > 120) { sure++; if ((e[j * TILE + i] > 0) !== (hp > 0)) disagree++; }
    }
    if (sure >= 6 && disagree / sure > 0.1) {       // wrong land and sea: use the coarser tile where it is sure of itself
      out = e.slice();
      for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
        const hp = up(i, j), k = j * TILE + i;
        if (out[k] > 0 && hp < -60) out[k] = hp;                  // land the coarse tile says is sea
        else if (out[k] <= 0 && hp > 120) out[k] = hp;           // sea the coarse tile says is land
        else if (out[k] <= 0 && Math.abs(hp) <= 300 && Math.abs(out[k] - hp) > 600) out[k] = hp;   // never flatten real land
      }
    }
  }
  // Near the date line the sea depth differs from tile to tile (and from one side of the line to the other), which shows as
  // hard edges. Within about 3.6 degrees of it, blend the sea smoothly toward the coarse zoom 7 depth, fully so in the
  // damaged strip itself, so the tones flow across tile edges and across the line.
  if (deep && z >= 8) {
    const reach = (3.6 / 360) * n;
    if (x + 1 > n - reach || x < reach) {
      const down = stretched(deep, x, y, z - 7);
      let copied = out !== e;
      for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
        const k = j * TILE + i, h = out[k];
        if (h > -20) continue;                       // land and the shore stay as they are
        const lng = ((x + (i + 0.5) / TILE) / n) * 360 - 180, d = Math.min(Math.abs(lng - 180), Math.abs(lng + 180));
        const t = Math.min(1, Math.max(0, (d - 1.4) / 2.2)), deepness = Math.min(1, (-h - 20) / 120);
        const w = (1 - t * t * (3 - 2 * t)) * deepness;
        if (w <= 0) continue;
        const hd = down(i, j);
        if (hd >= 0) continue;
        if (!copied) { out = e.slice(); copied = true; }
        out[k] = h * (1 - w) + hd * w;
      }
    }
  }
  if (deep) {                                        // sea with no depth data (flat or near zero): take the depth from the zoom 7 tile
    const down = stretched(deep, x, y, z - 7);
    let copied = out !== e;
    for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
      const k = j * TILE + i, h = out[k];
      if (h <= 0 && h > -8) {
        const hd = down(i, j);
        if (hd < -40) { if (!copied) { out = e.slice(); copied = true; } out[k] = hd; }
      }
    }
  }
  return out;
}

/** Land heights from Mapterhorn (global 30 m Copernicus data plus open national surveys, free, no key), squeezed to 256 x 256. */
const MAPTERHORN = (z: number, x: number, y: number) => `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`;
function loadMapterhorn(z: number, x: number, y: number): Promise<Float32Array | null> {
  return new Promise(res => {
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => {
      const w = im.width, c = document.createElement('canvas'); c.width = c.height = w;
      const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, w, w).data, e = new Float32Array(TILE * TILE), r = w / TILE;
      for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
        let sum = 0;
        for (let q = 0; q < r; q++) for (let p = 0; p < r; p++) { const o = ((j * r + q) * w + i * r + p) * 4; sum += d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768; }
        e[j * TILE + i] = sum / (r * r);
      }
      res(e);
    };
    im.onerror = () => res(null);
    im.src = MAPTERHORN(z, x, y);
  });
}

const merged = new Map<string, Promise<Float32Array | null>>();
/**
 * Elevation in meters for a tile. Land comes from Mapterhorn, which is consistent from zoom to zoom and has none of the
 * wrong land the AWS Terrarium tiles have near the date line. Mapterhorn has no seabed (the sea is flat zero), so the sea
 * keeps the depth from the repaired AWS tile.
 */
export function loadElevation(z: number, x: number, y: number): Promise<Float32Array | null> {
  const key = `${z}/${x}/${y}`;
  let p = merged.get(key);
  if (!p) {
    p = Promise.all([loadAws(z, x, y), loadMapterhorn(z, x, y)]).then(([a, m]) => {
      if (!m) return a;
      if (!a) return m;
      const out = new Float32Array(TILE * TILE);
      for (let k = 0; k < out.length; k++) out[k] = m[k] > 0.5 ? m[k] : (a[k] <= 0 ? a[k] : -3);   // land from Mapterhorn; elsewhere the sea depth
      return out;
    });
    merged.set(key, p);
    if (merged.size > 120) merged.delete(merged.keys().next().value!);
  }
  return p;
}

const lcScratch = document.createElement('canvas');
lcScratch.width = lcScratch.height = TILE;
const lctx = lcScratch.getContext('2d', { willReadFrequently: true })!;

/** What OpenStreetMap says covers each square of this tile (forest, field, marsh, town...), or null. */
function localCover(vt: VectorTile, kv: number, oxv: number, oyv: number): Uint8Array | null {
  lctx.clearRect(0, 0, TILE, TILE);
  let any = false;
  const fill = (layer: string, pick: (p: Record<string, any>) => number) => {
    const l = vt.layers[layer]; if (!l) return;
    const s = (TILE * kv) / l.extent;
    for (let i = 0; i < l.length; i++) {
      const f = l.feature(i); if (f.type !== 3) continue;
      const id = pick(f.properties); if (!id) continue;
      lctx.fillStyle = LC_ID(id); lctx.beginPath();
      for (const ring of f.loadGeometry()) ring.forEach((p, j) => { const x = p.x * s - oxv, y = p.y * s - oyv; if (j) lctx.lineTo(x, y); else lctx.moveTo(x, y); });
      lctx.fill('evenodd'); any = true;
    }
  };
  const order = ['farmland', 'grass', 'sand', 'rock', 'wood', 'wetland', 'ice'];   // later paints over earlier
  for (const cls of order) fill('landcover', p => p.class === cls ? LC_CLASS[cls] : 0);
  fill('landuse', p => LANDUSE[p.class] ?? 0);
  if (!any) return null;
  const d = lctx.getImageData(0, 0, TILE, TILE).data, out = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const o = ((j * CELL + 2) * TILE + i * CELL + 2) * 4;      // the middle of each square
    if (d[o + 3] < 255 || d[o + 1] || d[o + 2]) continue;      // blank, or a blurred edge pixel
    const id = Math.round((d[o] - 10) / 20);
    if (id >= 1 && id <= 9 && Math.abs(d[o] - (id * 20 + 10)) < 4) out[j * N + i] = id;
  }
  return out;
}

/** Paints one 64 x 64 chunky-pixel tile into `cv`. (z, tx, ty) is the map tile; the elevation window is ox, oy, sub. */
function paintTile(cv: HTMLCanvasElement, e: Float32Array, local: Uint8Array | null,
  z: number, tx: number, ty: number, dz: number, ox: number, oy: number, sub: number) {
  const step = sub / N, n = 2 ** z;
  const h = new Float32Array(N * N), peak = new Float32Array(N * N);
  const at = (x: number, y: number) => e[Math.min(TILE - 1, Math.max(0, y)) * TILE + Math.min(TILE - 1, Math.max(0, x))];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const sx = ox + (i + 0.5) * step - 0.5, sy = oy + (j + 0.5) * step - 0.5;
    if (step >= 1.5) {   // zoomed out: average the block so ridges are not lost
      let s = 0, c = 0, mx = -1e9; const a = Math.floor(step);
      for (let q = 0; q < a; q++) for (let p = 0; p < a; p++) { const e1 = at(Math.floor(ox + i * step + p), Math.floor(oy + j * step + q)); s += e1; c++; if (e1 > mx) mx = e1; }
      h[j * N + i] = s / c; peak[j * N + i] = mx;
    } else {             // zoomed in: smooth bilinear stretch
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      peak[j * N + i] = h[j * N + i] = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    }
  }
  const hAt = (x: number, y: number) => h[Math.min(N - 1, Math.max(0, y)) * N + Math.min(N - 1, Math.max(0, x))];
  const img = new ImageData(N, N), col = [0, 0, 0], tmp = [0, 0, 0];
  const worldM = 40075016.686, dtiles = 2 ** dz;
  for (let j = 0; j < N; j++) {
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (ty + (j + 0.5) / N) / n))) * 180 / Math.PI;
    const mpp = worldM / dtiles / TILE * step * Math.cos(lat * Math.PI / 180);
    // zoomed out, each square averages many heights and slopes flatten, so shade harder to keep ridges visible
    const boost = 1 + Math.min(3.2, Math.max(0, 0.45 * Math.log2(mpp / 250)));
    for (let i = 0; i < N; i++) {
      const lng = ((tx + (i + 0.5) / N) / n) * 360 - 180;
      const v = h[j * N + i], land = v > 0;
      const dx = (hAt(i + 1, j) - hAt(i - 1, j)) / (2 * mpp), dy = (hAt(i, j + 1) - hAt(i, j - 1)) / (2 * mpp);
      let lit: number;
      if (!land) {
        sea(-v, col);
        lit = Math.max(-1, Math.min(1, (-dx - dy) * 0.5)) * 16;
      } else {
        zoneColor(lat, lng, col);
        // altitude: above the tree line the ground turns to rock, then to snow at the snow line
        const tl = treeLine(lat), sl = snowLine(lat);
        const t = (v - tl) / (sl - tl);
        // hills and low mountains (like the Appalachians) warm toward brown the higher they are, even below the tree line
        // (zoomed out, lean toward the highest point in the square so ranges are not averaged away)
        const vt = 0.5 * v + 0.5 * Math.max(v, peak[j * N + i]);
        const warm = smooth((vt - 100) / 1000) * 0.95;
        if (warm > 0) mix(col, rock(0.24 + 0.62 * smooth((vt - 100) / 2800), tmp), warm, col);
        if (t > 0) mix(col, rock(t, tmp), smooth(t / 0.3), col);
        // OpenStreetMap detail: forests, fields, marsh, sand, rock, ice and towns
        const lc = local ? local[j * N + i] : 0;
        if (lc) {
          const a = Math.abs(lat);
          if (lc === LC.wood) mix(col, a <= 25 ? hex(0x3f7a49) : a >= 50 ? hex(0x4d6b56) : hex(0x6c9150), t > 0 ? 0.5 : 0.9, col);
          else if (lc === LC.farm) mix(col, FIELD[Math.floor(hash(Math.floor((tx * N + i) / 3), Math.floor((ty * N + j) / 3)) * 4)], 0.9, col);
          else if (lc === LC.wet) mix(col, (j + i) & 1 ? hex(0x78a393) : hex(0x5f8f86), 0.9, col);
          else if (lc === LC.rock) mix(col, rock(Math.max(t, 0.18), tmp), 0.85, col);
          else if (lc === LC.urban) mix(col, (i + j) & 1 ? LC_COLOR[LC.urban] : hex(0xb3a698), 0.9, col);
          else mix(col, LC_COLOR[lc], 0.85, col);
        }
        // steep faces (canyon walls, gorges, ridge crests) show bare rock
        const slope = Math.hypot(dx, dy);
        if (slope > 0.3 && lc !== LC.ice) mix(col, CLIFF, Math.min(0.55, (slope - 0.3) * 1.1), col);
        // a little grain, different in every square, so large areas are not flat
        const g = (hash(tx * N + i, ty * N + j) - 0.5) * 7;
        col[0] += g; col[1] += g; col[2] += g;
        lit = Math.max(-1, Math.min(1, (-dx - dy) * 2.2 * boost)) * 58;
      }
      const dith = ((BAYER[(j & 3) * 4 + (i & 3)] - 7.5) / 16) * 7, o = (j * N + i) * 4, Q = 6;
      for (let q = 0; q < 3; q++) img.data[o + q] = Math.max(0, Math.min(255, Math.round((col[q] + lit + dith) / Q) * Q));
      img.data[o + 3] = 255;
    }
  }
  const t = document.createElement('canvas'); t.width = t.height = N;
  t.getContext('2d')!.putImageData(img, 0, 0);
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false; ctx.drawImage(t, 0, 0, TILE, TILE);
}

export class ReliefLayer extends L.GridLayer {
  constructor(options: L.GridLayerOptions = {}) {
    super({ tileSize: TILE, updateWhenZooming: false, keepBuffer: 2, ...options });
  }

  protected createTile(c: L.Coords, done: L.DoneCallback): HTMLElement {
    const cv = document.createElement('canvas'); cv.width = cv.height = TILE;
    const n = 2 ** c.z;
    if (c.y < 0 || c.y >= n) { setTimeout(() => done(undefined, cv)); return cv; }
    // height tile and the window of it that this map tile covers (when we are zoomed past the data)
    const dz = Math.min(c.z, MAX_DATA_ZOOM), over = c.z - dz, k = 2 ** over;
    const tx = (((c.x >> over) % (2 ** dz)) + 2 ** dz) % 2 ** dz, ty = c.y >> over;
    const sub = TILE / k, ox = (c.x - (c.x >> over) * k) * sub, oy = (c.y - ty * k) * sub;
    // OpenStreetMap land cover tile, same idea
    const vz = Math.min(c.z, MAX_VECTOR_ZOOM), vo = c.z - vz, vk = 2 ** vo;
    const vx = (((c.x >> vo) % (2 ** vz)) + 2 ** vz) % 2 ** vz, vy = c.y >> vo;
    const oxv = (c.x - (c.x >> vo) * vk) * TILE, oyv = (c.y - vy * vk) * TILE;
    Promise.all([loadElevation(dz, tx, ty), zonesReady, c.z >= LOCAL_FROM ? loadVector(vz, vx, vy) : null]).then(([e, , vt]) => {
      if (e) paintTile(cv, e, vt ? localCover(vt, vk, oxv, oyv) : null, c.z, c.x, c.y, dz, ox, oy, sub);
      done(undefined, cv);
    });
    return cv;
  }
}

/** The whole world as one picture (Web Mercator, latitude +-85), for posters. Heights and zones only. */
let worldPicture: Promise<HTMLCanvasElement> | null = null;
export function reliefWorld(): Promise<HTMLCanvasElement> {
  return worldPicture ??= (async () => {
    const z = 3, n = 8, cv = document.createElement('canvas'); cv.width = cv.height = n * TILE;
    const cx = cv.getContext('2d')!;
    await zonesReady;
    const jobs: Promise<void>[] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) jobs.push(loadElevation(z, x, y).then(e => {
      if (!e) return;
      const t = document.createElement('canvas'); t.width = t.height = TILE;
      paintTile(t, e, null, z, x, y, z, 0, 0, TILE);
      cx.drawImage(t, x * TILE, y * TILE);
    }));
    await Promise.all(jobs);
    return cv;
  })();
}
