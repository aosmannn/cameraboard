// Pieces shared by every place a profile is shown: the travel summary chips and the pinned highlights.
import * as cloud from './cloud';
import './profile-extras.css';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** "4 countries", "Dubai · most photos", "United Arab Emirates · longest trip", "Panasonic DMC-LX1 · favorite camera". */
export function drawSummary(host: HTMLElement, s: cloud.TravelSummary | null) {
  host.innerHTML = ''; host.hidden = !s;
  if (!s) return;
  const chip = (big: string, small: string) => { const c = el('div', 'px-chip'); c.append(el('b', '', big), el('small', '', small)); host.append(c); };
  if (s.countries) chip(plural(s.countries, 'country', 'countries'), 'visited');
  if (s.top_place) chip(s.top_place, `most photos · ${s.top_place_n}`);
  if (s.longest_trip) chip(s.longest_trip, `longest story · ${plural(s.longest_trip_n ?? 0, 'stop')}`);
  if (s.top_camera) chip(s.top_camera, `favorite camera · ${s.top_camera_n}`);
  host.hidden = !host.children.length;
}

export interface Shot { id: string; url: string; title: string; place: string }
/** A row of pinned photos. `open` is called with the one that was clicked. */
export function drawHighlights(host: HTMLElement, shots: Shot[], open: (s: Shot, all: Shot[]) => void) {
  host.innerHTML = ''; host.hidden = !shots.length;
  if (!shots.length) return;
  host.append(el('h3', 'px-title', 'Highlights'));
  const row = el('div', 'px-row');
  for (const s of shots) {
    const b = el('button', 'px-shot'); b.type = 'button'; b.setAttribute('aria-label', s.title || s.place || 'Photo');
    const im = new Image(); im.src = s.url; im.alt = ''; im.loading = 'lazy'; b.append(im);
    const cap = el('span', 'px-cap', s.title || (s.place || '').split(',')[0]); b.append(cap);
    b.onclick = () => open(s, shots); row.append(b);
  }
  host.append(row);
}

/** Loads both for someone you're allowed to see. Failures just leave the section out. */
export async function loadExtras(id: string): Promise<{ summary: cloud.TravelSummary | null; shots: Shot[] }> {
  const [summary, hl] = await Promise.all([cloud.travelSummary(id).catch(() => null), cloud.profileHighlights(id).catch(() => [])]);
  return { summary, shots: hl.map(h => ({ id: h.id, url: h.url, title: h.title, place: h.place })) };
}
