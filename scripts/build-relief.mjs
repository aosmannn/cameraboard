// Builds the shaded-relief pictures the Terrain map draws: public/data/relief-shade.webp and relief-height.webp.
// A development tool, not part of the site's build. Run it only when you want to redo the data:
//   node scripts/build-relief.mjs [cache folder]
// Needs `cwebp` (brew install webp) and the pngjs package that is already in node_modules.
//
// Source: AWS Terrain Tiles, "terrarium" PNGs (elevation-tiles-prod on S3, no key). They combine SRTM, GMTED and ETOPO1 sea-floor data
// (see https://github.com/tilezen/joerd/blob/master/docs/data-sources.md). We read the zoom-4 tiles once, here, and ship only the result,
// so the running site never calls any outside map service.
//
// Both pictures cover the whole world in Web Mercator (the same tiling Leaflet uses, ±85.05°), so a map tile is a rectangle of the picture:
//   relief-shade.webp  grey. Hillshade, light from the north-west. Flat ground is mid-grey (~180); lighter faces the sun, darker faces away.
//   relief-height.webp grey. Height in metres as a signed square root: 0 = deepest sea, 128 = sea level, 255 = highest peak. See metres() in src/relief.ts.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';

const Z = 4, T = 256, N = T << Z;                    // 16 x 16 tiles, 4096 px square
const SHADE_SIZE = Number(process.env.SHADE_SIZE || 4096), HEIGHT_SIZE = Number(process.env.HEIGHT_SIZE || 2048);
const cache = process.argv[2] || path.join(os.tmpdir(), 'wayframe-relief');
const out = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'data');
fs.mkdirSync(cache, { recursive: true });

async function tile(x, y) {
  const f = path.join(cache, `${Z}-${x}-${y}.png`);
  if (!fs.existsSync(f)) {
    const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`);
    if (!r.ok) throw new Error(`tile ${x},${y}: ${r.status}`);
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  return PNG.sync.read(fs.readFileSync(f));
}

const H = new Float32Array(N * N);                   // metres
const jobs = [];
for (let y = 0; y < 1 << Z; y++) for (let x = 0; x < 1 << Z; x++) jobs.push([x, y]);
let done = 0;
async function worker() {
  for (let j; (j = jobs.pop());) {
    const [tx, ty] = j, png = await tile(tx, ty);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const i = (y * T + x) * 4;
      H[(ty * T + y) * N + tx * T + x] = png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
    }
    if (++done % 32 === 0) console.log(`tiles ${done}/${1 << (2 * Z)}`);
  }
}
await Promise.all(Array.from({ length: 8 }, worker));

// ---- hillshade (Horn's method). One pixel is 156543 m / 2^Z wide at the equator and shrinks with cos(latitude). ----
const EXAGGERATE = 9;                                // low zoom hides slopes, so stretch heights to make ranges read
const az = (315 * Math.PI) / 180, alt = (42 * Math.PI) / 180;
const lx = Math.cos(alt) * Math.sin(az), ly = Math.cos(alt) * Math.cos(az), lz = Math.sin(alt);
const shade = new Uint8Array(N * N);
for (let y = 0; y < N; y++) {
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / N)));
  const cell = (156543.03 / (1 << Z)) * Math.cos(lat);
  const y0 = Math.max(0, y - 1), y1 = Math.min(N - 1, y + 1);
  for (let x = 0; x < N; x++) {
    const x0 = (x + N - 1) % N, x1 = (x + 1) % N;   // wraps around the date line
    const g = (xx, yy) => Math.max(0, H[yy * N + xx]);   // the sea floor is not shaded: the sea is drawn flat
    const a = g(x0, y0), b = g(x, y0), c = g(x1, y0), d = g(x0, y), f = g(x1, y), gg = g(x0, y1), h = g(x, y1), i = g(x1, y1);
    const dx = ((c + 2 * f + i) - (a + 2 * d + gg)) / (8 * cell) * EXAGGERATE;
    const dy = ((gg + 2 * h + i) - (a + 2 * b + c)) / (8 * cell) * EXAGGERATE;   // y grows southward
    const len = Math.hypot(dx, dy, 1);
    const s = (-dx * lx + dy * ly + lz) / len;       // cosine of the angle to the sun
    shade[y * N + x] = Math.max(0, Math.min(255, Math.round(s * 255)));
  }
}

// ---- height as a signed square root, so the low ground (where most people live) keeps its detail ----
const MIN = -11000, MAX = 8850, sq = v => Math.sign(v) * Math.sqrt(Math.abs(v));
const lo = sq(MIN), hi = sq(MAX);
const heightByte = v => Math.max(0, Math.min(255, Math.round(((sq(v) - lo) / (hi - lo)) * 255)));

function box(src, size) {                            // area average down to size x size
  if (size === N) return src;
  const k = N / size, o = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let s = 0; for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) s += src[(y * k + j) * N + x * k + i];
    o[y * size + x] = Math.round(s / (k * k));
  }
  return o;
}
function write(name, gray, size, quality) {
  const png = new PNG({ width: size, height: size, colorType: 0, inputColorType: 0, inputHasAlpha: false });
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = gray[i]; rgba[i * 4 + 3] = 255; }
  png.data = rgba;
  const tmp = path.join(cache, name + '.png');
  fs.writeFileSync(tmp, PNG.sync.write(png, { colorType: 0, inputColorType: 6 }));
  execFileSync('cwebp', ['-q', String(quality), '-m', '6', '-quiet', tmp, '-o', path.join(out, name + '.webp')]);
  console.log(name, size + 'px', (fs.statSync(path.join(out, name + '.webp')).size / 1024).toFixed(0) + ' KB');
}
write('relief-shade', box(shade, SHADE_SIZE), SHADE_SIZE, Number(process.env.SHADE_Q || 80));
const hb = new Uint8Array(N * N); for (let i = 0; i < hb.length; i++) hb[i] = heightByte(H[i]);
write('relief-height', box(hb, HEIGHT_SIZE), HEIGHT_SIZE, Number(process.env.HEIGHT_Q || 85));
