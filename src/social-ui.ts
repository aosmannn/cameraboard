// Comments under a photo, and the bell with what happened since you last looked.
import * as cloud from './cloud';
import './social.css';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const initialOf = (n: string) => (n.replace(/^@/, '')[0] || '?').toUpperCase();
export function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  if (s < 86400 * 7) return Math.floor(s / 86400) + 'd';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
/** Text with @mentions picked out in bold. Built from text nodes, so nothing typed can become markup. */
function withMentions(into: HTMLElement, text: string) {
  let last = 0;
  for (const m of text.matchAll(/@[A-Za-z0-9_.]{2,30}/g)) {
    if (m.index! > last) into.append(text.slice(last, m.index));
    into.append(el('b', 'mention', m[0])); last = m.index! + m[0].length;
  }
  if (last < text.length) into.append(text.slice(last));
}
function avatar(path: string | null, name: string) {
  const a = el('span', 'cm-ava');
  if (path) { const im = new Image(); im.src = cloud.avatarUrl(path); im.alt = ''; im.onerror = () => { im.remove(); a.textContent = initialOf(name); }; a.append(im); } else a.textContent = initialOf(name);
  return a;
}

export interface CommentsCtx {
  /** The photo open in the drawer, if comments make sense for it (yours, or a followed person's). */
  photoId: () => string | null;
  openProfile: (id: string) => void;
  onChange?: () => void;
}
export function initComments(ctx: CommentsCtx) {
  const box = $('comments'), list = $('cmList'), form = $<HTMLFormElement>('cmForm'), input = $<HTMLInputElement>('cmIn'), msg = $('cmMsg'), count = $('cmCount');
  let token = 0, shown: string | null = null;
  async function draw() {
    const id = ctx.photoId(); box.hidden = !id; msg.textContent = '';
    if (!id) { shown = null; list.innerHTML = ''; return; }
    if (shown !== id) { list.innerHTML = ''; count.textContent = ''; input.value = ''; }
    shown = id; const mine = ++token;
    try {
      const rows = await cloud.photoComments(id);
      if (mine !== token) return;
      list.innerHTML = ''; count.textContent = rows.length ? String(rows.length) : '';
      for (const c of rows) {
        const li = el('li', 'cm'), body = el('div', 'cm-body'), head = el('div', 'cm-head');
        const who = el('button', 'cm-name', c.name || (c.username ? '@' + c.username : 'Someone')); who.type = 'button';
        who.onclick = () => ctx.openProfile(c.user_id);
        head.append(who, el('small', '', ago(c.created_at)));
        const text = el('p'); withMentions(text, c.body);
        body.append(head, text);
        li.append(avatar(c.avatar_path, c.name || 'S'), body);
        if (c.can_delete) { const x = el('button', 'cm-x', '✕'); x.type = 'button'; x.title = 'Delete'; x.setAttribute('aria-label', 'Delete comment'); x.onclick = async () => { try { await cloud.deleteComment(c.id); void draw(); ctx.onChange?.(); } catch (e) { msg.textContent = (e as Error).message; } }; li.append(x); }
        list.append(li);
      }
    } catch (e) { if (mine === token) msg.textContent = 'Couldn’t load comments: ' + (e as Error).message; }
  }
  form.onsubmit = async e => {
    e.preventDefault();
    const id = ctx.photoId(), text = input.value.trim();
    if (!id || !text) return;
    const btn = form.querySelector('button')!; btn.disabled = true; msg.textContent = '';
    try { await cloud.addComment(id, text); input.value = ''; await draw(); ctx.onChange?.(); }
    catch (err) { msg.textContent = (err as Error).message; }
    finally { btn.disabled = false; }
  };
  return { draw };
}

export interface NoticeCtx {
  signedIn: () => boolean;
  openProfile: (id: string) => void;
  /** Opens the photo if we have it; returns false when we don't. */
  openPhoto: (photoId: string) => boolean;
}
export function initNotices(ctx: NoticeCtx) {
  const bell = $('bellBtn'), badge = $('bellN'), panel = $('noticePanel'), list = $('noticeList');
  let timer = 0, notes: cloud.Notice[] = [];
  const text = (n: cloud.Notice) => {
    const who = n.actor_name || (n.actor_username ? '@' + n.actor_username : 'Someone');
    const title = n.photo_title ? `“${n.photo_title}”` : 'your photo';
    return n.kind === 'follow' ? [who, ' started following you']
      : n.kind === 'like' ? [who, ` liked ${title}`]
      : n.kind === 'comment' ? [who, ` commented on ${title}`]
      : [who, ` mentioned you in a comment`];
  };
  const paintBadge = () => { const n = notes.filter(x => !x.is_read).length; badge.hidden = !n; badge.textContent = n > 9 ? '9+' : String(n); bell.setAttribute('aria-label', n ? `Notifications, ${n} new` : 'Notifications'); };
  async function refresh() {
    bell.hidden = !ctx.signedIn();
    if (!ctx.signedIn()) { notes = []; paintBadge(); return; }
    try { notes = await cloud.myNotices(40); paintBadge(); if (!panel.hidden) paintList(); } catch { /* the bell just stays as it was */ }
  }
  function paintList() {
    list.innerHTML = '';
    if (!notes.length) { list.append(el('li', 'np-empty', 'Nothing yet. When someone follows you, likes a photo or comments, it shows up here.')); return; }
    for (const n of notes) {
      const li = el('li', 'np-item' + (n.is_read ? '' : ' new')), b = el('button', 'np-btn'); b.type = 'button';
      const [who, rest] = text(n);
      const line = el('span', 'np-text'); line.append(el('b', '', who), rest); b.append(avatar(n.actor_avatar, who), line);
      if (n.body) b.append(el('em', 'np-body', n.body));
      b.append(el('small', '', ago(n.created_at)));
      b.onclick = () => { close(); if (n.photo_id && ctx.openPhoto(n.photo_id)) return; ctx.openProfile(n.actor); };
      li.append(b); list.append(li);
    }
  }
  function open() { panel.hidden = false; bell.setAttribute('aria-expanded', 'true'); paintList(); }
  function close() {
    if (panel.hidden) return;
    panel.hidden = true; bell.setAttribute('aria-expanded', 'false');
    if (notes.some(n => !n.is_read)) { notes = notes.map(n => ({ ...n, is_read: true })); paintBadge(); void cloud.markNoticesRead(); }
  }
  bell.onclick = () => { if (panel.hidden) { open(); void refresh(); } else close(); };
  $('noticeClose').onclick = close;
  document.addEventListener('mousedown', e => { if (!panel.hidden && !panel.contains(e.target as Node) && !bell.contains(e.target as Node)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  return {
    refresh,
    /** Checks every minute while you're signed in and looking at the page. */
    start() { clearInterval(timer); void refresh(); timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 60000); },
    stop() { clearInterval(timer); bell.hidden = true; notes = []; paintBadge(); close(); }
  };
}
