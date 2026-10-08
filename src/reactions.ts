// A heart and a comment thread for one photo, shown under other people's pictures (the Explore viewer and the map's
// photo panel). It talks to the database through cloud.ts, so it respects who is allowed to see the photo.
import './reactions.css';
import * as cloud from './cloud';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e;
};
/** "just now", "5 min ago", "3 h ago", "2 d ago", then the date. */
export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  if (s < 7 * 86400) return Math.round(s / 86400) + ' d ago';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export interface ReactionOptions {
  /** Shown when someone who is signed out tries to like or comment. */
  onSignIn: () => void;
  /** Show the heart (the map's photo panel already has its own). Default true. */
  heart?: boolean;
  /** Start with the comments open. Default false. */
  open?: boolean;
}

export function mountReactions(photoId: string, opts: ReactionOptions): HTMLElement {
  const root = h('div', 'rx');
  const bar = h('div', 'rx-bar');
  const heart = h('button', 'rx-btn rx-heart'); heart.type = 'button';
  const hIcon = h('span', 'rx-ico', '♡'), hN = h('span', 'rx-n', '0'); heart.append(hIcon, hN);
  const chat = h('button', 'rx-btn rx-chat'); chat.type = 'button';
  const cN = h('span', 'rx-n', '0'); chat.append(h('span', 'rx-ico', '💬'), cN);
  chat.setAttribute('aria-label', 'Comments');
  if (opts.heart !== false) bar.append(heart);
  bar.append(chat);
  const thread = h('div', 'rx-thread'); thread.hidden = true;
  const note = h('p', 'rx-note'); note.hidden = true;
  root.append(bar, thread, note);

  let likes = 0, mine = false, comments = 0, loaded = false, open = false;
  const paintHeart = () => {
    heart.classList.toggle('on', mine); heart.setAttribute('aria-pressed', String(mine));
    heart.setAttribute('aria-label', mine ? 'Unlike' : 'Like');
    hIcon.textContent = mine ? '♥' : '♡'; hN.textContent = String(likes);
  };
  const paintChat = () => { cN.textContent = String(comments); chat.setAttribute('aria-expanded', String(open)); chat.classList.toggle('on', open); };
  const say = (msg: string) => { note.textContent = msg; note.hidden = !msg; };
  paintHeart(); paintChat();

  // counts
  cloud.reactionCounts([photoId]).then(m => {
    const r = m.get(photoId); if (!r) return;
    likes = r.likes; mine = r.mine; comments = r.comments; paintHeart(); paintChat();
  }).catch(err => say((err as Error).message));

  heart.onclick = () => {
    if (!cloud.me()) { opts.onSignIn(); return; }
    const was = { likes, mine };
    mine = !mine; likes = Math.max(0, likes + (mine ? 1 : -1)); paintHeart();
    cloud.setLike(photoId, mine).catch(err => { likes = was.likes; mine = was.mine; paintHeart(); say((err as Error).message); });
  };

  // thread
  const list = h('ul', 'rx-list');
  const form = h('form', 'rx-form'); form.autocomplete = 'off';
  const input = h('input', 'rx-input'); input.type = 'text'; input.maxLength = 500; input.placeholder = 'Add a comment…'; input.setAttribute('aria-label', 'Add a comment');
  const post = h('button', 'rx-post', 'Post'); post.type = 'submit';
  form.append(input, post);
  const signIn = h('button', 'rx-signin', 'Sign in to comment'); signIn.type = 'button'; signIn.onclick = () => opts.onSignIn();
  thread.append(list, form, signIn);

  const drawComments = (items: cloud.PhotoComment[]) => {
    list.innerHTML = '';
    if (!items.length) list.append(h('li', 'rx-empty', 'No comments yet. Be the first.'));
    for (const c of items) {
      const li = h('li', 'rx-item');
      const head = h('div', 'rx-head');
      head.append(h('b', '', c.name));
      if (c.username) head.append(h('span', 'rx-user', '@' + c.username));
      head.append(h('time', 'rx-time', ago(c.at)));
      if (c.canDelete) {
        const del = h('button', 'rx-del', '✕'); del.type = 'button'; del.setAttribute('aria-label', c.mine ? 'Delete your comment' : 'Remove this comment');
        del.onclick = async () => {
          del.disabled = true;
          try { await cloud.deleteComment(c.id); li.remove(); comments = Math.max(0, comments - 1); paintChat(); if (!list.children.length) drawComments([]); }
          catch (err) { del.disabled = false; say((err as Error).message); }
        };
        head.append(del);
      }
      li.append(head, h('p', 'rx-body', c.body));   // textContent: a comment is never HTML
      list.append(li);
    }
  };
  const reload = async () => {
    try { const items = await cloud.photoComments(photoId); comments = items.length; paintChat(); drawComments(items); say(''); }
    catch (err) { say((err as Error).message); }
  };
  const syncForm = () => { const on = !!cloud.me(); form.hidden = !on; signIn.hidden = on; };
  form.onsubmit = async e => {
    e.preventDefault();
    const text = input.value.trim(); if (!text) return;
    post.disabled = input.disabled = true;
    try { await cloud.addComment(photoId, text); input.value = ''; await reload(); say(''); }
    catch (err) { say((err as Error).message); }
    finally { post.disabled = input.disabled = false; input.focus(); }
  };
  const toggle = (on: boolean) => {
    open = on; thread.hidden = !on; paintChat();
    if (on) { syncForm(); if (!loaded) { loaded = true; list.append(h('li', 'rx-empty', 'Loading…')); void reload(); } }
  };
  chat.onclick = () => toggle(!open);
  if (opts.open) toggle(true);
  return root;
}
