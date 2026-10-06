(() => {
const $ = id => document.getElementById(id);
const PINS = ['#d6453d', '#2f7dd1', '#2e9e5b', '#e8b422', '#8e44ad'];
const SLOTS = 12;

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

let cards = [];
const blank = i => ({ id: crypto.randomUUID(), rot: +(Math.random() * 6 - 3).toFixed(1), pin: PINS[i % PINS.length],
  img: null, title: '', story: '', date: '', likes: 0, liked: false, meta: {}, lat: null, lng: null, place: '' });
const save = () => idb.set('cards', cards);

// ---------- board ----------
function render() {
  const board = $('board');
  board.innerHTML = '';
  cards.forEach((c, i) => {
    const el = document.createElement('article');
    el.className = 'card' + (c.img ? '' : ' empty');
    el.tabIndex = 0;
    el.style.setProperty('--rot', c.rot + 'deg');
    el.style.setProperty('--pin', c.pin);
    el.innerHTML = `<i class="pin"></i><div class="thumb"></div><div class="cap"><span></span><span class="lk"></span></div>`;
    const th = el.querySelector('.thumb');
    if (c.img) { const im = new Image(); im.src = c.img; im.alt = c.title; th.append(im); }
    else th.innerHTML = '<div><b>＋</b>Add a photo</div>';
    const [t, lk] = el.querySelectorAll('.cap span');
    t.textContent = c.img ? (c.title || 'Untitled') : '';
    lk.textContent = c.img && c.likes ? '♥ ' + c.likes : '';
    const open = () => c.img ? openCard(c) : pick(c);
    el.onclick = open;
    el.onkeydown = e => { if (e.key === 'Enter') open(); };
    board.append(el);
  });
}

// ---------- upload + EXIF ----------
let pickTarget = null;
function pick(c) { pickTarget = c; $('picker').value = ''; $('picker').click(); }

function fmtExposure(t) { return !t ? '' : t >= 1 ? t + ' s' : '1/' + Math.round(1 / t) + ' s'; }

async function readExif(file) {
  try {
    const x = await exifr.parse(file, { gps: true, pick: ['Make', 'Model', 'DateTimeOriginal', 'ExposureTime',
      'FNumber', 'ISO', 'FocalLength', 'latitude', 'longitude'] });
    return x || {};
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

$('picker').onchange = async e => {
  const f = e.target.files[0]; const c = pickTarget;
  if (!f || !c) return;
  const [ex, img] = await Promise.all([readExif(f), downscale(f)]);
  c.img = img.data;
  c.meta = { camera: [ex.Make, ex.Model].filter(Boolean).join(' '), exposure: fmtExposure(ex.ExposureTime),
    aperture: ex.FNumber ? 'f/' + ex.FNumber : '', iso: ex.ISO || '', focal: ex.FocalLength ? ex.FocalLength + ' mm' : '',
    size: `${img.w} × ${img.h}`, file: f.name };
  const d = ex.DateTimeOriginal || new Date(f.lastModified);
  c.date = toLocalInput(new Date(d));
  if (ex.latitude != null) { c.lat = ex.latitude; c.lng = ex.longitude; c.place = c.place || 'From photo GPS'; }
  if (!c.title) c.title = f.name.replace(/\.[^.]+$/, '');
  await save(); render();
  if ($('lightbox').hidden) openCard(c); else openCard(c);
};

// ---------- lightbox: zoom/pan ----------
let cur = null, map = null, marker = null;
const z = { s: 1, x: 0, y: 0, min: 1 };
const lbImg = $('lbImg'), lbPhoto = $('lbPhoto');
const applyZ = () => lbImg.style.transform = `translate(${z.x}px,${z.y}px) scale(${z.s})`;

function fit() {
  const W = lbPhoto.clientWidth, H = lbPhoto.clientHeight, w = lbImg.naturalWidth, h = lbImg.naturalHeight;
  if (!w) return;
  lbImg.style.width = w + 'px'; lbImg.style.height = h + 'px';
  z.min = z.s = Math.min(W / w, H / h);
  z.x = (W - w * z.s) / 2; z.y = (H - h * z.s) / 2; applyZ();
}
function zoomAt(f, cx, cy) {
  const ns = Math.min(z.min * 12, Math.max(z.min, z.s * f)), r = ns / z.s;
  z.x = cx - (cx - z.x) * r; z.y = cy - (cy - z.y) * r; z.s = ns; applyZ();
}
const center = () => [lbPhoto.clientWidth / 2, lbPhoto.clientHeight / 2];
lbPhoto.addEventListener('wheel', e => {
  e.preventDefault();
  const b = lbPhoto.getBoundingClientRect();
  zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - b.left, e.clientY - b.top);
}, { passive: false });
$('zIn').onclick = () => zoomAt(1.4, ...center());
$('zOut').onclick = () => zoomAt(1 / 1.4, ...center());
$('zReset').onclick = fit;
lbImg.onload = fit;

// pointer pan + pinch
const ptrs = new Map(); let pinch = 0;
lbPhoto.addEventListener('pointerdown', e => { lbPhoto.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, e); pinch = 0; });
lbPhoto.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, e);
  if (ptrs.size === 1) { z.x += e.clientX - prev.clientX; z.y += e.clientY - prev.clientY; applyZ(); }
  else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (pinch) { const r = lbPhoto.getBoundingClientRect();
      zoomAt(d / pinch, (a.clientX + b.clientX) / 2 - r.left, (a.clientY + b.clientY) / 2 - r.top); }
    pinch = d;
  }
});
['pointerup', 'pointercancel'].forEach(t => lbPhoto.addEventListener(t, e => { ptrs.delete(e.pointerId); pinch = 0; }));
lbPhoto.addEventListener('dblclick', e => { const r = lbPhoto.getBoundingClientRect(); zoomAt(2, e.clientX - r.left, e.clientY - r.top); });

// ---------- lightbox: info ----------
function openCard(c) {
  cur = c;
  $('lightbox').hidden = false;
  document.body.style.overflow = 'hidden';
  lbImg.src = c.img; lbImg.alt = c.title;
  if (lbImg.complete) fit();
  $('fTitle').value = c.title; $('fStory').value = c.story; $('fDate').value = c.date;
  $('fPlace').value = c.place || '';
  drawLike();
  const m = c.meta || {};
  const rows = [['Camera', m.camera || 'Sony Cyber-shot DSC-V1'], ['Exposure', m.exposure], ['Aperture', m.aperture],
    ['ISO', m.iso], ['Focal length', m.focal], ['Size', m.size], ['File', m.file]].filter(r => r[1]);
  $('meta').innerHTML = '';
  rows.forEach(([k, v]) => { const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = k; dd.textContent = v; $('meta').append(dt, dd); });
  setTimeout(() => initMap(c), 50);
}

function drawLike() {
  $('likeBtn').classList.toggle('on', cur.liked);
  $('likeBtn').firstChild.textContent = cur.liked ? '♥ ' : '♡ ';
  $('likeCount').textContent = cur.likes;
}
$('likeBtn').onclick = async () => {
  cur.liked = !cur.liked; cur.likes = Math.max(0, cur.likes + (cur.liked ? 1 : -1));
  drawLike(); await save(); render();
};

function initMap(c) {
  if (typeof L === 'undefined') { $('map').textContent = 'Map unavailable offline.'; return; }
  if (!map) {
    map = L.map('map').setView([20, 0], 2);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
      attribution: '© OpenStreetMap' }).addTo(map);
    map.on('click', e => setPoint(e.latlng.lat, e.latlng.lng, 'Dropped pin', true));
  }
  map.invalidateSize();
  if (marker) { marker.remove(); marker = null; }
  if (c.lat != null) { setPoint(c.lat, c.lng, c.place, false); map.setView([c.lat, c.lng], 12); }
  else map.setView([20, 0], 2);
}
function setPoint(lat, lng, place, persist) {
  if (marker) marker.setLatLng([lat, lng]); else marker = L.marker([lat, lng]).addTo(map);
  if (persist) { cur.lat = lat; cur.lng = lng; cur.place = place || cur.place; $('fPlace').value = cur.place; save(); }
}
async function findPlace() {
  const q = $('fPlace').value.trim(); if (!q) return;
  $('mapHint').textContent = 'Searching…';
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q));
    const [h] = await r.json();
    if (!h) { $('mapHint').textContent = 'No match — try another name or click the map.'; return; }
    cur.place = h.display_name.split(',').slice(0, 3).join(',').trim();
    $('fPlace').value = cur.place;
    setPoint(+h.lat, +h.lon, cur.place, true); map.setView([+h.lat, +h.lon], 12);
    $('mapHint').textContent = 'Pinned. Click the map to fine-tune.';
  } catch { $('mapHint').textContent = 'Search failed — click the map to drop a pin instead.'; }
}
$('placeBtn').onclick = findPlace;
$('fPlace').onkeydown = e => { if (e.key === 'Enter') findPlace(); };

const bind = (id, key) => $(id).oninput = e => { cur[key] = e.target.value; clearTimeout(bind.t); bind.t = setTimeout(save, 400); };
bind('fTitle', 'title'); bind('fStory', 'story'); bind('fDate', 'date');

function close() { $('lightbox').hidden = true; document.body.style.overflow = ''; save(); render(); }
$('lbClose').onclick = close;
$('lightbox').onclick = e => { if (e.target.id === 'lightbox') close(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('lightbox').hidden) close(); });
window.addEventListener('resize', () => { if (!$('lightbox').hidden) fit(); });

$('replaceBtn').onclick = () => pick(cur);
$('deleteBtn').onclick = async () => {
  if (!confirm('Remove this photo from the board?')) return;
  const i = cards.indexOf(cur); cards[i] = blank(i); $('lightbox').hidden = true;
  document.body.style.overflow = ''; await save(); render();
};

// ---------- board actions ----------
$('addSlot').onclick = async () => { for (let i = 0; i < 4; i++) cards.push(blank(cards.length)); await save(); render(); };
$('exportBtn').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(cards)], { type: 'application/json' }));
  a.download = 'cameraboard.json'; a.click();
};
$('importFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const d = JSON.parse(await f.text()); if (!Array.isArray(d)) throw 0; cards = d; await save(); render(); }
  catch { alert('That file is not a Cameraboard export.'); }
};

// ---------- init ----------
(async () => {
  await idb.open();
  cards = (await idb.get('cards')) || Array.from({ length: SLOTS }, (_, i) => blank(i));
  render();
})();
})();
