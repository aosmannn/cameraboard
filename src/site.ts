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
  foot.append(el('p', 'credit', `© ${new Date().getFullYear()} Wayframe. Photos belong to the people who took them.`));
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
export function setTitle(t: string) { document.title = t ? `${t} · Wayframe` : 'Wayframe'; }
export const slugCamera = cloud.slugify;
export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
