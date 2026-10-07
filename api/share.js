// /s/<key>?t=<story> and /u/<key>: the normal page, plus preview tags so a link shows a title, a route and a photo
// when it is pasted into Discord, iMessage, Slack and the like (those apps don't run the page's JavaScript).
const { publicPhotos, profile, withPreview, routeOf, origin, first } = require('./_lib');

module.exports = async function handler(req, res) {
  const kind = first(req.query.kind) === 'profile' ? 'profile' : 'story';
  const key = decodeURIComponent(first(req.query.key));
  const trip = first(req.query.t);
  const base = origin(req);
  const page = await fetch(`${base}/${kind === 'story' ? 'story' : 'profile'}.html`).then(r => (r.ok ? r.text() : null)).catch(() => null);
  if (!page) { res.status(502).send('Wayframe is updating. Try again in a moment.'); return; }

  let preview = null;
  try {
    const { rows, who } = await publicPhotos(key);
    const pageUrl = `${base}${kind === 'story' ? '/s/' : '/u/'}${encodeURIComponent(key)}${kind === 'story' && trip ? '?t=' + encodeURIComponent(trip) : ''}`;
    const cover = `${base}/api/cover?key=${encodeURIComponent(key)}${kind === 'story' ? '&t=' + encodeURIComponent(trip) : ''}`;
    if (kind === 'story') {
      const stops = rows.filter(r => r.trip === trip).sort((a, b) => a.seq - b.seq || String(a.taken_at).localeCompare(String(b.taken_at)));
      if (stops.length) {
        const route = routeOf(stops.map(s => s.place));
        preview = {
          title: `${trip} · a story on Wayframe`,
          description: `${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}${route ? ': ' + route : ''}. By ${stops[0].owner_name || 'a traveler'}. See the route on the map.`,
          url: pageUrl, image: cover
        };
      }
    } else if (rows.length || who) {
      const p = await profile(who).catch(() => null);
      const name = p?.display_name || rows[0]?.owner_name || (p?.username ? '@' + p.username : '');
      if (name) {
        const stories = new Set(rows.filter(r => r.trip).map(r => r.trip)).size;
        preview = {
          title: `${name} on Wayframe`,
          description: [p?.bio, `${rows.length} public ${rows.length === 1 ? 'photo' : 'photos'}${stories ? `, ${stories} ${stories === 1 ? 'story' : 'stories'}` : ''} pinned on a world map.`].filter(Boolean).join(' · ').slice(0, 280),
          url: pageUrl, image: rows.length ? cover : ''
        };
      }
    }
  } catch { /* no preview is better than no page */ }

  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).send(preview ? withPreview(page, preview) : page);
};
