import { mountShell } from './site';
import './landing.css';
import { THEMES, paintWorld, mercY } from './world';
import * as cloud from './cloud';

mountShell('home');

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- illustrated sample photos (the demo ships no real photos) ----------
interface Look { sky: [string, string]; sun: string; ground: string; far: string; shape: 'city' | 'hills' | 'harbour' | 'towers' }
const svg = (l: Look) => {
  const shapes = {
    city: '<rect x="60" y="250" width="70" height="130" fill="@f"/><rect x="140" y="200" width="60" height="180" fill="@f"/><rect x="210" y="270" width="90" height="110" fill="@f"/><rect x="310" y="220" width="55" height="160" fill="@f"/><rect x="380" y="260" width="100" height="120" fill="@f"/><rect x="495" y="190" width="60" height="190" fill="@f"/>',
    hills: '<path d="M0 330 Q120 220 240 300 T520 280 T640 330 V380 H0Z" fill="@f"/>',
    harbour: '<path d="M0 340 H640 V480 H0Z" fill="@g"/><rect x="90" y="270" width="8" height="70" fill="@f"/><path d="M98 270 L160 335 H98Z" fill="@f"/><rect x="380" y="290" width="150" height="50" fill="@f"/>',
    towers: '<path d="M80 380 L100 160 L120 380Z" fill="@f"/><path d="M180 380 L200 110 L220 380Z" fill="@f"/><path d="M290 380 L315 190 L340 380Z" fill="@f"/><path d="M400 380 L420 140 L440 380Z" fill="@f"/><path d="M500 380 L520 220 L540 380Z" fill="@f"/>'
  }[l.shape].replace(/@f/g, l.far).replace(/@g/g, l.ground);
  const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${l.sky[0]}"/><stop offset="1" stop-color="${l.sky[1]}"/></linearGradient></defs><rect width="640" height="480" fill="url(#s)"/><circle cx="470" cy="150" r="46" fill="${l.sun}"/>${shapes}<rect y="370" width="640" height="110" fill="${l.ground}"/></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(out);
};
const SCENES: Record<string, Look> = {
  home: { sky: ['#8fb8e6', '#e7f0ee'], sun: '#fff1b0', ground: '#6d9b63', far: '#4f7f58', shape: 'hills' },
  barcelona: { sky: ['#f7b27a', '#fde5b8'], sun: '#fff5c9', ground: '#b78a62', far: '#d9a06a', shape: 'towers' },
  madrid: { sky: ['#1d2457', '#5a3a77'], sun: '#f3e7b8', ground: '#c4953f', far: '#2a2a55', shape: 'city' },
  chongqing: { sky: ['#a63a3a', '#f0a561'], sun: '#ffd37a', ground: '#7a3a2a', far: '#4a2323', shape: 'city' },
  harbour: { sky: ['#f4a259', '#f9d9a8'], sun: '#fff2c8', ground: '#35607a', far: '#1f3a4d', shape: 'harbour' }
};

// ---------- the demo board ----------
interface Stop { dx: number; dy: number; id: string; name: string; title: string; when: string; story: string; lat: number; lng: number; rot: number; scene: string }
const STOPS: Stop[] = [
  { id: 'a', name: 'Atlanta', title: 'Leaving home', when: 'Jun 1', story: 'Boarding pass in one hand, coffee in the other.', lat: 33.75, lng: -84.39, rot: -3, scene: 'home', dx: 0, dy: 0 },
  { id: 'b', name: 'Barcelona', title: 'Sagrada Família', when: 'Jun 3', story: 'Three hours in line. Worth every minute.', lat: 41.4, lng: 2.17, rot: 2, scene: 'barcelona', dx: 120, dy: -50 },
  { id: 'm', name: 'Madrid', title: 'Gran Vía at night', when: 'Jun 8', story: 'We walked until the shops closed and then kept walking.', lat: 40.42, lng: -3.7, rot: -2, scene: 'madrid', dx: -135, dy: 70 },
  { id: 'c', name: 'Chongqing', title: 'Hotpot in Chongqing', when: 'Jun 15', story: 'The spiciest thing I have ever eaten, and I went back twice.', lat: 29.56, lng: 106.55, rot: 3, scene: 'chongqing', dx: 0, dy: 0 }
];
const W = 1400, H = 760;
const view = (() => {
  const w = -128, e = 152, cx = (w + e) / 2;
  const ySpan = ((e - w) * Math.PI / 180) * (H / W), cy = mercY(36);
  return { w, e, yTop: cy + ySpan / 2, yBot: cy - ySpan / 2 };
})();

const cv = $<HTMLCanvasElement>('demoMap');
cv.width = W; cv.height = H;
const { px, py } = paintWorld(cv.getContext('2d')!, W, H, view, THEMES.paper, null);
const yarnSvg = document.getElementById('demoYarn') as unknown as SVGSVGElement;
yarnSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
yarnSvg.setAttribute('preserveAspectRatio', 'none');

/** Where the pin hangs. Cities close together are nudged apart so every photo stays clickable. */
const pos = (s: Stop) => ({ x: px(s.lng) + s.dx, y: py(s.lat) + s.dy });
let order: Stop[] = [];
let playing = 0;
const pols = new Map<string, HTMLButtonElement>();

for (const s of STOPS) {
  const { x, y } = pos(s);
  if (s.dx || s.dy) {   // thin line back to the real location
    const ns = 'http://www.w3.org/2000/svg', t = document.createElementNS(ns, 'line'), d = document.createElementNS(ns, 'circle');
    t.setAttribute('x1', String(px(s.lng))); t.setAttribute('y1', String(py(s.lat))); t.setAttribute('x2', String(x)); t.setAttribute('y2', String(y));
    t.setAttribute('class', 'tether'); d.setAttribute('cx', String(px(s.lng))); d.setAttribute('cy', String(py(s.lat))); d.setAttribute('r', '5'); d.setAttribute('class', 'spot');
    yarnSvg.append(t, d);
  } else {
    const ns = 'http://www.w3.org/2000/svg', d = document.createElementNS(ns, 'circle');
    d.setAttribute('cx', String(x)); d.setAttribute('cy', String(y)); d.setAttribute('r', '5'); d.setAttribute('class', 'spot'); yarnSvg.append(d);
  }
  const b = document.createElement('button');
  b.className = 'dpol'; b.type = 'button';
  b.style.left = (x / W * 100) + '%'; b.style.top = (y / H * 100) + '%';
  b.style.setProperty('--rot', s.rot + 'deg');
  b.setAttribute('aria-label', `${s.title}, ${s.name}`);
  b.innerHTML = `<span class="frame"><img alt="" src="${svg(SCENES[s.scene])}"><span class="cap">${s.title}</span></span><i class="pin"></i><span class="num"></span>`;
  b.onclick = () => choose(s);
  $('demoPols').append(b); pols.set(s.id, b);
}

function yarnPath(a: Stop, b: Stop) {
  const p = pos(a), q = pos(b), sag = Math.min(Math.hypot(q.x - p.x, q.y - p.y) * 0.2, 150);
  return `M${p.x} ${p.y} Q${(p.x + q.x) / 2} ${(p.y + q.y) / 2 + sag} ${q.x} ${q.y}`;
}
function addSegment(a: Stop, b: Stop) {
  const ns = 'http://www.w3.org/2000/svg';
  const mk = (cls: string) => { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', yarnPath(a, b)); p.setAttribute('class', cls); return p; };
  const sh = mk('yarn-shadow'), p = mk('yarn');
  yarnSvg.append(sh, p);
  for (const el of [sh, p]) {
    const len = (el as SVGPathElement).getTotalLength();
    el.style.strokeDasharray = String(len); el.style.strokeDashoffset = String(len);
    el.getBoundingClientRect();
    el.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(.5,.1,.2,1)';
    el.style.strokeDashoffset = '0';
  }
}
function showCard(s: Stop) {
  $('demoCard').hidden = false;
  ($('dcImg') as HTMLImageElement).src = svg(SCENES[s.scene]);
  $('dcTitle').textContent = s.title; $('dcWhere').textContent = `${s.name} · ${s.when}`; $('dcStory').textContent = s.story;
}
function choose(s: Stop) {
  const was = order.includes(s);
  if (!was) {
    const prev = order[order.length - 1];
    order.push(s);
    if (prev) addSegment(prev, s);
    pols.get(s.id)!.classList.add('on');
    pols.get(s.id)!.querySelector('.num')!.textContent = String(order.length);
  }
  document.querySelectorAll('.dpol.sel').forEach(e => e.classList.remove('sel'));
  pols.get(s.id)!.classList.add('sel');
  showCard(s);
  $('demoRoute').textContent = order.map(o => o.name).join(' → ') || ' ';
  $('resetDemo').hidden = false;
  $('demoHint').textContent = order.length === STOPS.length
    ? 'That’s a story. Open Wayframe to make your own.'
    : order.length ? `Stop ${order.length} of ${STOPS.length}. Keep going.` : 'Click the photos in the order you went';
}
function reset() {
  clearTimeout(playing); order = [];
  yarnSvg.querySelectorAll('path').forEach(p => p.remove());
  pols.forEach(p => { p.classList.remove('on', 'sel'); p.querySelector('.num')!.textContent = ''; });
  $('demoCard').hidden = true; $('demoRoute').textContent = ' '; $('resetDemo').hidden = true;
  $('demoHint').textContent = 'Click the photos in the order you went';
}
$('resetDemo').onclick = reset;
$('playDemo').onclick = () => {
  reset();
  $('try').scrollIntoView({ behavior: 'smooth', block: 'start' });
  let i = 0;
  const next = () => { if (i < STOPS.length) { choose(STOPS[i++]); playing = window.setTimeout(next, 1700); } };
  playing = window.setTimeout(next, 500);
};

// ---------- old-camera demo ----------
const lookImg = $<HTMLImageElement>('lookImg');
lookImg.src = svg(SCENES.harbour);
document.querySelectorAll<HTMLButtonElement>('.chips .chip').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('.chips .chip').forEach(c => c.classList.remove('on')); b.classList.add('on');
    lookImg.className = 'look-' + b.dataset.look;
  };
});
const stampToggle = $<HTMLInputElement>('stampToggle');
stampToggle.onchange = () => { $('lookStamp').hidden = !stampToggle.checked; };

// ---------- friends demo ----------
let following = 0;
document.querySelectorAll<HTMLButtonElement>('[data-follow]').forEach(b => {
  b.onclick = () => {
    const on = b.classList.toggle('on'); b.textContent = on ? 'Following' : 'Follow';
    following += on ? 1 : -1;
    $('peopleNote').textContent = following ? `Their shared stories would now appear on your map in blue.` : 'Example people. Press Follow.';
  };
});
document.querySelectorAll<HTMLElement>('.step').forEach(s => s.addEventListener('mouseenter', () => s.classList.add('hot')));

// ---------- from the community ----------
cloud.explorePhotos({ limit: 8 }).then(r => {
  const strip = $('strip');
  if (!r.cards.length) { $('stripNote').hidden = false; return; }
  r.cards.forEach((c, i) => {
    const a = document.createElement('a'); a.className = 'tile'; a.href = '/explore'; a.style.setProperty('--rot', (i % 2 ? 2 : -2) + 'deg');
    a.innerHTML = '<span class="frame"><img alt="" loading="lazy"><span class="cap"><b></b><small></small></span></span>';
    const im = a.querySelector('img')!; im.src = c.img!; im.className = 'look-' + c.look;
    a.querySelector('b')!.textContent = c.title || 'Untitled';
    a.querySelector('small')!.textContent = (c.place || '').split(',').slice(0, 2).join(',');
    strip.append(a);
  });
}).catch(() => { $('community').hidden = true; });
