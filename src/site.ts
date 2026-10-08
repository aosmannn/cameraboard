// The header and footer every page shares, plus small helpers the pages use.
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/caveat/500.css';
import '@fontsource/caveat/700.css';
import '@fontsource/vt323/400.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import './site.css';
import * as cloud from './cloud';
import { inject as trackVisits } from '@vercel/analytics';

/** Counts page views (no cookies, no personal data) so we can see whether anyone uses the site. Needs Web Analytics turned on in Vercel. */
export const countVisit = () => { try { trackVisits(); } catch { /* analytics must never break a page */ } };
countVisit();

export type Section = 'home' | 'explore' | 'cameras' | '';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let authDone: () => void = () => {};
/** Resolves once we know whether someone is signed in. */
export const authReady = new Promise<void>(r => { authDone = r; });

export const CONTACT_EMAIL = 'wayframe0@gmail.com';
/** The name, set the way the hero sets its emphasis: “Way” upright, “frame” in italic red. */
function wordmark() {
  const w = el('span', 'wordmark', 'Way'); w.append(el('em', '', 'frame'));
  return w;
}
const LINKS: [Section, string, string][] = [['explore', 'Explore', '/explore'], ['cameras', 'Cameras', '/cameras']];

/** Adds the header and footer, and shows who is signed in. */
export function mountShell(active: Section) {
  const nav = el('header', 'nav');
  const logo = el('a', 'logo'); logo.href = '/'; logo.setAttribute('aria-label', 'Wayframe home');
  const mark = new Image(); mark.src = '/logo-mark.svg'; mark.alt = ''; mark.width = 40; mark.height = 40; mark.className = 'logo-mark';
  logo.append(mark, wordmark());
  const links = el('nav'); links.id = 'siteNav'; links.setAttribute('aria-label', 'Sections');
  for (const [key, label, href] of LINKS) {
    const a = el('a', '', label); a.href = href; if (key === active) a.setAttribute('aria-current', 'page'); links.append(a);
  }
  const mapLink = el('a', '', 'Map'); mapLink.href = '/app.html'; links.append(mapLink);
  // Get the next tab ready: on hover or touch, and quietly once this page has settled.
  for (const a of links.querySelectorAll('a')) for (const ev of ['pointerenter', 'focus', 'touchstart']) a.addEventListener(ev, () => cloud.warmCommunity(), { passive: true });
  (window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1200)))(() => cloud.warmCommunity());
  const end = el('div', 'nav-end');
  const who = el('a', 'who'); who.id = 'whoBtn'; who.hidden = true; who.href = '/app.html?account=1';
  const signIn = el('a', 'btn small', 'Sign in'); signIn.id = 'signInBtn'; signIn.href = '/app.html?account=1'; signIn.hidden = !cloud.cloudEnabled;
  const go = el('a', 'btn primary go', 'Open the map'); go.href = '/app.html';
  const menu = el('button', 'menu-btn', '☰'); menu.type = 'button'; menu.setAttribute('aria-label', 'Menu'); menu.setAttribute('aria-controls', 'siteNav'); menu.setAttribute('aria-expanded', 'false');
  menu.onclick = () => { const o = nav.classList.toggle('open'); menu.setAttribute('aria-expanded', String(o)); };
  end.append(signIn, who, go, menu);
  nav.append(logo, links, end);
  document.body.prepend(nav);
  glideNav(links);
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  const foot = el('footer', 'foot');
  const about = el('div');
  const flogo = el('a', 'logo small'); flogo.href = '/';
  const fmark = new Image(); fmark.src = '/logo-mark.svg'; fmark.alt = ''; fmark.width = 26; fmark.height = 26; fmark.className = 'logo-mark';
  flogo.append(fmark, wordmark());
  about.append(flogo, el('p', '', 'Turn your photos into a map of where you’ve been. Private by default, and built for every camera you own.'));
  const col = (title: string, items: [string, string][]) => {
    const d = el('div'); d.append(el('b', '', title));
    for (const [label, href] of items) { const a = el('a', '', label); a.href = href; d.append(a); }
    return d;
  };
  foot.append(
    about,
    col('Product', [['Open the map', '/app.html'], ['Explore', '/explore'], ['Stories', '/explore?tab=stories'], ['Cameras', '/cameras']]),
    col('Company', [['Privacy', '/privacy'], ['Terms', '/terms'], ['Credits', '/credits'], ['Contact', 'mailto:' + CONTACT_EMAIL]])
  );
  const credit = el('p', 'credit');
  const by = (name: string, href: string) => { const a = el('a', 'by', name); a.href = href; a.rel = 'noopener'; return a; };
  credit.append(`© ${new Date().getFullYear()} Wayframe. Photos belong to the people who took them. Made by `, by('Adam', 'https://adamosman.dev/'), ' with help from ', by('Steven', 'https://github.com/vcanp'), '.');
  foot.append(credit);
  document.body.append(foot);

  if (!cloud.cloudEnabled) authDone();
  cloud.initAuth(async signedIn => {
    authDone();
    signIn.hidden = signedIn || !cloud.cloudEnabled; who.hidden = !signedIn;
    if (signedIn) {
      const p = await cloud.myProfile().catch(() => null);
      who.textContent = ((p ? cloud.labelOf(p) : 'Me').replace(/^@/, '')[0] || '?').toUpperCase();
      who.setAttribute('aria-label', 'Your account');
    }
  });
}

// ---------- small helpers ----------
export const initialOf = (name: string) => (name.replace(/^@/, '')[0] || '?').toUpperCase();
export function fmtDate(d: string, opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }) {
  if (!d) return '';
  const t = new Date(d); return isNaN(+t) ? '' : t.toLocaleDateString(undefined, opts);
}
/** Place names in order, skipping repeats: "Atlanta → Dallas → Las Vegas". */
export function routeOf(places: string[]) {
  const out: string[] = [];
  for (const p of places) { const n = (p || '').split(',')[0].trim(); if (n && n !== out[out.length - 1]) out.push(n); }
  return out.join(' → ');
}
export const shortPlace = (p: string) => (p || '').split(',').slice(0, 2).join(',').trim();
export const pathPart = (n: number) => decodeURIComponent(location.pathname.split('/').filter(Boolean)[n] ?? '');
/**
 * The header's highlight is one pill that glides to the link you choose (Explore, Cameras, Map) instead of jumping.
 * Clicking waits a moment so the glide is seen, then goes to the page. Not used in the narrow drop-down menu.
 */
function glideNav(links: HTMLElement) {
  const anchors = [...links.querySelectorAll('a')];
  const pill = el('span', 'nav-pill'); pill.setAttribute('aria-hidden', 'true');
  links.prepend(pill); links.classList.add('has-pill');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const active = anchors.find(a => a.getAttribute('aria-current') === 'page');
  const put = (a: HTMLElement) => {
    pill.style.left = a.offsetLeft + 'px'; pill.style.top = a.offsetTop + 'px';
    pill.style.width = a.offsetWidth + 'px'; pill.style.height = a.offsetHeight + 'px';
  };
  const place = () => { if (active && active.offsetWidth) { put(active); pill.classList.add('on'); } else pill.classList.remove('on'); };
  place();
  requestAnimationFrame(() => requestAnimationFrame(() => pill.classList.add('glide')));   // later moves glide; the first placement does not
  new ResizeObserver(() => { pill.classList.remove('glide'); place(); requestAnimationFrame(() => pill.classList.add('glide')); }).observe(links);
  void document.fonts?.ready.then(place);
  addEventListener('pageshow', e => { if (e.persisted) { pill.classList.remove('glide'); place(); requestAnimationFrame(() => pill.classList.add('glide')); } });
  let leaving = false;
  for (const a of anchors) a.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || reduce || a === active || leaving) return;
    if (getComputedStyle(pill).display === 'none') return;   // the narrow drop-down menu has no pill
    e.preventDefault(); leaving = true;
    if (!active) { pill.classList.remove('glide'); put(a); void pill.offsetWidth; pill.classList.add('glide'); }
    put(a); pill.classList.add('on');
    setTimeout(() => { location.href = a.href; }, 150);
  });
}

/** Makes a pill-style tab bar slide its highlight from one tab to the next. Call it again whenever the selected tab changes. */
export function slideTabs(tabs: HTMLElement) {
  tabs.classList.add('slide');
  const place = () => {
    const sel = tabs.querySelector<HTMLElement>('[aria-selected="true"]'); if (!sel || !sel.offsetWidth) return;
    tabs.style.setProperty('--pill-x', sel.offsetLeft + 'px'); tabs.style.setProperty('--pill-w', sel.offsetWidth + 'px');
  };
  place();
  if (!tabs.dataset.watched) {
    tabs.dataset.watched = '1';
    requestAnimationFrame(() => requestAnimationFrame(() => tabs.classList.add('ready')));   // the first placement does not slide
    new ResizeObserver(place).observe(tabs);
    void document.fonts?.ready.then(place);
  }
}
/** Fades and lifts freshly drawn content into place. */
export function swapIn(node: HTMLElement) { node.classList.remove('swap-in'); void node.offsetWidth; node.classList.add('swap-in'); }
/** Fades the old content out, runs `change`, then fades whatever it drew in. */
export function swapContent(node: HTMLElement, change: () => void) {
  node.classList.add('swap-out');
  setTimeout(() => { node.classList.remove('swap-out'); change(); swapIn(node); }, 120);
}
export function setTitle(t: string) { document.title = t ? `${t} · Wayframe` : 'Wayframe'; }
export const slugCamera = cloud.slugify;
export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
