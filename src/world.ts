// Draws our own colored political world map (no street-map tiles).
// Country shapes: Natural Earth via the world-atlas package.
import L from 'leaflet';
import { feature, neighbors } from 'topojson-client';
import topo from 'world-atlas/countries-50m.json';
import { loadAdmin1, loadCounties, loadCities } from './atlas';
import { Labels, type Item } from './labels';
import { ReliefLayer, reliefWorld } from './relief';
import { StreetsLayer, TERRAIN_STREETS, type StreetStyle } from './streets';
import { ShadeLayer, rgb, type ShadeStyle } from './shade';

export type ThemeName = 'paper' | 'atlas' | 'night' | 'terrain';
export interface Theme {
  name: string; ocean: string; border: string; sea: string; /** outline around sea names */ seaHalo: string; label: string; halo: string; fills: string[];
  /** Draw live pixel relief, rivers and streets under the borders instead of flat country colors. */
  terrain?: boolean;
  /** Flat styles get extra detail on top of the country colors: hillshade, sea depth, lakes, rivers, roads, buildings. */
  detail?: { shade: ShadeStyle; streets: StreetStyle };
}
export const THEMES: Record<ThemeName, Theme> = {
  // pixel-art relief heat map in Claude's cream and orange: lowlands pale, mountains deep terracotta
  terrain: { name: 'Terrain', terrain: true, ocean: '#141f26', border: '#3b2a22', sea: '#f6ecd9', seaHalo: '#0d1a22', label: '#2a1d17', halo: '#f6ecd9',
    fills: ['#e6c595'] },
  // a printed paper map, pinned to the board: warm parchment, soft relief, brown ink roads
  paper: { name: 'Paper', ocean: '#b3cfd3', border: '#b8a574', sea: '#2c5560', seaHalo: '#f4eedd', label: '#3a3226', halo: '#f7f0e1',
    fills: ['#efe0b8', '#e3d0a0', '#cfdcb0', '#ecc9a0', '#dcd0af', '#bdd3b5', '#f1d9a7', '#d6c28f'],
    detail: {
      shade: { land: 0.4, seaShallow: rgb(0xd2e5e4), seaDeep: rgb(0x8cb1ba) },
      streets: {
        water: '#a4c6cd', sea: false, river: 'rgba(120,170,182,0.95)', rail: 'rgba(90,70,40,0.5)',
        building: ['rgba(214,196,158,0.95)', 'rgba(110,90,55,0.55)'], casing: 'rgba(90,70,40,0.12)',
        roads: { motorway: 'rgba(193,92,52,0.85)', trunk: 'rgba(204,120,70,0.8)', primary: 'rgba(120,96,60,0.7)', secondary: 'rgba(120,96,60,0.55)', minor: 'rgba(120,96,60,0.4)' }
      } } },
  // bright school-atlas colors with a blue sea that deepens offshore
  atlas: { name: 'Atlas', ocean: '#a9d9f3', border: '#ffffff', sea: '#1d5a8f', seaHalo: '#eaf6fd', label: '#2b2b2b', halo: '#ffffff',
    fills: ['#f5a09a', '#f7d05c', '#94d494', '#f3ad62', '#b39ee0', '#82cdd8', '#eb9cc6', '#c9e07c'],
    detail: {
      shade: { land: 0.3, seaShallow: rgb(0xcdeefb), seaDeep: rgb(0x62a9d8) },
      streets: {
        water: '#9fd3ee', sea: false, river: 'rgba(110,190,230,0.95)', rail: 'rgba(60,60,70,0.45)',
        building: ['rgba(255,244,228,0.95)', 'rgba(70,60,50,0.4)'], casing: 'rgba(0,0,0,0.14)',
        roads: { motorway: 'rgba(245,130,50,0.95)', trunk: 'rgba(250,170,70,0.9)', primary: 'rgba(255,255,255,0.95)', secondary: 'rgba(255,255,255,0.85)', minor: 'rgba(255,255,255,0.7)' }
      } } },
  // deep blues and purples with glowing amber roads
  night: { name: 'Night', ocean: '#0d151b', border: '#7a95ad', sea: '#bcd6e8', seaHalo: '#070d12', label: '#e6e1d6', halo: '#121b22',
    fills: ['#2f4a5c', '#43386b', '#2d5a52', '#5a3f63', '#33577a', '#4d6140', '#6a4448', '#37486e'],
    detail: {
      shade: { land: 0.7, light: 0.3, seaShallow: rgb(0x1a3a4c), seaDeep: rgb(0x060b10) },
      streets: {
        water: '#143142', sea: false, river: 'rgba(40,100,140,0.95)', rail: 'rgba(170,160,140,0.35)',
        building: ['rgba(90,84,76,0.75)', 'rgba(200,190,170,0.25)'], casing: 'rgba(0,0,0,0.35)',
        roads: { motorway: 'rgba(255,180,90,0.9)', trunk: 'rgba(255,195,120,0.8)', primary: 'rgba(250,225,170,0.7)', secondary: 'rgba(240,220,180,0.5)', minor: 'rgba(235,215,175,0.32)' }
      } } }
};

// The poster is a flat picture, so it uses the whole world drawn once by the relief renderer (heights and climate zones).
const TERRAIN_LAT = 85.0511287798;
let reliefImg: HTMLCanvasElement | null = null;
/** Draws the world relief for a theme that has one (a no-op for other themes). Await it before paintWorld. */
export async function ensurePosterRelief(theme: Theme): Promise<void> {
  if (theme.terrain && !reliefImg) reliefImg = await reliefWorld();
}

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
  const img = theme.terrain ? reliefImg : null;
  if (img) {
    ctx.imageSmoothingEnabled = false;
    const top = mercY(TERRAIN_LAT);
    for (const off of [-360, 0, 360]) {
      const x0 = px(-180 + off), x1 = px(180 + off);
      ctx.drawImage(img, x0, ((view.yTop - top) / (view.yTop - view.yBot)) * H, x1 - x0, ((2 * top) / (view.yTop - view.yBot)) * H);
    }
  }
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1, W / 1800); ctx.strokeStyle = theme.border;
  for (const f of fc.features) {
    if (f.properties.name === 'Antarctica') continue;
    ctx.fillStyle = theme.fills[f.properties.ci % theme.fills.length];
    ctx.globalAlpha = visited && visited.size && !visited.has(f.properties.name) ? 0.55 : 1;
    for (const p of f._polys as Poly[]) {
      ctx.beginPath();
      for (const r of p.rings) r.forEach(([x, y], i) => i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y)));
      if (!theme.terrain) ctx.fill('evenodd');
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  return { px, py };
}

/** The part of a country to zoom to: its biggest piece, so far-away islands don't stretch the view. */
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


export function drawWorld(map: L.Map, initial: ThemeName): World {
  let T = THEMES[initial];
  let visited: Set<string> | null = null;
  const root = document.documentElement.style;
  const labels = new Labels(map);
  const applyChrome = () => {
    map.getContainer().style.background = T.ocean;
    root.setProperty('--lbl', T.label); root.setProperty('--sea', T.sea); root.setProperty('--halo', T.halo);
    labels.setColors({ text: T.label, halo: T.halo, sea: T.sea, seaHalo: T.seaHalo });
  };
  applyChrome();
  for (const [name, z] of [['terrainPane', 140], ['streetsPane', 145], ['worldPane', 150], ['statePane', 160], ['shadePane', 162], ['detailPane', 163], ['countyPane', 170], ['hlPane', 180]] as [string, number][])
    map.createPane(name).style.zIndex = String(z);
  map.getPane('hlPane')!.style.pointerEvents = 'none';
  for (const n of ['terrainPane', 'streetsPane', 'shadePane', 'detailPane']) map.getPane(n)!.style.pointerEvents = 'none';

  // ---- live map detail: pixel relief and streets on Terrain; hillshade, sea depth, lakes, roads on the flat styles ----
  const relief = new ReliefLayer({ pane: 'terrainPane' });
  const terrainStreets = new StreetsLayer(TERRAIN_STREETS, { pane: 'streetsPane' });
  let seaShade: ShadeLayer | null = null, landShade: ShadeLayer | null = null, detailStreets: StreetsLayer | null = null;
  let detailApplied: Theme['detail'] | undefined;
  const syncRelief = () => {
    if (T.terrain) { relief.addTo(map); terrainStreets.addTo(map); } else { relief.remove(); terrainStreets.remove(); }
    const d = T.detail;
    if (!d) { seaShade?.remove(); landShade?.remove(); detailStreets?.remove(); return; }
    if (!seaShade) {
      seaShade = new ShadeLayer('sea', d.shade, { pane: 'terrainPane' });
      landShade = new ShadeLayer('land', d.shade, { pane: 'shadePane' });
      detailStreets = new StreetsLayer(d.streets, { pane: 'detailPane' });
    } else if (d !== detailApplied) { seaShade.setStyle(d.shade); landShade!.setStyle(d.shade); detailStreets!.setStyle(d.streets); }
    detailApplied = d;
    seaShade.addTo(map); landShade!.addTo(map); detailStreets!.addTo(map);
  };

  // The map wraps around the globe: every vector layer is drawn three times, one world to the left and right.
  const OFFSETS = [-360, 0, 360];
  const shifted = (off: number) => (c: number[]) => L.latLng(c[1], c[0] + off);

  // ---- countries ----
  const countryRenderer = L.canvas({ pane: 'worldPane' });
  const style = (f?: any): L.PathOptions => {
    const lit = !visited || !visited.size || visited.has(f.properties.name);
    // on the relief map the land colors come from the picture; a country you haven't visited just gets a dark veil
    if (T.terrain) return { fillColor: '#141f26', fillOpacity: lit ? 0 : 0.5,
      color: lit && visited?.size ? '#e4572e' : T.border, weight: lit && visited?.size ? 1.6 : 0.8, opacity: 0.8 };
    return { fillColor: T.fills[f.properties.ci % T.fills.length], fillOpacity: lit ? 1 : 0.5,
      color: lit && visited?.size ? '#e4572e' : T.border, weight: lit && visited?.size ? 1.6 : 0.8 };
  };
  const countryLabels: Item[] = [];
  const worlds: L.GeoJSON[] = OFFSETS.map(off => {
    const g: L.GeoJSON = L.geoJSON(fc, {
      pane: 'worldPane', renderer: countryRenderer,
      filter: f => f.properties?.name !== 'Antarctica',
      style, coordsToLatLng: shifted(off),
      onEachFeature: (f, layer) => {
        layer.on('mouseover', () => (layer as L.Path).setStyle({ weight: 2.2, color: '#fff' }));
        layer.on('mouseout', () => g.resetStyle(layer as L.Path));
        layer.bindTooltip(f.properties.name, { sticky: true, direction: 'top', className: 'ctip' });
        layer.on('mouseover', () => { if (map.getZoom() >= 4.5) layer.closeTooltip(); });
        const { area, lc } = f.properties;
        if (lc && off === 0) countryLabels.push({ text: f.properties.name, lat: lc[0], lng: lc[1], min: areaZoom(area, [600, 80, 14, 3]) === 3 ? 2 : areaZoom(area, [600, 80, 14, 3]) - 1, max: 6 });
      }
    } as L.GeoJSONOptions).addTo(map);
    g.bringToBack();
    return g;
  });
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
    if (T.terrain) return { fillColor: '#141f26', fillOpacity: lit ? 0 : 0.5, color: T.border, weight: 1, opacity: 0.85, dashArray: '4 2' };
    return { fillColor: stateFill(f), fillOpacity: lit ? 1 : 0.5, color: T.border, weight: 0.7 };
  };
  let states: L.FeatureGroup | null = null, counties: L.FeatureGroup | null = null;
  const stateRenderer = L.canvas({ pane: 'statePane' }), countyRenderer = L.canvas({ pane: 'countyPane' });
  const STATES_FROM = 4.5, COUNTIES_FROM = 7.5;
  loadAdmin1().then(fc1 => {
    prepareFeatures(fc1.features, false);
    states = L.featureGroup(OFFSETS.map(off => L.geoJSON(fc1, { pane: 'statePane', renderer: stateRenderer, interactive: false, style: stateStyle, coordsToLatLng: shifted(off) } as L.GeoJSONOptions)));
    labels.set('state', fc1.features.filter((f: any) => f.properties.lc && f.properties.name).map((f: any) => ({
      text: f.properties.name, lat: f.properties.lc[0], lng: f.properties.lc[1],
      min: areaZoom(f.properties.area, [60, 12, 3, 0.6]) + 1, max: 12 })));
    sync();
  });
  // ---- US counties, from zoom 7.5 ----
  loadCounties().then(fc2 => {
    counties = L.featureGroup(OFFSETS.map(off => L.geoJSON(fc2, { pane: 'countyPane', renderer: countyRenderer, interactive: false,
      style: () => ({ fill: false, color: T.border, weight: T.terrain ? 0.8 : 0.5, opacity: T.terrain ? 0.8 : 0.6 }), coordsToLatLng: shifted(off) } as L.GeoJSONOptions)));
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
    const want = (layer: L.FeatureGroup | null, on: boolean) => {
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
    for (const off of OFFSETS) {
      L.geoJSON(f, { ...common, coordsToLatLng: shifted(off), style: { color: accent, weight: 9, opacity: 0.22, fillColor: accent, fillOpacity: 0.1, lineJoin: 'round' } } as L.GeoJSONOptions).addTo(hlGroup);
      L.geoJSON(f, { ...common, coordsToLatLng: shifted(off), style: { color: accent, weight: 3, opacity: 1, fill: false, lineJoin: 'round' } } as L.GeoJSONOptions).addTo(hlGroup);
    }
  };
  const restyle = () => {
    syncRelief();
    for (const w of worlds) { w.options.style = style; w.setStyle(style); }
    states?.eachLayer(l => (l as L.GeoJSON).setStyle(stateStyle));
    counties?.eachLayer(l => (l as L.GeoJSON).setStyle({ color: T.border, weight: T.terrain ? 0.8 : 0.5, opacity: T.terrain ? 0.8 : 0.6 }));
  };
  syncRelief();
  return {
    setTheme(t) { T = THEMES[t]; applyChrome(); restyle(); drawHighlight(); },
    highlight(name) { hlName = name; drawHighlight(); },
    setVisited(names) { visited = names; restyle(); }
  };
}
