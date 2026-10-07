// A person's public page: a map of where they've been, their stories, and their public photos.
import * as cloud from './cloud';
import type { Card } from './types';
import { mountShell, el, $, routeOf, fmtDate, setTitle, pathPart, isUuid, initialOf, authReady } from './site';
import { tile, openLightbox } from './gallery-ui';
import { mountRouteMap } from './routemap';

mountShell('explore');
const root = $('root');
const key = pathPart(1);

function missing(msg: string) {
  root.innerHTML = '';
  const e = el('div', 'empty'); e.append(el('h2', '', 'Profile not found'), el('p', '', msg));
  const a = el('a', 'btn primary', 'Explore the gallery'); a.href = '/explore'; e.append(a); root.append(e);
  setTitle('Profile not found');
}

async function main() {
  if (!key) return missing('This link is missing part of its address.');
  const who: { id?: string; handle?: string; code?: string }[] = isUuid(key) ? [{ id: key }] : [{ handle: key }, { code: key }];
  let card: cloud.PublicCard | null = null, photos: { cards: Card[]; owners: Map<string, string> } = { cards: [], owners: new Map() };
  for (const w of who) {
    [card, photos] = await Promise.all([cloud.publicCard(w), cloud.publicPhotos(w)]);
    if (card || photos.cards.length) break;
  }
  if (!card && !photos.cards.length) return missing('That person may not exist, or has nothing public. Check the link.');
  const cards = photos.cards;
  const id = card?.id ?? cards[0]?.owner ?? '';
  const name = card?.display_name || photos.owners.get(id) || (card?.username ? '@' + card.username : 'A traveler');
  setTitle(name);
  await authReady;

  root.innerHTML = '';
  const head = el('section', 'person-head');
  head.append(el('span', 'ava-big', initialOf(name)));
  const stories = new Map<string, Card[]>();
  for (const c of cards) if (c.trip) (stories.get(c.trip) ?? stories.set(c.trip, []).get(c.trip)!).push(c);
  const txt = el('div', 'grow'); txt.append(el('h1', '', name));
  if (card?.username) txt.append(el('p', 'sub', '@' + card.username));
  const stats = el('div', 'ig-stats');
  for (const [n, l] of [[card?.photos ?? cards.length, 'photos'], [card?.stories ?? stories.size, 'stories'], [card?.followers, 'followers'], [card?.following, 'following']] as const) {
    if (n === undefined) continue; const s = el('span'); s.append(el('b', '', String(n)), ' ' + l); stats.append(s);
  }
  txt.append(stats);
  if (card?.bio) txt.append(el('p', 'ig-bio', card.bio));
  head.append(txt);
  const act = el('div', 'act');
  const me = cloud.me();
  if (id && me?.id === id) { const a = el('a', 'btn', 'Edit my profile'); a.href = '/app.html?account=1'; act.append(a); }
  else if (id && me) {
    const f = el('button', 'btn primary', 'Follow'); f.type = 'button';
    let on = false;
    cloud.connections().then(cs => { on = cs.some(c => c.id === id && c.i_follow); paint(); });
    const paint = () => { f.textContent = on ? 'Following' : 'Follow'; f.className = 'btn' + (on ? '' : ' primary'); };
    f.onclick = async () => { f.disabled = true; try { if (on) await cloud.unfollow(id); else await cloud.follow(id); on = !on; paint(); } catch (e) { f.textContent = 'Couldn’t update'; console.warn(e); } f.disabled = false; };
    const rep = el('button', 'btn', 'Report'); rep.type = 'button';
    rep.onclick = async () => { const why = prompt('What is wrong with this profile? A moderator will take a look.'); if (!why) return; try { await cloud.reportUser(id, why); rep.textContent = 'Reported. Thanks.'; rep.disabled = true; } catch { rep.textContent = 'Couldn’t send that'; } };
    act.append(f, rep);
  } else if (id) {
    const a = el('a', 'btn primary', 'Sign in to follow'); a.href = '/app.html?account=1'; act.append(a);
  }
  head.append(act);
  root.append(head);

  if (!cards.length) { const e = el('div', 'empty'); e.append(el('h2', '', 'Nothing public yet'), el('p', '', `${name} hasn't made any photos public.`)); root.append(e); return; }

  const placed = cards.filter(c => c.lat != null && c.lng != null);
  if (placed.length) {
    root.append(el('h2', 'section-title', 'Where they’ve been'));
    const host = el('div'); root.append(host);
    // each story gets its red string, in the order of its stops
    const at = new Map(placed.map((c, i) => [c.id, i] as const));
    const links: [number, number][] = [];
    for (const list of stories.values()) {
      const route = [...list].sort((a, b) => a.seq - b.seq).filter(c => at.has(c.id));
      for (let i = 1; i < route.length; i++) links.push([at.get(route[i - 1].id)!, at.get(route[i].id)!]);
    }
    mountRouteMap(host, placed.map(c => ({ lat: c.lat!, lng: c.lng!, img: c.img!, title: c.title || 'Untitled' })), { links });
  }
  if (stories.size) {
    root.append(el('h2', 'section-title', 'Stories'));
    const grid = el('div', 'cards');
    for (const [trip, list] of stories) {
      list.sort((a, b) => a.seq - b.seq);
      const a = el('a', 'card'); a.href = `/s/${id}?t=${encodeURIComponent(trip)}`;
      const th = el('div', 'thumb'); const im = new Image(); im.src = (list.find(c => c.cover) ?? list[0]).img!; im.alt = ''; im.loading = 'lazy'; th.append(im);
      const body = el('div', 'body'); body.append(el('h3', '', trip));
      const route = routeOf(list.map(c => c.place)); if (route) body.append(el('p', 'route-line', route));
      body.append(el('small', '', `${list.length} ${list.length === 1 ? 'stop' : 'stops'} · ${fmtDate(list[0].date, { month: 'short', year: 'numeric' })}`));
      a.append(th, body); grid.append(a);
    }
    root.append(grid);
  }
  root.append(el('h2', 'section-title', 'Photos'));
  const wall = el('div', 'wall');
  cards.forEach((c, i) => wall.append(tile(c, '', () => openLightbox(cards, i, photos.owners))));
  root.append(wall);
}
main().catch(err => missing('Couldn’t load it: ' + (err as Error).message));
