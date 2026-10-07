// Builds public/data/cities.json: Natural Earth's populated places plus every GeoNames city of 15,000+ people.
// A development tool, not part of the site's build. Run it only when you want to refresh the data:
//   npm install --no-save all-the-cities@3 && node scripts/build-cities.mjs
// Rows are [name, region, country, lat, lng, population, alias?], biggest first. An alias is another spelling that
// search also understands ("Al Ain" for "Al Ayn"); it is never shown.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const all = require(process.env.ALL_THE_CITIES || 'all-the-cities');
const FILE = new URL('../public/data/cities.json', import.meta.url);
const ne = JSON.parse(fs.readFileSync(new URL('./data/natural-earth-places.json', import.meta.url), 'utf8'));
const MIN_POP = 15000;

const ascii = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ʻʼʾʿ'’`]/g, '').replace(/\s+/g, ' ').trim();
const key = s => ascii(s).toLowerCase();
const US = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
const CA = { '01': 'Alberta', '02': 'British Columbia', '03': 'Manitoba', '04': 'New Brunswick', '05': 'Newfoundland and Labrador', '07': 'Nova Scotia', '08': 'Ontario', '09': 'Prince Edward Island', '10': 'Quebec', '11': 'Saskatchewan', '12': 'Yukon', '13': 'Northwest Territories', '14': 'Nunavut' };

// Country names: match the Natural Earth spelling by voting between cities both lists know.
const votes = new Map();
const big = all.filter(c => c.population >= MIN_POP);
const grid = new Map();
const cell = (lat, lng) => Math.round(lat * 4) + ',' + Math.round(lng * 4);
for (const c of big) { const k = cell(c.loc.coordinates[1], c.loc.coordinates[0]); (grid.get(k) ?? grid.set(k, []).get(k)).push(c); }
const near = (lat, lng, d) => {
  const out = [], r = Math.ceil(d * 4) + 1;
  for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (const c of grid.get(cell(lat + a / 4, lng + b / 4)) ?? []) {
    if (Math.abs(c.loc.coordinates[1] - lat) < d && Math.abs(c.loc.coordinates[0] - lng) < d) out.push(c);
  }
  return out;
};
for (const r of ne) for (const c of near(r[3], r[4], 0.08)) {
  const v = votes.get(c.country) ?? votes.set(c.country, new Map()).get(c.country);
  v.set(r[2], (v.get(r[2]) ?? 0) + 1);
}
const display = new Intl.DisplayNames('en', { type: 'region' });
const countryName = iso => { const v = votes.get(iso); return v ? [...v].sort((a, b) => b[1] - a[1])[0][0] : (display.of(iso) || iso); };

const rows = ne.map(r => r.slice(0, 6));
const have = new Set(ne.map(r => key(r[0]) + '|' + r[2]));
// The same city in two spellings: ignore "al"/"el"/"city" and allow a letter or two of difference.
const core = s => key(s).replace(/\b(al|el|ar|as|an|ash|city)\b/g, '').replace(/[^a-z0-9]/g, '');
const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
const sameCity = (a, b) => { const x = core(a), y = core(b); return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 4 && lev(x, y) <= Math.max(1, Math.floor(Math.min(x.length, y.length) / 4)))); };
let added = 0, aliased = 0;
for (const c of big) {
  const [lng, lat] = c.loc.coordinates;
  let name = ascii(c.name);
  if (c.country === 'AE') name = name.replace(/ City$/, '');
  const country = countryName(c.country);
  if (have.has(key(name) + '|' + country)) continue;
  const twin = rows.find(r => r[2] === country && Math.abs(r[3] - lat) < 0.2 && Math.abs(r[4] - lng) < 0.2 && sameCity(r[0], name));
  if (twin) { if (key(twin[0]) !== key(name) && !twin[6]) { twin[6] = name; aliased++; } continue; }
  const region = c.country === 'US' ? US[c.adminCode] ?? '' : c.country === 'CA' ? CA[c.adminCode] ?? '' : '';
  rows.push([name, region, country, +lat.toFixed(3), +lng.toFixed(3), c.population]);
  have.add(key(name) + '|' + country); added++;
}
rows.sort((a, b) => b[5] - a[5]);
fs.writeFileSync(FILE, JSON.stringify(rows));
console.log(`Natural Earth ${ne.length} + GeoNames ${added} new (${aliased} extra spellings) = ${rows.length} places (${(fs.statSync(FILE).size / 1e6).toFixed(2)} MB)`);
