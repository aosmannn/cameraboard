import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/caveat/500.css';
import '@fontsource/caveat/700.css';
import '@fontsource/vt323/400.css';
import './style.css';
import type { Card, Look } from './types';
import { openStore, loadCards, saveCards } from './storage';
import { blankCard, fillCard, normalize, cameraName, dayOf, timeOf, stampText, placeKey } from './photo';
import { drawWorld, countryAt, THEMES, type ThemeName } from './world';
import { loadCities, searchPlaces, nameAt } from './atlas';
import { initViewer, openViewer, closeViewer, viewerIsOpen } from './viewer';
import { filters, matches, activeCount, clearFilters } from './filters';
import { renderStats } from './stats';
import { renderPoster } from './poster';

const SLOTS = 12;
const COLORS = ['', '#e4572e', '#2f7dd1', '#2e9e5b', '#e8b422', '#8e44ad', '#111111'];
const ICONS = ['', '❤️', '⭐', '🏖️', '🍜', '⛰️', '🏛️', '🎉', '📷'];
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const wide = () => window.matchMedia('(min-width:801px)').matches;
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

let cards: Card[] = [];
let cur: Card | null = null;
let pinTargets: Card[] = [];
let pickTarget: Card | null = null;
let highlight = lsGet('cb-hl') !== '0';
let view: 'map' | 'board' | 'stats' = 'map';

const save = () => saveCards(cards);
let saveT: number;
const saveSoon = () => { clearTimeout(saveT); saveT = window.setTimeout(save, 400); };
const placed = (c: Card) => !!c.img && c.lat != null && c.lng != null;

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
const visible = (c: Card) => !!c.img && matches(c, countryOf(c));
const visiblePlaced = () => cards.filter(c => placed(c) && visible(c));
const byDate = (a: Card, b: Card) => (timeOf(a) || Infinity) - (timeOf(b) || Infinity);

/** Photos at the same place as `c`, oldest first. */
const stackOf = (c: Card) => placed(c) ? visiblePlaced().filter(x => placeKey(x) === placeKey(c)).sort(byDate) : [c];

// ---------- map ----------
const themeName = ((): ThemeName => { const t = lsGet('cb-theme'); return t && t in THEMES ? t as ThemeName : 'classic'; })();
const map = L.map('map', { zoomControl: false, minZoom: 2, maxZoom: 10, preferCanvas: true,
  maxBounds: [[-60, -180], [84, 180]], maxBoundsViscosity: 1 }).setView([25, 10], 2);
L.control.zoom({ position: 'topleft' }).addTo(map);
const world = drawWorld(map, themeName);
map.attributionControl.setPrefix('').addAttribution('Map: Natural Earth');

const cluster = L.markerClusterGroup({
  showCoverageOnHover: false, maxClusterRadius: 50,
  iconCreateFunction: c => L.divIcon({ html: `<div class="cl">${c.getChildCount()}</div>`, className: '', iconSize: [44, 44] })
});
map.addLayer(cluster);
const markers = new Map<string, L.Marker>();
let focusCard: () => Card | null = () => cur;   // card whose pin is highlighted (playback overrides)

map.on('click', async e => {
  if (!pinTargets.length) return;
  const targets = pinTargets;
  for (const c of targets) { c.lat = e.latlng.lat; c.lng = e.latlng.lng; }
  stopPinning(); render(); locNote();
  const name = await reverse(e.latlng.lat, e.latlng.lng) || 'Dropped pin';
  for (const c of targets) c.place = name;
  if (cur && targets.includes(cur)) fPlace.value = name;
  save(); renderQueue();
});

function pinElement(rep: Card, n: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'mk';
  if (rep.pinColor) el.style.setProperty('--pc', rep.pinColor);
  const im = new Image(); im.src = rep.img!; im.alt = rep.title;
  el.append(im, document.createElement('i'));
  if (rep.pinIcon) { const s = document.createElement('span'); s.className = 'mk-ic'; s.textContent = rep.pinIcon; el.append(s); }
  if (n > 1) { const s = document.createElement('span'); s.className = 'mk-n'; s.textContent = String(n); el.append(s); }
  return el;
}

function renderMap() {
  cluster.clearLayers(); markers.clear();
  const groups = new Map<string, Card[]>();
  for (const c of visiblePlaced()) { const k = placeKey(c); (groups.get(k) ?? groups.set(k, []).get(k)!).push(c); }
  groups.forEach((g, k) => {
    g.sort(byDate);
    const rep = g.find(c => c.cover) ?? g[0];
    const el = pinElement(rep, g.length);
    const f = focusCard();
    if (f && placed(f) && placeKey(f) === k) el.classList.add('sel');
    const m = L.marker([rep.lat!, rep.lng!], {
      icon: L.divIcon({ html: el, className: '', iconSize: [56, 66], iconAnchor: [28, 66] }), title: rep.title });
    m.on('click', () => openCard(rep));
    markers.set(k, m); cluster.addLayer(m);
  });
  $('empty').hidden = cards.some(c => c.img);
}
function markSelected() {
  const f = focusCard(), key = f && placed(f) ? placeKey(f) : '';
  markers.forEach((m, k) => {
    const e = m.getElement();
    if (e && e.firstElementChild) e.firstElementChild.classList.toggle('sel', k === key);
  });
}
function fitAll() {
  const pts = visiblePlaced().map(c => [c.lat!, c.lng!] as L.LatLngTuple);
  if (pts.length) map.fitBounds(pts, { padding: [80, 80], maxZoom: 6 });
}
function flyTo(c: Card, zoom = 8) {
  const pad = wide() ? { paddingBottomRight: L.point(420, 0) } : { paddingBottomRight: L.point(0, window.innerHeight * 0.7) };
  map.flyToBounds(L.latLngBounds([[c.lat!, c.lng!]]), { ...pad, maxZoom: Math.max(map.getZoom(), zoom), duration: 1.2 });
  map.once('moveend', () => { const m = markers.get(placeKey(c)); if (m) cluster.zoomToShowLayer(m, markSelected); });
}

function renderStrip() {
  const s = $('strip'); s.innerHTML = '';
  const unplaced = cards.filter(c => c.img && !placed(c));
  if (unplaced.length) {
    const b = document.createElement('button');
    b.className = 'chip queue-chip'; b.textContent = `Place me (${unplaced.length})`;
    b.onclick = () => openQueue(); s.append(b);
  }
  for (const c of cards.filter(visible)) {
    const b = document.createElement('button');
    b.className = 'chip' + (placed(c) ? '' : ' unplaced') + (cur && cur.id === c.id ? ' on' : '');
    const im = new Image(); im.src = c.img!; im.alt = ''; im.className = 'look-' + c.look;
    const t = document.createElement('small'); t.textContent = placed(c) ? (c.title || 'Untitled') : 'Place me';
    b.append(im, t); b.onclick = () => openCard(c); s.append(b);
  }
}

// ---------- board view ----------
function renderBoard() {
  const board = $('board'); board.innerHTML = '';
  const filtering = activeCount() > 0;
  for (const c of cards) {
    if (c.img ? !visible(c) : filtering) continue;
    const el = document.createElement('article');
    el.className = 'card' + (c.img ? '' : ' blank');
    el.tabIndex = 0;
    el.style.setProperty('--rot', c.rot + 'deg'); el.style.setProperty('--pin', c.pin);
    el.innerHTML = '<i class="pin"></i><div class="thumb"></div><div class="cap"><span></span><span class="lk"></span></div>';
    const th = el.querySelector('.thumb')!;
    if (c.img) {
      const im = new Image(); im.src = c.img; im.alt = c.title; im.className = 'look-' + c.look; th.append(im);
      if (c.stamp && c.date) { const s = document.createElement('span'); s.className = 'stamp'; s.textContent = stampText(c); th.append(s); }
    } else th.innerHTML = '<div><b>＋</b>Add a photo</div>';
    const [t, lk] = el.querySelectorAll('.cap span');
    t.textContent = c.img ? (c.title || 'Untitled') : '';
    lk.textContent = c.img && c.likes ? '♥ ' + c.likes : '';
    const act = () => c.img ? openCard(c) : pick(c);
    el.onclick = act; el.onkeydown = e => { if (e.key === 'Enter') act(); };
    board.append(el);
  }
}

// ---------- everything that depends on the cards ----------
function visitedSet(): Set<string> {
  return new Set(cards.filter(c => c.img).map(countryOf).filter((x): x is string => !!x));
}
function refreshChrome() {
  const v = visitedSet();
  world.setVisited(highlight ? v : null);
  const h = $('hlBtn'); h.textContent = `${v.size} ${v.size === 1 ? 'country' : 'countries'}`; h.classList.toggle('on', highlight);
  // filter menus and trip suggestions
  const fill = (id: string, label: string, vals: string[], cur: string) => {
    const s = $<HTMLSelectElement>(id); s.innerHTML = '';
    s.append(new Option(label, ''));
    [...new Set(vals)].sort().forEach(v => s.append(new Option(v, v)));
    s.value = cur;
  };
  const imgs = cards.filter(c => c.img);
  fill('fTrip', 'All trips', imgs.map(c => c.trip).filter(Boolean), filters.trip);
  fill('fCamera', 'All cameras', imgs.map(cameraName), filters.camera);
  fill('fCountry', 'All countries', imgs.map(countryOf).filter((x): x is string => !!x), filters.country);
  const dl = $('tripList'); dl.innerHTML = '';
  [...new Set(imgs.map(c => c.trip).filter(Boolean))].forEach(t => dl.append(new Option(t)));
  const n = activeCount(), badge = $('filterCount');
  badge.hidden = !n; badge.textContent = String(n);
}
function render() {
  renderMap(); renderStrip(); renderBoard(); refreshChrome();
  if (view === 'stats') renderStats($('statsView'), cards, countryOf);
}

// ---------- views ----------
function setView(v: 'map' | 'board' | 'stats') {
  view = v;
  $('mapView').hidden = v !== 'map'; $('boardView').hidden = v !== 'board'; $('statsView').hidden = v !== 'stats';
  $('vMap').classList.toggle('on', v === 'map'); $('vBoard').classList.toggle('on', v === 'board'); $('vStats').classList.toggle('on', v === 'stats');
  if (v === 'map') setTimeout(() => map.invalidateSize(), 0);
  if (v === 'stats') renderStats($('statsView'), cards, countryOf);
  if (v !== 'map') stopPlay();
  lsSet('cb-view', v);
}
$('vMap').onclick = () => setView('map');
$('vBoard').onclick = () => setView('board');
$('vStats').onclick = () => setView('stats');

// ---------- search + filters ----------
const q = $<HTMLInputElement>('q');
q.oninput = () => { filters.q = q.value.trim(); render(); };
$('filterBtn').onclick = () => { const f = $('filters'); f.hidden = !f.hidden; setBarHeight(); };
const bindSel = (id: string, key: 'trip' | 'camera' | 'country') =>
  $<HTMLSelectElement>(id).onchange = e => { filters[key] = (e.target as HTMLSelectElement).value; render(); fitAll(); };
bindSel('fTrip', 'trip'); bindSel('fCamera', 'camera'); bindSel('fCountry', 'country');
$<HTMLInputElement>('fFrom').onchange = e => { filters.from = (e.target as HTMLInputElement).value; render(); };
$<HTMLInputElement>('fTo').onchange = e => { filters.to = (e.target as HTMLInputElement).value; render(); };
$('fClear').onclick = () => {
  clearFilters(); q.value = '';
  $<HTMLInputElement>('fFrom').value = ''; $<HTMLInputElement>('fTo').value = '';
  render();
};
function setBarHeight() {
  const h = document.querySelector<HTMLElement>('.bar')!.offsetHeight + ($('filters').hidden ? 0 : $('filters').offsetHeight);
  document.documentElement.style.setProperty('--bar', h + 'px');
}

// ---------- map tools: theme, highlight ----------
const themeSel = $<HTMLSelectElement>('themeSel');
for (const [k, t] of Object.entries(THEMES)) themeSel.append(new Option(t.name + ' map', k));
themeSel.value = themeName;
themeSel.onchange = () => { world.setTheme(themeSel.value as ThemeName); lsSet('cb-theme', themeSel.value); };
$('hlBtn').onclick = () => { highlight = !highlight; lsSet('cb-hl', highlight ? '1' : '0'); refreshChrome(); };

// ---------- upload ----------
function pick(c: Card | null) { pickTarget = c; picker.multiple = !c; picker.value = ''; picker.click(); }
$('addBtn').onclick = $('emptyAdd').onclick = () => pick(null);

picker.onchange = async () => {
  const files = [...(picker.files ?? [])]; if (!files.length) return;
  const made: Card[] = [];
  for (const f of files) {
    let c = pickTarget || cards.find(x => !x.img);
    if (!c) { c = blankCard(cards.length); cards.push(c); }
    try { await fillCard(c, f); made.push(c); } catch { alert(`Could not read ${f.name}`); }
  }
  await save(); render();
  if (made.length === 1) openCard(made[0]);
  else if (made.length) fitAll();
};

// ---------- drawer ----------
function buildSwatches() {
  const sw = $('swatches'); sw.innerHTML = '';
  COLORS.forEach(col => {
    const b = document.createElement('button');
    b.className = 'sw' + (cur && cur.pinColor === col ? ' on' : ''); b.title = col || 'Default';
    b.style.background = col || 'conic-gradient(#fff 0 50%,#ccc 0)'; b.setAttribute('aria-label', 'Pin colour ' + (col || 'default'));
    b.onclick = () => { if (!cur) return; cur.pinColor = col; save(); renderMap(); buildSwatches(); };
    sw.append(b);
  });
  const ic = $('icons'); ic.innerHTML = '';
  ICONS.forEach(i => {
    const b = document.createElement('button');
    b.className = 'ic' + (cur && cur.pinIcon === i ? ' on' : ''); b.textContent = i || '∅'; b.setAttribute('aria-label', 'Pin icon ' + (i || 'none'));
    b.onclick = () => { if (!cur) return; cur.pinIcon = i; save(); renderMap(); buildSwatches(); };
    ic.append(b);
  });
}
function drawLookAndStamp(c: Card) {
  const dImg = $<HTMLImageElement>('dImg'); dImg.className = 'look-' + c.look;
  const st = $('dStamp'); st.hidden = !(c.stamp && c.date); st.textContent = stampText(c);
}
function drawShotOn(c: Card) {
  const m = c.meta || {}, box = $('shotOn'); box.innerHTML = '';
  const lab = document.createElement('span'); lab.className = 'so-label'; lab.textContent = 'Shot on';
  const cam = document.createElement('b'); cam.className = 'so-cam'; cam.textContent = cameraName(c);
  box.append(lab, cam);
  const chips = [m.exposure, m.aperture, m.iso ? 'ISO ' + m.iso : '', m.focal].filter(Boolean) as string[];
  if (chips.length) {
    const row = document.createElement('div'); row.className = 'so-chips';
    chips.forEach(t => { const s = document.createElement('span'); s.textContent = t; row.append(s); });
    box.append(row);
  }
}
function drawStack(c: Card) {
  const st = stackOf(c), i = st.findIndex(x => x.id === c.id);
  $('stack').hidden = st.length < 2;
  $('stText').textContent = `Photo ${i + 1} of ${st.length} at this place`;
}

function openCard(c: Card, fly = true) {
  stopPlay();
  cur = c; stopPinning();
  $('drawer').hidden = false;
  const dImg = $<HTMLImageElement>('dImg'); dImg.src = c.img!; dImg.alt = c.title;
  fTitle.value = c.title; fStory.value = c.story; fDate.value = c.date; fPlace.value = c.place || '';
  fTripName.value = c.trip;
  $<HTMLInputElement>('coverBox').checked = c.cover;
  $<HTMLSelectElement>('lookSel').value = c.look; $<HTMLInputElement>('stampBox').checked = c.stamp;
  drawLike(); locNote(); buildSwatches(); drawLookAndStamp(c); drawShotOn(c); drawStack(c);
  const m = c.meta || {};
  const rows: [string, string | number | undefined][] = [['Size', m.size], ['File', m.file]];
  const meta = $('meta'); meta.innerHTML = '';
  for (const [k, v] of rows) {
    if (!v) continue;
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = k; dd.textContent = String(v); meta.append(dt, dd);
  }
  markSelected(); renderStrip();
  if (fly && placed(c) && view === 'map') flyTo(c);
}
function closeDrawer() { cur = null; stopPinning(); $('drawer').hidden = true; markSelected(); renderStrip(); save(); renderBoard(); }
$('dClose').onclick = closeDrawer;

const step = (d: number) => {
  if (!cur) return;
  const st = stackOf(cur), i = st.findIndex(x => x.id === cur!.id);
  openCard(st[(i + d + st.length) % st.length], false);
};
$('stPrev').onclick = () => step(-1);
$('stNext').onclick = () => step(1);

function drawLike() {
  if (!cur) return;
  $('likeBtn').classList.toggle('on', cur.liked);
  $('likeBtn').firstChild!.textContent = cur.liked ? '♥ ' : '♡ ';
  $('likeCount').textContent = String(cur.likes);
}
$('likeBtn').onclick = async () => {
  if (!cur) return;
  cur.liked = !cur.liked; cur.likes = Math.max(0, cur.likes + (cur.liked ? 1 : -1));
  drawLike(); await save(); renderBoard();
};
fTitle.oninput = () => { if (cur) { cur.title = fTitle.value; saveSoon(); renderStrip(); } };
fTitle.onchange = () => { renderMap(); renderBoard(); };
fStory.oninput = () => { if (cur) { cur.story = fStory.value; saveSoon(); } };
fDate.oninput = () => { if (cur) { cur.date = fDate.value; saveSoon(); drawLookAndStamp(cur); } };
fTripName.oninput = () => { if (cur) { cur.trip = fTripName.value.trim(); saveSoon(); } };
fTripName.onchange = () => { render(); };
$<HTMLInputElement>('coverBox').onchange = e => {
  if (!cur) return;
  const on = (e.target as HTMLInputElement).checked;
  if (on && placed(cur)) cards.filter(c => placed(c) && placeKey(c) === placeKey(cur!)).forEach(c => { c.cover = false; });
  cur.cover = on; save(); renderMap();
};
$<HTMLSelectElement>('lookSel').onchange = e => {
  if (!cur) return; cur.look = (e.target as HTMLSelectElement).value as Look; save(); drawLookAndStamp(cur); renderBoard(); renderStrip();
};
$<HTMLInputElement>('stampBox').onchange = e => {
  if (!cur) return; cur.stamp = (e.target as HTMLInputElement).checked; save(); drawLookAndStamp(cur); renderBoard();
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
  const i = cards.indexOf(cur); cards[i] = blankCard(i); cur = null;
  $('drawer').hidden = true; await save(); render();
};

// ---------- location ----------
function locNote() {
  if (!cur) return;
  $('locNote').textContent = placed(cur) ? `Pinned at ${cur.lat!.toFixed(3)}, ${cur.lng!.toFixed(3)}`
    : 'No location yet. The DSC-V1 has no GPS, so search a place or pin it on the map.';
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
  save(); render(); locNote(); drawStack(c);
  if (view !== 'map') setView('map');
  flyTo(c);
}
fPlace.oninput = async () => {
  await loadCities();
  const dl = $('placeList'); dl.innerHTML = '';
  searchPlaces(fPlace.value, 6).forEach(p => dl.append(new Option(p.label)));
};
$('placeBtn').onclick = findPlace;
fPlace.onkeydown = e => { if (e.key === 'Enter') findPlace(); };

function startPinning(targets: Card[]) {
  setView('map'); pinTargets = targets; document.body.classList.add('pinning');
  $('pinText').textContent = targets.length > 1 ? `Click the map to place ${targets.length} photos` : 'Click the map to place this photo';
  $('pinBanner').hidden = false; $('queue').hidden = true; $('mapTools').hidden = true;
  if (!wide()) $('drawer').hidden = true;
}
function stopPinning() {
  pinTargets = []; document.body.classList.remove('pinning'); $('pinBanner').hidden = true; $('mapTools').hidden = false;
  if (cur) $('drawer').hidden = false;
}
$('pinBtn').onclick = () => { if (cur) startPinning([cur]); };
$('pinCancel').onclick = stopPinning;
$('exactBtn').onclick = () => { if (cur && placed(cur)) { if (view !== 'map') setView('map'); flyTo(cur, 10); } };
$('clearLoc').onclick = () => {
  if (!cur) return;
  cur.lat = cur.lng = null; cur.place = ''; fPlace.value = '';
  render(); locNote(); drawStack(cur); save();
};

// ---------- "Place me" queue: photos without a location, a day at a time ----------
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
function renderQueue() {
  const list = $('qList'); list.innerHTML = '';
  const days = new Map<string, Card[]>();
  for (const c of cards.filter(c => c.img && !placed(c))) { const d = dayOf(c); (days.get(d) ?? days.set(d, []).get(d)!).push(c); }
  if (!days.size) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'Every photo is on the map.'; list.append(p); return; }
  [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([day, group]) => {
    const box = document.createElement('div'); box.className = 'q-group';
    const head = document.createElement('b');
    head.textContent = (day ? new Date(day + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'No date')
      + ` · ${group.length} photo${group.length > 1 ? 's' : ''}`;
    const thumbs = document.createElement('div'); thumbs.className = 'q-thumbs';
    group.slice(0, 6).forEach(c => { const im = new Image(); im.src = c.img!; im.alt = c.title; im.onclick = () => openCard(c); thumbs.append(im); });
    box.append(head, thumbs);
    const near = nearestPlaced(group);
    const row = document.createElement('div'); row.className = 'row';
    if (near) {
      const b = document.createElement('button'); b.className = 'btn small primary';
      b.textContent = `Place all at ${near.place || 'the nearest photo'}`;
      b.title = 'Nearest in time: ' + (near.title || 'Untitled');
      b.onclick = async () => {
        for (const c of group) { c.lat = near.lat; c.lng = near.lng; c.place = near.place; if (!c.trip) c.trip = near.trip; }
        await save(); render(); renderQueue();
      };
      row.append(b);
    }
    const pin = document.createElement('button'); pin.className = 'btn small'; pin.textContent = 'Pin on map…';
    pin.onclick = () => startPinning(group);
    row.append(pin); box.append(row); list.append(box);
  });
}
function openQueue() { renderQueue(); $('queue').hidden = false; }
$('qClose').onclick = () => { $('queue').hidden = true; };

// ---------- timeline playback ----------
const pl = { list: [] as Card[], i: 0, timer: 0, paused: false, on: false };
function stopPlay() {
  if (!pl.on) return;
  clearTimeout(pl.timer); pl.on = false; $('playCard').hidden = true; $('playBtn').textContent = 'Play';
  focusCard = () => cur; markSelected();
}
function playStep(i: number) {
  if (i >= pl.list.length) { stopPlay(); return; }
  pl.i = Math.max(0, i); clearTimeout(pl.timer);
  const c = pl.list[pl.i];
  focusCard = () => c;
  ($('pcImg') as HTMLImageElement).src = c.img!; $('pcImg').className = 'look-' + c.look;
  $('pcTitle').textContent = c.title || 'Untitled';
  $('pcWhere').textContent = [c.place, c.date ? new Date(c.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''].filter(Boolean).join(' · ');
  $('pcCount').textContent = `${pl.i + 1} of ${pl.list.length}`;
  map.flyTo([c.lat!, c.lng!], 7, { duration: 2.2 });
  map.once('moveend', () => { const m = markers.get(placeKey(c)); if (m) cluster.zoomToShowLayer(m, markSelected); markSelected(); });
  markSelected();
  if (!pl.paused) pl.timer = window.setTimeout(() => playStep(pl.i + 1), 4800);
}
function startPlay() {
  const list = visiblePlaced().sort(byDate);
  if (!list.length) { alert('Place at least one photo on the map first.'); return; }
  closeDrawerQuiet();
  Object.assign(pl, { list, i: 0, paused: false, on: true });
  $('playCard').hidden = false; $('playBtn').textContent = 'Stop'; $('pcPause').textContent = '⏸';
  playStep(0);
}
function closeDrawerQuiet() { cur = null; $('drawer').hidden = true; renderStrip(); }
$('playBtn').onclick = () => pl.on ? stopPlay() : startPlay();
$('pcStop').onclick = stopPlay;
$('pcPrev').onclick = () => playStep(Math.max(0, pl.i - 1));
$('pcNext').onclick = () => playStep(pl.i + 1);
$('pcPause').onclick = () => {
  pl.paused = !pl.paused; $('pcPause').textContent = pl.paused ? '▶' : '⏸';
  clearTimeout(pl.timer); if (!pl.paused) pl.timer = window.setTimeout(() => playStep(pl.i + 1), 1500);
};

// ---------- poster ----------
const posterCv = $<HTMLCanvasElement>('posterCv');
const posterTitle = $<HTMLInputElement>('posterTitle');
let posterT: number;
function drawPoster() {
  renderPoster(posterCv, cards.filter(visible), posterTitle.value.trim(), themeSel.value as ThemeName,
    highlight ? visitedSet() : null, visitedSet().size);
}
$('posterBtn').onclick = () => { $('posterModal').hidden = false; drawPoster(); };
posterTitle.oninput = () => { clearTimeout(posterT); posterT = window.setTimeout(drawPoster, 300); };
$('posterClose').onclick = () => { $('posterModal').hidden = true; };
$('posterSave').onclick = () => {
  posterCv.toBlob(b => {
    if (!b) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'wayframe-poster.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
};

// ---------- viewer ----------
initViewer();
$('photoBtn').onclick = () => { if (cur?.img) openViewer(cur.img, 'look-' + cur.look); };
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('posterModal').hidden) $('posterModal').hidden = true;
  else if (viewerIsOpen()) closeViewer();
  else if (pinTargets.length) stopPinning();
  else if (pl.on) stopPlay();
  else if (!$('queue').hidden) $('queue').hidden = true;
  else if (!$('drawer').hidden) closeDrawer();
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
    cards = d.map(normalize); await save(); render(); fitAll();
  } catch { alert('That file is not a Wayframe export.'); }
};

// ---------- start ----------
(async () => {
  setBarHeight();
  window.addEventListener('resize', setBarHeight);
  await openStore();
  const saved = await loadCards();
  cards = saved ? saved.map(normalize) : Array.from({ length: SLOTS }, (_, i) => blankCard(i));
  render(); fitAll();
  document.fonts.ready.then(() => map.fire('moveend'));
  const v = lsGet('cb-view');
  setView(v === 'board' || v === 'stats' ? v : 'map');
})();
