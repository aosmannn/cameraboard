// The map's own data, shipped with the app in public/data (Natural Earth, public domain; US counties from us-atlas).
// Nothing is fetched from outside services.
import { feature } from 'topojson-client';

const base = import.meta.env.BASE_URL;
const getJson = (path: string) => fetch(base + path).then(r => r.json());
const once = <T>(fn: () => Promise<T>) => { let p: Promise<T> | undefined; return () => (p ??= fn()); };

/** name, state or province, country, lat, lng, population, and sometimes another spelling to search by. Sorted biggest first. */
export type CityRow = [string, string, string, number, number, number, string?];
let cities: CityRow[] = [];
let keys: string[] = [];
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const loadCities = once(async () => {
  cities = await getJson('data/cities.json');
  keys = cities.map(r => ' ' + norm(`${r[0]} ${r[1]} ${r[2]} ${r[6] ?? ''}`).replace(/[-'’.,]/g, ' '));
  return cities;
});
export const loadAdmin1 = once(async () => {
  const t = await getJson('data/admin1.json');
  const fc = feature(t, t.objects[Object.keys(t.objects)[0]]) as any;
  fc.features = fc.features.filter((f: any) => f.geometry);   // a few tiny areas vanish when simplified
  return fc;
});
export const loadCounties = once(async () => {
  const t = await getJson('data/us-counties.json');
  const fc = feature(t, t.objects.counties) as any;
  fc.features = fc.features.filter((f: any) => f.geometry);
  return fc;
});

export interface Place { label: string; short: string; lat: number; lng: number }
/** "Dubai" and its region "Dubay" are the same word spelled two ways; say it once. */
const sameWord = (a: string, b: string) => {
  const bare = (t: string) => norm(t).replace(/^(al|el)[\s-]+/, '').replace(/[^a-z0-9]/g, '');
  const x = bare(a), y = bare(b);
  if (x === y) return true;
  if (x.length < 4 || y.length < 4 || Math.abs(x.length - y.length) > 1) return false;
  let i = 0; while (i < x.length && x[i] === y[i]) i++;
  const rest = (x.length === y.length ? [x.slice(i + 1), y.slice(i + 1)] : x.length > y.length ? [x.slice(i + 1), y.slice(i)] : [x.slice(i), y.slice(i + 1)]);
  return rest[0] === rest[1];   // one letter different, added or missing
};
const toPlace = (r: CityRow): Place => {
  const region = r[1] && !sameWord(r[0], r[1]) ? r[1] + ', ' : '';
  return { label: `${r[0]}, ${region}${r[2]}`, short: `${r[0]}, ${r[2]}`, lat: r[3], lng: r[4] };
};

/** Finds cities by name, optionally with state and country words ("austin texas"). Biggest first. */
export function searchPlaces(query: string, max = 6): Place[] {
  const words = norm(query).replace(/[-'’.]/g, ' ').split(/[\s,]+/).filter(Boolean);
  if (!words.length) return [];
  const hits: { r: CityRow; s: number }[] = [];
  for (let i = 0; i < cities.length; i++) {
    const k = keys[i];
    if (!words.every(w => k.includes(' ' + w))) continue;   // each word must start a word: "ain" finds Ain, not Spain
    const name = norm(cities[i][0]);
    let s = Math.log10(cities[i][5] + 10);
    if (name === words[0] || name === words.join(' ')) s += 10; else if (name.startsWith(words[0])) s += 5;
    hits.push({ r: cities[i], s });
  }
  return hits.sort((a, b) => b.s - a.s).slice(0, max).map(h => toPlace(h.r));
}

/** Closest city to a point, as a readable name. Null when nothing is within ~300 km. */
export function nameAt(lat: number, lng: number): string | null {
  const k = Math.cos(lat * Math.PI / 180);
  let best: CityRow | null = null, bd = Infinity;
  for (const r of cities) {
    if (r[5] < 20000) continue;
    const d = ((r[4] - lng) * k) ** 2 + (r[3] - lat) ** 2;
    if (d < bd) { bd = d; best = r; }
  }
  if (!best) return null;
  const km = Math.sqrt(bd) * 111;
  if (km > 300) return null;
  const p = toPlace(best);
  return km < 25 ? p.short : `Near ${p.short}`;
}
