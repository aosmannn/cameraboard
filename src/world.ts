// Draws our own coloured political world map (no street-map tiles).
// Country shapes: Natural Earth via the world-atlas package.
import L from 'leaflet';
import { feature, neighbors } from 'topojson-client';
import topo from 'world-atlas/countries-50m.json';

export type ThemeName = 'classic' | 'vintage' | 'night' | 'ocean';
export interface Theme {
  name: string; ocean: string; border: string; sea: string; label: string; halo: string; fills: string[];
}
export const THEMES: Record<ThemeName, Theme> = {
  classic: { name: 'Classic', ocean: '#bde3f6', border: '#ffffff', sea: '#3f7fb0', label: '#2b2b2b', halo: '#ffffff',
    fills: ['#f5a9a2', '#f7d56e', '#a4d8a4', '#f3b774', '#bba8e0', '#93d2da', '#eba8cb', '#cddf90'] },
  vintage: { name: 'Vintage', ocean: '#cfc29b', border: '#f3ead2', sea: '#7a6a45', label: '#4a3c26', halo: '#efe3c3',
    fills: ['#dcbf90', '#cba96f', '#bdb788', '#d7ab8e', '#c3a782', '#cbb980', '#dcc59b', '#bd9f77'] },
  night: { name: 'Night', ocean: '#10202b', border: '#0b141b', sea: '#5b8fb3', label: '#e9e7e0', halo: '#10202b',
    fills: ['#8a5a57', '#8a7b3f', '#4f7b53', '#8a6a42', '#6a5c8c', '#4a7a80', '#85536c', '#76854a'] },
  ocean: { name: 'Ocean', ocean: '#0e4a73', border: '#0a3b5c', sea: '#a9d8f2', label: '#0b2a40', halo: '#d7eefb',
    fills: ['#4f9fc9', '#bfe3f6', '#2a8fbd', '#7fc8e8', '#9ad1ea', '#3a8fc0', '#a8d9ee', '#5aa9d6'] }
};

const CITIES: [string, number, number][] = [
  ['New York', 40.71, -74.0], ['Los Angeles', 34.05, -118.24], ['Chicago', 41.88, -87.63], ['Mexico City', 19.43, -99.13],
  ['Toronto', 43.65, -79.38], ['Vancouver', 49.28, -123.12], ['Miami', 25.76, -80.19], ['Havana', 23.11, -82.37],
  ['Bogotá', 4.71, -74.07], ['Lima', -12.05, -77.04], ['São Paulo', -23.55, -46.63], ['Rio de Janeiro', -22.91, -43.17],
  ['Buenos Aires', -34.6, -58.38], ['Santiago', -33.45, -70.67], ['London', 51.51, -0.13], ['Paris', 48.86, 2.35],
  ['Madrid', 40.42, -3.7], ['Lisbon', 38.72, -9.14], ['Rome', 41.9, 12.5], ['Berlin', 52.52, 13.4],
  ['Amsterdam', 52.37, 4.9], ['Istanbul', 41.01, 28.98], ['Athens', 37.98, 23.73], ['Moscow', 55.76, 37.62],
  ['Cairo', 30.04, 31.24], ['Lagos', 6.52, 3.38], ['Nairobi', -1.29, 36.82], ['Cape Town', -33.92, 18.42],
  ['Johannesburg', -26.2, 28.05], ['Casablanca', 33.57, -7.59], ['Dubai', 25.2, 55.27], ['Tehran', 35.69, 51.39],
  ['Mumbai', 19.08, 72.88], ['Delhi', 28.61, 77.21], ['Bangkok', 13.76, 100.5], ['Singapore', 1.35, 103.82],
  ['Jakarta', -6.21, 106.85], ['Manila', 14.6, 120.98], ['Hong Kong', 22.32, 114.17], ['Shanghai', 31.23, 121.47],
  ['Beijing', 39.9, 116.4], ['Seoul', 37.57, 126.98], ['Tokyo', 35.68, 139.69], ['Osaka', 34.69, 135.5],
  ['Sydney', -33.87, 151.21], ['Melbourne', -37.81, 144.96], ['Auckland', -36.85, 174.76], ['Honolulu', 21.31, -157.86],
  ['Anchorage', 61.22, -149.9], ['Reykjavík', 64.15, -21.94]
];
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
function prepare() {
  for (const f of fc.features) {
    const g = f.geometry;
    const polys: Ring[][] = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    const out: Ring[][] = [];
    const idx: Poly[] = [];
    let best: { area: number; c: Pos } | null = null;
    const add = (rings: Ring[]) => {
      out.push(rings);
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
    f._polys = idx;
    f.properties.area = best?.area ?? 0; f.properties.lc = best?.c;
  }
}
prepare();

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
export function countryAt(lat: number, lng: number): string | null {
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
  return { px, py };
}

export interface World {
  setTheme(t: ThemeName): void;
  setVisited(names: Set<string> | null): void;
}

export function drawWorld(map: L.Map, initial: ThemeName): World {
  let T = THEMES[initial];
  let visited: Set<string> | null = null;
  const root = document.documentElement.style;
  const applyChrome = () => {
    map.getContainer().style.background = T.ocean;
    root.setProperty('--lbl', T.label); root.setProperty('--sea', T.sea); root.setProperty('--halo', T.halo);
  };
  applyChrome();

  const labels: { m: L.Marker; min: number; max: number }[] = [];
  const labelGroup = L.layerGroup().addTo(map);
  const addLabel = (text: string, at: L.LatLngExpression, cls: string, min: number, max = 99) => {
    const m = L.marker(at, { interactive: false, keyboard: false,
      icon: L.divIcon({ className: 'lbl ' + cls, html: `<span>${text}</span>`, iconSize: [0, 0] }) });
    labels.push({ m, min, max });
  };

  const style = (f?: any): L.PathOptions => {
    const lit = !visited || !visited.size || visited.has(f.properties.name);
    return { fillColor: T.fills[f.properties.ci % T.fills.length], fillOpacity: lit ? 1 : 0.5,
      color: lit && visited?.size ? '#e4572e' : T.border, weight: lit && visited?.size ? 1.6 : 0.8 };
  };
  const world: L.GeoJSON = L.geoJSON(fc, {
    filter: f => f.properties?.name !== 'Antarctica',
    style,
    onEachFeature: (f, layer) => {
      layer.on('mouseover', () => (layer as L.Path).setStyle({ weight: 2.2, color: '#fff' }));
      layer.on('mouseout', () => world.resetStyle(layer as L.Path));
      layer.bindTooltip(f.properties.name, { sticky: true, direction: 'top', className: 'ctip' });
      const { area, lc } = f.properties;
      if (!lc) return;
      const min = area > 600 ? 2 : area > 80 ? 3 : area > 14 ? 4 : area > 3 ? 5 : 6;
      addLabel(f.properties.name, lc, 'country', min);
    }
  }).addTo(map);
  world.bringToBack();

  CITIES.forEach(([n, la, lo]) => addLabel(n, [la, lo], 'city', 5));
  SEAS.forEach(([n, la, lo, mn, mx]) => addLabel(n, [la, lo], 'sea', mn, mx));

  const refresh = () => {
    const z = map.getZoom();
    for (const { m, min, max } of labels) {
      const on = z >= min && z <= max, has = labelGroup.hasLayer(m);
      if (on && !has) labelGroup.addLayer(m); else if (!on && has) labelGroup.removeLayer(m);
    }
  };
  map.on('zoomend', refresh); refresh();

  const restyle = () => { world.options.style = style; world.setStyle(style); };
  return {
    setTheme(t) { T = THEMES[t]; applyChrome(); restyle(); },
    setVisited(names) { visited = names; restyle(); }
  };
}
