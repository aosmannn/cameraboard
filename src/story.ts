// A story as a page: the route on a map, then each stop with its photo, note and camera.
import * as cloud from './cloud';
import type { Card } from './types';
import { mountShell, el, $, routeOf, fmtDate, setTitle, pathPart, isUuid, shortPlace, slugCamera } from './site';
import { openLightbox, shotChips } from './gallery-ui';
import { mountRouteMap, type RouteMap } from './routemap';

mountShell('explore');
const root = $('root');
const key = pathPart(1), trip = new URLSearchParams(location.search).get('t') ?? '';

function missing(msg: string) {
  root.innerHTML = '';
  const e = el('div', 'empty'); e.append(el('h2', '', 'Story not found'), el('p', '', msg));
  const a = el('a', 'btn primary', 'Browse stories'); a.href = '/explore?tab=stories'; e.append(a); root.append(e);
  setTitle('Story not found');
}

async function main() {
  if (!key || !trip) return missing('This link is missing part of its address.');
  const r = await cloud.publicPhotos(isUuid(key) ? { id: key } : { code: key });
  const cards = r.cards.filter(c => c.trip === trip).sort((a, b) => a.seq - b.seq || a.date.localeCompare(b.date));
  if (!cards.length) return missing('It may have been made private, renamed or taken down. Only photos set to Public show up here.');
  const owner = cards[0].owner, ownerName = r.owners.get(owner) ?? 'A traveller';
  const owners = r.owners;
  setTitle(trip);

  const places = cards.map(c => c.place);
  const first = cards[0], last = cards[cards.length - 1];
  const when = [fmtDate(first.date, { month: 'short', year: 'numeric' }), fmtDate(last.date, { month: 'short', year: 'numeric' })]
    .filter((v, i, a) => v && a.indexOf(v) === i).join(' – ');

  root.innerHTML = '';
  const crumb = el('a', 'crumb', '← Stories'); crumb.href = '/explore?tab=stories';
  const head = el('div', 'page-head'); const titles = el('div');
  titles.append(el('h1', '', trip));
  const by = el('p', 'byline'); const who = el('a', '', ownerName); who.href = '/u/' + owner;
  by.append('by ', who, ` · ${cards.length} ${cards.length === 1 ? 'stop' : 'stops'}${when ? ' · ' + when : ''}`);
  titles.append(by);
  const route = routeOf(places); if (route) titles.append(el('p', 'story-route', route));
  const act = el('div', 'act');
  const play = el('button', 'btn primary', 'Play the route'); play.type = 'button';
  const share = el('button', 'btn', 'Copy link'); share.type = 'button';
  share.onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); share.textContent = 'Link copied'; } catch { share.textContent = location.href; }
    setTimeout(() => { share.textContent = 'Copy link'; }, 2500);
  };
  const make = el('a', 'btn', 'Make your own'); make.href = '/app.html';
  act.append(play, share, make);
  head.append(titles, act);
  root.append(crumb, head);

  const grid = el('div', 'story-grid');
  const side = el('div', 'story-map'), mapHost = el('div');
  side.append(mapHost);
  const list = el('ol', 'stops');
  const items: HTMLElement[] = [];

  const placed = cards.map((c, i) => ({ c, i })).filter(x => x.c.lat != null && x.c.lng != null);
  let map: RouteMap | null = null;
  const selectStop = (i: number, fromMap = false) => {
    items.forEach((li, k) => li.classList.toggle('sel', k === i));
    const m = placed.findIndex(x => x.i === i); if (m >= 0) map?.select(m);
    if (fromMap) items[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  cards.forEach((c, i) => {
    const li = el('li', 'stop'); li.id = 'stop-' + (i + 1);
    const card = el('div', 'stop-card');
    const im = new Image(); im.src = c.img!; im.alt = c.title || ''; im.loading = i < 3 ? 'eager' : 'lazy'; im.className = 'look-' + c.look;
    im.style.cursor = 'zoom-in'; im.onclick = e => { e.stopPropagation(); openLightbox(cards, i, owners, { storyLink: false }); };
    const body = el('div', 'stop-body');
    body.append(el('h3', '', c.title || 'Untitled'), el('p', 'meta', [shortPlace(c.place), fmtDate(c.date)].filter(Boolean).join(' · ')));
    if (c.story) body.append(el('p', 'note', c.story));
    const cam = c.meta?.camera?.trim();
    if (cam) { const a = el('a', 'meta', 'Shot on ' + cam); a.href = '/cameras/' + slugCamera(cam); a.style.textDecoration = 'none'; body.append(a); }
    const chips = shotChips(c); if (chips) body.append(chips);
    card.append(im, body); card.onclick = () => selectStop(i);
    li.append(el('span', 'stop-n', String(i + 1)), card);
    list.append(li); items.push(li);
  });
  grid.append(side, list); root.append(grid);

  if (placed.length) {
    map = mountRouteMap(mapHost, placed.map(x => ({ lat: x.c.lat!, lng: x.c.lng!, img: x.c.img!, title: x.c.title || 'Untitled', n: x.i + 1 })), { onSelect: m => selectStop(placed[m].i, true) });
    map.select(0); items[0].classList.add('sel');
  } else mapHost.remove();

  let playing = false;
  play.onclick = () => {
    if (!map) return;
    if (playing) { map.stop(); map.showAll(); playing = false; play.textContent = 'Play the route'; return; }
    playing = true; play.textContent = 'Stop';
    map.play(m => { items.forEach((li, k) => li.classList.toggle('sel', k === placed[m].i)); items[placed[m].i].scrollIntoView({ behavior: 'smooth', block: 'center' }); },
      () => { playing = false; play.textContent = 'Play the route'; });
  };
  play.hidden = !map;
}
main().catch(err => missing('Couldn’t load it: ' + (err as Error).message));
