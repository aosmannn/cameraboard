import type { Card } from './types';
import { THEMES, type ThemeName, paintWorld, mercY } from './world';
import { placeKey } from './photo';

const W = 2400, H = 1600;
const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
  const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src;
});

interface Spot { rep: Card; n: number; lat: number; lng: number; x: number; y: number; bx: number; by: number }

/** Draws a printable poster of the given photos onto the canvas (2400 x 1600). */
export async function renderPoster(cv: HTMLCanvasElement, cards: Card[], title: string, themeName: ThemeName,
  visited: Set<string> | null, countries: number) {
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
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
  const PW = 250, PH = 300;
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

  const imgs = await Promise.all(spots.map(s => loadImg(s.rep.img!)));
  ctx.lineWidth = 3; ctx.strokeStyle = '#e4572e';
  for (const s of spots) {
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.bx, s.by + PH / 2); ctx.stroke();
    ctx.fillStyle = '#e4572e'; ctx.beginPath(); ctx.arc(s.x, s.y, 11, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = '#e4572e';
  }
  spots.forEach((s, i) => {
    const x = s.bx - PW / 2, y = s.by - PH / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#fffdf8'; ctx.fillRect(x, y, PW, PH); ctx.restore();
    const im = imgs[i], bw = PW - 28, bh = 210, r = Math.max(bw / im.width, bh / im.height);
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
  const dates = cards.map(c => c.date).filter(Boolean).sort();
  const years = dates.length ? (dates[0].slice(0, 4) === dates[dates.length - 1].slice(0, 4) ? dates[0].slice(0, 4) : `${dates[0].slice(0, 4)}–${dates[dates.length - 1].slice(0, 4)}`) : '';
  ctx.fillStyle = 'rgba(255,255,255,.88)'; ctx.fillRect(0, H - 150, W, 150);
  ctx.textAlign = 'left'; ctx.fillStyle = '#1c1c1a'; ctx.font = 'bold 70px DM Sans, sans-serif';
  ctx.fillText(title || 'My travels', 60, H - 70);
  ctx.font = '34px DM Sans, sans-serif'; ctx.fillStyle = '#76736b';
  ctx.fillText([`${cards.filter(c => c.img).length} photos`, `${countries} countries`, years].filter(Boolean).join('  ·  '), 60, H - 25);
  ctx.textAlign = 'right'; ctx.font = '30px DM Sans, sans-serif';
  ctx.fillText('Made with Wayframe', W - 60, H - 25);
}
