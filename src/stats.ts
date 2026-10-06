import type { Card } from './types';
import { cameraName } from './photo';

const h = (tag: string, cls = '', text = '') => {
  const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e;
};
const count = (items: string[]) => {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

function bars(title: string, rows: [string, number][], empty: string): HTMLElement {
  const box = h('section', 'panel'); box.append(h('h3', '', title));
  if (!rows.length) { box.append(h('p', 'hint', empty)); return box; }
  const max = rows[0][1];
  for (const [name, n] of rows) {
    const r = h('div', 'bar-row');
    const bar = h('div', 'sbar'); bar.style.width = Math.max(4, (n / max) * 100) + '%';
    r.append(h('span', 'bar-name', name), bar, h('span', 'bar-n', String(n)));
    box.append(r);
  }
  return box;
}

/** Fills the Stats view: totals, photos per camera, per country and per trip. */
export function renderStats(el: HTMLElement, cards: Card[], countryOf: (c: Card) => string | null) {
  const photos = cards.filter(c => c.img);
  const countries = photos.map(countryOf).filter((x): x is string => !!x);
  const cams = photos.map(cameraName);
  const trips = photos.map(c => c.trip).filter(Boolean);
  el.innerHTML = '';
  const wrap = h('div', 'stats-wrap');

  const tiles = h('div', 'tiles');
  const tile = (n: number, label: string) => { const t = h('div', 'tile'); t.append(h('b', '', String(n)), h('span', '', label)); return t; };
  tiles.append(
    tile(photos.length, 'photos'),
    tile(photos.filter(c => c.lat != null).length, 'on the map'),
    tile(new Set(countries).size, 'countries'),
    tile(new Set(trips).size, 'trips'),
    tile(new Set(cams).size, 'cameras'));
  wrap.append(tiles);

  const grid = h('div', 'panels');
  grid.append(
    bars('Photos per camera', count(cams), 'Add photos to see which camera took them.'),
    bars('Countries photographed', count(countries), 'Place a photo on the map to see countries.'),
    bars('Trips', count(trips), 'Give photos a trip name to group them.'));
  wrap.append(grid);
  el.append(wrap);
}
