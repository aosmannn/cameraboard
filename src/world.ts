// Draws our own colored political world map (no street-map tiles).
// Country shapes: Natural Earth via the world-atlas package.
import L from 'leaflet';
import { feature, neighbors } from 'topojson-client';
import topo from 'world-atlas/countries-50m.json';
import { loadAdmin1, loadCounties, loadCities } from './atlas';
import { Labels, type Item } from './labels';
import { addNature } from './nature';
import { reliefReady, reliefTile, shadeLand, bayer, seaStyleFor, SeaLayer, ShadeLayer } from './relief';

export type ThemeName = 'terrain' | 'paper' | 'atlas' | 'night';
export interface Theme {
  name: string; ocean: string; border: string; sea: string; label: string; halo: string; fills: string[];
  /** Terrain: neutral land with deserts, forests, mountains and so on drawn over it (see nature.ts and the zone layer below). */
  terrain?: boolean;
}
export const THEMES: Record<ThemeName, Theme> = {
  // land colored by what grows on it: forests, grassland, desert, tundra, ice; with mountains, rivers and lakes
  terrain: { name: 'Terrain', ocean: '#a8c8d2', border: '#f6f0de', sea: '#4d7683', label: '#33301f', halo: '#f4efe0', terrain: true,
    fills: ['#eee6cf', '#e9e0c6', '#ede4cc', '#e7dec5', '#ece3ca', '#e8dfc8', '#eee5cd', '#e6ddc3'] },
  // a printed paper map, pinned to the board
  paper: { name: 'Paper', ocean: '#bcd3d6', border: '#fbf6ea', sea: '#55777f', label: '#3a3226', halo: '#f7f0e1',
    fills: ['#eadfc4', '#dccba6', '#d2dab8', '#e8cdb0', '#dbd0b8', '#c9d5c1', '#efdcbd', '#d8c7a2'] },
  atlas: { name: 'Atlas', ocean: '#bde3f6', border: '#ffffff', sea: '#3f7fb0', label: '#2b2b2b', halo: '#ffffff',
    fills: ['#f5a9a2', '#f7d56e', '#a4d8a4', '#f3b774', '#bba8e0', '#93d2da', '#eba8cb', '#cddf90'] },
  night: { name: 'Night', ocean: '#121b22', border: '#0a1015', sea: '#6d8ea3', label: '#e6e1d6', halo: '#121b22',
    fills: ['#3b3f3a', '#423d34', '#363f3c', '#433a37', '#3c3a42', '#353f42', '#45403a', '#3e4236'] }
};

// name, lat, lng, min zoom, max zoom
const SEAS: [string, number, number, number, number][] = [
  ['Pacific Ocean', 5, -150, 2, 4], ['Pacific Ocean', -15, 165, 2, 4], ['Atlantic Ocean', 30, -40, 2, 4],
  ['Atlantic Ocean', -22, -15, 2, 4], ['Indian Ocean', -20, 78, 2, 4], ['Arctic Ocean', 82, 0, 2, 3],
  ['Southern Ocean', -57, 20, 2, 4], ['Mediterranean Sea', 35, 18, 4, 6], ['Caribbean Sea', 15, -75, 4, 6],
  ['Gulf of Mexico', 25, -90, 4, 6], ['North Sea', 56, 3, 5, 7], ['Arabian Sea', 15, 65, 4, 6],
  ['Bay of Bengal', 15, 88, 4, 6], ['South China Sea', 12, 114, 4, 6], ['Sea of Japan', 40, 134, 5, 7]
];


type Pos = [number, number];
type Ring = Pos[];
interface Poly { bbox: [number, number, number, number]; rings: Ring[] }

// ---- country shapes, prepared once ----
const geoms = topo.objects.countries.geometries;
const fc: any = feature(topo, topo.objects.countries);
{
  // greedy coloring so neighboring countries get different colors
  const nb = neighbors(geoms);
  const col: number[] = [];
  geoms.forEach((_: unknown, i: number) => {
    const used = new Set(nb[i].map((j: number) => col[j]));
    let c = 0; while (used.has(c) && c < 7) c++;
    col[i] = c;
  });
  fc.features.forEach((f: any, i: number) => { f.properties.ci = col[i]; });
}

/** Countries that cross the 180° line come as rings that jump from +180 to -180, which draws a streak
 *  across the map. Shift such a polygon to continuous longitudes and also keep a copy 360° to the left. */
function prepareFeatures(features: any[], index: boolean) {
  for (const f of features) {
    const g = f.geometry;
    const polys: Ring[][] = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    const out: Ring[][] = [];
    const idx: Poly[] = [];
    let best: { area: number; c: Pos } | null = null;
    const add = (rings: Ring[]) => {
      out.push(rings);
      if (!index) return;
      const xs = rings[0].map(p => p[0]), ys = rings[0].map(p => p[1]);
      idx.push({ bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], rings });
    };
    for (const poly of polys) {
      const outer = poly[0];
      const crossed = outer.some((p, i) => i > 0 && Math.abs(p[0] - outer[i - 1][0]) > 180);
      const fixed = crossed ? poly.map(r => r.map(([x, y]) => [x < 0 ? x + 360 : x, y] as Pos)) : poly;
      add(fixed);
      if (crossed) add(fixed.map(r => r.map(([x, y]) => [x - 360, y] as Pos)));
      const xs = fixed[0].map(p => p[0]), ys = fixed[0].map(p => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const area = (x1 - x0) * (y1 - y0);
      if (!best || area > best.area) best = { area, c: [(y0 + y1) / 2, ((x0 + x1) / 2 + 540) % 360 - 180] };
    }
    f.geometry = { type: 'MultiPolygon', coordinates: out };
    if (index) f._polys = idx;
    f.properties.area = best?.area ?? 0; f.properties.lc = best?.c;
  }
}
prepareFeatures(fc.features, true);

const inRing = (r: Ring, x: number, y: number) => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** Name of the country containing this point. Photos taken from a pier, bridge or boat land just off the
 *  coastline in the map data, so a point in the water falls back to the nearest country within ~40 km. */
export function countryAt(lat: number, lng: number, strict = false): string | null {
  for (const f of fc.features) {
    if (f.properties.name === 'Antarctica') continue;
    for (const p of f._polys as Poly[]) {
      for (const x of [lng, lng + 360]) {
        const [x0, y0, x1, y1] = p.bbox;
        if (x < x0 || x > x1 || lat < y0 || lat > y1) continue;
        if (inRing(p.rings[0], x, lat) && !p.rings.slice(1).some(h => inRing(h, x, lat))) return f.properties.name;
      }
    }
  }
  if (strict) return null;
  const TOL = 0.4, k = Math.cos(lat * Math.PI / 180);
  let best: string | null = null, bd = TOL * TOL;
  for (const f of fc.features) {
    if (f.properties.name === 'Antarctica') continue;
    for (const p of f._polys as Poly[]) {
      const [x0, y0, x1, y1] = p.bbox;
      for (const x of [lng, lng + 360]) {
        if (x < x0 - TOL / k || x > x1 + TOL / k || lat < y0 - TOL || lat > y1 + TOL) continue;
        for (const [px, py] of p.rings[0]) {
          const d = ((px - x) * k) ** 2 + (py - lat) ** 2;
          if (d < bd) { bd = d; best = f.properties.name; }
        }
      }
    }
  }
  return best;
}

// ---- Mercator helpers (shared with the poster) ----
export const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360));
export const invMercY = (y: number) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;

/** Paints the whole world onto a canvas for the poster. `view` is in degrees; y is Mercator. */
export function paintWorld(ctx: CanvasRenderingContext2D, W: number, H: number,
  view: { w: number; e: number; yTop: number; yBot: number }, theme: Theme, visited: Set<string> | null) {
  ctx.fillStyle = theme.ocean; ctx.fillRect(0, 0, W, H);
  const px = (lng: number) => ((lng - view.w) / (view.e - view.w)) * W;
  const py = (lat: number) => ((view.yTop - mercY(lat)) / (view.yTop - view.yBot)) * H;
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1, W / 1800); ctx.strokeStyle = theme.border;
  for (const f of fc.features) {
    if (f.properties.name === 'Antarctica') continue;
    ctx.fillStyle = theme.fills[f.properties.ci % theme.fills.length];
    ctx.globalAlpha = visited && visited.size && !visited.has(f.properties.name) ? 0.55 : 1;
    for (const p of f._polys as Poly[]) {
      ctx.beginPath();
      for (const r of p.rings) r.forEach(([x, y], i) => i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y)));
      ctx.fill('evenodd'); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  if (theme.terrain && zones) {
    // the Terrain style on a poster or GIF: the same climate zones, clipped to the land
    const cell = Math.max(3, Math.round(W / 700)), cols = Math.ceil(W / cell), rows = Math.ceil(H / cell);
    const small = document.createElement('canvas'); small.width = cols; small.height = rows;
    const sctx = small.getContext('2d')!, img = sctx.createImageData(cols, rows), rgb = [0, 0, 0];
    for (let j = 0; j < rows; j++) {
      const lat = invMercY(view.yTop - ((j + 0.5) / rows) * (view.yTop - view.yBot));
      for (let i = 0; i < cols; i++) {
        zoneAt(lat, view.w + ((i + 0.5) / cols) * (view.e - view.w), rgb);
        const o = (j * cols + i) * 4; img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
      }
    }
    sctx.putImageData(img, 0, 0);
    ctx.save(); ctx.beginPath();
    for (const f of fc.features) {
      if (f.properties.name === 'Antarctica') continue;
      for (const p of f._polys as Poly[]) for (const r of p.rings) { r.forEach(([x, y], i) => i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))); ctx.closePath(); }
    }
    ctx.clip('evenodd'); ctx.globalAlpha = 0.78; ctx.imageSmoothingEnabled = true; ctx.drawImage(small, 0, 0, W, H); ctx.restore();
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1, W / 1800); ctx.strokeStyle = theme.border; ctx.globalAlpha = 0.8;
    for (const f of fc.features) {
      if (f.properties.name === 'Antarctica') continue;
      for (const p of f._polys as Poly[]) { ctx.beginPath(); for (const r of p.rings) r.forEach(([x, y], i) => i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
  }
  return { px, py };
}

/** Resolves once the climate-zone grid has loaded (posters wait for it so the Terrain style isn't drawn plain). */
export const zonesLoaded = (): Promise<void> => zonesReady;

/** Every country name on the map (Natural Earth spelling, which is abbreviated: "S. Sudan"), for search. */
export function listCountries(): string[] {
  return fc.features.map((f: any) => f.properties.name as string).filter((n: string) => n && n !== 'Antarctica');
}

/** The part of a country to zoom to: its biggest piece, so far-away islands don't stretch the view. */
/** Every country on the map, A to Z. */
export const countryNames = (): string[] => fc.features.map((f: any) => f.properties.name as string).filter((n: string) => n && n !== 'Antarctica').sort((a: string, b: string) => a.localeCompare(b));

export function countryBounds(name: string): L.LatLngBounds | null {
  const f = fc.features.find((x: any) => x.properties.name === name);
  if (!f) return null;
  let best: Poly | null = null, ba = 0;
  for (const p of f._polys as Poly[]) {
    if (p.bbox[0] < -180) continue;   // skip the copy shifted for the antimeridian
    const a = (p.bbox[2] - p.bbox[0]) * (p.bbox[3] - p.bbox[1]);
    if (a > ba) { ba = a; best = p; }
  }
  return best ? L.latLngBounds([best.bbox[1], best.bbox[0]], [best.bbox[3], Math.min(best.bbox[2], 180)]) : null;
}

export interface World {
  setTheme(t: ThemeName): void;
  setVisited(names: Set<string> | null): void;
  /** Draws an outline around a country (or clears it with null). */
  highlight(name: string | null): void;
}

const SEA_ZOOM_MAX = 7;

// ---- color helpers: states get a slightly different shade of their country's color ----
const hash = (s: string | null) => { s = s ?? ''; let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16), t = amt < 0 ? 0 : 255, p = Math.abs(amt);
  const m = (c: number) => Math.round((t - c) * p + c);
  return `rgb(${m(n >> 16)},${m((n >> 8) & 255)},${m(n & 255)})`;
}
const cityZoom = (pop: number) => pop >= 8e6 ? 3 : pop >= 3e6 ? 4 : pop >= 1e6 ? 5 : pop >= 4e5 ? 6 : pop >= 1.5e5 ? 7 : pop >= 5e4 ? 8 : 9;
const cityFont = (pop: number) => pop >= 5e6 ? 14 : pop >= 1e6 ? 13 : 12;
const areaZoom = (a: number, z: number[]) => a > z[0] ? 3 : a > z[1] ? 4 : a > z[2] ? 5 : a > z[3] ? 6 : 7;


// ---- what grows on the land: forests, grassland, desert, tundra, ice (the Terrain style) ----
// public/data/biomes.png is a world grid of climate zones made from Natural Earth II land cover (public domain) by Steven (@vcanp);
// each pixel's red value is a zone number. We color the land by zone and clip it to the country shapes, so it never spills into the sea.
const ZONE_COLORS = ['#f3f7fa', '#c6c5a6', '#86a28b', '#a4c184', '#659d6d', '#d0cc8f', '#dcd498', '#dcc79f', '#f0dfae', '#d6ac82']
  .map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
let zones: Uint8Array | null = null, zw = 2048, zh = 1024;
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
/** Soft blend of the four nearest grid cells, so one zone fades into the next like a real transition. */
function zoneAt(lat: number, lng: number, out: number[]) {
  const u = ((((lng + 180) % 360) + 360) % 360) / 360 * zw - 0.5, v = ((90 - lat) / 180) * zh - 0.5;
  const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
  const at = (x: number, y: number) => ZONE_COLORS[Math.min(9, zones![Math.min(zh - 1, Math.max(0, y)) * zw + (((x % zw) + zw) % zw)])];
  const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
  for (let k = 0; k < 3; k++) out[k] = (a[k] * (1 - fx) + b[k] * fx) * (1 - fy) + (c[k] * (1 - fx) + d[k] * fx) * fy;
}
const ZONE_CELLS = 64;     // without the relief pictures, each map tile is sampled 64 x 64 and stretched smoothly to the tile size
const PIXEL_CELLS = 128;   // with them, 128 x 128: every cell is a 2 px square of pixel art, lit by the sun and dithered
const ZoneLayer = L.GridLayer.extend({
  createTile(coords: L.Coords, done: (e: Error | null, t: HTMLElement) => void) {
    const size = 256, tile = document.createElement('canvas'); tile.width = tile.height = size;
    Promise.all([zonesReady, reliefReady()]).then(([, pics]) => {
      if (!zones) { done(null, tile); return; }
      const relief = pics && reliefTile(pics, coords.z, coords.x, coords.y, PIXEL_CELLS);
      const cells = relief ? PIXEL_CELLS : ZONE_CELLS;
      const n = 2 ** coords.z, small = document.createElement('canvas'); small.width = small.height = cells;
      // the sun and snow fade out as you zoom in past what the pictures can show (about zoom 6)
      const k = Math.max(0.35, Math.min(1, 1 - (coords.z - 6) * 0.13));
      const sctx = small.getContext('2d')!, img = sctx.createImageData(cells, cells), rgb = [0, 0, 0];
      for (let j = 0; j < cells; j++) {
        const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (coords.y + (j + 0.5) / cells) / n))) * 180 / Math.PI;
        for (let i = 0; i < cells; i++) {
          zoneAt(lat, (coords.x + (i + 0.5) / cells) / n * 360 - 180, rgb);
          const o = (j * cells + i) * 4;
          if (relief) shadeLand(rgb, relief.shade[j * cells + i], relief.height[j * cells + i], lat, k, bayer(i, j));
          img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
        }
      }
      sctx.putImageData(img, 0, 0);
      const ctx = tile.getContext('2d')!;
      // land only: the outline of every country that touches this tile
      const lng0 = coords.x / n * 360 - 180, lng1 = (coords.x + 1) / n * 360 - 180;
      const latTop = Math.atan(Math.sinh(Math.PI * (1 - 2 * coords.y / n))) * 180 / Math.PI;
      const latBot = Math.atan(Math.sinh(Math.PI * (1 - 2 * (coords.y + 1) / n))) * 180 / Math.PI;
      const px = (lng: number) => ((lng + 180) / 360 * n - coords.x) * size;
      const py = (lat: number) => ((1 - mercY(lat) / Math.PI) / 2 * n - coords.y) * size;
      ctx.beginPath();
      for (const f of fc.features) {
        if (f.properties.name === 'Antarctica') continue;
        for (const p of f._polys as Poly[]) for (const shift of [-360, 0, 360]) {
          const [x0, y0, x1, y1] = p.bbox;
          if (x1 + shift < lng0 || x0 + shift > lng1 || y1 < latBot || y0 > latTop) continue;
          for (const ring of p.rings) {
            ring.forEach(([x, y], k) => (k ? ctx.lineTo(px(x + shift), py(y)) : ctx.moveTo(px(x + shift), py(y))));
            ctx.closePath();
          }
        }
      }
      ctx.save(); ctx.clip('evenodd'); ctx.imageSmoothingEnabled = !relief; ctx.drawImage(small, 0, 0, size, size); ctx.restore();
      done(null, tile);
    });
    return tile;
  }
});

export function drawWorld(map: L.Map, initial: ThemeName): World {
  let T = THEMES[initial];
  let visited: Set<string> | null = null;
  const root = document.documentElement.style;
  const labels = new Labels(map);
  const applyChrome = () => {
    map.getContainer().style.background = T.ocean;
    root.setProperty('--lbl', T.label); root.setProperty('--sea', T.sea); root.setProperty('--halo', T.halo);
    labels.setColors({ text: T.label, halo: T.halo, sea: T.sea });
  };
  applyChrome();
  for (const [name, z] of [['seaPane', 148], ['worldPane', 150], ['statePane', 160], ['shadePane', 162], ['zonePane', 164], ['countyPane', 170], ['hlPane', 180]] as [string, number][])
    map.createPane(name).style.zIndex = String(z);
  map.getPane('shadePane')!.style.pointerEvents = 'none'; map.getPane('seaPane')!.style.pointerEvents = 'none';
  map.getPane('hlPane')!.style.pointerEvents = 'none';
  map.getPane('zonePane')!.style.pointerEvents = 'none';
  // the Terrain style: land colored by what grows on it, plus deserts, mountains, rivers and lakes (all bundled data)
  const zoneLayer = new (ZoneLayer as any)({ pane: 'zonePane', tileSize: 256, minZoom: 2, maxZoom: 16, keepBuffer: 2 }) as L.GridLayer;
  const zoneFade = () => { const z = map.getZoom(); zoneLayer.setOpacity(z <= 5 ? 0.72 : Math.max(0.3, 0.72 - (z - 5) * 0.1)); };
  const syncZones = () => { if (T.terrain) { if (!map.hasLayer(zoneLayer)) zoneLayer.addTo(map); zoneFade(); } else if (map.hasLayer(zoneLayer)) map.removeLayer(zoneLayer); };
  map.on('zoomend', zoneFade);
  const nature = addNature(map, T);
  syncZones();
  // sea depth in every style (shelves light, deep ocean dark), and sun and shadow on the land of the flat styles; both from the bundled relief pictures
  const seaLayer = new SeaLayer(seaStyleFor(T.ocean, !!T.terrain), { pane: 'seaPane', minZoom: 2, maxZoom: 16 }).addTo(map);
  const SHADE: Partial<Record<ThemeName, number>> = { paper: 0.6, atlas: 0.45, night: 0.7 };
  const shadeLayer = new ShadeLayer(0.6, { pane: 'shadePane', minZoom: 2, maxZoom: 16 });
  const syncRelief = () => {
    seaLayer.setStyle(seaStyleFor(T.ocean, !!T.terrain));
    const k = SHADE[(Object.keys(THEMES) as ThemeName[]).find(n => THEMES[n] === T)!];
    if (k) { shadeLayer.setStrength(k); if (!map.hasLayer(shadeLayer)) shadeLayer.addTo(map); } else if (map.hasLayer(shadeLayer)) map.removeLayer(shadeLayer);
  };
  syncRelief();

  // ---- countries ----
  const countryRenderer = L.canvas({ pane: 'worldPane' });
  const style = (f?: any): L.PathOptions => {
    const lit = !visited || !visited.size || visited.has(f.properties.name);
    return { fillColor: T.fills[f.properties.ci % T.fills.length], fillOpacity: lit ? 1 : 0.5,
      color: lit && visited?.size ? '#e4572e' : T.border, weight: lit && visited?.size ? 1.6 : 0.8 };
  };
  const countryLabels: Item[] = [];
  const world: L.GeoJSON = L.geoJSON(fc, {
    pane: 'worldPane', renderer: countryRenderer,
    filter: f => f.properties?.name !== 'Antarctica',
    style,
    onEachFeature: (f, layer) => {
      layer.on('mouseover', () => (layer as L.Path).setStyle({ weight: 2.2, color: '#fff' }));
      layer.on('mouseout', () => world.resetStyle(layer as L.Path));
      layer.bindTooltip(f.properties.name, { sticky: true, direction: 'top', className: 'ctip' });
      layer.on('mouseover', () => { if (map.getZoom() >= 4.5) layer.closeTooltip(); });
      const { area, lc } = f.properties;
      if (lc) countryLabels.push({ text: f.properties.name, lat: lc[0], lng: lc[1], min: areaZoom(area, [600, 80, 14, 3]) === 3 ? 2 : areaZoom(area, [600, 80, 14, 3]) - 1, max: 6 });
    }
  } as L.GeoJSONOptions).addTo(map);
  world.bringToBack();
  labels.set('country', countryLabels);
  labels.set('sea', SEAS.map(([text, lat, lng, min, max]) => ({ text, lat, lng, min, max: Math.min(max, SEA_ZOOM_MAX) })));

  // ---- states and provinces (all countries), from zoom 4.5 ----
  const ciByCountry = new Map<string, number>(fc.features.map((f: any) => [f.properties.name, f.properties.ci]));
  const stateFill = (f: any) => {
    const ci = ciByCountry.get(f.properties.admin) ?? hash(f.properties.admin) % T.fills.length;
    return shade(T.fills[ci % T.fills.length], ((hash(f.properties.name) % 7) - 3) * 0.035);
  };
  const stateStyle = (f?: any): L.PathOptions => {
    const lit = !visited || !visited.size || visited.has(f.properties.admin);
    return { fillColor: stateFill(f), fillOpacity: lit ? 1 : 0.5, color: T.border, weight: 0.7 };
  };
  let states: L.GeoJSON | null = null, counties: L.GeoJSON | null = null;
  const STATES_FROM = 4.5, COUNTIES_FROM = 7.5;
  loadAdmin1().then(fc1 => {
    prepareFeatures(fc1.features, false);
    states = L.geoJSON(fc1, { pane: 'statePane', renderer: L.canvas({ pane: 'statePane' }), interactive: false, style: stateStyle } as L.GeoJSONOptions);
    labels.set('state', fc1.features.filter((f: any) => f.properties.lc && f.properties.name).map((f: any) => ({
      text: f.properties.name, lat: f.properties.lc[0], lng: f.properties.lc[1],
      min: areaZoom(f.properties.area, [60, 12, 3, 0.6]) + 1, max: 12 })));
    sync();
  });
  // ---- US counties, from zoom 7.5 ----
  loadCounties().then(fc2 => {
    counties = L.geoJSON(fc2, { pane: 'countyPane', renderer: L.canvas({ pane: 'countyPane' }), interactive: false,
      style: () => ({ fill: false, color: T.border, weight: 0.5, opacity: 0.6 }) } as L.GeoJSONOptions);
    labels.set('county', fc2.features.map((f: any) => {
      const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      let big: Ring | null = null, ba = 0;
      for (const p of polys) {
        const xs = p[0].map((c: Pos) => c[0]), ys = p[0].map((c: Pos) => c[1]);
        const a = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
        if (a > ba) { ba = a; big = p[0]; }
      }
      const xs = big!.map(c => c[0]), ys = big!.map(c => c[1]);
      return { text: f.properties.name, lat: (Math.min(...ys) + Math.max(...ys)) / 2, lng: (Math.min(...xs) + Math.max(...xs)) / 2, min: 9, max: 16 };
    }));
    sync();
  });
  // ---- cities (worldwide) ----
  loadCities().then(rows => labels.set('city', rows.map(r => ({ text: r[0], lat: r[3], lng: r[4], min: cityZoom(r[5]), max: 13, size: cityFont(r[5]) }))));

  /** Shows each detail layer only when it is useful, so the canvas stays fast. */
  function sync() {
    const z = map.getZoom();
    const want = (layer: L.GeoJSON | null, on: boolean) => {
      if (!layer) return;
      if (on && !map.hasLayer(layer)) map.addLayer(layer); else if (!on && map.hasLayer(layer)) map.removeLayer(layer);
    };
    want(states, z >= STATES_FROM); want(counties, z >= COUNTIES_FROM);
  }
  map.on('zoomend', sync);
  // During a fly-to, Leaflet only scales the last drawing, so zooming out leaves blank land.
  // Redraw the countries every frame and park the heavier state and county layers until it lands.
  map.on('zoom', () => {
    if (!(map as any)._flyToFrame) return;
    if (states && map.hasLayer(states)) map.removeLayer(states);
    if (counties && map.hasLayer(counties)) map.removeLayer(counties);
    const r = countryRenderer as any; if (r._map) r._reset();
  });

  // ---- the outline around a clicked country ----
  const hlRenderer = L.canvas({ pane: 'hlPane' });
  const hlGroup = L.layerGroup().addTo(map);
  let hlName: string | null = null;
  const drawHighlight = () => {
    hlGroup.clearLayers();
    const f = hlName && fc.features.find((x: any) => x.properties.name === hlName);
    if (!f) return;
    const accent = T === THEMES.night ? '#ff8a66' : '#d6402b';
    const common = { pane: 'hlPane', renderer: hlRenderer, interactive: false } as any;
    L.geoJSON(f, { ...common, style: { color: accent, weight: 9, opacity: 0.22, fillColor: accent, fillOpacity: 0.1, lineJoin: 'round' } } as L.GeoJSONOptions).addTo(hlGroup);
    L.geoJSON(f, { ...common, style: { color: accent, weight: 3, opacity: 1, fill: false, lineJoin: 'round' } } as L.GeoJSONOptions).addTo(hlGroup);
  };
  const restyle = () => {
    world.options.style = style; world.setStyle(style);
    states?.setStyle(stateStyle); counties?.setStyle({ color: T.border });
  };
  return {
    setTheme(t) { T = THEMES[t]; applyChrome(); restyle(); drawHighlight(); syncZones(); syncRelief(); nature.setTheme(T); },
    highlight(name) { hlName = name; drawHighlight(); },
    setVisited(names) { visited = names; restyle(); }
  };
}
