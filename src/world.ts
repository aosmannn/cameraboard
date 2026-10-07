// Draws our own coloured political world map (no street-map tiles).
// Country shapes: Natural Earth via the world-atlas package.
import L from 'leaflet';
import { feature, neighbors } from 'topojson-client';
import topo from 'world-atlas/countries-50m.json';
import { loadAdmin1, loadCounties, loadCities } from './atlas';
import { Labels, type Item } from './labels';

export type ThemeName = 'paper' | 'atlas' | 'night';
export interface Theme {
  name: string; ocean: string; border: string; sea: string; label: string; halo: string; fills: string[];
}
export const THEMES: Record<ThemeName, Theme> = {
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
  // greedy colouring so neighbouring countries get different colours
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

/** All country names on the map (Natural Earth), excluding Antarctica. */
export function allCountryNames(): string[] {
  return fc.features
    .map((f: { properties: { name: string } }) => f.properties.name)
    .filter((n: string) => n && n !== 'Antarctica')
    .sort((a: string, b: string) => a.localeCompare(b));
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

// ---- colour helpers: states get a slightly different shade of their country's colour ----
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
    labels.setColors({ text: T.label, halo: T.halo, sea: T.sea });
  };
  applyChrome();
  for (const [name, z] of [['worldPane', 150], ['statePane', 160], ['countyPane', 170], ['hlPane', 180]] as [string, number][])
    map.createPane(name).style.zIndex = String(z);
  map.getPane('hlPane')!.style.pointerEvents = 'none';

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
    setTheme(t) { T = THEMES[t]; applyChrome(); restyle(); drawHighlight(); },
    highlight(name) { hlName = name; drawHighlight(); },
    setVisited(names) { visited = names; restyle(); }
  };
}
