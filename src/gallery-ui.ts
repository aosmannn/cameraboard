// Photo tiles and the lightbox, shared by Explore, profiles and camera pages.
import { mountReactions } from './reactions';
import type { Card } from './types';
import * as cloud from './cloud';
import { el, fmtDate, shortPlace, slugCamera } from './site';

const STAMP = (c: Card) => c.meta?.camera?.trim() || '';

// ---------- the heart on each polaroid ----------
/** A slightly wobbly, hand-drawn heart, to sit next to the handwritten title. */
const HEART = '<svg viewBox="0 0 28 26" aria-hidden="true"><path d="M14.2 23.4C8.6 19.2 3.4 15.3 3.3 10c0-3.3 2.5-5.8 5.6-5.8 2.1 0 4.2 1.2 5.3 3.2 1.2-2 3.2-3.2 5.3-3.2 3.2 0 5.7 2.5 5.6 5.8-.1 5.3-5.3 9.1-10.9 13.4z"/></svg>';
const heartLive = new Map<string, { likes: number; mine: boolean }>();
const heartButtons = new Map<string, Set<HTMLButtonElement>>();
const heartQueue = new Set<string>();
let heartTimer = 0;
function paintHeart(btn: HTMLButtonElement, v?: { likes: number; mine: boolean }) {
  btn.classList.toggle('on', !!v?.mine); btn.setAttribute('aria-pressed', String(!!v?.mine)); btn.setAttribute('aria-label', v?.mine ? 'Unlike' : 'Like');
  btn.querySelector('.n')!.textContent = v && v.likes > 0 ? String(v.likes) : '';
}
function setHeart(id: string, v: { likes: number; mine: boolean }) { heartLive.set(id, v); heartButtons.get(id)?.forEach(b => paintHeart(b, v)); }
/** One request for every heart that appeared in the last moment (up to 100 photos at a time). */
function flushHearts() {
  const ids = [...heartQueue]; heartQueue.clear();
  for (let i = 0; i < ids.length; i += 100) cloud.reactionCounts(ids.slice(i, i + 100)).then(m => m.forEach((r, id) => setHeart(id, { likes: r.likes, mine: r.mine }))).catch(() => { /* hearts just stay empty */ });
}
// the viewer's heart and a polaroid's heart for the same photo stay in step
document.addEventListener('wf-like', e => { const d = (e as CustomEvent<{ id: string; likes: number; mine: boolean }>).detail; setHeart(d.id, { likes: d.likes, mine: d.mine }); });
function heartFor(id: string): HTMLButtonElement {
  const b = el('button', 'tile-heart'); b.type = 'button';
  const ico = el('span', 'ico'); ico.innerHTML = HEART;   // fixed markup, no user text
  b.append(ico, el('span', 'n'));
  (heartButtons.get(id) ?? heartButtons.set(id, new Set()).get(id)!).add(b);
  paintHeart(b, heartLive.get(id));
  if (!heartLive.has(id)) { heartQueue.add(id); clearTimeout(heartTimer); heartTimer = window.setTimeout(flushHearts, 40); }
  b.onclick = e => {
    e.stopPropagation();
    if (!cloud.me()) { location.href = '/app.html?account=1'; return; }
    const was = heartLive.get(id) ?? { likes: 0, mine: false };
    const now = { mine: !was.mine, likes: Math.max(0, was.likes + (was.mine ? -1 : 1)) };
    setHeart(id, now); document.dispatchEvent(new CustomEvent('wf-like', { detail: { id, ...now } }));
    cloud.setLike(id, now.mine).catch(() => { setHeart(id, was); document.dispatchEvent(new CustomEvent('wf-like', { detail: { id, ...was } })); });
  };
  return b;
}

/** A polaroid for the wall, with a heart on the caption row. */
export function tile(c: Card, owner: string, open: () => void): HTMLElement {
  const wrap = el('div', 'tile-wrap');
  wrap.style.setProperty('--rot', (c.rot || 0) * 0.6 + 'deg');
  const b = el('button', 'tile'); b.type = 'button';
  b.setAttribute('aria-label', [c.title || 'Untitled', shortPlace(c.place), owner && 'by ' + owner].filter(Boolean).join(', '));
  const frame = el('span', 'frame');
  const im = new Image(); im.src = c.img!; im.alt = ''; im.loading = 'lazy'; im.className = 'look-' + c.look;
  const cap = el('span', 'cap'); cap.append(el('b', '', c.title || 'Untitled'), el('small', '', [shortPlace(c.place), owner].filter(Boolean).join(' · ')));
  frame.append(im, cap); b.append(frame);
  b.onclick = open;
  wrap.append(b);
  if (cloud.cloudEnabled && c.id) wrap.append(heartFor(c.id));
  return wrap;
}

export function shotChips(c: Card): HTMLElement | null {
  const m = c.meta || {};
  const chips = [m.exposure, m.aperture, m.iso ? 'ISO ' + m.iso : '', m.focal].filter(Boolean) as string[];
  if (!chips.length) return null;
  const row = el('div', 'shot'); chips.forEach(t => row.append(el('i', '', t)));
  return row;
}

/** Opens a photo large, with the story behind it and the camera it was shot on. Arrow keys move through `list`. */
export function openLightbox(list: Card[], start: number, owners: Map<string, string>, opts: { storyLink?: boolean } = {}) {
  let i = start;
  const back = el('div', 'lb'); back.setAttribute('role', 'dialog'); back.setAttribute('aria-modal', 'true'); back.setAttribute('aria-label', 'Photo');
  const prevFocus = document.activeElement as HTMLElement | null;
  const box = el('div', 'lb-box'), pic = el('div', 'lb-pic'), side = el('div', 'lb-side');
  const close = el('button', 'lb-close', '✕'); close.type = 'button'; close.setAttribute('aria-label', 'Close');
  const prev = el('button', 'lb-nav prev', '‹'); prev.type = 'button'; prev.setAttribute('aria-label', 'Previous photo');
  const next = el('button', 'lb-nav next', '›'); next.type = 'button'; next.setAttribute('aria-label', 'Next photo');
  box.append(pic, side, close);
  if (list.length > 1) box.append(prev, next);
  back.append(box); document.body.append(back);
  document.body.style.overflow = 'hidden';

  const show = () => {
    const c = list[i];
    pic.innerHTML = ''; side.innerHTML = '';
    const im = new Image(); im.src = c.img!; im.alt = c.title || 'Photo'; im.className = 'look-' + c.look; pic.append(im);
    side.append(el('h2', '', c.title || 'Untitled'));
    side.append(el('p', 'meta', [c.place, fmtDate(c.date)].filter(Boolean).join(' · ')));
    const name = owners.get(c.owner);
    if (name) { const by = el('a', 'by', 'by ' + name); by.href = '/u/' + c.owner; side.append(by); }
    if (c.story) side.append(el('p', 'note', c.story));
    const cam = STAMP(c);
    if (cam || shotChips(c)) {
      const so = el('div', 'shoton'); so.append(el('span', 'so-label', 'Shot on'));
      if (cam) { const a = el('a', '', cam); a.href = '/cameras/' + slugCamera(cam); so.append(a); }
      const chips = shotChips(c); if (chips) so.append(chips);
      side.append(so);
    }
    if (cloud.cloudEnabled && c.id) side.append(mountReactions(c.id, { onSignIn: () => { location.href = '/app.html?account=1'; }, open: true }));
    const act = el('div', 'lb-actions');
    if (c.trip && c.owner && opts.storyLink !== false) { const a = el('a', 'btn small primary', 'See the whole story'); a.href = `/s/${c.owner}?t=${encodeURIComponent(c.trip)}`; act.append(a); }
    if (cloud.me() && c.owner && c.owner !== cloud.me()!.id) {
      const rep = el('button', 'btn small', 'Report'); rep.type = 'button';
      rep.onclick = async () => {
        const why = prompt('What is wrong with this photo? A moderator will take a look.'); if (!why) return;
        try { await cloud.reportUser(c.owner, `Photo ${c.id}: ${why}`); rep.textContent = 'Reported. Thanks.'; rep.disabled = true; }
        catch (err) { rep.textContent = 'Couldn’t send that'; console.warn(err); }
      };
      act.append(rep);
    }
    side.append(act);
    prev.hidden = i === 0; next.hidden = i === list.length - 1;
  };
  const go = (d: number) => { const j = i + d; if (j >= 0 && j < list.length) { i = j; show(); } };
  const end = () => { document.removeEventListener('keydown', key); document.body.style.overflow = ''; back.remove(); prevFocus?.focus(); };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') end(); else if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'Tab') {   // keep focus inside the dialog
      const f = [...back.querySelectorAll<HTMLElement>('button, a[href]')].filter(x => !x.hidden);
      if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
  };
  close.onclick = end; prev.onclick = () => go(-1); next.onclick = () => go(1);
  back.onclick = e => { if (e.target === back) end(); };
  document.addEventListener('keydown', key);
  show(); close.focus();
}
