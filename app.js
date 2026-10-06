(() => {
const $ = id => document.getElementById(id);
const PINS = ['#d6453d', '#2f7dd1', '#2e9e5b', '#e8b422', '#8e44ad'];
const SLOTS = 12;
const wide = () => window.matchMedia('(min-width:801px)').matches;

// ---------- storage (IndexedDB, whole board under one key) ----------
const idb = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('cameraboard', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  get(k) {
    return new Promise((res, rej) => {
      const q = this.db.transaction('kv').objectStore('kv').get(k);
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
  },
  set(k, v) {
    return new Promise((res, rej) => {
      const t = this.db.transaction('kv', 'readwrite');
      t.objectStore('kv').put(v, k);
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
  }
};

let cards = [], cur = null, pinning = false, pickTarget = null;
const blank = i => ({ id: crypto.randomUUID(), rot: +(Math.random() * 6 - 3).toFixed(1), pin: PINS[i % PINS.length],
  img: null, title: '', story: '', date: '', likes: 0, liked: false, meta: {}, lat: null, lng: null, place: '' });
const save = () => idb.set('cards', cards);
let saveT; const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(save, 400); };
const placed = c => c.img && c.lat != null;

// ---------- map ----------
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
const map = L.map('map', { zoomControl: false, minZoom: 2, worldCopyJump: true }).setView([25, 10], 2);
L.control.zoom({ position: 'topleft' }).addTo(map);
L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`, {
  maxZoom: 19, subdomains: 'abcd',
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>'
}).addTo(map);
const cluster = L.markerClusterGroup({
  showCoverageOnHover: false, maxClusterRadius: 50,
  iconCreateFunction: c => L.divIcon({ html: `<div class="cl">${c.getChildCount()}</div>`, className: '', iconSize: [44, 44] })
});
map.addLayer(cluster);
const markers = new Map();

map.on('click', async e => {
  if (!pinning || !cur) return;
  setLocation(cur, e.latlng.lat, e.latlng.lng, '');
  stopPinning();
  cur.place = await reverse(e.latlng.lat, e.latlng.lng) || 'Dropped pin';
  $('fPlace').value = cur.place; locNote(); save(); renderStrip();
});

function renderMap() {
  cluster.clearLayers(); markers.clear();
  cards.filter(placed).forEach(c => {
    const el = document.createElement('div');
    el.className = 'mk' + (cur && cur.id === c.id ? ' sel' : '');
    const im = new Image(); im.src = c.img; im.alt = c.title;
    el.append(im, document.createElement('i'));
    const m = L.marker([c.lat, c.lng], { icon: L.divIcon({ html: el, className: '', iconSize: [56, 66], iconAnchor: [28, 66] }), title: c.title });
    m.on('click', () => openCard(c));
    markers.set(c.id, m); cluster.addLayer(m);
  });
  $('empty').hidden = cards.some(c => c.img);
}
function markSelected() {
  markers.forEach((m, id) => { const e = m.getElement(); if (e) e.firstChild.classList.toggle('sel', !!cur && id === cur.id); });
}
function fitAll() {
  const pts = cards.filter(placed).map(c => [c.lat, c.lng]);
  if (pts.length) map.fitBounds(pts, { padding: [80, 80], maxZoom: 6 });
}
function flyTo(c) {
  const pad = wide() ? { paddingBottomRight: [420, 0] } : { paddingBottomRight: [0, window.innerHeight * 0.7] };
  map.flyToBounds(L.latLngBounds([[c.lat, c.lng]]), { ...pad, maxZoom: Math.max(map.getZoom(), 10), duration: 1 });
  map.once('moveend', () => { const m = markers.get(c.id); if (m) cluster.zoomToShowLayer(m, markSelected); });
}

function renderStrip() {
  const s = $('strip'); s.innerHTML = '';
  cards.filter(c => c.img).forEach(c => {
    const b = document.createElement('button');
    b.className = 'chip' + (placed(c) ? '' : ' unplaced') + (cur && cur.id === c.id ? ' on' : '');
    const im = new Image(); im.src = c.img; im.alt = '';
    const t = document.createElement('small'); t.textContent = placed(c) ? (c.title || 'Untitled') : 'Place me';
    b.append(im, t); b.onclick = () => openCard(c); s.append(b);
  });
}

// ---------- board view ----------
function renderBoard() {
  const board = $('board'); board.innerHTML = '';
  cards.forEach(c => {
    const el = document.createElement('article');
    el.className = 'card' + (c.img ? '' : ' blank');
    el.tabIndex = 0;
    el.style.setProperty('--rot', c.rot + 'deg'); el.style.setProperty('--pin', c.pin);
    el.innerHTML = '<i class="pin"></i><div class="thumb"></div><div class="cap"><span></span><span class="lk"></span></div>';
    const th = el.querySelector('.thumb');
    if (c.img) { const im = new Image(); im.src = c.img; im.alt = c.title; th.append(im); }
    else th.innerHTML = '<div><b>＋</b>Add a photo</div>';
    const [t, lk] = el.querySelectorAll('.cap span');
    t.textContent = c.img ? (c.title || 'Untitled') : '';
    lk.textContent = c.img && c.likes ? '♥ ' + c.likes : '';
    const act = () => c.img ? openCard(c) : pick(c);
    el.onclick = act; el.onkeydown = e => { if (e.key === 'Enter') act(); };
    board.append(el);
  });
}
const render = () => { renderMap(); renderStrip(); renderBoard(); };

// ---------- views ----------
function setView(v) {
  const isMap = v === 'map';
  $('mapView').hidden = !isMap; $('boardView').hidden = isMap;
  $('vMap').classList.toggle('on', isMap); $('vBoard').classList.toggle('on', !isMap);
  if (isMap) setTimeout(() => map.invalidateSize(), 0);
  try { localStorage.setItem('cb-view', v); } catch {}
}
$('vMap').onclick = () => setView('map');
$('vBoard').onclick = () => setView('board');

// ---------- upload + EXIF ----------
function pick(c) { pickTarget = c; $('picker').multiple = !c; $('picker').value = ''; $('picker').click(); }
$('addBtn').onclick = $('emptyAdd').onclick = () => pick(null);

const fmtExposure = t => !t ? '' : t >= 1 ? t + ' s' : '1/' + Math.round(1 / t) + ' s';
async function readExif(file) {
  try {
    return await exifr.parse(file, { gps: true, pick: ['Make', 'Model', 'DateTimeOriginal', 'ExposureTime',
      'FNumber', 'ISO', 'FocalLength', 'latitude', 'longitude'] }) || {};
  } catch { return {}; }
}
function downscale(file, max = 1800) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const s = Math.min(1, max / Math.max(im.width, im.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(im.width * s); cv.height = Math.round(im.height * s);
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      res({ data: cv.toDataURL('image/jpeg', 0.86), w: im.width, h: im.height });
    };
    im.onerror = () => rej(new Error('Could not read image'));
    im.src = url;
  });
}
const toLocalInput = d => { const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

async function fillCard(c, f) {
  const [ex, img] = await Promise.all([readExif(f), downscale(f)]);
  c.img = img.data;
  c.meta = { camera: [ex.Make, ex.Model].filter(Boolean).join(' '), exposure: fmtExposure(ex.ExposureTime),
    aperture: ex.FNumber ? 'f/' + ex.FNumber : '', iso: ex.ISO || '', focal: ex.FocalLength ? ex.FocalLength + ' mm' : '',
    size: `${img.w} × ${img.h}`, file: f.name };
  c.date = toLocalInput(new Date(ex.DateTimeOriginal || f.lastModified));
  if (ex.latitude != null) { c.lat = ex.latitude; c.lng = ex.longitude; c.place = c.place || 'From photo GPS'; }
  if (!c.title) c.title = f.name.replace(/\.[^.]+$/, '');
}

$('picker').onchange = async e => {
  const files = [...e.target.files]; if (!files.length) return;
  const made = [];
  for (const f of files) {
    let c = pickTarget || cards.find(x => !x.img);
    if (!c) { c = blank(cards.length); cards.push(c); }
    try { await fillCard(c, f); made.push(c); } catch { alert(`Could not read ${f.name}`); }
  }
  await save(); render();
  if (made.length === 1) openCard(made[0]);
  else if (made.length) fitAll();
};

// ---------- drawer ----------
function openCard(c, fly = true) {
  cur = c; stopPinning();
  $('drawer').hidden = false;
  $('dImg').src = c.img; $('dImg').alt = c.title;
  $('fTitle').value = c.title; $('fStory').value = c.story; $('fDate').value = c.date;
  $('fPlace').value = c.place || '';
  drawLike(); locNote();
  const m = c.meta || {};
  const rows = [['Camera', m.camera || 'Sony Cyber-shot DSC-V1'], ['Exposure', m.exposure], ['Aperture', m.aperture],
    ['ISO', m.iso], ['Focal length', m.focal], ['Size', m.size], ['File', m.file]].filter(r => r[1]);
  $('meta').innerHTML = '';
  rows.forEach(([k, v]) => { const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = k; dd.textContent = v; $('meta').append(dt, dd); });
  markSelected(); renderStrip();
  if (fly && placed(c) && !$('mapView').hidden) flyTo(c);
}
function closeDrawer() { cur = null; stopPinning(); $('drawer').hidden = true; markSelected(); renderStrip(); save(); renderBoard(); }
$('dClose').onclick = closeDrawer;

function drawLike() {
  $('likeBtn').classList.toggle('on', cur.liked);
  $('likeBtn').firstChild.textContent = cur.liked ? '♥ ' : '♡ ';
  $('likeCount').textContent = cur.likes;
}
$('likeBtn').onclick = async () => {
  cur.liked = !cur.liked; cur.likes = Math.max(0, cur.likes + (cur.liked ? 1 : -1));
  drawLike(); await save(); renderBoard();
};
const bind = (id, key) => $(id).oninput = e => { cur[key] = e.target.value; saveSoon(); if (key === 'title') { renderStrip(); } };
bind('fTitle', 'title'); bind('fStory', 'story'); bind('fDate', 'date');
$('fTitle').onchange = () => { renderMap(); markSelected(); };

$('replaceBtn').onclick = () => pick(cur);
$('deleteBtn').onclick = async () => {
  if (!$('deleteBtn').dataset.sure) {
    $('deleteBtn').dataset.sure = 1; $('deleteBtn').textContent = 'Really remove?';
    setTimeout(() => { delete $('deleteBtn').dataset.sure; $('deleteBtn').textContent = 'Remove'; }, 3000); return;
  }
  delete $('deleteBtn').dataset.sure; $('deleteBtn').textContent = 'Remove';
  const i = cards.indexOf(cur); cards[i] = blank(i); cur = null;
  $('drawer').hidden = true; await save(); render();
};

// ---------- location ----------
function locNote() {
  $('locNote').textContent = placed(cur) ? `Pinned at ${cur.lat.toFixed(3)}, ${cur.lng.toFixed(3)}`
    : 'No location yet. The DSC-V1 has no GPS, so search a place or pin it on the map.';
}
function setLocation(c, lat, lng, place) {
  c.lat = lat; c.lng = lng; if (place) c.place = place;
  renderMap(); renderStrip(); markSelected(); locNote();
}
async function reverse(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&lat=${lat}&lon=${lng}`);
    const j = await r.json(); return j.display_name ? j.display_name.split(',').slice(0, 2).join(',').trim() : '';
  } catch { return ''; }
}
async function findPlace() {
  const q = $('fPlace').value.trim(); if (!q || !cur) return;
  $('locNote').textContent = 'Searching…';
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q));
    const [h] = await r.json();
    if (!h) { $('locNote').textContent = 'No match. Try another name, or pin it on the map.'; return; }
    const name = h.display_name.split(',').slice(0, 3).join(',').trim();
    $('fPlace').value = name; setLocation(cur, +h.lat, +h.lon, name); save();
    $('mapView').hidden && setView('map');
    flyTo(cur);
  } catch { $('locNote').textContent = 'Search failed. Pin it on the map instead.'; }
}
$('placeBtn').onclick = findPlace;
$('fPlace').onkeydown = e => { if (e.key === 'Enter') findPlace(); };

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
$('clearLoc').onclick = () => { cur.lat = cur.lng = null; cur.place = ''; $('fPlace').value = ''; renderMap(); renderStrip(); locNote(); save(); };

// ---------- full-size viewer (zoom / pan / pinch) ----------
const vw = $('viewer'), vwImg = $('vwImg'), z = { s: 1, x: 0, y: 0, min: 1 };
const applyZ = () => vwImg.style.transform = `translate(${z.x}px,${z.y}px) scale(${z.s})`;
function fit() {
  const W = vw.clientWidth, H = vw.clientHeight, w = vwImg.naturalWidth, h = vwImg.naturalHeight;
  if (!w) return;
  vwImg.style.width = w + 'px'; vwImg.style.height = h + 'px';
  z.min = z.s = Math.min(W / w, H / h);
  z.x = (W - w * z.s) / 2; z.y = (H - h * z.s) / 2; applyZ();
}
function zoomAt(f, cx, cy) {
  const ns = Math.min(z.min * 12, Math.max(z.min, z.s * f)), r = ns / z.s;
  z.x = cx - (cx - z.x) * r; z.y = cy - (cy - z.y) * r; z.s = ns; applyZ();
}
const centre = () => [vw.clientWidth / 2, vw.clientHeight / 2];
vw.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
$('zIn').onclick = () => zoomAt(1.4, ...centre());
$('zOut').onclick = () => zoomAt(1 / 1.4, ...centre());
$('zReset').onclick = fit;
vwImg.onload = fit;
const ptrs = new Map(); let pinch = 0;
vw.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; vw.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, e); pinch = 0; });
vw.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, e);
  if (ptrs.size === 1) { z.x += e.clientX - prev.clientX; z.y += e.clientY - prev.clientY; applyZ(); }
  else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (pinch) zoomAt(d / pinch, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    pinch = d;
  }
});
['pointerup', 'pointercancel'].forEach(t => vw.addEventListener(t, e => { ptrs.delete(e.pointerId); pinch = 0; }));
vw.addEventListener('dblclick', e => zoomAt(2, e.clientX, e.clientY));
$('photoBtn').onclick = () => { vw.hidden = false; vwImg.src = cur.img; if (vwImg.complete) fit(); };
$('vwClose').onclick = () => vw.hidden = true;
window.addEventListener('resize', () => { if (!vw.hidden) fit(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!vw.hidden) vw.hidden = true; else if (pinning) stopPinning(); else if (!$('drawer').hidden) closeDrawer();
});

// ---------- export / import ----------
$('exportBtn').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(cards)], { type: 'application/json' }));
  a.download = 'cameraboard.json'; a.click();
};
$('importFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const d = JSON.parse(await f.text()); if (!Array.isArray(d)) throw 0; cards = d; await save(); render(); fitAll(); }
  catch { alert('That file is not a Cameraboard export.'); }
};

// ---------- init ----------
(async () => {
  document.documentElement.style.setProperty('--bar', document.querySelector('.bar').offsetHeight + 'px');
  await idb.open();
  cards = (await idb.get('cards')) || Array.from({ length: SLOTS }, (_, i) => blank(i));
  render(); fitAll();
  let v = 'map'; try { v = localStorage.getItem('cb-view') || 'map'; } catch {}
  setView(v);
})();
})();
