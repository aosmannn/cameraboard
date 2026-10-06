import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import './style.css';
import type { Card } from './types';
import { openStore, loadCards, saveCards } from './storage';
import { blankCard, fillCard } from './photo';
import { drawWorld } from './world';
import { initViewer, openViewer, closeViewer, viewerIsOpen } from './viewer';

const SLOTS = 12;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const wide = () => window.matchMedia('(min-width:801px)').matches;

let cards: Card[] = [];
let cur: Card | null = null;
let pinning = false;
let pickTarget: Card | null = null;

const save = () => saveCards(cards);
let saveT: number;
const saveSoon = () => { clearTimeout(saveT); saveT = window.setTimeout(save, 400); };
const placed = (c: Card) => !!c.img && c.lat != null && c.lng != null;

const fTitle = $<HTMLInputElement>('fTitle');
const fStory = $<HTMLTextAreaElement>('fStory');
const fDate = $<HTMLInputElement>('fDate');
const fPlace = $<HTMLInputElement>('fPlace');
const picker = $<HTMLInputElement>('picker');

// ---------- map ----------
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
const map = L.map('map', { zoomControl: false, minZoom: 2, maxZoom: 10, preferCanvas: true,
  maxBounds: [[-60, -180], [84, 180]], maxBoundsViscosity: 1 }).setView([25, 10], 2);
L.control.zoom({ position: 'topleft' }).addTo(map);
drawWorld(map, dark);
map.attributionControl.setPrefix('').addAttribution('Map: Natural Earth');

const cluster = L.markerClusterGroup({
  showCoverageOnHover: false, maxClusterRadius: 50,
  iconCreateFunction: c => L.divIcon({ html: `<div class="cl">${c.getChildCount()}</div>`, className: '', iconSize: [44, 44] })
});
map.addLayer(cluster);
const markers = new Map<string, L.Marker>();

map.on('click', async e => {
  if (!pinning || !cur) return;
  const c = cur;
  setLocation(c, e.latlng.lat, e.latlng.lng, '');
  stopPinning();
  c.place = await reverse(e.latlng.lat, e.latlng.lng) || 'Dropped pin';
  fPlace.value = c.place; locNote(); save(); renderStrip();
});

function renderMap() {
  cluster.clearLayers(); markers.clear();
  for (const c of cards.filter(placed)) {
    const el = document.createElement('div');
    el.className = 'mk' + (cur && cur.id === c.id ? ' sel' : '');
    const im = new Image(); im.src = c.img!; im.alt = c.title;
    el.append(im, document.createElement('i'));
    const m = L.marker([c.lat!, c.lng!], {
      icon: L.divIcon({ html: el, className: '', iconSize: [56, 66], iconAnchor: [28, 66] }), title: c.title });
    m.on('click', () => openCard(c));
    markers.set(c.id, m); cluster.addLayer(m);
  }
  $('empty').hidden = cards.some(c => c.img);
}
function markSelected() {
  markers.forEach((m, id) => {
    const e = m.getElement();
    if (e && e.firstElementChild) e.firstElementChild.classList.toggle('sel', !!cur && id === cur.id);
  });
}
function fitAll() {
  const pts = cards.filter(placed).map(c => [c.lat!, c.lng!] as L.LatLngTuple);
  if (pts.length) map.fitBounds(pts, { padding: [80, 80], maxZoom: 6 });
}
function flyTo(c: Card) {
  const pad = wide() ? { paddingBottomRight: L.point(420, 0) } : { paddingBottomRight: L.point(0, window.innerHeight * 0.7) };
  map.flyToBounds(L.latLngBounds([[c.lat!, c.lng!]]), { ...pad, maxZoom: Math.max(map.getZoom(), 7), duration: 1 });
  map.once('moveend', () => { const m = markers.get(c.id); if (m) cluster.zoomToShowLayer(m, markSelected); });
}

function renderStrip() {
  const s = $('strip'); s.innerHTML = '';
  for (const c of cards.filter(c => c.img)) {
    const b = document.createElement('button');
    b.className = 'chip' + (placed(c) ? '' : ' unplaced') + (cur && cur.id === c.id ? ' on' : '');
    const im = new Image(); im.src = c.img!; im.alt = '';
    const t = document.createElement('small'); t.textContent = placed(c) ? (c.title || 'Untitled') : 'Place me';
    b.append(im, t); b.onclick = () => openCard(c); s.append(b);
  }
}

// ---------- board view ----------
function renderBoard() {
  const board = $('board'); board.innerHTML = '';
  for (const c of cards) {
    const el = document.createElement('article');
    el.className = 'card' + (c.img ? '' : ' blank');
    el.tabIndex = 0;
    el.style.setProperty('--rot', c.rot + 'deg'); el.style.setProperty('--pin', c.pin);
    el.innerHTML = '<i class="pin"></i><div class="thumb"></div><div class="cap"><span></span><span class="lk"></span></div>';
    const th = el.querySelector('.thumb')!;
    if (c.img) { const im = new Image(); im.src = c.img; im.alt = c.title; th.append(im); }
    else th.innerHTML = '<div><b>＋</b>Add a photo</div>';
    const [t, lk] = el.querySelectorAll('.cap span');
    t.textContent = c.img ? (c.title || 'Untitled') : '';
    lk.textContent = c.img && c.likes ? '♥ ' + c.likes : '';
    const act = () => c.img ? openCard(c) : pick(c);
    el.onclick = act; el.onkeydown = e => { if (e.key === 'Enter') act(); };
    board.append(el);
  }
}
const render = () => { renderMap(); renderStrip(); renderBoard(); };

// ---------- views ----------
function setView(v: 'map' | 'board') {
  const isMap = v === 'map';
  $('mapView').hidden = !isMap; $('boardView').hidden = isMap;
  $('vMap').classList.toggle('on', isMap); $('vBoard').classList.toggle('on', !isMap);
  if (isMap) setTimeout(() => map.invalidateSize(), 0);
  try { localStorage.setItem('cb-view', v); } catch { /* storage blocked */ }
}
$('vMap').onclick = () => setView('map');
$('vBoard').onclick = () => setView('board');

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
function openCard(c: Card, fly = true) {
  cur = c; stopPinning();
  $('drawer').hidden = false;
  const dImg = $<HTMLImageElement>('dImg'); dImg.src = c.img!; dImg.alt = c.title;
  fTitle.value = c.title; fStory.value = c.story; fDate.value = c.date; fPlace.value = c.place || '';
  drawLike(); locNote();
  const m = c.meta || {};
  const rows: [string, string | number | undefined][] = [['Camera', m.camera || 'Sony Cyber-shot DSC-V1'], ['Exposure', m.exposure],
    ['Aperture', m.aperture], ['ISO', m.iso], ['Focal length', m.focal], ['Size', m.size], ['File', m.file]];
  const meta = $('meta'); meta.innerHTML = '';
  for (const [k, v] of rows) {
    if (!v) continue;
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = k; dd.textContent = String(v); meta.append(dt, dd);
  }
  markSelected(); renderStrip();
  if (fly && placed(c) && !$('mapView').hidden) flyTo(c);
}
function closeDrawer() { cur = null; stopPinning(); $('drawer').hidden = true; markSelected(); renderStrip(); save(); renderBoard(); }
$('dClose').onclick = closeDrawer;

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
fStory.oninput = () => { if (cur) { cur.story = fStory.value; saveSoon(); } };
fDate.oninput = () => { if (cur) { cur.date = fDate.value; saveSoon(); } };
fTitle.onchange = () => { renderMap(); markSelected(); };

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
function setLocation(c: Card, lat: number, lng: number, place: string) {
  c.lat = lat; c.lng = lng; if (place) c.place = place;
  renderMap(); renderStrip(); markSelected(); locNote();
}
async function reverse(lat: number, lng: number): Promise<string> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&lat=${lat}&lon=${lng}`);
    const j = await r.json(); return j.display_name ? j.display_name.split(',').slice(0, 2).join(',').trim() : '';
  } catch { return ''; }
}
async function findPlace() {
  const q = fPlace.value.trim(); if (!q || !cur) return;
  const c = cur;
  $('locNote').textContent = 'Searching…';
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q));
    const [h] = await r.json();
    if (!h) { $('locNote').textContent = 'No match. Try another name, or pin it on the map.'; return; }
    const name = h.display_name.split(',').slice(0, 3).join(',').trim();
    fPlace.value = name; setLocation(c, +h.lat, +h.lon, name); save();
    if ($('mapView').hidden) setView('map');
    flyTo(c);
  } catch { $('locNote').textContent = 'Search failed. Pin it on the map instead.'; }
}
$('placeBtn').onclick = findPlace;
fPlace.onkeydown = e => { if (e.key === 'Enter') findPlace(); };

function startPinning() {
  setView('map'); pinning = true; document.body.classList.add('pinning');
  $('pinBanner').hidden = false;
  if (!wide()) $('drawer').hidden = true;
}
function stopPinning() {
  pinning = false; document.body.classList.remove('pinning'); $('pinBanner').hidden = true;
  if (cur) $('drawer').hidden = false;
}
$('pinBtn').onclick = startPinning;
$('pinCancel').onclick = stopPinning;
$('clearLoc').onclick = () => {
  if (!cur) return;
  cur.lat = cur.lng = null; cur.place = ''; fPlace.value = '';
  renderMap(); renderStrip(); locNote(); save();
};

// ---------- viewer ----------
initViewer();
$('photoBtn').onclick = () => { if (cur?.img) openViewer(cur.img); };
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (viewerIsOpen()) closeViewer(); else if (pinning) stopPinning(); else if (!$('drawer').hidden) closeDrawer();
});

// ---------- export / import ----------
$('exportBtn').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(cards)], { type: 'application/json' }));
  a.download = 'cameraboard.json'; a.click();
};
$<HTMLInputElement>('importFile').onchange = async e => {
  const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text()); if (!Array.isArray(d)) throw 0;
    cards = d; await save(); render(); fitAll();
  } catch { alert('That file is not a Cameraboard export.'); }
};

// ---------- start ----------
(async () => {
  document.documentElement.style.setProperty('--bar', document.querySelector<HTMLElement>('.bar')!.offsetHeight + 'px');
  await openStore();
  cards = (await loadCards()) || Array.from({ length: SLOTS }, (_, i) => blankCard(i));
  render(); fitAll();
  let v: 'map' | 'board' = 'map';
  try { if (localStorage.getItem('cb-view') === 'board') v = 'board'; } catch { /* storage blocked */ }
  setView(v);
})();
