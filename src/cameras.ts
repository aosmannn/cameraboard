// Cameras: every camera people shot community photos on, and a page per camera.
import * as cloud from './cloud';
import type { Card } from './types';
import { mountShell, el, $, setTitle, pathPart } from './site';
import { tile, openLightbox } from './gallery-ui';

mountShell('cameras');
const root = $('root');
const slug = pathPart(1);

function top(values: (string | number | undefined)[], n = 3): string[] {
  const count = new Map<string, number>();
  for (const v of values) { const k = String(v ?? '').trim(); if (k) count.set(k, (count.get(k) ?? 0) + 1); }
  return [...count].sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]);
}

async function index() {
  setTitle('Cameras');
  root.innerHTML = '';
  const head = el('div', 'page-head'); const t = el('div');
  t.append(el('h1', '', 'Cameras'), el('p', 'lede', 'The cameras behind the photos. Old compacts, DSLRs, film scans and phones, read straight from each photo’s own details.'));
  head.append(t); root.append(head);
  const list = await cloud.exploreCameras();
  if (!list.length) {
    const e = el('div', 'empty');
    e.append(el('h2', '', 'No cameras listed yet'), el('p', '', 'Cameras show up here once people share public photos to the community gallery. Add yours: Wayframe reads the camera, shutter, aperture and ISO from every photo that has them.'));
    const a = el('a', 'btn primary', 'Open the map'); a.href = '/app.html'; e.append(a); root.append(e); return;
  }
  const grid = el('div', 'cards');
  for (const c of list) {
    const a = el('a', 'card'); a.href = '/cameras/' + c.slug;
    const th = el('div', 'thumb'); if (c.cover) { const im = new Image(); im.src = c.cover; im.alt = ''; im.loading = 'lazy'; th.append(im); }
    const body = el('div', 'body'); body.append(el('h3', '', c.camera), el('small', '', `${c.photos} ${c.photos === 1 ? 'photo' : 'photos'} · ${c.people} ${c.people === 1 ? 'person' : 'people'}`));
    a.append(th, body); grid.append(a);
  }
  root.append(grid);
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
