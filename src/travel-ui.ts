// Travel: the countries you've been to and your bucket list.
// The idea, and the first version of the matching logic, came from Steven (@vcanp). This one saves to your account.
import L from 'leaflet';
import type { Card } from './types';
import * as cloud from './cloud';
import { countryNames } from './world';
import { searchPlaces, loadCities, type Place } from './atlas';
import './travel.css';

export interface TravelCtx {
  map: L.Map;
  cards: () => Card[];                       // your own photos
  signedIn: () => boolean;
  setVisited: (names: Set<string> | null) => void;
  flyToCountry: (name: string) => void;
  openCard: (id: string) => void;
  note: (text: string) => void;
}
type Item = cloud.BucketItem;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const ls = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* blocked */ } }
};
const km = (a: number, b: number, c: number, d: number) => {
  const r = (x: number) => (x * Math.PI) / 180, h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const STATUS: Record<cloud.BucketStatus, string> = { wishlist: 'Wishlist', planned: 'Planned', done: 'Done' };
const KINDS: [cloud.BucketKind, string][] = [['country', 'Country'], ['city', 'City'], ['place', 'Place'], ['experience', 'Experience']];

export function initTravel(ctx: TravelCtx) {
  const box = document.getElementById('travelList')!;
  let manual = new Set<string>(ls.get<string[]>('wf-visits', []));
  let bucket: Item[] = ls.get<Item[]>('wf-bucket', []);
  let tab: 'been' | 'bucket' = 'been';
  let colorMap = ls.get<boolean>('wf-color-map', true);
  let starsOn = ls.get<boolean>('wf-bucket-stars', true);
  const stars = L.layerGroup().addTo(ctx.map);
  const allCountries = countryNames();
  const worldTotal = allCountries.length;

  /** Countries from your photos (with how many) plus the ones you added yourself. */
  const fromPhotos = () => {
    const m = new Map<string, number>();
    for (const c of ctx.cards()) if (c.img && c.country) m.set(c.country, (m.get(c.country) ?? 0) + 1);
    return m;
  };
  const visited = () => new Set<string>([...fromPhotos().keys(), ...manual]);

  // ---- saving: your account when signed in, this browser otherwise ----
  const remember = () => { if (!ctx.signedIn()) { ls.set('wf-visits', [...manual]); ls.set('wf-bucket', bucket); } };
  const fail = (e: unknown) => ctx.note('Couldn’t save that: ' + (e as Error).message);
  async function addVisit(name: string) {
    manual.add(name); paint(); remember();
    if (ctx.signedIn()) await cloud.addVisit(name).catch(fail);
  }
  async function dropVisit(name: string) {
    manual.delete(name); paint(); remember();
    if (ctx.signedIn()) await cloud.removeVisit(name).catch(fail);
  }
  async function addItem(p: { title: string; kind: cloud.BucketKind; country: string; lat: number | null; lng: number | null; notes: string }) {
    const base: Item = { id: crypto.randomUUID(), ...p, status: 'wishlist', fulfilled_photo: null, created_at: new Date().toISOString() };
    if (ctx.signedIn()) { try { bucket.unshift(await cloud.addBucket(p)); } catch (e) { fail(e); return; } } else bucket.unshift(base);
    remember(); paint();
  }
  async function patchItem(it: Item, patch: Partial<Pick<Item, 'status' | 'notes' | 'fulfilled_photo'>>) {
    Object.assign(it, patch); remember(); paint();
    if (ctx.signedIn()) await cloud.updateBucket(it.id, patch).catch(fail);
  }
  async function dropItem(it: Item) {
    bucket = bucket.filter(b => b !== it); remember(); paint();
    if (ctx.signedIn()) await cloud.removeBucket(it.id).catch(fail);
  }

  /** Bucket items your photos have already ticked off: same country, or within 40 km of the spot. */
  const matches = () => {
    const out = new Map<string, Card>();
    const mine = ctx.cards().filter(c => c.img && c.lat != null && c.lng != null);
    for (const it of bucket) {
      if (it.status === 'done') continue;
      const hit = mine.find(c => (it.kind === 'country' || !it.lat) && it.country ? c.country === it.country
        : it.lat != null && it.lng != null ? km(it.lat, it.lng, c.lat!, c.lng!) <= 40 : false);
      if (hit) out.set(it.id, hit);
    }
    return out;
  };

  // ---- small pieces ----
  /** A text box that lists matching countries to click on. */
  function countryPicker(placeholder: string, onPick: (name: string) => void) {
    const wrap = el('div', 'tv-pick'), input = el('input', 'plain'), list = el('div', 'tv-suggest');
    input.placeholder = placeholder; input.autocomplete = 'off'; input.setAttribute('aria-label', placeholder);
    const show = () => {
      const q = input.value.trim().toLowerCase(); list.innerHTML = '';
      if (!q) { list.hidden = true; return; }
      const hits = allCountries.filter(n => n.toLowerCase().split(/[\s-]+/).some(w => w.startsWith(q)) || n.toLowerCase().startsWith(q)).slice(0, 6);
      for (const n of hits) { const b = el('button', '', n); b.type = 'button'; b.onmousedown = e => e.preventDefault(); b.onclick = () => { input.value = ''; list.hidden = true; onPick(n); }; list.append(b); }
      list.hidden = !hits.length;
    };
    input.oninput = show; input.onblur = () => setTimeout(() => { list.hidden = true; }, 120);
    wrap.append(input, list); list.hidden = true;
    return { wrap, input };
  }

  function paintBeen(into: HTMLElement) {
    const photos = fromPhotos(), all = [...visited()].sort((a, b) => a.localeCompare(b));
    const pct = Math.round((all.length / worldTotal) * 100);
    const head = el('div', 'tv-stat');
    head.append(el('b', '', String(all.length)), el('span', '', all.length === 1 ? ' country' : ' countries'), el('small', '', ` · ${pct}% of the world`));
    into.append(head);
    const bar = el('div', 'tv-bar'); const fill = el('i'); fill.style.width = Math.max(2, pct) + '%'; bar.append(fill); into.append(bar);
    const add = countryPicker('Add a country you’ve been to', n => { void addVisit(n); });
    into.append(add.wrap);
    if (!all.length) { into.append(el('p', 'hint', 'Countries fill in on their own when you pin photos. For places you went without a camera, add them above.')); return; }
    const ul = el('ul', 'tv-list');
    for (const n of all) {
      const li = el('li'), go = el('button', 'tv-name', n); go.type = 'button'; go.onclick = () => ctx.flyToCountry(n);
      const c = photos.get(n);
      li.append(go, el('small', '', c ? `${c} ${c === 1 ? 'photo' : 'photos'}` : 'added by you'));
      if (manual.has(n)) { const x = el('button', 'tv-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Remove ' + n); x.title = 'Remove'; x.onclick = () => { void dropVisit(n); }; li.append(x); }
      ul.append(li);
    }
    into.append(ul);
  }

  function paintBucket(into: HTMLElement) {
    const form = el('form', 'tv-form');
    const title = el('input', 'plain'); title.placeholder = 'Add a place or dream, e.g. Kyoto'; title.maxLength = 120; title.setAttribute('aria-label', 'Bucket list item');
    const kind = el('select', 'tv-kind'); kind.setAttribute('aria-label', 'Type');
    for (const [v, t] of KINDS) { const o = el('option', '', t); o.value = v; kind.append(o); }
    kind.value = 'city';
    const hits = el('div', 'tv-suggest'); hits.hidden = true;
    let picked: Place | null = null, pickedCountry = '';
    const suggest = async () => {
      picked = null; hits.innerHTML = ''; const q = title.value.trim();
      if (q.length < 2) { hits.hidden = true; return; }
      let items: { label: string; run: () => void }[] = [];
      if (kind.value === 'country') items = allCountries.filter(n => n.toLowerCase().startsWith(q.toLowerCase())).slice(0, 6).map(n => ({ label: n, run: () => { title.value = n; pickedCountry = n; } }));
      else if (kind.value !== 'experience') {
        await loadCities();
        items = searchPlaces(q, 6).map(p => ({ label: p.label, run: () => { picked = p; title.value = p.short || p.label.split(',')[0]; pickedCountry = p.label.split(',').pop()!.trim(); } }));
      }
      for (const it of items) { const b = el('button', '', it.label); b.type = 'button'; b.onmousedown = e => e.preventDefault(); b.onclick = () => { it.run(); hits.hidden = true; }; hits.append(b); }
      hits.hidden = !items.length;
    };
    title.oninput = () => { pickedCountry = ''; void suggest(); }; title.onblur = () => setTimeout(() => { hits.hidden = true; }, 120);
    kind.onchange = () => { title.placeholder = kind.value === 'experience' ? 'e.g. See the northern lights' : kind.value === 'country' ? 'e.g. Japan' : 'Add a place, e.g. Kyoto'; void suggest(); };
    const go = el('button', 'btn small primary', 'Add'); go.type = 'submit';
    form.append(title, kind, go, hits);
    form.onsubmit = e => {
      e.preventDefault(); const t = title.value.trim(); if (!t) return;
      const country = kind.value === 'country' ? (allCountries.find(n => n.toLowerCase() === t.toLowerCase()) ?? t) : (allCountries.find(n => n === pickedCountry) ?? '');
      void addItem({ title: t, kind: kind.value as cloud.BucketKind, country, lat: picked?.lat ?? null, lng: picked?.lng ?? null, notes: '' });
      title.value = ''; picked = null; pickedCountry = ''; hits.hidden = true;
    };
    into.append(form);

    const hitsNow = matches();
    if (hitsNow.size) {
      const ban = el('div', 'tv-ban');
      ban.append(el('b', '', `Your photos check off ${hitsNow.size} ${hitsNow.size === 1 ? 'item' : 'items'}.`), el('span', '', hitsNow.size === 1 ? ' Mark it done below.' : ' Mark them done below.'));
      into.append(ban);
    }
    if (!bucket.length) { into.append(el('p', 'hint', 'Nothing here yet. Add somewhere you want to go. When you pin a photo there, it checks itself off.')); return; }
    const done = bucket.filter(b => b.status === 'done').length;
    into.append(el('p', 'tv-count', `${done} of ${bucket.length} done`));
    const ul = el('ul', 'tv-list bucket');
    for (const it of bucket) {
      const li = el('li', 'tv-item ' + it.status), top = el('div', 'tv-row');
      const name = el('button', 'tv-name', it.title); name.type = 'button';
      name.onclick = () => { if (it.lat != null && it.lng != null) ctx.map.flyTo([it.lat, it.lng], 8, { duration: 1 }); else if (it.country) ctx.flyToCountry(it.country); };
      const st = el('select', 'tv-status'); st.setAttribute('aria-label', 'Status of ' + it.title);
      for (const k of Object.keys(STATUS) as cloud.BucketStatus[]) { const o = el('option', '', STATUS[k]); o.value = k; st.append(o); }
      st.value = it.status; st.onchange = () => { void patchItem(it, { status: st.value as cloud.BucketStatus }); };
      const x = el('button', 'tv-x', '✕'); x.type = 'button'; x.title = 'Remove'; x.setAttribute('aria-label', 'Remove ' + it.title); x.onclick = () => { void dropItem(it); };
      top.append(name, st, x); li.append(top);
      const sub = [KINDS.find(k => k[0] === it.kind)?.[1], it.country && it.country !== it.title ? it.country : ''].filter(Boolean).join(' · ');
      if (sub) li.append(el('small', '', sub));
      const m = hitsNow.get(it.id);
      if (m) {
        const row = el('div', 'tv-match'); row.append(el('span', '', 'You’ve been here.'));
        const see = el('button', 'btn small', 'See the photo'); see.type = 'button'; see.onclick = () => ctx.openCard(m.id);
        const ok = el('button', 'btn small primary', 'Mark done'); ok.type = 'button'; ok.onclick = () => { void patchItem(it, { status: 'done', fulfilled_photo: m.id }); };
        row.append(see, ok); li.append(row);
      } else if (it.status === 'done' && it.fulfilled_photo) {
        const see = el('button', 'tv-link', 'See the photo'); see.type = 'button'; see.onclick = () => ctx.openCard(it.fulfilled_photo!); li.append(see);
      }
      ul.append(li);
    }
    into.append(ul);
  }

  function paint() {
    box.innerHTML = '';
    const tabs = el('div', 'tv-tabs');
    for (const [k, t] of [['been', 'Been'], ['bucket', 'Bucket list']] as const) {
      const b = el('button', tab === k ? 'on' : '', t); b.type = 'button'; b.onclick = () => { if (tab === k) return; tab = k; paint(); box.classList.remove('swap'); void box.offsetWidth; box.classList.add('swap'); }; tabs.append(b);
    }
    box.append(tabs);
    (tab === 'been' ? paintBeen : paintBucket)(box);
    const opts = el('div', 'tv-opts');
    const mk = (label: string, on: boolean, set: (v: boolean) => void) => {
      const l = el('label'), c = el('input'); c.type = 'checkbox'; c.checked = on; c.onchange = () => set(c.checked); l.append(c, ' ' + label); return l;
    };
    opts.append(mk('Color the countries I’ve been to', colorMap, v => { colorMap = v; ls.set('wf-color-map', v); apply(); }),
      mk('Show my bucket list on the map', starsOn, v => { starsOn = v; ls.set('wf-bucket-stars', v); apply(); }));
    box.append(opts);
    apply();
  }

  /** The map: visited countries stand out, and bucket-list spots get a star. */
  function apply() {
    const v = visited();
    ctx.setVisited(colorMap && v.size ? v : null);
    stars.clearLayers();
    if (!starsOn) return;
    for (const it of bucket) {
      if (it.status === 'done' || it.lat == null || it.lng == null) continue;
      const icon = L.divIcon({ className: 'tv-star', html: '<span>★</span>', iconSize: [26, 26], iconAnchor: [13, 13] });
      L.marker([it.lat, it.lng], { icon, title: it.title, keyboard: false }).bindTooltip(it.title, { direction: 'top', offset: [0, -10] }).addTo(stars);
    }
  }

  return {
    /** Draws the panel; call when it's shown or when photos change. */
    render: paint,
    /** Photos or places changed: redraw the panel if it's open, and the map either way. */
    refresh() { if (!box.hidden) paint(); else apply(); },
    /** Count for the header chip. */
    count: () => visited().size,
    /** After signing in: bring your saved visits and bucket list down, and move up anything made while signed out. */
    async onAuth() {
      if (!ctx.signedIn()) { manual = new Set(ls.get<string[]>('wf-visits', [])); bucket = ls.get<Item[]>('wf-bucket', []); paint(); return; }
      try {
        const [vs, items] = await Promise.all([cloud.myVisits(), cloud.myBucket()]);
        const localV = ls.get<string[]>('wf-visits', []), localB = ls.get<Item[]>('wf-bucket', []);
        for (const n of localV) if (!vs.includes(n)) { await cloud.addVisit(n).catch(() => {}); vs.push(n); }
        for (const b of localB) { try { items.unshift(await cloud.addBucket(b)); } catch { /* skip */ } }
        ls.set('wf-visits', []); ls.set('wf-bucket', []);
        manual = new Set(vs); bucket = items;
      } catch (e) { ctx.note('Couldn’t load your travel list: ' + (e as Error).message); }
      paint();
    }
  };
}
