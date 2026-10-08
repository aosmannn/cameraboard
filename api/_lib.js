// Shared by the share-preview functions: reads public data from Supabase with the same public key the website uses.
const URL_ = process.env.VITE_SUPABASE_URL || 'https://psuykzkrakkdqhulrqig.supabase.co';
const KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_mD_qa0pJwt0HT4DmergxzQ_3-QNS-bu';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { apikey: KEY, authorization: 'Bearer ' + KEY, 'content-type': 'application/json' };

async function rpc(name, body) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(name + ' ' + r.status);
  return r.json();
}
const cleanHandle = s => String(s || '').trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_.]/g, '');

/** Public photos for a key that is an account id, a username or an invite code. */
async function publicPhotos(key) {
  const tries = UUID.test(key) ? [{ uid: key }] : [{ handle: cleanHandle(key) }, { code: key }];
  for (const t of tries) {
    const rows = await rpc('public_photos', { code: t.code ?? null, handle: t.handle ?? null, uid: t.uid ?? null });
    if (rows.length) return { rows, who: t };
  }
  return { rows: [], who: tries[0] };
}
async function profile(who) {
  const rows = await rpc('profile_page', { code: who.code ?? null, handle: who.handle ?? null, uid: who.uid ?? null });
  return rows[0] || null;
}
/** A temporary link to one stored picture. */
async function signedImage(path) {
  const r = await fetch(`${URL_}/storage/v1/object/sign/photos/${path.split('/').map(encodeURIComponent).join('/')}`,
    { method: 'POST', headers, body: JSON.stringify({ expiresIn: 300 }) });
  if (!r.ok) return null;
  const { signedURL } = await r.json();
  return signedURL ? URL_ + '/storage/v1' + signedURL : null;
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const first = v => (Array.isArray(v) ? v[0] : v) || '';
/** The address the visitor used, so image links point at the same site. */
const origin = req => `https://${first(req.headers['x-forwarded-host']) || req.headers.host}`;

/** Puts the preview tags into a page's <head>, replacing the plain title and description. */
function withPreview(html, p) {
  const tags = [
    `<title>${esc(p.title)}</title>`,
    `<meta name="description" content="${esc(p.description)}">`,
    `<meta property="og:site_name" content="Wayframe">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(p.title)}">`,
    `<meta property="og:description" content="${esc(p.description)}">`,
    `<meta property="og:url" content="${esc(p.url)}">`,
    p.image ? `<meta property="og:image" content="${esc(p.image)}">` : '',
    `<meta name="twitter:card" content="${p.image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(p.title)}">`,
    `<meta name="twitter:description" content="${esc(p.description)}">`,
    p.image ? `<meta name="twitter:image" content="${esc(p.image)}">` : ''
  ].filter(Boolean).join('\n');
  return html.replace(/<title>[\s\S]*?<\/title>/i, '').replace(/<meta name="description"[^>]*>/i, '').replace(/<\/head>/i, tags + '\n</head>');
}
/** Place names in order without repeats: "Rome → Florence → Venice". */
const routeOf = places => {
  const out = [];
  for (const p of places) { const n = String(p || '').split(',')[0].trim(); if (n && !out.includes(n)) out.push(n); }   // each place once, even if the trip went back and forth
  return out.slice(0, 5).join(' → ') + (out.length > 5 ? ' …' : '');
};

module.exports = { publicPhotos, profile, signedImage, withPreview, routeOf, origin, first, esc };
