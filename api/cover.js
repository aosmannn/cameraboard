// The picture shown in a link preview: a Wayframe card with the story's title, route and a few of its photos on
// polaroids. If the card can't be drawn for any reason, it falls back to the plain first photo.
const fs = require('fs');
const path = require('path');
const satori = require('satori').default;
const { Resvg } = require('@resvg/resvg-js');
const { publicPhotos, profile, signedImage, first } = require('./_lib');

const A = f => path.join(__dirname, '_assets', f);
const read = f => fs.readFileSync(A(f));
const h = (type, style, children, props = {}) => ({ type, props: { ...props, style, children } });
const INK = '#231f19', RED = '#b3242c', PAPER = '#fffdf8';

async function photoData(p) {
  const url = p && p.image_path && (await signedImage(p.image_path));
  if (!url) return null;
  const r = await fetch(url);
  if (!r.ok) return null;
  return 'data:' + (r.headers.get('content-type') || 'image/jpeg') + ';base64,' + Buffer.from(await r.arrayBuffer()).toString('base64');
}
/** Up to three photos spread across the story, so the card shows its range. */
const spread = (list, n = 3) => (list.length <= n ? list : Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]));
const uniquePlaces = rows => { const seen = []; for (const r of rows) { const n = String(r.place || '').split(',')[0].trim(); if (n && !seen.includes(n)) seen.push(n); } return seen; };
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

function polaroid(src, caption, left, top, rot, w) {
  const photoH = Math.round(w * 0.82);
  return h('div', { position: 'absolute', left, top, width: w, display: 'flex', flexDirection: 'column', background: PAPER, padding: '12px 12px 0 12px',
    transform: `rotate(${rot}deg)`, boxShadow: '0 14px 30px rgba(42,32,20,.28)' }, [
    h('img', { width: w - 24, height: photoH, objectFit: 'cover' }, undefined, { src }),
    h('div', { display: 'flex', justifyContent: 'center', alignItems: 'center', height: 54, fontFamily: 'Caveat', fontWeight: 700, fontSize: 30, color: '#2b2118' }, clip(caption || '', 18)),
    h('div', { position: 'absolute', top: -9, left: w / 2 - 10, width: 20, height: 20, borderRadius: 10, background: '#d33a2c', boxShadow: '1px 3px 3px rgba(0,0,0,.4)' }, '')
  ]);
}

async function card(key, trip) {
  const { rows, who } = await publicPhotos(key);
  let title, route, meta, shots;
  if (trip) {
    const stops = rows.filter(r => r.trip === trip).sort((a, b) => a.seq - b.seq || String(a.taken_at).localeCompare(String(b.taken_at)));
    if (!stops.length) return null;
    const places = uniquePlaces(stops);
    title = trip; route = places.slice(0, 4).join(',  ') + (places.length > 4 ? ' …' : '');
    meta = `${stops.length} ${stops.length === 1 ? 'stop' : 'stops'} · by ${stops[0].owner_name || 'a traveler'}`;
    shots = spread(stops.filter(r => r.image_path));
  } else {
    if (!rows.length) return null;
    const p = await profile(who).catch(() => null);
    const name = p?.display_name || rows[0].owner_name || 'A traveler';
    const places = uniquePlaces(rows);
    title = name; route = places.slice(0, 4).join(', ') + (places.length > 4 ? ' …' : '');
    meta = `${rows.length} public ${rows.length === 1 ? 'photo' : 'photos'}${p?.username ? ' · @' + p.username : ''}`;
    shots = spread((rows.filter(r => r.cover).concat(rows)).filter((r, i, a) => r.image_path && a.findIndex(x => x.id === r.id && x.image_path === r.image_path) === i));
  }
  const imgs = (await Promise.all(shots.map(photoData))).map((src, i) => ({ src, cap: shots[i].title })).filter(x => x.src);
  if (!imgs.length) return null;

  const big = title.length > 34 ? 56 : title.length > 22 ? 68 : 82;
  const slots = [[640, 70, -6], [830, 250, 4], [600, 300, -2]].slice(0, imgs.length);
  if (imgs.length === 1) slots[0] = [700, 150, -3];
  const logo = 'data:image/svg+xml;base64,' + read('logo-mark.svg').toString('base64');
  const W = imgs.length === 1 ? 330 : 300;
  const tree = h('div', { display: 'flex', position: 'relative', width: 1200, height: 630, background: 'linear-gradient(135deg,#d7e5e3,#bcd3d6 55%,#a9c5c9)', fontFamily: 'DM Sans' }, [
    // soft landmasses behind the photos, like the map
    h('div', { position: 'absolute', left: 560, top: 30, width: 330, height: 230, borderRadius: 140, background: '#e6d6b3', opacity: .7, transform: 'rotate(-8deg)' }, ''),
    h('div', { position: 'absolute', left: 800, top: 330, width: 360, height: 250, borderRadius: 150, background: '#e6d6b3', opacity: .7, transform: 'rotate(10deg)' }, ''),
    ...(imgs.length > 1 ? [h('svg', { position: 'absolute', left: 0, top: 0 }, [
      { type: 'path', props: { d: 'M760 150 Q860 300 975 330 T 740 430', fill: 'none', stroke: RED, strokeWidth: 6, strokeLinecap: 'round' } }
    ], { width: 1200, height: 630, viewBox: '0 0 1200 630' })] : []),
    ...imgs.map((im, i) => polaroid(im.src, im.cap, slots[i][0], slots[i][1], slots[i][2], W)),
    h('div', { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: 560, height: 630, padding: '52px 0 52px 64px' }, [
      h('div', { display: 'flex', alignItems: 'center' }, [
        h('img', { width: 56, height: 56 }, undefined, { src: logo }),
        h('div', { display: 'flex', marginLeft: 14, fontFamily: 'Instrument Serif', fontSize: 50, color: INK }, [
          h('span', {}, 'Way'), h('span', { fontStyle: 'italic', color: RED }, 'frame')])
      ]),
      h('div', { display: 'flex', flexDirection: 'column' }, [
        h('div', { fontFamily: 'Instrument Serif', fontSize: big, lineHeight: 1.02, color: INK, letterSpacing: -1 }, clip(title, 46)),
        h('div', { marginTop: 18, fontFamily: 'Caveat', fontWeight: 700, fontSize: 40, color: RED, lineHeight: 1.1 }, clip(route, 60))
      ]),
      h('div', { fontSize: 28, fontWeight: 500, color: '#3a342b' }, meta)
    ])
  ]);
  const fonts = [
    { name: 'Instrument Serif', data: read('instrument-serif-latin-400-normal.woff'), weight: 400, style: 'normal' },
    { name: 'Instrument Serif', data: read('instrument-serif-latin-400-italic.woff'), weight: 400, style: 'italic' },
    { name: 'DM Sans', data: read('dm-sans-latin-500-normal.woff'), weight: 500, style: 'normal' },
    { name: 'DM Sans', data: read('dm-sans-latin-700-normal.woff'), weight: 700, style: 'normal' },
    { name: 'Caveat', data: read('caveat-latin-700-normal.woff'), weight: 700, style: 'normal' }
  ];
  const svg = await satori(tree, { width: 1200, height: 630, fonts });
  return { type: 'image/png', body: new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng() };
}

async function plainPhoto(key, trip) {
  const { rows } = await publicPhotos(key);
  const pool = trip ? rows.filter(r => r.trip === trip).sort((a, b) => a.seq - b.seq) : rows.filter(r => r.cover).concat(rows);
  const pick = pool.find(r => r.image_path);
  const url = pick && (await signedImage(pick.image_path));
  if (!url) return null;
  const img = await fetch(url);
  return img.ok ? { type: img.headers.get('content-type') || 'image/jpeg', body: Buffer.from(await img.arrayBuffer()) } : null;
}

module.exports = async function handler(req, res) {
  const key = decodeURIComponent(first(req.query.key)), trip = first(req.query.t);
  let out = null;
  if (first(req.query.plain) !== '1') out = await card(key, trip).catch(e => { console.error('card failed', e); return null; });
  if (!out) out = await plainPhoto(key, trip).catch(() => null);
  if (!out) { res.status(404).send('No picture'); return; }
  res.setHeader('content-type', out.type);
  res.setHeader('cache-control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(out.body);
};
