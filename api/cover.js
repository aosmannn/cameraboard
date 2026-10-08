// The picture shown in a link preview: a story's first photo, or a person's cover/first public photo.
const { publicPhotos, signedImage, first } = require('./_lib');

module.exports = async function handler(req, res) {
  try {
    const key = decodeURIComponent(first(req.query.key)), trip = first(req.query.t);
    const { rows } = await publicPhotos(key);
    const pool = trip ? rows.filter(r => r.trip === trip).sort((a, b) => a.seq - b.seq) : rows.filter(r => r.cover).concat(rows);
    const pick = pool.find(r => r.image_path);
    const url = pick && (await signedImage(pick.image_path));
    if (!url) { res.status(404).send('No picture'); return; }
    const img = await fetch(url);
    if (!img.ok) { res.status(404).send('No picture'); return; }
    res.setHeader('content-type', img.headers.get('content-type') || 'image/jpeg');
    res.setHeader('cache-control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.status(200).send(Buffer.from(await img.arrayBuffer()));
  } catch { res.status(404).send('No picture'); }
};
