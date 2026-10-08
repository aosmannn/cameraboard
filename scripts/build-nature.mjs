// Builds public/data/nature.json: lakes, rivers, deserts, mountain ranges and peaks for the map. Natural Earth, public domain.
// A development tool, not part of the site's build. Run it only when you want to redo the data:
//   1. Download these from https://github.com/nvkelso/natural-earth-vector (the geojson folder) into one folder:
//        ne_50m_lakes, ne_50m_rivers_lake_centerlines, ne_50m_geography_regions_polys, ne_10m_geography_regions_elevation_points
//   2. node scripts/build-nature.mjs <that folder>
// Shapes are simplified and rounded so the file stays small; the map loads it after it is up.
import fs from 'node:fs';
const dir = process.argv[2];
if (!dir) throw new Error('give the folder with the Natural Earth geojson files');
const read = n => JSON.parse(fs.readFileSync(`${dir}/${n}.geojson`, 'utf8')).features;
const r2 = v => Math.round(v * 100) / 100;

// Douglas-Peucker: keeps the shape, drops points that barely matter
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let worst = 0, wi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / len));
      const d = Math.hypot(pts[i][0] - (ax + t * dx), pts[i][1] - (ay + t * dy));
      if (d > worst) { worst = d; wi = i; }
    }
    if (worst > tol) { keep[wi] = 1; stack.push([a, wi], [wi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const line = (pts, tol) => simplify(pts, tol).map(([x, y]) => [r2(x), r2(y)]);
const ringArea = r => Math.abs(r.reduce((s, p, i) => s + (p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1]), 0) / 2);
/** polygons as [outer ring] lists; holes are dropped (they only matter for huge inland seas) */
function polys(g, tol, minArea) {
  const list = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return list.map(p => p[0]).filter(r => ringArea(r) >= minArea).map(r => line(r, tol)).filter(r => r.length >= 4);
}

const lakes = [];
for (const f of read('ne_50m_lakes')) for (const r of polys(f.geometry, 0.03, 0.01)) lakes.push({ n: f.properties.name || '', r });

const rivers = [];
for (const f of read('ne_50m_rivers_lake_centerlines')) {
  const p = f.properties, rank = p.scalerank ?? 5;
  if (p.featurecla && !/river/i.test(p.featurecla)) continue;      // lake centerlines are drawn as lakes
  const parts = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const c of parts) { const s = line(c, 0.04); if (s.length > 1) rivers.push({ n: p.name || '', k: rank, c: s }); }
}

const regions = read('ne_50m_geography_regions_polys');
const pick = cls => regions.filter(f => f.properties.FEATURECLA === cls);
const deserts = [], ranges = [];
for (const f of pick('Desert')) for (const r of polys(f.geometry, 0.12, 4)) deserts.push({ n: f.properties.NAME_EN || f.properties.NAME || '', r });
for (const f of pick('Range/mtn')) for (const r of polys(f.geometry, 0.1, 1)) ranges.push({ n: f.properties.NAME_EN || f.properties.NAME || '', r });

const peaks = read('ne_10m_geography_regions_elevation_points').filter(f => f.properties.featurecla === 'mountain' && f.properties.elevation)
  .map(f => ({ n: f.properties.name || '', e: f.properties.elevation, k: f.properties.scalerank ?? 9, p: [r2(f.properties.long_x), r2(f.properties.lat_y)] }));

const out = { lakes, rivers, deserts, ranges, peaks };
fs.writeFileSync(new URL('../public/data/nature.json', import.meta.url), JSON.stringify(out));
console.log('lakes', lakes.length, 'rivers', rivers.length, 'deserts', deserts.length, 'ranges', ranges.length, 'peaks', peaks.length,
  '->', (fs.statSync(new URL('../public/data/nature.json', import.meta.url)).size / 1024).toFixed(0) + ' KB');
