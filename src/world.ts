// Draws our own coloured political world map (no street-map tiles).
// Country shapes: Natural Earth via the world-atlas package.
import L from 'leaflet';
import { feature, neighbors } from 'topojson-client';
import topo from 'world-atlas/countries-50m.json';

interface Theme { ocean: string; border: string; sea: string; label: string; fills: string[] }
const LIGHT: Theme = { ocean: '#bde3f6', border: '#ffffff', sea: '#3f7fb0', label: '#2b2b2b',
  fills: ['#f5a9a2', '#f7d56e', '#a4d8a4', '#f3b774', '#bba8e0', '#93d2da', '#eba8cb', '#cddf90'] };
const DARK: Theme = { ocean: '#10202b', border: '#0b141b', sea: '#5b8fb3', label: '#e9e7e0',
  fills: ['#8a5a57', '#8a7b3f', '#4f7b53', '#8a6a42', '#6a5c8c', '#4a7a80', '#85536c', '#76854a'] };

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

/** Countries that cross the 180° line come as rings that jump from +180 to -180, which draws a streak
 *  across the map. Shift such a polygon to continuous longitudes and also draw a copy 360° to the left. */
function prepare(fc: any) {
  for (const f of fc.features) {
    const g = f.geometry;
    const polys: Ring[][] = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    const out: Ring[][] = [];
    let best: { area: number; c: Pos } | null = null;
    for (const poly of polys) {
      const outer = poly[0];
      const crossed = outer.some((p, i) => i > 0 && Math.abs(p[0] - outer[i - 1][0]) > 180);
      const fixed = crossed ? poly.map(r => r.map(([x, y]) => [x < 0 ? x + 360 : x, y] as Pos)) : poly;
      out.push(fixed);
      if (crossed) out.push(fixed.map(r => r.map(([x, y]) => [x - 360, y] as Pos)));
      const xs = fixed[0].map(p => p[0]), ys = fixed[0].map(p => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const area = (x1 - x0) * (y1 - y0);
      if (!best || area > best.area) best = { area, c: [(y0 + y1) / 2, ((x0 + x1) / 2 + 540) % 360 - 180] };
    }
    f.geometry = { type: 'MultiPolygon', coordinates: out };
    f.properties.area = best?.area ?? 0; f.properties.lc = best?.c;
  }
}

export function drawWorld(map: L.Map, dark: boolean) {
  const T = dark ? DARK : LIGHT;
  map.getContainer().style.background = T.ocean;
  document.documentElement.style.setProperty('--lbl', T.label);
  document.documentElement.style.setProperty('--sea', T.sea);

  // Greedy colouring so neighbouring countries get different colours.
  const geoms = topo.objects.countries.geometries;
  const nb = neighbors(geoms);
  const col: number[] = [];
  geoms.forEach((_: unknown, i: number) => {
    const used = new Set(nb[i].map((j: number) => col[j]));
    let c = 0; while (used.has(c) && c < T.fills.length - 1) c++;
    col[i] = c;
  });
  const fc: any = feature(topo, topo.objects.countries);
  fc.features.forEach((f: any, i: number) => { f.properties.ci = col[i]; });
  prepare(fc);

  const labels: { m: L.Marker; min: number; max: number }[] = [];
  const labelGroup = L.layerGroup().addTo(map);
  const addLabel = (text: string, at: L.LatLngExpression, cls: string, min: number, max = 99) => {
    const m = L.marker(at, { interactive: false, keyboard: false,
      icon: L.divIcon({ className: 'lbl ' + cls, html: `<span>${text}</span>`, iconSize: [0, 0] }) });
    labels.push({ m, min, max });
  };

  const world: L.GeoJSON = L.geoJSON(fc, {
    filter: f => f.properties?.name !== 'Antarctica',
    style: f => ({ fillColor: T.fills[f!.properties.ci % T.fills.length], fillOpacity: 1, color: T.border, weight: 0.8 }),
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
}
