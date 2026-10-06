// Explore: a wall of community photos and a list of community stories.
import * as cloud from './cloud';
import type { Card } from './types';
import { mountShell, el, $, routeOf, fmtDate, setTitle } from './site';
import { tile, openLightbox } from './gallery-ui';

mountShell('explore'); setTitle('Explore');
const root = $('root');
const params = new URLSearchParams(location.search);
let tab: 'photos' | 'stories' = params.get('tab') === 'stories' ? 'stories' : 'photos';
let camera = params.get('camera') ?? '', q = params.get('q') ?? '';

root.innerHTML = '';
const head = el('div', 'page-head');
const titles = el('div'); titles.append(el('h1', '', 'Explore'), el('p', 'lede', 'Photos and stories from people around the world, each pinned to the place it was taken.'));
const tabs = el('div', 'tabs'); tabs.setAttribute('role', 'tablist');
const tPhotos = el('button', '', 'Photos'), tStories = el('button', '', 'Stories');
for (const b of [tPhotos, tStories]) { b.type = 'button'; b.setAttribute('role', 'tab'); tabs.append(b); }
head.append(titles, tabs);
const filters = el('div', 'filters');
const search = el('input', 'field'); search.type = 'search'; search.placeholder = 'Search places, titles or cameras'; search.value = q; search.setAttribute('aria-label', 'Search photos');
const camSel = el('select', 'field'); camSel.setAttribute('aria-label', 'Camera'); camSel.append(new Option('All cameras', ''));
filters.append(search, camSel);
const out = el('div'); out.id = 'out'; out.setAttribute('aria-live', 'polite');
root.append(head, filters, out);

let photos: Card[] = [], owners = new Map<string, string>(), offset = 0, token = 0;

function emptyState(what: string) {
  const e = el('div', 'empty');
  e.append(el('h2', '', `No ${what} yet`),
    el('p', '', 'Be the first to share. In the map, set a photo or story to Public, then turn on “Show my public photos in the community gallery” in your profile. Nothing is listed unless you choose it.'));
  const a = el('a', 'btn primary', 'Open the map'); a.href = '/app.html'; e.append(a);
  return e;
}
function setTab(t: typeof tab) {
  tab = t;
  tPhotos.setAttribute('aria-selected', String(t === 'photos')); tStories.setAttribute('aria-selected', String(t === 'stories'));
  filters.hidden = t !== 'photos';
  const u = new URL(location.href); if (t === 'stories') u.searchParams.set('tab', 'stories'); else u.searchParams.delete('tab');
  history.replaceState(null, '', u);
  load(true);
}
tPhotos.onclick = () => setTab('photos'); tStories.onclick = () => setTab('stories');

async function load(reset: boolean) {
  const my = ++token;
  if (reset) { offset = 0; photos = []; out.innerHTML = ''; out.append(el('p', 'status', 'Loading…')); }
  try {
    if (tab === 'photos') {
      const r = await cloud.explorePhotos({ offset, camera, q, limit: 48 });
      if (my !== token) return;
      photos = photos.concat(r.cards); r.owners.forEach((v, k) => owners.set(k, v)); offset += 48;
      drawPhotos(r.more);
    } else {
      const r = await cloud.exploreStories(24, offset);
      if (my !== token) return;
      drawStories(r.stories, r.more);
    }
  } catch (err) {
    if (my === token) { out.innerHTML = ''; out.append(el('p', 'status', 'Couldn’t load the gallery: ' + (err as Error).message)); }
  }
}
function drawPhotos(more: boolean) {
  out.innerHTML = '';
  if (!photos.length) { out.append(q || camera ? el('p', 'status', 'Nothing matches that. Try a different search.') : emptyState('photos')); return; }
  const wall = el('div', 'wall');
  photos.forEach((c, i) => wall.append(tile(c, owners.get(c.owner) ?? '', () => openLightbox(photos, i, owners))));
  out.append(wall);
  if (more) { const m = el('div', 'more'), b = el('button', 'btn', 'Show more'); b.onclick = () => { b.disabled = true; load(false); }; m.append(b); out.append(m); }
}
function drawStories(list: cloud.GalleryStory[], more: boolean) {
  if (offset === 0) out.innerHTML = '';
  else out.querySelector('.more')?.remove();
  if (offset === 0 && !list.length) { out.append(emptyState('stories')); return; }
  let grid = out.querySelector<HTMLElement>('.cards');
  if (!grid) { grid = el('div', 'cards'); out.append(grid); }
  for (const s of list) {
    const a = el('a', 'card'); a.href = `/s/${s.owner}?t=${encodeURIComponent(s.trip)}`;
    const th = el('div', 'thumb'); if (s.cover) { const im = new Image(); im.src = s.cover; im.alt = ''; im.loading = 'lazy'; th.append(im); }
    const body = el('div', 'body');
    body.append(el('h3', '', s.trip));
    const route = routeOf(s.places); if (route) body.append(el('p', 'route-line', route));
    body.append(el('small', '', `by ${s.owner_name} · ${s.stops} ${s.stops === 1 ? 'stop' : 'stops'}${s.updated ? ' · ' + fmtDate(s.updated, { month: 'short', year: 'numeric' }) : ''}`));
    a.append(th, body); grid.append(a);
  }
  offset += 24;
  if (more) { const m = el('div', 'more'), b = el('button', 'btn', 'Show more'); b.onclick = () => { b.disabled = true; load(false); }; m.append(b); out.append(m); }
}

let typing = 0;
search.oninput = () => { clearTimeout(typing); typing = window.setTimeout(() => { q = search.value; sync(); load(true); }, 300); };
camSel.onchange = () => { camera = camSel.value; sync(); load(true); };
function sync() {
  const u = new URL(location.href);
  q ? u.searchParams.set('q', q) : u.searchParams.delete('q'); camera ? u.searchParams.set('camera', camera) : u.searchParams.delete('camera');
  history.replaceState(null, '', u);
}

cloud.exploreCameras().then(list => {
  for (const c of list) camSel.append(new Option(`${c.camera} (${c.photos})`, c.slug));
  camSel.value = camera;
}).catch(() => { /* the camera filter is optional */ });
setTab(tab);
