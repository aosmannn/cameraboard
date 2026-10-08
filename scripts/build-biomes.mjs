// Builds public/data/biomes.png: a world grid of climate/vegetation zones for the Terrain theme (equirectangular,
// 2048 x 1024). Each pixel's red value is a zone number (see ZONES in src/relief.ts).
// A development tool, not part of the site's build. Run it only when you want to redo the classification:
//   1. Download Natural Earth II land cover (public domain): https://naciscdn.org/naturalearth/10m/raster/NE2_LR_LC.zip
//   2. Shrink it (macOS):  sips -z 1024 2048 NE2_LR_LC.tif --out small.tif && sips -s format png small.tif --out small.png
//   3. npm install --no-save pngjs && node scripts/build-biomes.mjs small.png
// Natural Earth II paints each zone a typical color (forest green, desert tan, tundra grey, ice blue), so we turn
// the colors back into zones with a few rules, then fill the sea and tidy up speckle.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { PNG } = createRequire(import.meta.url)('pngjs');

const src = PNG.sync.read(fs.readFileSync(process.argv[2]));
const W = src.width, H = src.height;
if (W !== 2048 || H !== 1024) throw new Error('expected a 2048 x 1024 picture');
const OUT = new URL('../public/data/biomes.png', import.meta.url);
const NONE = 255;
// zone numbers
const ICE = 0, TUNDRA = 1, BOREAL = 2, FOREST = 3, RAINFOREST = 4, SAVANNA = 5, GRASS = 6, SEMIARID = 7, DESERT = 8, ROCKY = 9;

function classify(r, g, b, lat) {
  if (r > 250 && g > 250 && b > 250) return NONE;                 // sea
  const gr = g - r, rg = r - g, br = b - r, sat = Math.max(r, g, b) - Math.min(r, g, b), sum = r + g + b, a = Math.abs(lat);
  if (lat <= -62) return ICE;                                      // all of Antarctica
  if (br >= 12) return sum >= 690 ? ICE : NONE;                   // near-white blue: ice sheets and glaciers; darker blue is a lake
  if (sat <= 14) return TUNDRA;                                   // grey: arctic tundra and high alpine plateaus
  if (gr >= 36) return a <= 30 ? RAINFOREST : FOREST;
  if (a >= 50 && gr >= 14) return BOREAL;                         // taiga
  if (gr >= 22) return FOREST;
  if (gr >= 10) return SAVANNA;
  if (rg >= 12) return sum <= 620 ? SEMIARID : ROCKY;             // reddish and dry: rocky desert, or cold steppe
  if (gr >= 0) return GRASS;
  return sum >= 650 && b >= 196 ? DESERT : SEMIARID;
}

let z = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  const lat = 90 - ((y + 0.5) / H) * 180;
  for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; z[y * W + x] = classify(src.data[i], src.data[i + 1], src.data[i + 2], lat); }
}
// tidy: replace each land pixel with the most common zone around it (twice), which removes relief-shading speckle
for (let pass = 0; pass < 2; pass++) {
  const n = z.slice();
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (z[y * W + x] === NONE) continue;
    const c = new Uint8Array(11); let best = z[y * W + x], bc = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const v = z[(y + j) * W + x + i]; if (v !== NONE && ++c[v] > bc) { bc = c[v]; best = v; } }
    n[y * W + x] = best;
  }
  z = n;
}
// fill the sea with the nearest land zone, so coastlines never pick up a wrong color
for (let pass = 0; pass < 24; pass++) {
  const n = z.slice();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (z[y * W + x] !== NONE) continue;
    for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = (x + i + W) % W, yy = y + j;
      if (yy >= 0 && yy < H && z[yy * W + xx] !== NONE) { n[y * W + x] = z[yy * W + xx]; break; }
    }
  }
  z = n;
}
const png = new PNG({ width: W, height: H });
for (let i = 0; i < W * H; i++) { const v = z[i] === NONE ? DESERT : z[i]; png.data[i * 4] = v; png.data[i * 4 + 1] = v; png.data[i * 4 + 2] = v; png.data[i * 4 + 3] = 255; }
fs.writeFileSync(OUT, PNG.sync.write(png, { colorType: 2 }));
console.log(`wrote ${OUT.pathname} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
