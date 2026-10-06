// A small drawn map of a route: the world painted from our own data, numbered pins, and red string between them.
import { THEMES, paintWorld, mercY } from './world';

export interface RouteStop { lat: number; lng: number; img: string; title: string; n?: number }
export interface RouteMap {
  select(i: number): void;
  showAll(): void;
  play(onStep?: (i: number) => void, onDone?: () => void): void;
  stop(): void;
}
const W = 1400, H = 760, NS = 'http://www.w3.org/2000/svg';

/** A view (in degrees, Mercator y) that holds every stop with some room around it. */
function fit(stops: RouteStop[]) {
  const lats = stops.map(s => s.lat), lngs = stops.map(s => s.lng);
  const w0 = Math.min(...lngs), e0 = Math.max(...lngs);
  const cx = (w0 + e0) / 2;
  const y0 = mercY(Math.min(...lats)), y1 = mercY(Math.max(...lats)), cy = (y0 + y1) / 2;
  let spanRad = Math.max((e0 - w0) * 1.5, 14) * Math.PI / 180;
  let ySpan = Math.max((y1 - y0) * 1.6, 0.05);
  if (spanRad / ySpan > W / H) ySpan = spanRad * H / W; else spanRad = ySpan * W / H;
  const spanDeg = Math.min(spanRad * 180 / Math.PI, 360);
  if (spanDeg >= 360) { ySpan = (2 * Math.PI) * H / W; return { w: -180, e: 180, yTop: cy + ySpan / 2, yBot: cy - ySpan / 2 }; }
  return { w: cx - spanDeg / 2, e: cx + spanDeg / 2, yTop: cy + ySpan / 2, yBot: cy - ySpan / 2 };
}

export function mountRouteMap(host: HTMLElement, stops: RouteStop[], o: { yarn?: boolean; onSelect?: (i: number) => void } = {}): RouteMap {
  const yarn = o.yarn !== false;
  host.classList.add('routemap'); host.innerHTML = '';
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.setAttribute('aria-hidden', 'true');
  const view = fit(stops);
  const { px, py } = paintWorld(cv.getContext('2d')!, W, H, view, THEMES.paper, null);
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
  host.append(cv, svg);

  const pos = stops.map(s => ({ x: px(s.lng), y: py(s.lat) }));
  const segs: SVGPathElement[][] = [];   // segs[i] joins stop i-1 to stop i
  if (yarn) {
    for (let i = 0; i < stops.length; i++) {
      segs[i] = [];
      if (!i) continue;
      const a = pos[i - 1], b = pos[i], d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d < 3) continue;
      const path = `M${a.x} ${a.y} Q${(a.x + b.x) / 2} ${(a.y + b.y) / 2 + Math.min(d * 0.2, 150)} ${b.x} ${b.y}`;
      for (const cls of ['yarn-shadow', 'yarn']) {
        const p = document.createElementNS(NS, 'path'); p.setAttribute('d', path); p.setAttribute('class', cls); svg.append(p); segs[i].push(p);
      }
    }
  }
  const pins: HTMLButtonElement[] = stops.map((s, i) => {
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'rpin' + (yarn ? '' : ' plain');
    b.style.left = pos[i].x / W * 100 + '%'; b.style.top = pos[i].y / H * 100 + '%';
    b.textContent = yarn ? String(s.n ?? i + 1) : '';
    b.setAttribute('aria-label', yarn ? `Stop ${s.n ?? i + 1}: ${s.title}` : s.title);
    b.onclick = () => { select(i); o.onSelect?.(i); };
    host.append(b); return b;
  });
  let pop: HTMLElement | null = null, timer = 0, cur = -1;

  function select(i: number) {
    cur = i;
    pins.forEach((p, k) => p.classList.toggle('sel', k === i));
    pop?.remove();
    const s = stops[i]; if (!s) return;
    pop = document.createElement('div'); pop.className = 'rpop';
    const im = new Image(); im.src = s.img; im.alt = '';
    const t = document.createElement('span'); t.textContent = s.title;
    pop.append(im, t);
    // keep the photo inside the map near the edges
    const x = Math.min(88, Math.max(12, pos[i].x / W * 100));
    pop.style.left = x + '%'; pop.style.top = Math.max(pos[i].y / H * 100, 30) + '%';
    host.append(pop);
  }
  const draw = (list: SVGPathElement[]) => {
    for (const el of list) {
      const len = el.getTotalLength();
      el.style.transition = 'none'; el.style.strokeDasharray = String(len); el.style.strokeDashoffset = String(len);
      el.getBoundingClientRect();
      el.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(.5,.1,.2,1)'; el.style.strokeDashoffset = '0';
    }
  };
  const clear = (list: SVGPathElement[]) => { for (const el of list) { el.style.transition = 'none'; el.style.strokeDasharray = 'none'; el.style.strokeDashoffset = '0'; el.style.opacity = '0'; } };
  const unclear = (list: SVGPathElement[]) => { for (const el of list) el.style.opacity = ''; };

  function stop() { clearTimeout(timer); timer = 0; }
  return {
    select,
    showAll() { stop(); segs.forEach(l => { unclear(l); l.forEach(e => { e.style.strokeDasharray = 'none'; e.style.strokeDashoffset = '0'; }); }); pins.forEach(p => p.classList.remove('off')); },
    stop,
    play(onStep, onDone) {
      stop(); segs.forEach(clear); pins.forEach(p => p.classList.add('off'));
      let i = 0;
      const step = () => {
        if (i >= stops.length) { pins.forEach(p => p.classList.remove('off')); onDone?.(); return; }
        pins[i].classList.remove('off'); select(i); onStep?.(i);
        if (segs[i]?.length) { unclear(segs[i]); draw(segs[i]); }
        i++; timer = window.setTimeout(step, 2200);
      };
      step();
    },
  };
}
