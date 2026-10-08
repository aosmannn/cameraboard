import L from 'leaflet';
import type { Card } from './types';
import {
  syncVisitsFromPhotos, toggleManualVisit, visitNameSet, loadVisits, loadBucket, saveBucket,
  newBucketItem, matchBucketHits, setCountryCatalog, listCountryNames,
  type BucketKind, type BucketStatus, type Visit,
} from './travel';
import { loadCities, searchPlaces, type Place } from './atlas';
import { allCountryNames, countryAt, countryBounds } from './world';

export type PanelTab = 'stories' | 'been' | 'bucket' | 'feed';

export type TravelApi = {
  setPanelTab: (t: PanelTab) => void;
  refreshTravel: () => void;
  getPanelTab: () => PanelTab;
  bucketLayer: L.LayerGroup;
};

export function installTravel(deps: {
  $: <T extends HTMLElement = HTMLElement>(id: string) => T;
  el: <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => HTMLElementTagNameMap[K];
  getCards: () => Card[];
  getSignedIn: () => boolean;
  map: L.Map;
  world: { setVisited(names: Set<string> | null): void };
  placed: (c: Card) => boolean;
  countryOf: (c: Card) => string | null;
  openCard: (c: Card, fly?: boolean) => void;
  flyTo: (c: Card, zoom?: number) => void;
  renderFeed: () => void;
}): TravelApi {
  const { $, el, world, placed, countryOf, openCard, flyTo } = deps;
  let panelTab: PanelTab = 'stories';
  let beenFilter = '';
  let visits: Visit[] = loadVisits();
  setCountryCatalog(allCountryNames());
  const bucketLayer = L.layerGroup();
  const bucketMarkers = new Map<string, L.Marker>();

  function setPanelTab(t: PanelTab) {
    panelTab = t === 'feed' && !deps.getSignedIn() ? 'stories' : t;
    $('tabStories').classList.toggle('on', panelTab === 'stories');
    $('tabBeen').classList.toggle('on', panelTab === 'been');
    $('tabBucket').classList.toggle('on', panelTab === 'bucket');
    $('tabFeed').classList.toggle('on', panelTab === 'feed');
    $('storyList').hidden = panelTab !== 'stories';
    $('beenList').hidden = panelTab !== 'been';
    $('bucketList').hidden = panelTab !== 'bucket';
    $('feedList').hidden = panelTab !== 'feed';
    $('newStory').hidden = panelTab !== 'stories';
    if (panelTab !== 'stories') $('newStoryForm').hidden = true;
    if (panelTab === 'been') renderBeen();
    if (panelTab === 'bucket') renderBucket();
    for (const [id, name] of [['tabStories', 'stories'], ['tabBeen', 'been'], ['tabBucket', 'bucket'], ['tabFeed', 'feed']]) {
      $(id).setAttribute('aria-selected', String(panelTab === name));
    }
    deps.renderFeed();
  }

  function refreshTravel() {
    visits = syncVisitsFromPhotos(deps.getCards());
    const names = visitNameSet(visits);
    world.setVisited(names.size ? names : null);
    autoFulfillBucket();
    renderBucketPins();
    if (panelTab === 'been') renderBeen();
    if (panelTab === 'bucket') renderBucket();
  }

  function renderBeen() {
    const box = $('beenList'); if (box.hidden) return;
    const total = listCountryNames().length;
    const n = visits.length;
    const stat = $('beenStat');
    stat.replaceChildren(el('b', '', `${n} of ${total} countries`), document.createTextNode(' marked from your photos or by hand. Visited places light up on the map.'));
    const search = $<HTMLInputElement>('beenSearch');
    if (search.value !== beenFilter) search.value = beenFilter;
    search.oninput = () => { beenFilter = search.value.trim(); renderBeen(); };
    const rowsBox = $('beenRows');
    rowsBox.innerHTML = '';
    const q = beenFilter.toLowerCase();
    const visited = visitNameSet(visits);
    const rows = listCountryNames().filter(name => !q || name.toLowerCase().includes(q));
    const shown = [
      ...rows.filter(n => visited.has(n)),
      ...rows.filter(n => !visited.has(n)),
    ];
    if (!shown.length) {
      const empty = el('div', 'st-empty');
      empty.append(el('p', '', 'No countries match.'));
      rowsBox.append(empty);
      return;
    }
    for (const name of shown) {
      const v = visits.find(x => x.name === name);
      const on = !!v;
      const row = el('button', 'tv-row' + (on ? ' on' : ''));
      row.type = 'button';
      row.setAttribute('aria-pressed', String(on));
      row.append(el('span', 'tv-check', on ? '✓' : ''), el('span', 'tv-name', name));
      if (v) {
        const meta = v.source === 'photo'
          ? `${v.photoCount} photo${v.photoCount === 1 ? '' : 's'}`
          : 'Marked by hand';
        row.append(el('span', 'tv-meta', meta));
      }
      row.onclick = () => {
        if (v?.source === 'photo' && v.photoCount > 0) {
          const hit = deps.getCards().find(c => placed(c) && countryOf(c) === name);
          if (hit) { openCard(hit); flyTo(hit, 5); }
          return;
        }
        toggleManualVisit(name);
        visits = syncVisitsFromPhotos(deps.getCards());
        world.setVisited(visitNameSet(visits));
        renderBeen();
      };
      rowsBox.append(row);
    }
  }

  function autoFulfillBucket() {
    const items = loadBucket();
    const hits = matchBucketHits(items, deps.getCards());
    if (!hits.length) return;
    let changed = false;
    for (const { item, photoId } of hits) {
      const cur = items.find(i => i.id === item.id);
      if (!cur || cur.status === 'done') continue;
      cur.status = 'done';
      cur.fulfilledPhotoId = photoId;
      changed = true;
    }
    if (changed) saveBucket(items);
  }

  function renderBucketPins() {
    bucketLayer.clearLayers(); bucketMarkers.clear();
    for (const item of loadBucket()) {
      if (item.lat == null || item.lng == null) continue;
      const pin = el('span', 'bucket-pin' + (item.status === 'done' ? ' done' : item.status === 'planned' ? ' planned' : ''));
      pin.append(el('span'));
      pin.title = item.title;
      const m = L.marker([item.lat, item.lng], {
        icon: L.divIcon({ html: pin, className: '', iconSize: [0, 0], iconAnchor: [0, 0] }),
        title: item.title, alt: item.title,
        zIndexOffset: item.status === 'done' ? 100 : 200,
      });
      m.on('click', () => { setPanelTab('bucket'); renderBucket(); });
      m.addTo(bucketLayer);
      bucketMarkers.set(item.id, m);
    }
  }

  function renderBucket() {
    const box = $('bucketList'); if (box.hidden) return;
    box.innerHTML = '';
    const items = loadBucket().slice().sort((a, b) => {
      const order = { wishlist: 0, planned: 1, done: 2 };
      return order[a.status] - order[b.status] || a.title.localeCompare(b.title);
    });
    const open = items.filter(i => i.status !== 'done').length;
    const done = items.filter(i => i.status === 'done').length;
    const stat = el('p', 'tv-stat');
    stat.append(el('b', '', `${open} to go`), document.createTextNode(done ? ` · ${done} done` : ''),
      document.createTextNode('. Countries match photos anywhere in that country; cities and places match within 40 km. Mark experiences done by hand.'));
    box.append(stat);

    const form = el('form', 'tv-form');
    const titleIn = el('input', 'plain') as HTMLInputElement;
    titleIn.placeholder = 'Somewhere you want to go'; titleIn.required = true;
    titleIn.setAttribute('aria-label', 'Bucket list title');
    const kindSel = el('select', 'plain') as HTMLSelectElement;
    kindSel.setAttribute('aria-label', 'Bucket item type');
    for (const [v, lab] of [['city', 'City'], ['country', 'Country'], ['place', 'Place'], ['experience', 'Experience']] as [BucketKind, string][])
      kindSel.append(new Option(lab, v));
    const countryIn = el('input', 'plain') as HTMLInputElement;
    countryIn.setAttribute('list', 'bucketCountries'); countryIn.placeholder = 'Country (optional)';
    countryIn.setAttribute('aria-label', 'Country');
    let dl = document.getElementById('bucketCountries') as HTMLDataListElement | null;
    if (!dl) { dl = document.createElement('datalist'); dl.id = 'bucketCountries'; document.body.append(dl); }
    dl.innerHTML = ''; listCountryNames().forEach(n => dl!.append(new Option(n)));
    const notesIn = el('input', 'plain') as HTMLInputElement;
    notesIn.placeholder = 'Notes (optional)'; notesIn.setAttribute('aria-label', 'Notes');
    const addBtn = el('button', 'btn small primary', 'Add'); addBtn.type = 'submit';
    const row = el('div', 'row'); row.append(kindSel, addBtn);
    form.append(titleIn, countryIn, notesIn, row);
    const locationIn = el('input', 'plain');
    locationIn.placeholder = 'Find a city to pin (optional)';
    locationIn.setAttribute('aria-label', 'Find bucket location');
    const results = el('div', 'tv-results');
    const locationNote = el('p', 'hint', 'Choose a result to pin a city or place. Experiences are checked off by hand.');
    let selectedPlace: Place | null = null;
    let searchVersion = 0;
    locationIn.oninput = async () => {
      selectedPlace = null;
      const version = ++searchVersion;
      results.replaceChildren();
      if (locationIn.value.trim().length < 2) return;
      try {
        await loadCities();
        if (version !== searchVersion || !form.isConnected) return;
        const hits = searchPlaces(locationIn.value);
        locationNote.textContent = hits.length ? 'Choose the matching location below.' : 'No matching city. You can still add this item and mark it done by hand.';
        for (const hit of hits) {
          const button = el('button', 'btn small', hit.label); button.type = 'button';
          button.onclick = () => {
            selectedPlace = hit; locationIn.value = hit.label;
            if (!titleIn.value.trim()) titleIn.value = hit.short.split(',')[0];
            countryIn.value = countryAt(hit.lat, hit.lng) ?? '';
            locationNote.textContent = 'Pinned to ' + hit.label;
            results.replaceChildren();
          };
          results.append(button);
        }
      } catch { locationNote.textContent = 'City search is unavailable. You can still add the item without a pin.'; }
    };
    form.insertBefore(locationIn, notesIn);
    form.insertBefore(results, notesIn);
    form.insertBefore(locationNote, notesIn);
    countryIn.oninput = () => countryIn.setCustomValidity('');
    form.onsubmit = e => {
      e.preventDefault();
      const title = titleIn.value.trim(); if (!title) return;
      const kind = kindSel.value as BucketKind;
      const rawCountry = countryIn.value.trim() || (kind === 'country' ? title : '');
      const country = listCountryNames().find(n => n.toLowerCase() === rawCountry.toLowerCase()) ?? null;
      if ((rawCountry || kind === 'country') && !country) {
        countryIn.setCustomValidity('Choose a country from the list.'); countryIn.reportValidity(); return;
      }
      let lat = selectedPlace?.lat ?? null, lng = selectedPlace?.lng ?? null;
      if (kind === 'country') {
        const bounds = countryBounds(country!);
        const center = bounds?.getCenter(); lat = center?.lat ?? null; lng = center?.lng ?? null;
      }
      const next = loadBucket();
      next.push(newBucketItem({ title, kind, country, lat, lng, notes: notesIn.value.trim() }));
      saveBucket(next);
      autoFulfillBucket();
      renderBucket(); renderBucketPins();
    };
    box.append(form);

    if (!items.length) {
      const empty = el('div', 'st-empty');
      empty.append(el('b', '', 'Build a list of places to chase.'),
        el('p', '', 'Countries, cities, or experiences. Pin them on the map and tick them off when your photos catch up.'));
      box.append(empty);
      return;
    }
    for (const item of items) {
      const art = el('article', 'bucket-item' + (item.status === 'done' ? ' done' : ''));
      const top = el('div', 'bi-top');
      top.append(el('b', '', item.title), el('span', 'bi-kind', item.kind));
      art.append(top);
      const bits = [item.country, item.status === 'done' ? 'Done' : item.status === 'planned' ? 'Planned' : 'Wishlist'].filter(Boolean);
      art.append(el('p', 'bi-meta', bits.join(' · ')));
      if (item.notes) art.append(el('p', 'bi-notes', item.notes));
      const actions = el('div', 'st-actions');
      const cycle = el('button', 'btn small', item.status === 'wishlist' ? 'Mark planned' : item.status === 'planned' ? 'Mark done' : 'Reopen');
      cycle.onclick = () => {
        const all = loadBucket();
        const cur = all.find(i => i.id === item.id); if (!cur) return;
        const nextStatus: BucketStatus = cur.status === 'wishlist' ? 'planned' : cur.status === 'planned' ? 'done' : 'wishlist';
        cur.status = nextStatus;
        if (nextStatus !== 'done') cur.fulfilledPhotoId = null;
        if (nextStatus === 'wishlist') cur.autoComplete = false;
        saveBucket(all); renderBucket(); renderBucketPins();
      };
      actions.append(cycle);
      if (item.lat != null && item.lng != null) {
        const go = el('button', 'btn small', 'Show on map');
        go.onclick = () => deps.map.flyTo([item.lat!, item.lng!], Math.max(deps.map.getZoom(), 5), { duration: 1 });
        actions.append(go);
      }
      if (item.fulfilledPhotoId) {
        const photo = deps.getCards().find(c => c.id === item.fulfilledPhotoId);
        if (photo) {
          const open = el('button', 'btn small primary', 'Open photo');
          open.onclick = () => openCard(photo);
          actions.append(open);
        }
      }
      const rm = el('button', 'btn small ghost', 'Remove');
      rm.onclick = () => {
        saveBucket(loadBucket().filter(i => i.id !== item.id));
        renderBucket(); renderBucketPins();
      };
      actions.append(rm);
      art.append(actions);
      box.append(art);
    }
  }

  $('tabStories').onclick = () => setPanelTab('stories');
  $('tabBeen').onclick = () => setPanelTab('been');
  $('tabBucket').onclick = () => setPanelTab('bucket');
  $('tabFeed').onclick = () => setPanelTab('feed');

  return { setPanelTab, refreshTravel, getPanelTab: () => panelTab, bucketLayer };
}
