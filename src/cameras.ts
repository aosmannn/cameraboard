// Cameras: every camera people shot community photos on, and a page per camera.
import * as cloud from './cloud';
import type { Card } from './types';
import { mountShell, el, $, setTitle, pathPart, slideTabs, swapContent } from './site';
import { tile, openLightbox } from './gallery-ui';

mountShell('cameras');
const root = $('root');
const slug = pathPart(1);

function top(values: (string | number | undefined)[], n = 3): string[] {
  const count = new Map<string, number>();
  for (const v of values) { const k = String(v ?? '').trim(); if (k) count.set(k, (count.get(k) ?? 0) + 1); }
  return [...count].sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]);
}

type Period = 'today' | 'week' | 'month' | 'year' | 'all';
const PERIODS: [Period, string][] = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['all', 'All time']];
const EMPTY: Record<Period, string> = {
  today: 'No community photos were taken today yet.', week: 'No community photos were taken this week yet.',
  month: 'No community photos were taken this month yet.', year: 'No community photos were taken this year yet.',
  all: 'No cameras yet.'
};
const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** The first day of a period and the day after it ends, as local dates. Photos carry the local date they were taken on. */
function range(p: Period): [string, string] {
  if (p === 'all') return ['', ''];
  const now = new Date(), tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const start = p === 'today' ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
    : p === 'week' ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))   // weeks start on Monday
    : p === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1)
    : new Date(now.getFullYear(), 0, 1);
  return [day(start), day(tomorrow)];
}

async function index() {
  setTitle('Cameras');
  root.innerHTML = '';
  const head = el('div', 'page-head'); const t = el('div');
  t.append(el('h1', '', 'Cameras'), el('p', 'lede', 'The cameras behind the photos, ranked by how many photos were shot on each: compacts, DSLRs, film scans and phones, read from each photo’s own details.'));
  head.append(t); root.append(head);

  let period = (new URLSearchParams(location.search).get('period') as Period) || 'all';
  if (!PERIODS.some(([k]) => k === period)) period = 'all';
  let token = 0;
  const tabs = el('div', 'tabs rank-tabs'); tabs.setAttribute('role', 'tablist');
  const box = el('div'); box.setAttribute('aria-live', 'polite');
  const note = el('p', 'fine rank-note');
  root.append(tabs, box, note);

  const choose = (key: Period) => {
    if (key === period) return;
    period = key; history.replaceState(null, '', key === 'all' ? location.pathname : `?period=${key}`); drawTabs();
    swapContent(box, () => void load());
  };
  const tabButtons = new Map<Period, HTMLButtonElement>();
  function drawTabs() {
    if (!tabButtons.size) for (const [key, label] of PERIODS) {
      const b = el('button', '', label); b.type = 'button'; b.setAttribute('role', 'tab'); b.onclick = () => choose(key);
      tabButtons.set(key, b); tabs.append(b);
    }
    tabButtons.forEach((b, k) => b.setAttribute('aria-selected', String(k === period)));
    slideTabs(tabs);
  }
  type Stat = cloud.CameraStat; type Board = { rows: cloud.BoardRow[]; partial: boolean };
  /** Placeholder cards, so there is something to look at from the first moment on the very first visit. */
  const skeleton = () => {
    box.innerHTML = ''; note.textContent = '';
    const grid = el('div', 'cards'); grid.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 6; i++) { const c = el('div', 'card skel'); c.append(el('div', 'thumb'), el('div', 'body')); grid.append(c); }
    box.append(grid);
  };
  function paint(all: Stat[], board: Board | null) {
    box.innerHTML = '';
    if (!all.length) {
      const e = el('div', 'empty');
      e.append(el('h2', '', 'No cameras yet'), el('p', '', 'Cameras appear here once people share photos to the community gallery. Wayframe reads the camera, shutter speed, aperture and ISO from every photo that includes them.'));
      const a = el('a', 'btn primary', 'Open the map'); a.href = '/app.html'; e.append(a); box.append(e); tabs.hidden = true; return;
    }
    tabs.hidden = false; slideTabs(tabs);
    const cover = new Map(all.map(c => [c.slug, c.cover]));
    const rows = board ? board.rows : all.map(c => ({ camera: c.camera, slug: c.slug, photos: c.photos, people: c.people }));
    if (!rows.length) {
      const e = el('div', 'empty'); e.append(el('p', '', EMPTY[period]));
      const a = el('button', 'btn small', 'See all time'); a.type = 'button'; a.onclick = () => choose('all'); e.append(a); box.append(e); note.textContent = ''; return;
    }
    const top = rows[0].photos, grid = el('div', 'cards');
    rows.forEach((c, i) => {
      const a = el('a', 'card'); a.href = '/cameras/' + c.slug;
      const th = el('div', 'thumb'); const src = cover.get(c.slug);
      if (src) { const im = new Image(); im.src = src; im.alt = ''; im.loading = i < 6 ? 'eager' : 'lazy'; im.decoding = 'async'; th.append(im); }
      th.append(el('span', 'rank-tag' + (i < 3 ? ' p' + (i + 1) : ''), '#' + (i + 1)));
      const body = el('div', 'body'); body.append(el('h3', '', c.camera), el('small', '', `${c.photos.toLocaleString()} ${c.photos === 1 ? 'photo' : 'photos'} · ${c.people} ${c.people === 1 ? 'person' : 'people'}`));
      const meter = el('span', 'meter'), fill = el('i'); fill.style.width = Math.max(4, Math.round((c.photos / top) * 100)) + '%'; meter.append(fill); body.append(meter);
      a.append(th, body); grid.append(a);
    });
    box.append(grid);
    note.textContent = period === 'all' ? 'Counts every photo shared to the community gallery.' : 'Counted by the day each photo was taken.';
    if (board?.partial) note.textContent += ' This count is based on the newest community photos only.';
  }
  async function load() {
    const my = ++token;
    const [from, to] = range(period);
    // Show what we saw last time straight away, then check for news in the background.
    const seenAll = cloud.peekCameras(), seenBoard = period === 'all' ? null : cloud.peekBoard(from, to);
    const seen = seenAll && (period === 'all' || seenBoard) ? JSON.stringify([seenAll, seenBoard]) : '';
    if (seen) paint(seenAll!, seenBoard); else skeleton();
    try {
      const [all, board] = await Promise.all([cloud.exploreCameras(), period === 'all' ? null : cloud.cameraLeaderboard(from, to)]);
      if (my !== token) return;
      if (JSON.stringify([all, board]) !== seen) paint(all, board);
    } catch (err) {
      if (my !== token) return;
      if (!seen) { box.innerHTML = ''; box.append(el('p', 'status', 'Couldn’t load the cameras: ' + (err as Error).message)); }
    }
  }
  drawTabs(); await load();
}

async function detail() {
  root.innerHTML = '';
  const r = await cloud.explorePhotos({ camera: slug, limit: 96 });
  const name = r.cards.find(c => c.meta?.camera)?.meta.camera ?? slug.replace(/-/g, ' ');
  setTitle(name);
  const crumb = el('a', 'crumb', '← All cameras'); crumb.href = '/cameras';
  const head = el('div', 'page-head'); const t = el('div');
  t.append(el('h1', '', name));
  const people = new Set(r.cards.map(c => c.owner)).size;
  t.append(el('p', 'lede', r.cards.length ? `${r.cards.length} community ${r.cards.length === 1 ? 'photo' : 'photos'} from ${people} ${people === 1 ? 'person' : 'people'}.` : 'No community photos from this camera yet.'));
  head.append(t); root.append(crumb, head);
  if (!r.cards.length) { const a = el('a', 'btn primary', 'Explore all photos'); a.href = '/explore'; root.append(a); return; }

  const cards: Card[] = r.cards;
  const typical = [['Shutter', top(cards.map(c => c.meta?.exposure))], ['Aperture', top(cards.map(c => c.meta?.aperture))], ['ISO', top(cards.map(c => c.meta?.iso ? 'ISO ' + c.meta.iso : ''))], ['Focal length', top(cards.map(c => c.meta?.focal))]] as const;
  const shown = typical.filter(([, v]) => v.length);
  if (shown.length) {
    root.append(el('h2', 'section-title', 'What people shoot at'));
    const box = el('div', 'shot');
    for (const [label, vals] of shown) for (const v of vals) box.append(el('i', '', v));
    root.append(box, el('p', 'fine', `The most common settings across these ${cards.length} photos.`));
  }
  root.append(el('h2', 'section-title', 'Shot on this camera'));
  const wall = el('div', 'wall');
  cards.forEach((c, i) => wall.append(tile(c, r.owners.get(c.owner) ?? '', () => openLightbox(cards, i, r.owners))));
  root.append(wall);
}
(slug ? detail() : index()).catch(err => { root.innerHTML = ''; root.append(el('p', 'status', 'Couldn’t load that: ' + (err as Error).message)); });
