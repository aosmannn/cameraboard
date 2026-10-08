// Lakes, rivers, deserts, mountain ranges and peaks, drawn on our own map from data that ships with the app
// (public/data/nature.json, made from Natural Earth, public domain; see scripts/build-nature.mjs).
import L from 'leaflet';

interface Nature {
  lakes: { n: string; r: [number, number][] }[];
  rivers: { n: string; k: number; c: [number, number][] }[];
  deserts: { n: string; r: [number, number][] }[];
  ranges: { n: string; r: [number, number][] }[];
  peaks: { n: string; e: number; k: number; p: [number, number] }[];
}
export interface NatureTheme { name: string; ocean: string; sea: string; terrain?: boolean }

let cache: Promise<Nature | null> | null = null;
const load = () => cache ??= fetch(`${import.meta.env.BASE_URL}data/nature.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);

const ll = (p: [number, number]): L.LatLngTuple => [p[1], p[0]];
/** The same shape again one world to the left and right, so it shows however far the map is panned sideways. */
const copies = (r: [number, number][]) => [-360, 0, 360].map(s => r.map(p => [p[1], p[0] + s] as L.LatLngTuple));

export function addNature(map: L.Map, initial: NatureTheme) {
  let T = initial;
  for (const [name, z] of [['desertPane', 166], ['waterPane', 172], ['peakPane', 175]] as [string, number][]) {
    const p = map.createPane(name); p.style.zIndex = String(z); p.style.pointerEvents = 'none';
  }
  const terrain = L.layerGroup().addTo(map);      // deserts and ranges: only in the Terrain style
  const lakes = L.layerGroup().addTo(map);
  const rivers = L.layerGroup().addTo(map);
  const peakGroup = L.layerGroup().addTo(map);
  const desertRenderer = L.canvas({ pane: 'desertPane' }), waterRenderer = L.canvas({ pane: 'waterPane' });
  let data: Nature | null = null;

  const riverColor = () => (T.name === 'Night' ? '#4f7a90' : T.terrain ? '#5f9fc0' : '#7fb0cc');
  const riverWidth = (k: number, z: number) => (k <= 2 ? 2.2 : k <= 3 ? 1.7 : k <= 4 ? 1.3 : 0.9) * (z >= 6 ? 1.5 : z >= 4 ? 1.15 : 1);

  function drawStatic() {
    terrain.clearLayers(); lakes.clearLayers();
    if (!data) return;
    if (T.terrain) {
      const sand = T.name === 'Night' ? '#6b5a3a' : '#e3c982', rock = T.name === 'Night' ? '#5b5348' : '#8a6e55';
      for (const d of data.deserts) L.polygon(copies(d.r), { renderer: desertRenderer, stroke: false, fillColor: sand, fillOpacity: 0.42, interactive: false } as L.PolylineOptions).addTo(terrain);
      for (const m of data.ranges) L.polygon(copies(m.r), { renderer: desertRenderer, stroke: false, fillColor: rock, fillOpacity: 0.26, interactive: false } as L.PolylineOptions).addTo(terrain);
    }
    for (const l of data.lakes) L.polygon(copies(l.r), { renderer: waterRenderer, fillColor: T.ocean, fillOpacity: 1, color: T.sea, weight: 0.7, opacity: 0.55, interactive: false } as L.PolylineOptions).addTo(lakes);
  }
  /** Rivers thicken and gain smaller ones as you zoom in; peaks appear the same way. */
  function drawZoomDependent() {
    rivers.clearLayers(); peakGroup.clearLayers();
    if (!data) return;
    const z = map.getZoom(), maxRank = z >= 5 ? 6 : z >= 4 ? 5 : z >= 3 ? 3 : 0;
    for (const r of data.rivers) {
      if (r.k > maxRank) continue;
      for (const s of [-360, 0, 360]) L.polyline(r.c.map(p => [p[1], p[0] + s] as L.LatLngTuple), { renderer: waterRenderer, color: riverColor(), weight: riverWidth(r.k, z), opacity: 0.85, lineCap: 'round', lineJoin: 'round', interactive: false } as L.PolylineOptions).addTo(rivers);
    }
    if (!T.terrain || z < 3) return;
    const b = map.getBounds().pad(0.25), limit = z >= 8 ? 9 : z >= 6 ? 6 : z >= 5 ? 5 : z >= 4 ? 3 : 2, ink = T.name === 'Night' ? '#b9a98f' : '#6b4f3a';
    let shown = 0;
    for (const pk of data.peaks) {
      if (pk.k > limit || shown > 160) continue;
      for (const s of [-360, 0, 360]) {
        const at = L.latLng(pk.p[1], pk.p[0] + s);
        if (!b.contains(at)) continue;
        const size = z >= 6 ? 15 : 12;
        const icon = L.divIcon({ className: 'peak', iconSize: [size, size], iconAnchor: [size / 2, size * 0.8],
          html: `<svg viewBox="0 0 20 18" width="${size}" height="${size}" aria-hidden="true"><path d="M1 17 L10 2 L19 17 Z" fill="${ink}" fill-opacity=".72"/><path d="M10 2 L13.4 8 L10.8 6.6 L9 8.2 L7.4 6.8 L6.6 8 Z" fill="#f4f1ea"/></svg>` });
        L.marker(at, { icon, pane: 'peakPane', interactive: false, keyboard: false, title: `${pk.n} ${pk.e.toLocaleString()} m` }).addTo(peakGroup);
        shown++;
      }
    }
  }
  map.on('zoomend moveend', drawZoomDependent);
  load().then(d => { data = d; drawStatic(); drawZoomDependent(); });
  return { setTheme(t: NatureTheme) { T = t; drawStatic(); drawZoomDependent(); } };
}
