import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/caveat/500.css';
import '@fontsource/caveat/700.css';
import '@fontsource/vt323/400.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import './style.css';
import type { Card, Look } from './types';
import { openStore, loadCards, saveCards } from './storage';
import { blankCard, fillCard, normalize, cameraName, dayOf, timeOf, stampText, placeKey } from './photo';
import { drawWorld, countryAt, THEMES, type ThemeName } from './world';
import { loadCities, searchPlaces, nameAt } from './atlas';
import { initViewer, openViewer, closeViewer, viewerIsOpen } from './viewer';
import { renderPoster } from './poster';
import * as cloud from './cloud';

const PIN_COLORS = ['', '#2f6fd1', '#2e9e5b', '#e8b422', '#8e44ad', '#1d1d1d'];
const YARN = '#b3242c';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const wide = () => window.matchMedia('(min-width:801px)').matches;
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e;
};

let cards: Card[] = [];
let cur: Card | null = null;
let pinTargets: Card[] = [];
let pickTarget: Card | null = null;
let activeStory: string | null = null;     // story shown on its own, the rest faded
let connecting: string | null = null;      // story that clicks on photos add to
let query = '';
// signed-in state: your account, the people you follow, and the photos they shared with you
let signedIn = false;
let myName = '';
let friends: cloud.Person[] = [];
let friendCards: Card[] = [];
let showFriends = lsGet('wf-friends') !== '0';
const likeCache = new Map<string, { n: number; mine: boolean }>();
const FRIEND_YARN = '#2f5fb3';

let pushT: number;
/** Saves in the browser, and to your account a moment later when signed in. */
const save = async () => {
  await saveCards(cards);
  if (signedIn) { clearTimeout(pushT); pushT = window.setTimeout(syncUp, 1500); }
};
async function syncUp() {
  try { await cloud.push(cards); await saveCards(cards); syncNote('Your photos are saved to your account.'); }
  catch (e) { syncNote('Couldn’t save to your account: ' + (e as Error).message); }
}
function syncNote(t: string) { const n = document.getElementById('syncNote'); if (n) n.textContent = t; }
let saveT: number;
const saveSoon = () => { clearTimeout(saveT); saveT = window.setTimeout(save, 400); };
const placed = (c: Card) => !!c.img && c.lat != null && c.lng != null;
const byDate = (a: Card, b: Card) => (timeOf(a) || Infinity) - (timeOf(b) || Infinity);
const fmtDate = (c: Card, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  c.date ? new Date(c.date).toLocaleDateString(undefined, opts) : '';
const placeName = (c: Card) => (c.place || '').split(',')[0].replace(/^Near /, '').trim();

const fTitle = $<HTMLInputElement>('fTitle');
const fStory = $<HTMLTextAreaElement>('fStory');
const fDate = $<HTMLInputElement>('fDate');
const fPlace = $<HTMLInputElement>('fPlace');
const fTripName = $<HTMLInputElement>('fTripName');
const picker = $<HTMLInputElement>('picker');

// ---------- which country is each photo in ----------
const countryCache = new Map<string, string | null>();
function countryOf(c: Card): string | null {
  if (c.lat == null || c.lng == null) return null;
  const k = c.lat + ',' + c.lng;
  if (!countryCache.has(k)) countryCache.set(k, countryAt(c.lat, c.lng));
  return countryCache.get(k)!;
}
function visible(c: Card) {
  if (!c.img) return false;
  if (!query) return true;
  const hay = [c.title, c.story, c.place, c.trip, cameraName(c), countryOf(c) ?? ''].join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).every(w => hay.includes(w));
}
const visiblePlaced = () => cards.filter(c => placed(c) && visible(c));
const isFriendCard = (c: Card) => friendCards.includes(c);
const nameOf = (id: string) => friends.find(f => f.id === id)?.display_name || 'A friend';
/** Everything on the map: your photos, plus friends' shared photos when shown. */
const mapCards = () => [...visiblePlaced(), ...(signedIn && showFriends ? friendCards.filter(c => placed(c) && visible(c)) : [])];
/** Friends' photos never share a pin with yours. */
const keyOf = (c: Card) => (isFriendCard(c) ? 'f:' + c.owner + ':' : '') + placeKey(c);
/** Photos at the same spot as `c`, oldest first. */
const stackOf = (c: Card) => placed(c) ? mapCards().filter(x => keyOf(x) === keyOf(c)).sort(byDate) : [c];

// ---------- stories: photos joined by string, in order ----------
interface Story { name: string; cards: Card[] }
function stories(): Story[] {
  const m = new Map<string, Card[]>();
  for (const c of cards) if (c.img && c.trip) (m.get(c.trip) ?? m.set(c.trip, []).get(c.trip)!).push(c);
  return [...m.entries()]
    .map(([name, cs]) => ({ name, cards: cs.sort((a, b) => a.seq - b.seq || byDate(a, b)) }))
    .sort((a, b) => byDate(a.cards[0], b.cards[0]));
}
const storyOf = (name: string) => stories().find(s => s.name === name)?.cards ?? [];
/** Friends' stories, one per person and story name. */
function friendStories(): (Story & { owner: string })[] {
  if (!signedIn || !showFriends) return [];
  const m = new Map<string, Card[]>();
  for (const c of friendCards) if (c.trip) { const k = c.owner + '\u0000' + c.trip; (m.get(k) ?? m.set(k, []).get(k)!).push(c); }
  return [...m.values()].map(cs => ({ name: cs[0].trip, owner: cs[0].owner, cards: cs.sort((a, b) => a.seq - b.seq || byDate(a, b)) }));
}
/** The story a photo belongs to, yours or a friend's. */
const storyListOf = (c: Card) => !c.trip ? [] : isFriendCard(c)
  ? friendCards.filter(x => x.owner === c.owner && x.trip === c.trip).sort((a, b) => a.seq - b.seq || byDate(a, b))
  : storyOf(c.trip);
function addToStory(c: Card, name: string) {
  if (c.trip === name) return;
  const rest = storyOf(name);
  c.trip = name; c.seq = rest.length ? Math.max(...rest.map(x => x.seq)) + 1 : 1;
}
function renumber(name: string, list: Card[]) { list.forEach((c, i) => { c.trip = name; c.seq = i + 1; }); }

// ---------- map ----------
const themeName = ((): ThemeName => { const t = lsGet('wf-theme'); return t && t in THEMES ? t as ThemeName : 'paper'; })();
const map = L.map('map', { zoomControl: false, minZoom: 2, maxZoom: 16, preferCanvas: true,
  maxBounds: [[-70, -220], [85, 220]], maxBoundsViscosity: 0.8 }).setView([30, 10], 2);
L.control.zoom({ position: 'bottomright' }).addTo(map);
const world = drawWorld(map, themeName);
map.attributionControl.setPrefix('').addAttribution('Natural Earth');

map.createPane('stringPane').style.zIndex = '620';
map.getPane('stringPane')!.style.pointerEvents = 'none';
const stringRenderer = L.svg({ pane: 'stringPane' });
const strings = L.layerGroup().addTo(map);
// keep the string drawn while the map flies between stops (same reason as the countries in world.ts)
map.on('zoom', () => { if ((map as any)._flyToFrame) (stringRenderer as any)._reset(); });
const photos = L.layerGroup().addTo(map);
const markers = new Map<string, L.Marker>();

/** Polaroids shrink when zoomed out so the board doesn't turn into a pile. */
function sizeClass() {
  const z = map.getZoom(), c = map.getContainer().classList;
  c.toggle('z-far', z < 3.5); c.toggle('z-mid', z >= 3.5 && z < 6); c.toggle('z-near', z >= 6);
}
map.on('zoom zoomend', sizeClass); sizeClass();

map.on('click', async e => {
  if (!pinTargets.length) return;
  const targets = pinTargets;
  for (const c of targets) { c.lat = e.latlng.lat; c.lng = e.latlng.lng; }
  stopPinning(); render(); locNote();
  const name = await reverse(e.latlng.lat, e.latlng.lng) || 'Dropped pin';
  for (const c of targets) c.place = name;
  if (cur && targets.includes(cur)) { fPlace.value = name; drawMeta(cur); }
  save(); renderStories();
});

/** A polaroid hanging from a push pin. The pin's point is the photo's exact location. */
function polaroid(rep: Card, n: number): HTMLElement {
  const box = el('div', 'pol');
  box.style.setProperty('--rot', rep.rot + 'deg');
  if (rep.pinColor) box.style.setProperty('--pc', rep.pinColor);
  if (n > 1) box.classList.add('stacked');
  const frame = el('div', 'pol-frame');
  const im = new Image(); im.src = rep.img!; im.alt = rep.title; im.className = 'look-' + rep.look; im.draggable = false;
  frame.append(im, el('span', 'pol-cap', rep.title || placeName(rep) || 'Untitled'));
  box.append(frame, el('i', 'pushpin'));
  if (n > 1) box.append(el('span', 'pol-n', String(n)));
  if (isFriendCard(rep)) { box.classList.add('friend'); box.append(el('span', 'pol-by', nameOf(rep.owner))); }
  return box;
}

function renderMap() {
  photos.clearLayers(); markers.clear();
  const groups = new Map<string, Card[]>();
  for (const c of mapCards()) { const k = keyOf(c); (groups.get(k) ?? groups.set(k, []).get(k)!).push(c); }
  const focus = focusCard();
  groups.forEach((g, k) => {
    g.sort(byDate);
    const rep = g.find(c => c.cover) ?? g[0];
    const box = polaroid(rep, g.length);
    const inStory = !activeStory || g.some(c => !isFriendCard(c) && c.trip === activeStory);
    if (!inStory) box.classList.add('dim');
    if (focus && placed(focus) && keyOf(focus) === k) box.classList.add('sel');
    const m = L.marker([rep.lat!, rep.lng!], {
      icon: L.divIcon({ html: box, className: 'pol-icon', iconSize: [0, 0], iconAnchor: [0, 0] }),
      zIndexOffset: inStory ? 100 : 0, title: rep.title || 'Photo'
    });
    m.on('click', () => {
      if (connecting) {
        if (isFriendCard(rep)) return;
        const c = g.find(x => x.trip !== connecting) ?? rep;
        addToStory(c, connecting); save(); render(); connectText(); return;
      }
      openCard(rep);
    });
    markers.set(k, m); photos.addLayer(m);
  });
  $('empty').hidden = cards.some(c => c.img);
}
function markSelected() {
  const f = focusCard(), key = f && placed(f) ? keyOf(f) : '';
  markers.forEach((m, k) => {
    m.getElement()?.querySelector('.pol')?.classList.toggle('sel', k === key);
    m.setZIndexOffset(k === key ? 1000 : 100);
  });
}

/** Red string between two stops, sagging a little like real yarn. */
function yarn(a: Card, b: Card): L.LatLng[] {
  const Z = 4;
  let lng2 = b.lng!;
  if (lng2 - a.lng! > 180) lng2 -= 360; else if (a.lng! - lng2 > 180) lng2 += 360;
  const p1 = map.project([a.lat!, a.lng!], Z), p2 = map.project([b.lat!, lng2], Z);
  const mid = p1.add(p2).divideBy(2), d = p1.distanceTo(p2);
  const ctrl = L.point(mid.x, mid.y + Math.min(d * 0.2, 160));
  const out: L.LatLng[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40, u = 1 - t;
    out.push(map.unproject(L.point(u * u * p1.x + 2 * u * t * ctrl.x + t * t * p2.x, u * u * p1.y + 2 * u * t * ctrl.y + t * t * p2.y), Z));
  }
  return out;
}
function drawYarn(list: Card[], color: string, dim: boolean) {
  const opacity = dim ? 0.18 : 0.95;
  for (let i = 1; i < list.length; i++) {
    if (keyOf(list[i - 1]) === keyOf(list[i])) continue;
    const pts = yarn(list[i - 1], list[i]);
    L.polyline(pts, { renderer: stringRenderer, color: '#000', weight: 3.5, opacity: opacity * 0.16, interactive: false, className: 'yarn-shadow' }).addTo(strings);
    L.polyline(pts, { renderer: stringRenderer, color, weight: 2.2, opacity, interactive: false, lineCap: 'round' }).addTo(strings);
  }
  for (const c of list) {
    L.circleMarker([c.lat!, c.lng!], { renderer: stringRenderer, radius: 3, color: '#0006', weight: 1,
      fillColor: color, fillOpacity: dim ? 0.2 : 1, opacity: dim ? 0.2 : 1, interactive: false }).addTo(strings);
  }
}
function renderStrings() {
  strings.clearLayers();
  const cut = (key: string, list: Card[]) => pl.on && pl.key === key ? list.slice(0, pl.i + 1) : list;
  for (const s of stories()) {
    drawYarn(cut('own:' + s.name, s.cards.filter(c => placed(c) && visible(c))), YARN,
      (!!activeStory && activeStory !== s.name) || (pl.on && pl.key !== 'own:' + s.name));
  }
  for (const s of friendStories()) {
    drawYarn(cut('f:' + s.owner + ':' + s.name, s.cards.filter(c => placed(c) && visible(c))), FRIEND_YARN, !!activeStory || (pl.on && !pl.key.startsWith('f:' + s.owner + ':' + s.name)));
  }
}

function mapPadding() {
  const left = !$('stories').hidden && wide() ? 340 : 0;
  const right = !$('drawer').hidden && wide() ? 410 : 0;
  const bottom = !$('drawer').hidden && !wide() ? window.innerHeight * 0.62 : (!$('tray').hidden ? 160 : 60);
  return { paddingTopLeft: L.point(left + 60, 110), paddingBottomRight: L.point(right + 60, bottom) };
}
function fitCards(list: Card[], maxZoom = 6) {
  const pts = list.filter(placed).map(c => [c.lat!, c.lng!] as L.LatLngTuple);
  if (pts.length) map.flyToBounds(L.latLngBounds(pts), { ...mapPadding(), maxZoom, duration: 1 });
}
function flyTo(c: Card, zoom = 8) {
  map.flyToBounds(L.latLngBounds([[c.lat!, c.lng!]]), { ...mapPadding(), maxZoom: Math.max(map.getZoom(), zoom), duration: 1.1 });
}

// ---------- stories panel ----------
function routeText(list: Card[]) {
  const names: string[] = [];
  for (const c of list.filter(placed)) { const n = placeName(c); if (n && n !== names[names.length - 1]) names.push(n); }
  return names.join(' → ');
}
function renderStories() {
  const box = $('storyList'); box.innerHTML = '';
  const all = stories();
  if (!all.length) {
    const p = el('div', 'st-empty');
    p.append(el('b', '', 'Tell the story of a trip.'),
      el('p', '', 'Start a story, then click your photos on the map in the order you went. A red string joins them, like a board on the wall.'));
    box.append(p);
  }
  for (const s of all) {
    const on = activeStory === s.name;
    const item = el('article', 'story' + (on ? ' on' : ''));
    const head = el('button', 'st-title');
    const first = s.cards[0], last = s.cards[s.cards.length - 1];
    const when = [fmtDate(first, { month: 'short', year: 'numeric' }), fmtDate(last, { month: 'short', year: 'numeric' })]
      .filter((v, i, a) => v && a.indexOf(v) === i).join(' – ');
    head.append(el('span', 'st-name', s.name), el('span', 'st-sub', `${s.cards.length} ${s.cards.length === 1 ? 'stop' : 'stops'}${when ? ' · ' + when : ''}`));
    head.onclick = () => selectStory(on ? null : s.name);
    item.append(head);
    const route = routeText(s.cards);
    if (route) item.append(el('p', 'st-route', route));
    const thumbs = el('div', 'st-thumbs');
    s.cards.slice(0, 7).forEach(c => { const im = new Image(); im.src = c.img!; im.alt = ''; im.className = 'look-' + c.look; thumbs.append(im); });
    item.append(thumbs);
    const actions = el('div', 'st-actions');
    const play = el('button', 'btn small primary', 'Play'); play.onclick = () => playStory(s.name);
    const add = el('button', 'btn small', connecting === s.name ? 'Adding…' : 'Add stops'); add.onclick = () => startConnect(s.name);
    actions.append(play, add);
    if (signedIn) {
      const all = s.cards.every(c => c.shared);
      const sh = el('button', 'btn small' + (all ? ' on' : ''), all ? 'Shared with friends' : 'Share with friends');
      sh.onclick = () => { s.cards.forEach(c => { c.shared = !all; }); save(); render(); };
      actions.append(sh);
    }
    item.append(actions);
    if (on) item.append(storyEditor(s));
    box.append(item);
  }
  const fs = friendStories();
  if (fs.length) box.append(el('h3', 'st-section', 'Friends’ stories'));
  for (const s of fs) {
    const item = el('article', 'story friend');
    item.append(el('span', 'st-name', s.name), el('span', 'st-sub', `by ${nameOf(s.owner)} · ${s.cards.length} ${s.cards.length === 1 ? 'stop' : 'stops'}`));
    const route = routeText(s.cards);
    if (route) item.append(el('p', 'st-route', route));
    const thumbs = el('div', 'st-thumbs');
    s.cards.slice(0, 7).forEach(c => { const im = new Image(); im.src = c.img!; im.alt = ''; im.className = 'look-' + c.look; thumbs.append(im); });
    const actions = el('div', 'st-actions');
    const play = el('button', 'btn small friend-play', 'Play'); play.onclick = () => playList(s.cards, 'f:' + s.owner + ':' + s.name, s.name);
    actions.append(play);
    item.append(thumbs, actions);
    box.append(item);
  }
}
function storyEditor(s: Story): HTMLElement {
  const wrap = el('div', 'st-edit');
  const ol = el('ol', 'st-stops');
  s.cards.forEach((c, i) => {
    const li = el('li');
    const im = new Image(); im.src = c.img!; im.alt = '';
    const txt = el('button', 'stop-txt');
    txt.append(el('b', '', c.title || 'Untitled'), el('span', '', [placeName(c) || 'Not on the map', fmtDate(c)].filter(Boolean).join(' · ')));
    txt.onclick = () => openCard(c);
    const move = (d: number) => {
      const list = [...s.cards]; const j = i + d; if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]]; renumber(s.name, list); save(); render();
    };
    const up = el('button', 'mini', '↑'); up.setAttribute('aria-label', 'Move earlier'); up.onclick = () => move(-1); up.disabled = i === 0;
    const down = el('button', 'mini', '↓'); down.setAttribute('aria-label', 'Move later'); down.onclick = () => move(1); down.disabled = i === s.cards.length - 1;
    const rm = el('button', 'mini', '✕'); rm.setAttribute('aria-label', 'Take out of this story');
    rm.onclick = () => { c.trip = ''; c.seq = 0; renumber(s.name, s.cards.filter(x => x !== c)); save(); render(); };
    li.append(el('span', 'stop-n', String(i + 1)), im, txt, up, down, rm);
    ol.append(li);
  });
  const foot = el('div', 'st-foot');
  const rename = el('button', 'linkbtn', 'Rename');
  rename.onclick = () => {
    const input = el('input', 'plain') as HTMLInputElement; input.value = s.name; input.setAttribute('aria-label', 'Story name');
    foot.replaceChildren(input); input.focus(); input.select();
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      const v = input.value.trim();
      if (v && v !== s.name) { s.cards.forEach(c => { c.trip = v; }); activeStory = v; save(); }
      render();
    };
    input.onkeydown = e => { if (e.key === 'Enter') finish(); if (e.key === 'Escape') { done = true; render(); } };
    input.onblur = finish;
  };
  const del = el('button', 'linkbtn danger', 'Delete story');
  del.onclick = () => {
    if (del.dataset.sure) { s.cards.forEach(c => { c.trip = ''; c.seq = 0; }); activeStory = null; save(); render(); return; }
    del.dataset.sure = '1'; del.textContent = 'Photos stay. Delete the story?';
  };
  foot.append(rename, del);
  wrap.append(ol, foot);
  return wrap;
}
function selectStory(name: string | null) {
  activeStory = name;
  render();
  if (name) fitCards(storyOf(name), 7);
}

$('newStory').onclick = () => { const f = $('newStoryForm'); f.hidden = !f.hidden; if (!f.hidden) $('newStoryName').focus(); };
$('newStoryForm').onsubmit = e => {
  e.preventDefault();
  const name = $<HTMLInputElement>('newStoryName').value.trim(); if (!name) return;
  $<HTMLInputElement>('newStoryName').value = ''; $('newStoryForm').hidden = true;
  if (cur) { addToStory(cur, name); save(); }
  startConnect(name);
};
$('storiesHide').onclick = () => { $('stories').hidden = true; $('storiesShow').hidden = false; lsSet('wf-stories', '0'); };
$('storiesShow').onclick = () => { $('stories').hidden = false; $('storiesShow').hidden = true; lsSet('wf-stories', '1'); };

function connectText() {
  if (!connecting) return;
  const n = storyOf(connecting).length;
  $('connectText').textContent = `Click photos in the order you went to add them to “${connecting}”. ${n} ${n === 1 ? 'stop' : 'stops'} so far.`;
}
function startConnect(name: string) {
  stopPlay(); stopPinning();
  connecting = name; activeStory = name;
  closeDrawerQuiet();
  document.body.classList.add('connecting');
  $('connectBar').hidden = false; connectText(); render();
}
function stopConnect() {
  if (!connecting) return;
  connecting = null; document.body.classList.remove('connecting'); $('connectBar').hidden = true; render();
}
$('connectDone').onclick = stopConnect;

// ---------- loose photos (not on the map yet), a day at a time ----------
const DAY = 864e5;
function nearestPlaced(group: Card[]): Card | null {
  const t = timeOf(group[0]); if (!t) return null;
  let best: Card | null = null, bd = 5 * DAY;
  for (const c of cards) {
    if (!placed(c) || !timeOf(c)) continue;
    const d = Math.abs(timeOf(c) - t);
    if (d <= bd) { bd = d; best = c; }
  }
  return best;
}
let trayOpen = true;
function renderTray() {
  const loose = cards.filter(c => c.img && !placed(c));
  $('tray').hidden = !loose.length;
  if (!loose.length) return;
  $('trayTitle').textContent = `${loose.length} ${loose.length === 1 ? 'photo isn’t' : 'photos aren’t'} on the map yet`;
  $('trayToggle').textContent = trayOpen ? '–' : '+';
  const list = $('trayList'); list.innerHTML = ''; list.hidden = !trayOpen;
  const days = new Map<string, Card[]>();
  for (const c of loose) { const d = dayOf(c); (days.get(d) ?? days.set(d, []).get(d)!).push(c); }
  [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([day, group]) => {
    const g = el('div', 'tray-group');
    const thumbs = el('div', 'tray-thumbs');
    group.slice(0, 5).forEach(c => {
      const b = el('button', 'tray-photo'); b.setAttribute('aria-label', 'Open ' + (c.title || 'photo'));
      const im = new Image(); im.src = c.img!; im.alt = ''; im.className = 'look-' + c.look; b.append(im);
      b.onclick = () => openCard(c); thumbs.append(b);
    });
    const label = el('span', 'tray-day', day ? new Date(day + 'T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'No date');
    const row = el('div', 'tray-actions');
    const near = nearestPlaced(group);
    if (near) {
      const b = el('button', 'btn small primary', `Put at ${placeName(near) || 'nearest photo'}`);
      b.title = 'Taken around the same time as ' + (near.title || 'another photo');
      b.onclick = async () => {
        for (const c of group) { c.lat = near.lat; c.lng = near.lng; c.place = near.place; if (!c.trip && near.trip) addToStory(c, near.trip); }
        await save(); render();
      };
      row.append(b);
    }
    const pin = el('button', 'btn small', group.length > 1 ? `Pin all ${group.length}` : 'Pin on map');
    pin.onclick = () => startPinning(group);
    row.append(pin);
    g.append(thumbs, label, row); list.append(g);
  });
}
$('trayToggle').onclick = () => { trayOpen = !trayOpen; renderTray(); };

// ---------- everything that depends on the cards ----------
function render() {
  renderMap(); renderStrings(); renderStories(); renderTray();
  const dl = $('tripList'); dl.innerHTML = '';
  stories().forEach(s => dl.append(new Option(s.name)));
}
const q = $<HTMLInputElement>('q');
q.oninput = () => { query = q.value.trim(); render(); };

// ---------- map style ----------
const themeSel = $<HTMLSelectElement>('themeSel');
for (const [k, t] of Object.entries(THEMES)) themeSel.append(new Option(t.name, k));
themeSel.value = themeName;
themeSel.onchange = () => { world.setTheme(themeSel.value as ThemeName); lsSet('wf-theme', themeSel.value); };
document.addEventListener('click', e => {
  const m = document.querySelector<HTMLDetailsElement>('.menu');
  if (m?.open && !m.contains(e.target as Node)) m.open = false;
});

// ---------- upload ----------
function pick(c: Card | null) { pickTarget = c; picker.multiple = !c; picker.value = ''; picker.click(); }
$('addBtn').onclick = $('emptyAdd').onclick = () => pick(null);

picker.onchange = async () => {
  const files = [...(picker.files ?? [])]; if (!files.length) return;
  const made: Card[] = [];
  for (const f of files) {
    let c = pickTarget;
    if (!c) { c = blankCard(cards.length); cards.push(c); }
    try {
      if (c.img) await cloud.dropImage(c);
      await fillCard(c, f);
      if (placed(c) && (!c.place || c.place === 'From photo GPS')) { await loadCities(); c.place = nameAt(c.lat!, c.lng!) ?? c.place; }
      made.push(c);
    } catch {
      alert(`Could not read ${f.name}`);
      if (!c.img) cards.splice(cards.indexOf(c), 1);
    }
  }
  await save(); render();
  if (made.length === 1) openCard(made[0]);
  else if (made.length) fitCards(made);
};

// ---------- photo panel ----------
function buildSwatches() {
  const sw = $('swatches'); sw.innerHTML = '';
  PIN_COLORS.forEach(col => {
    const b = el('button', 'sw' + (cur && cur.pinColor === col ? ' on' : ''));
    b.style.background = col || 'radial-gradient(circle at 35% 30%,#ff8a7a,#c8372d 60%)';
    b.setAttribute('aria-label', 'Pin colour ' + (col || 'red'));
    b.onclick = () => { if (!cur) return; cur.pinColor = col; save(); renderMap(); markSelected(); buildSwatches(); };
    sw.append(b);
  });
}
function drawLookAndStamp(c: Card) {
  $<HTMLImageElement>('dImg').className = 'look-' + c.look;
  const st = $('dStamp'); st.hidden = !(c.stamp && c.date); st.textContent = stampText(c);
}
function drawMeta(c: Card) {
  $('dMeta').textContent = [c.place || 'Not on the map yet', fmtDate(c)].filter(Boolean).join(' · ');
}
function drawShotOn(c: Card) {
  const m = c.meta || {}, box = $('shotOn'); box.innerHTML = '';
  box.append(el('span', 'so-label', 'Shot on'), el('b', 'so-cam', cameraName(c)));
  const chips = [m.exposure, m.aperture, m.iso ? 'ISO ' + m.iso : '', m.focal].filter(Boolean) as string[];
  if (chips.length) { const row = el('div', 'so-chips'); chips.forEach(t => row.append(el('span', '', t))); box.append(row); }
}
function drawStoryNav(c: Card) {
  const list = storyListOf(c);
  const i = list.indexOf(c);
  $('dStory').hidden = i < 0;
  if (i >= 0) $('dsText').textContent = `Stop ${i + 1} of ${list.length} · ${c.trip}`;
  const st = stackOf(c), j = st.findIndex(x => x.id === c.id);
  $('stack').hidden = st.length < 2;
  $('stText').textContent = `Photo ${j + 1} of ${st.length} at this spot`;
}

function openCard(c: Card, fly = true) {
  stopPlay(); stopPinning();
  cur = c;
  $('drawer').hidden = false;
  const ro = isFriendCard(c);   // friends' photos can be looked at and liked, not edited
  $('drawer').classList.toggle('ro', ro);
  fTitle.readOnly = ro; fStory.readOnly = ro;
  $('dOwner').hidden = !ro; $('dOwner').textContent = ro ? 'Shared by ' + nameOf(c.owner) : '';
  $('shareRow').hidden = !signedIn || ro; $<HTMLInputElement>('shareBox').checked = c.shared;
  const dImg = $<HTMLImageElement>('dImg'); dImg.src = c.img!; dImg.alt = c.title;
  $('photoBtn').style.setProperty('--rot', (c.rot / 2) + 'deg');
  fTitle.value = c.title; fStory.value = c.story; fDate.value = c.date; fPlace.value = c.place || '';
  fTripName.value = c.trip;
  $<HTMLInputElement>('coverBox').checked = c.cover;
  $<HTMLSelectElement>('lookSel').value = c.look; $<HTMLInputElement>('stampBox').checked = c.stamp;
  drawLike(); locNote(); buildSwatches(); drawLookAndStamp(c); drawShotOn(c); drawStoryNav(c); drawMeta(c);
  const m = c.meta || {};
  const meta = $('meta'); meta.innerHTML = '';
  for (const [k, v] of [['Size', m.size], ['File', m.file]] as [string, string | undefined][]) {
    if (v) meta.append(el('dt', '', k), el('dd', '', v));
  }
  markSelected();
  if (fly && placed(c)) flyTo(c);
}
function closeDrawerQuiet() { cur = null; $('drawer').hidden = true; markSelected(); }
function closeDrawer() { closeDrawerQuiet(); save(); }
$('dClose').onclick = closeDrawer;

const stepIn = (list: Card[], d: number) => {
  if (!cur) return;
  const i = list.indexOf(cur); if (i < 0) return;
  openCard(list[(i + d + list.length) % list.length]);
};
$('dsPrev').onclick = () => cur && stepIn(storyListOf(cur), -1);
$('dsNext').onclick = () => cur && stepIn(storyListOf(cur), 1);
const stackStep = (d: number) => {
  if (!cur) return;
  const s = stackOf(cur), i = s.findIndex(x => x.id === cur!.id);
  openCard(s[(i + d + s.length) % s.length], false);
};
$('stPrev').onclick = () => stackStep(-1);
$('stNext').onclick = () => stackStep(1);

/** Signed in, likes are real and shared; otherwise they're kept in this browser. */
const cloudLike = (c: Card) => signedIn && !!c.owner && !!c.imgPath;
function drawLike() {
  if (!cur) return;
  const v = cloudLike(cur) ? likeCache.get(cur.id) ?? { n: 0, mine: false } : { n: cur.likes, mine: cur.liked };
  $('likeBtn').classList.toggle('on', v.mine);
  $('likeBtn').firstChild!.textContent = v.mine ? '♥ ' : '♡ ';
  $('likeCount').textContent = String(v.n);
}
$('likeBtn').onclick = async () => {
  if (!cur) return;
  if (cloudLike(cur)) {
    const c = cur, v = { ...(likeCache.get(c.id) ?? { n: 0, mine: false }) };
    v.mine = !v.mine; v.n = Math.max(0, v.n + (v.mine ? 1 : -1)); likeCache.set(c.id, v); drawLike();
    cloud.setLike(c.id, v.mine).catch(() => { likeCache.set(c.id, { n: v.n + (v.mine ? -1 : 1), mine: !v.mine }); drawLike(); });
    return;
  }
  cur.liked = !cur.liked; cur.likes = Math.max(0, cur.likes + (cur.liked ? 1 : -1));
  drawLike(); await save();
};
$<HTMLInputElement>('shareBox').onchange = e => {
  if (!cur) return; cur.shared = (e.target as HTMLInputElement).checked; save(); renderStories();
};
fTitle.oninput = () => { if (cur) { cur.title = fTitle.value; saveSoon(); } };
fTitle.onchange = () => { render(); markSelected(); };
fStory.oninput = () => { if (cur) { cur.story = fStory.value; saveSoon(); } };
fDate.oninput = () => { if (cur) { cur.date = fDate.value; saveSoon(); drawLookAndStamp(cur); drawMeta(cur); } };
fTripName.onchange = () => {
  if (!cur) return;
  const v = fTripName.value.trim();
  if (!v) { const old = cur.trip; cur.trip = ''; cur.seq = 0; if (old) renumber(old, storyOf(old)); } else addToStory(cur, v);
  save(); render(); drawStoryNav(cur); markSelected();
};
$<HTMLInputElement>('coverBox').onchange = e => {
  if (!cur) return;
  const on = (e.target as HTMLInputElement).checked;
  if (on && placed(cur)) cards.filter(c => placed(c) && placeKey(c) === placeKey(cur!)).forEach(c => { c.cover = false; });
  cur.cover = on; save(); renderMap(); markSelected();
};
$<HTMLSelectElement>('lookSel').onchange = e => {
  if (!cur) return; cur.look = (e.target as HTMLSelectElement).value as Look; save(); drawLookAndStamp(cur); render(); markSelected();
};
$<HTMLInputElement>('stampBox').onchange = e => {
  if (!cur) return; cur.stamp = (e.target as HTMLInputElement).checked; save(); drawLookAndStamp(cur);
};

$('replaceBtn').onclick = () => pick(cur);
const del = $('deleteBtn');
del.onclick = async () => {
  if (!cur) return;
  if (!del.dataset.sure) {
    del.dataset.sure = '1'; del.textContent = 'Really remove?';
    setTimeout(() => { delete del.dataset.sure; del.textContent = 'Remove'; }, 3000); return;
  }
  delete del.dataset.sure; del.textContent = 'Remove';
  const old = cur.trip;
  if (signedIn) cloud.removeRemote(cur).catch(() => { /* removed locally either way */ });
  cards.splice(cards.indexOf(cur), 1); cur = null;
  if (old) renumber(old, storyOf(old));
  $('drawer').hidden = true; await save(); render();
};

// ---------- location ----------
function locNote() {
  if (!cur) return;
  $('locNote').textContent = placed(cur) ? `Pinned at ${cur.lat!.toFixed(4)}, ${cur.lng!.toFixed(4)}`
    : 'The DSC-V1 has no GPS. Search a city, or pin it on the map yourself.';
}
/** Names a point from the map's own city list, so nothing is sent to an outside service. */
async function reverse(lat: number, lng: number): Promise<string> {
  await loadCities();
  return nameAt(lat, lng) ?? countryAt(lat, lng) ?? '';
}
async function findPlace() {
  const text = fPlace.value.trim(); if (!text || !cur) return;
  const c = cur;
  await loadCities();
  const hits = searchPlaces(text, 6);
  const h = hits.find(x => x.label === text) ?? hits[0];
  if (!h) { $('locNote').textContent = 'No city found with that name. Try another spelling, or pin it on the map.'; return; }
  c.lat = h.lat; c.lng = h.lng; c.place = h.short; fPlace.value = h.short;
  save(); render(); locNote(); drawStoryNav(c); drawMeta(c); markSelected();
  flyTo(c);
}
$('placeBtn').onclick = findPlace;
fPlace.onkeydown = e => { if (e.key === 'Enter') findPlace(); };
fPlace.oninput = async () => {
  await loadCities();
  const dl = $('placeList'); dl.innerHTML = '';
  searchPlaces(fPlace.value, 6).forEach(p => dl.append(new Option(p.label)));
};

function startPinning(targets: Card[]) {
  stopConnect();
  pinTargets = targets; document.body.classList.add('pinning');
  $('pinText').textContent = targets.length > 1 ? `Click the map where these ${targets.length} photos were taken` : 'Click the map where this photo was taken';
  $('pinBanner').hidden = false;
  if (!wide()) $('drawer').hidden = true;
}
function stopPinning() {
  if (!pinTargets.length && $('pinBanner').hidden) return;
  pinTargets = []; document.body.classList.remove('pinning'); $('pinBanner').hidden = true;
  if (cur) $('drawer').hidden = false;
}
$('pinBtn').onclick = () => { if (cur) startPinning([cur]); };
$('pinCancel').onclick = stopPinning;
$('exactBtn').onclick = () => { if (cur && placed(cur)) flyTo(cur, 13); };
$('clearLoc').onclick = () => {
  if (!cur) return;
  cur.lat = cur.lng = null; cur.place = ''; fPlace.value = '';
  render(); locNote(); drawStoryNav(cur); drawMeta(cur); save();
};

// ---------- playing a story: the string draws itself stop by stop ----------
const pl = { story: '', key: '', list: [] as Card[], i: 0, timer: 0, paused: false, on: false };
let focusCard: () => Card | null = () => cur;
function stopPlay() {
  if (!pl.on) return;
  clearTimeout(pl.timer); pl.on = false; $('playCard').hidden = true;
  focusCard = () => cur; renderStrings(); markSelected();
}
function playStep(i: number) {
  if (i >= pl.list.length) { stopPlay(); return; }
  pl.i = Math.max(0, i); clearTimeout(pl.timer);
  const c = pl.list[pl.i];
  focusCard = () => c;
  const img = $<HTMLImageElement>('pcImg'); img.src = c.img!; img.className = 'look-' + c.look;
  $('pcTitle').textContent = c.title || 'Untitled';
  $('pcWhere').textContent = [placeName(c), fmtDate(c)].filter(Boolean).join(' · ');
  $('pcCount').textContent = `Stop ${pl.i + 1} of ${pl.list.length} · ${pl.story}`;
  const prev = pl.list[pl.i - 1];
  const far = prev ? map.distance([prev.lat!, prev.lng!], [c.lat!, c.lng!]) : 0;
  map.flyTo([c.lat!, c.lng!], far > 3e6 ? 4 : far > 6e5 ? 5 : 7, { duration: 2.4 });
  renderStrings(); markSelected();
  if (!pl.paused) pl.timer = window.setTimeout(() => playStep(pl.i + 1), 5000);
}
function playStory(name: string) { playList(storyOf(name), 'own:' + name, name); }
function playList(cards0: Card[], key: string, label: string) {
  const list = cards0.filter(placed);
  if (!list.length) return;
  stopConnect(); closeDrawerQuiet();
  activeStory = key.startsWith('own:') ? label : null; render();
  Object.assign(pl, { story: label, key, list, i: 0, paused: false, on: true });
  $('playCard').hidden = false; $('pcPause').textContent = '❚❚';
  playStep(0);
}
$('pcStop').onclick = stopPlay;
$('pcPrev').onclick = () => playStep(Math.max(0, pl.i - 1));
$('pcNext').onclick = () => playStep(pl.i + 1);
$('pcPause').onclick = () => {
  pl.paused = !pl.paused; $('pcPause').textContent = pl.paused ? '▶' : '❚❚';
  clearTimeout(pl.timer); if (!pl.paused) pl.timer = window.setTimeout(() => playStep(pl.i + 1), 1500);
};

// ---------- poster ----------
const posterCv = $<HTMLCanvasElement>('posterCv');
const posterTitle = $<HTMLInputElement>('posterTitle');
let posterT: number;
function drawPoster() {
  const list = activeStory ? storyOf(activeStory) : cards.filter(visible);
  const countries = new Set(list.map(countryOf).filter(Boolean)).size;
  renderPoster(posterCv, list, posterTitle.value.trim(), themeSel.value as ThemeName, null, countries);
}
$('posterBtn').onclick = () => {
  (document.querySelector('.menu') as HTMLDetailsElement).open = false;
  if (activeStory) posterTitle.value = activeStory;
  $('posterModal').hidden = false; drawPoster();
};
posterTitle.oninput = () => { clearTimeout(posterT); posterT = window.setTimeout(drawPoster, 300); };
$('posterClose').onclick = () => { $('posterModal').hidden = true; };
$('posterSave').onclick = () => {
  posterCv.toBlob(b => {
    if (!b) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'wayframe-poster.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
};

// ---------- viewer + keys ----------
initViewer();
$('photoBtn').onclick = () => { if (cur?.img) openViewer(cur.img, 'look-' + cur.look); };
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('acctModal').hidden) $('acctModal').hidden = true;
  else if (!$('posterModal').hidden) $('posterModal').hidden = true;
  else if (viewerIsOpen()) closeViewer();
  else if (pinTargets.length) stopPinning();
  else if (connecting) stopConnect();
  else if (pl.on) stopPlay();
  else if (!$('drawer').hidden) closeDrawer();
  else if (activeStory) selectStory(null);
});

// ---------- export / import ----------
$('exportBtn').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(cards)], { type: 'application/json' }));
  a.download = 'wayframe.json'; a.click();
};
$<HTMLInputElement>('importFile').onchange = async e => {
  const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text()); if (!Array.isArray(d)) throw 0;
    cards = d.map(normalize).filter(c => c.img); await save(); render(); fitCards(cards);
  } catch { alert('That file is not a Wayframe export.'); }
};

// ---------- account: email sign-in, friends from contacts ----------
const acctBtn = $('acctBtn');
let pendingEmail = '';
function renderAcct() {
  acctBtn.hidden = !cloud.cloudEnabled;
  acctBtn.textContent = signedIn ? (myName.trim()[0] || '☺').toUpperCase() : 'Sign in';
  acctBtn.classList.toggle('avatar', signedIn);
  acctBtn.setAttribute('aria-label', signedIn ? 'Your account' : 'Sign in');
  $('signIn').hidden = signedIn; $('account').hidden = !signedIn;
  const email = cloud.me()?.email;
  $('acctEmail').textContent = email ? 'Signed in as ' + email : '';
}
acctBtn.onclick = () => { $('acctModal').hidden = false; if (signedIn) renderPeople(); else $('phoneIn').focus(); };
$('acctClose').onclick = () => { $('acctModal').hidden = true; };
const authMsg = (t: string) => { $('authMsg').textContent = t; };
$('phoneForm').onsubmit = async e => {
  e.preventDefault();
  pendingEmail = $<HTMLInputElement>('phoneIn').value;
  authMsg('Sending…');
  try {
    await cloud.sendCode(pendingEmail);
    $('phoneForm').hidden = true; $('codeForm').hidden = false; $('codeIn').focus();
    authMsg(`We emailed a code to ${cloud.cleanEmail(pendingEmail)}. You can also tap the link in that email.`);
  } catch (err) { authMsg('Couldn’t send the code: ' + (err as Error).message); }
};
$('codeForm').onsubmit = async e => {
  e.preventDefault();
  authMsg('Checking…');
  try { await cloud.verifyCode(pendingEmail, $<HTMLInputElement>('codeIn').value); authMsg(''); }
  catch (err) { authMsg('That code didn’t work: ' + (err as Error).message); }
};
$('codeBack').onclick = () => { $('codeForm').hidden = true; $('phoneForm').hidden = false; authMsg(''); };
$('nameSave').onclick = async () => {
  try { await cloud.setMyName($<HTMLInputElement>('nameIn').value); myName = $<HTMLInputElement>('nameIn').value.trim(); renderAcct(); syncNote('Name saved.'); }
  catch (err) { syncNote('Couldn’t save your name: ' + (err as Error).message); }
};
$('signOutBtn').onclick = async () => { await cloud.signOut(); $('acctModal').hidden = true; };
const showFriendsBox = $<HTMLInputElement>('showFriends');
showFriendsBox.checked = showFriends;
showFriendsBox.onchange = () => { showFriends = showFriendsBox.checked; lsSet('wf-friends', showFriends ? '1' : '0'); render(); };

function person(p: cloud.Person, action: HTMLElement) {
  const row = el('div', 'person');
  row.append(el('span', 'ava', (p.display_name.trim()[0] || '?').toUpperCase()), el('span', 'p-name', p.display_name || 'No name yet'), action);
  return row;
}
function renderPeople() {
  const list = $('friendList'); list.innerHTML = '';
  if (!friends.length) list.append(el('p', 'hint', 'You aren’t following anyone yet. Find friends below.'));
  for (const f of friends) {
    const b = el('button', 'linkbtn', 'Unfollow');
    b.onclick = async () => { await cloud.unfollow(f.id); await refreshFriends(); };
    list.append(person(f, b));
  }
}
$('findBtn').onclick = async () => {
  const lines = $<HTMLTextAreaElement>('numbersIn').value.split(/[\s,;]+/);
  const out = $('matchList'); out.innerHTML = '';
  try {
    const found = await cloud.matchContacts(lines);
    if (!found.length) { out.append(el('p', 'hint', 'None of those addresses use Wayframe yet. Send them the invite link.')); return; }
    for (const p of found) {
      const already = friends.some(f => f.id === p.id);
      const b = el('button', 'btn small' + (already ? '' : ' primary'), already ? 'Following' : 'Follow');
      b.onclick = async () => { await cloud.follow(p.id); b.textContent = 'Following'; b.className = 'btn small'; await refreshFriends(); };
      out.append(person(p, b));
    }
  } catch (err) { out.append(el('p', 'hint', 'Couldn’t check those addresses: ' + (err as Error).message)); }
};
// The Contact Picker only exists in Chrome on Android; elsewhere people paste numbers.
const contactsApi = (navigator as any).contacts;
$('pickContacts').hidden = !(contactsApi && 'select' in contactsApi);
$('pickContacts').onclick = async () => {
  try {
    const picked: { email?: string[] }[] = await contactsApi.select(['email'], { multiple: true });
    const nums = picked.flatMap(p => p.email ?? []);
    const ta = $<HTMLTextAreaElement>('numbersIn');
    ta.value = [ta.value.trim(), ...nums].filter(Boolean).join('\n');
    $('findBtn').click();
  } catch { /* closed the picker */ }
};
$('inviteBtn').onclick = async () => {
  const link = location.origin;
  try { await navigator.clipboard.writeText(link); $('inviteBtn').textContent = 'Link copied'; }
  catch { $('inviteBtn').textContent = link; }
  setTimeout(() => { $('inviteBtn').textContent = 'Copy invite link'; }, 2500);
};

async function refreshFriends() {
  try {
    friends = await cloud.following();
    friendCards = await cloud.friendPhotos(friends.map(f => f.id));
    const info = await cloud.likeInfo([...cards.filter(c => c.imgPath).map(c => c.id), ...friendCards.map(c => c.id)]);
    likeCache.clear(); info.forEach((v, k) => likeCache.set(k, v));
  } catch (err) { console.warn('Could not load friends', err); }
  render(); renderPeople();
  if (cur) drawLike();
}
async function onAuth(s: boolean) {
  signedIn = s;
  if (!s) {
    myName = ''; friends = []; friendCards = []; likeCache.clear();
    $('phoneForm').hidden = false; $('codeForm').hidden = true;
    renderAcct(); render(); return;
  }
  renderAcct();
  myName = await cloud.myName().catch(() => '');
  $<HTMLInputElement>('nameIn').value = myName;
  renderAcct();
  if (!myName) { $('acctModal').hidden = false; $('nameIn').focus(); syncNote('Add your name so friends know it’s you.'); }
  try {
    const mine = await cloud.pullMine(new Set(cards.map(c => c.id)));
    if (mine.length) { cards.push(...mine); await saveCards(cards); }
    await cloud.push(cards); await saveCards(cards);
    syncNote(mine.length ? `Brought in ${mine.length} photos from your account.` : 'Your photos are saved to your account.');
  } catch (err) { syncNote('Couldn’t sync your photos: ' + (err as Error).message); }
  await refreshFriends();
}
setInterval(() => { if (signedIn) refreshFriends(); }, 45 * 60 * 1000);   // signed image links last an hour

// ---------- start ----------
(async () => {
  if (lsGet('wf-stories') === '0' || !wide()) { $('stories').hidden = true; $('storiesShow').hidden = false; }
  await openStore();
  const saved = await loadCards();
  // older boards kept empty placeholder cards; the map has no use for them
  cards = (saved ?? []).map(normalize).filter(c => c.img);
  render();
  fitCards(cards, 5);
  document.fonts.ready.then(() => map.fire('moveend'));
  renderAcct();
  cloud.initAuth(onAuth).catch(err => console.warn('Sign-in unavailable', err));
})();
