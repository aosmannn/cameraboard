import type { Card } from './types';
import { THEMES, type ThemeName, paintWorld, mercY, zonesLoaded } from './world';
import { placeKey } from './photo';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

const W = 2400, H = 1600;
const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
  const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src;
});

interface Spot { rep: Card; n: number; lat: number; lng: number; x: number; y: number; bx: number; by: number }

export interface PosterOpts { handle?: string }
const LINK_BLUE = '#1a5fd0';
const PW = 250, PH = 300;

export interface Prepared {
  cards: Card[]; base: HTMLCanvasElement; spots: Spot[]; imgs: HTMLImageElement[];
  px: (lng: number) => number; py: (lat: number) => number;
  byStory: Map<string, Card[]>; countries: number;
}

/** Does the slow work once (map, layout, photos) so a poster or every GIF frame can reuse it. */
export async function preparePoster(cards: Card[], themeName: ThemeName, visited: Set<string> | null, countries: number): Promise<Prepared> {
  await Promise.all(['34px Caveat', 'bold 30px DM Sans', '30px DM Sans'].map(f => document.fonts.load(f).catch(() => [])));   // canvas text needs them ready
  await zonesLoaded();
  const base = document.createElement('canvas'); base.width = W; base.height = H;
  const ctx = base.getContext('2d')!;
  const theme = THEMES[themeName];

  // one spot per place, showing the cover photo
  const groups = new Map<string, Card[]>();
  for (const c of cards) if (c.img && c.lat != null) (groups.get(placeKey(c)) ?? groups.set(placeKey(c), []).get(placeKey(c))!).push(c);
  const spots: Spot[] = [...groups.values()].map(g => {
    const rep = g.find(c => c.cover) ?? g[0];
    return { rep, n: g.length, lat: rep.lat!, lng: rep.lng!, x: 0, y: 0, bx: 0, by: 0 };
  });

  // view: fit the photos with room around them, keeping pixels square
  let w = -170, e = 170, yTop = mercY(78), yBot = mercY(-56);
  if (spots.length) {
    const lngs = spots.map(s => s.lng), ys = spots.map(s => mercY(s.lat));
    let spanX = Math.max(Math.max(...lngs) - Math.min(...lngs), 22) * 1.9;
    const spanYrad = Math.max(Math.max(...ys) - Math.min(...ys), 0.3) * 1.9;
    spanX = Math.min(360, Math.max(spanX, (spanYrad * 180 / Math.PI) * (W / H)));
    const cx = (Math.max(...lngs) + Math.min(...lngs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    const ySpan = (spanX * Math.PI / 180) * (H / W);
    w = cx - spanX / 2; e = cx + spanX / 2; yTop = cy + ySpan / 2; yBot = cy - ySpan / 2;
  }
  const { px, py } = paintWorld(ctx, W, H, { w, e, yTop, yBot }, theme, visited);

  // polaroids: start above each point, then push overlapping ones apart
  for (const s of spots) { s.x = px(s.lng); s.y = py(s.lat); s.bx = s.x; s.by = s.y - PH / 2 - 40; }
  for (let it = 0; it < 80; it++) {
    for (const a of spots) for (const b of spots) {
      if (a === b) continue;
      const dx = b.bx - a.bx, dy = b.by - a.by;
      if (Math.abs(dx) < PW + 14 && Math.abs(dy) < PH + 14) {
        const push = 4, d = Math.hypot(dx, dy) || 1;
        a.bx -= (dx / d) * push; a.by -= (dy / d) * push; b.bx += (dx / d) * push; b.by += (dy / d) * push;
      }
    }
    for (const s of spots) {
      s.bx = Math.min(W - PW / 2 - 30, Math.max(PW / 2 + 30, s.bx));
      s.by = Math.min(s.y - PH / 2 - 26, H - PH / 2 - 170);   // keep the polaroid above its own dot
      s.by = Math.max(PH / 2 + 30, s.by);
    }
  }

  const byStory = new Map<string, Card[]>();
  for (const c of cards) if (c.trip && c.img && c.lat != null) (byStory.get(c.trip) ?? byStory.set(c.trip, []).get(c.trip)!).push(c);
  for (const list of byStory.values()) list.sort((a, b) => a.seq - b.seq);

  const imgs = await Promise.all(spots.map(s => loadImg(s.rep.img!)));
  return { cards, base, spots, imgs, px, py, byStory, countries };
}

/** The point a fraction t along the string between two stops (it sags a little, like real string). */
function stringAt(P: Prepared, a: Card, b: Card, t: number) {
  const ax = P.px(a.lng!), ay = P.py(a.lat!), bx = P.px(b.lng!), by = P.py(b.lat!);
  const sag = Math.min(Math.hypot(bx - ax, by - ay) * 0.2, 260), cx = (ax + bx) / 2, cy = (ay + by) / 2 + sag;
  const u = 1 - t;
  return { x: u * u * ax + 2 * u * t * cx + t * t * bx, y: u * u * ay + 2 * u * t * cy + t * t * by };
}

export interface Frame {
  /** Which spots are showing; null = all. */
  shown?: Set<Spot> | null;
  /** How much of each string is drawn, by index of the stop it runs to; missing = all. */
  stringTo?: (storyKey: string, i: number) => number;
}

/** Draws the poster (or one frame of the GIF) onto a 2400 x 1600 canvas. */
/** Returns where the "Wayframe" word sits, as fractions of the poster, so a link can be laid over it. */
export function paintPoster(cv: HTMLCanvasElement, P: Prepared, title: string, opts: PosterOpts = {}, frame: Frame = {}) {
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(P.base, 0, 0);
  const shown = (s: Spot) => !frame.shown || frame.shown.has(s);

  // red string between the stops of each story, under the polaroids
  ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = '#b3242c'; ctx.lineWidth = 5;
  ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowOffsetY = 4; ctx.shadowBlur = 4;
  for (const [key, list] of P.byStory) {
    for (let i = 1; i < list.length; i++) {
      const frac = frame.stringTo ? frame.stringTo(key, i) : 1;
      if (frac <= 0) continue;
      ctx.beginPath(); const a = stringAt(P, list[i - 1], list[i], 0); ctx.moveTo(a.x, a.y);
      const steps = Math.max(2, Math.round(40 * frac));
      for (let k = 1; k <= steps; k++) { const q = stringAt(P, list[i - 1], list[i], (frac * k) / steps); ctx.lineTo(q.x, q.y); }
      ctx.stroke();
    }
  }
  ctx.restore();

  ctx.lineWidth = 3; ctx.strokeStyle = '#e4572e';
  for (const s of P.spots) {
    if (!shown(s)) continue;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.bx, s.by + PH / 2); ctx.stroke();
    ctx.fillStyle = '#e4572e'; ctx.beginPath(); ctx.arc(s.x, s.y, 11, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = '#e4572e';
  }
  P.spots.forEach((s, i) => {
    if (!shown(s)) return;
    const x = s.bx - PW / 2, y = s.by - PH / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#fffdf8'; ctx.fillRect(x, y, PW, PH); ctx.restore();
    const im = P.imgs[i], bw = PW - 28, bh = 210, r = Math.max(bw / im.width, bh / im.height);
    ctx.save(); ctx.beginPath(); ctx.rect(x + 14, y + 14, bw, bh); ctx.clip();
    ctx.drawImage(im, x + 14 + (bw - im.width * r) / 2, y + 14 + (bh - im.height * r) / 2, im.width * r, im.height * r);
    ctx.restore();
    ctx.fillStyle = '#2b2118'; ctx.font = '34px Caveat, cursive'; ctx.textAlign = 'center';
    ctx.fillText((s.rep.title || 'Untitled').slice(0, 22), s.bx, y + PH - 30);
    if (s.n > 1) {
      ctx.fillStyle = '#e4572e'; ctx.beginPath(); ctx.arc(x + PW - 8, y + 8, 24, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 26px DM Sans, sans-serif'; ctx.fillText(String(s.n), x + PW - 8, y + 18);
    }
  });

  // title block
  const cards = P.cards;
  const dates = cards.map(c => c.date).filter(Boolean).sort();
  const years = dates.length ? (dates[0].slice(0, 4) === dates[dates.length - 1].slice(0, 4) ? dates[0].slice(0, 4) : `${dates[0].slice(0, 4)}–${dates[dates.length - 1].slice(0, 4)}`) : '';
  ctx.fillStyle = 'rgba(255,255,255,.88)'; ctx.fillRect(0, H - 150, W, 150);
  ctx.textAlign = 'left'; ctx.fillStyle = '#1c1c1a'; ctx.font = 'bold 70px DM Sans, sans-serif';
  ctx.fillText(title || 'My travels', 60, H - 70);
  ctx.font = '34px DM Sans, sans-serif'; ctx.fillStyle = '#76736b';
  ctx.fillText([`${cards.filter(c => c.img).length} photos`, `${P.countries} countries`, years].filter(Boolean).join('  ·  '), 60, H - 25);

  // who made it, and "Wayframe" in link blue (the poster preview lays a real link over this spot)
  const right = W - 60;
  if (opts.handle) { ctx.font = 'bold 40px DM Sans, sans-serif'; ctx.fillStyle = '#1c1c1a'; ctx.textAlign = 'right'; ctx.fillText(opts.handle, right, H - 78); }
  ctx.textAlign = 'left'; ctx.font = '30px DM Sans, sans-serif';
  const made = 'Made with ', name = 'Wayframe';
  const mw = ctx.measureText(made).width;
  ctx.font = 'bold 30px DM Sans, sans-serif';
  const nw = ctx.measureText(name).width, x = right - nw - mw;
  ctx.font = '30px DM Sans, sans-serif'; ctx.fillStyle = '#76736b'; ctx.fillText(made, x, H - 25);
  ctx.font = 'bold 30px DM Sans, sans-serif'; ctx.fillStyle = LINK_BLUE; ctx.fillText(name, x + mw, H - 25);
  ctx.fillRect(x + mw, H - 19, nw, 3);
  return { x: (x + mw) / W, y: (H - 58) / H, w: nw / W, h: 46 / H };
}

/** Draws a printable poster of the given photos onto the canvas (2400 x 1600). */
export async function renderPoster(cv: HTMLCanvasElement, cards: Card[], title: string, themeName: ThemeName,
  visited: Set<string> | null, countries: number, opts: PosterOpts = {}) {
  return paintPoster(cv, await preparePoster(cards, themeName, visited, countries), title, opts);
}

/** An animated GIF of a story: the string is drawn stop by stop and each photo is pinned as it is reached. */
export async function renderStoryGif(cards: Card[], title: string, themeName: ThemeName, countries: number, opts: PosterOpts = {},
  onProgress: (done: number, total: number) => void = () => {}): Promise<Blob> {
  const P = await preparePoster(cards, themeName, null, countries);
  const story = [...P.byStory.values()][0] ?? [];
  const spotOf = (c: Card) => P.spots.find(s => placeKey(s.rep) === placeKey(c))!;
  const key = [...P.byStory.keys()][0] ?? '';
  const GW = 1200, GH = 800;
  const full = document.createElement('canvas'), small = document.createElement('canvas'); small.width = GW; small.height = GH;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  const grab = () => { sctx.drawImage(full, 0, 0, GW, GH); return sctx.getImageData(0, 0, GW, GH).data; };

  // the order things appear in: [spots showing, how far the string to stop i has been drawn, how long to wait]
  type Step = { shown: Set<Spot>; i: number; frac: number; delay: number };
  const steps: Step[] = [], shown = new Set<Spot>();
  const lerp = story.length > 10 ? [1] : [0.5, 1];
  story.forEach((c, i) => {
    if (i > 0) for (const f of lerp) steps.push({ shown: new Set(shown), i, frac: f, delay: 110 });
    shown.add(spotOf(c));
    steps.push({ shown: new Set(shown), i: i + 1, frac: 1, delay: i === story.length - 1 ? 3200 : 650 });
  });
  if (!steps.length) steps.push({ shown: new Set(), i: 0, frac: 1, delay: 1000 });

  const frames: { data: Uint8ClampedArray; delay: number }[] = [];
  for (let n = 0; n < steps.length; n++) {
    const st = steps[n];
    paintPoster(full, P, title, opts, { shown: st.shown, stringTo: (k, i) => (k !== key ? 1 : i < st.i ? 1 : i === st.i ? st.frac : 0) });
    frames.push({ data: new Uint8ClampedArray(grab()), delay: st.delay });
    onProgress(n + 1, steps.length);
    await new Promise(r => setTimeout(r));          // let the page breathe
  }
  // one palette, taken from the finished frame, keeps the file small and the colors steady
  const palette = quantize(frames[frames.length - 1].data, 256);
  const gif = GIFEncoder();
  for (const f of frames) gif.writeFrame(applyPalette(f.data, palette), GW, GH, { palette, delay: f.delay });
  gif.finish();
  return new Blob([gif.bytes() as BlobPart], { type: 'image/gif' });
}
