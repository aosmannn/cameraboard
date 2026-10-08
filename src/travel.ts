import type { Card } from './types';
import { countryAt } from './world';

/** Countries you’ve been to (by map name, matching world-atlas / countryAt). */
export type VisitSource = 'photo' | 'manual';

export interface Visit {
  name: string;
  source: VisitSource;
  firstAt: string; // ISO
  photoCount: number;
}

export type BucketKind = 'country' | 'city' | 'place' | 'experience';
export type BucketStatus = 'wishlist' | 'planned' | 'done';

export interface BucketItem {
  id: string;
  title: string;
  kind: BucketKind;
  /** Country name when known (same spelling as countryAt) */
  country: string | null;
  lat: number | null;
  lng: number | null;
  notes: string;
  status: BucketStatus;
  createdAt: string;
  fulfilledPhotoId: string | null;
  /** Reopened items stay open until the user checks them off again. */
  autoComplete?: boolean;
}

const VISIT_KEY = 'wf-visited';
const BUCKET_KEY = 'wf-bucket';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked */
  }
}

export function loadVisits(): Visit[] {
  return readJson<Visit[]>(VISIT_KEY, []);
}

export function saveVisits(visits: Visit[]): void {
  writeJson(VISIT_KEY, visits);
}

export function loadBucket(): BucketItem[] {
  return readJson<BucketItem[]>(BUCKET_KEY, []);
}

export function saveBucket(items: BucketItem[]): void {
  writeJson(BUCKET_KEY, items);
}

/** Auto-mark countries from placed photos; keep manual visits. */
export function syncVisitsFromPhotos(cards: Card[]): Visit[] {
  const byName = new Map(loadVisits().map((v) => [v.name, { ...v, photoCount: 0 }]));
  const counts = new Map<string, { n: number; first: string }>();

  for (const c of cards) {
    if (c.lat == null || c.lng == null || !c.img) continue;
    const name = countryAt(c.lat, c.lng);
    if (!name) continue;
    const date = new Date(c.date);
    const at = Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
    const cur = counts.get(name);
    if (!cur) counts.set(name, { n: 1, first: at });
    else {
      cur.n += 1;
      if (Date.parse(at) < Date.parse(cur.first)) cur.first = at;
    }
  }

  for (const [name, meta] of counts) {
    const existing = byName.get(name);
    if (existing) {
      existing.photoCount = meta.n;
      if (existing.source === 'manual') {
        // keep manual, but attach photo count
      } else {
        existing.source = 'photo';
        existing.firstAt = meta.first;
      }
    } else {
      byName.set(name, {
        name,
        source: 'photo',
        firstAt: meta.first,
        photoCount: meta.n,
      });
    }
  }

  // Drop photo-sourced visits that no longer have photos (keep manual)
  for (const [name, v] of [...byName]) {
    if (v.source === 'photo' && !counts.has(name)) byName.delete(name);
  }

  const next = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  saveVisits(next);
  return next;
}

export function toggleManualVisit(name: string): Visit[] {
  const visits = loadVisits();
  const i = visits.findIndex((v) => v.name === name);
  if (i >= 0) {
    const v = visits[i]!;
    if (v.source === 'photo' && v.photoCount > 0) {
      // Already visited via photos — leave it
      return visits;
    }
    visits.splice(i, 1);
  } else {
    visits.push({
      name,
      source: 'manual',
      firstAt: new Date().toISOString(),
      photoCount: 0,
    });
  }
  visits.sort((a, b) => a.name.localeCompare(b.name));
  saveVisits(visits);
  return visits;
}

export function visitNameSet(visits: Visit[]): Set<string> {
  return new Set(visits.map((v) => v.name));
}

export function listCountryNames(): string[] {
  // Built from the same Natural Earth set used on the map (via countryAt’s topo).
  // We expose names already used by photos + a static shortlist is insufficient;
  // world.ts doesn’t export the feature list, so we collect from visits + a helper
  // injected at runtime. See setCountryCatalog below.
  return countryCatalog.slice().sort((a, b) => a.localeCompare(b));
}

let countryCatalog: string[] = [];

export function setCountryCatalog(names: string[]): void {
  countryCatalog = names.filter((n) => n && n !== 'Antarctica');
}

export function newBucketItem(partial: {
  title: string;
  kind: BucketKind;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  notes?: string;
}): BucketItem {
  return {
    id: crypto.randomUUID(),
    title: partial.title.trim(),
    kind: partial.kind,
    country: partial.country ?? null,
    lat: partial.lat ?? null,
    lng: partial.lng ?? null,
    notes: partial.notes ?? '',
    status: 'wishlist',
    createdAt: new Date().toISOString(),
    fulfilledPhotoId: null,
  };
}

export function matchBucketHits(
  items: BucketItem[],
  cards: Card[],
  radiusKm = 40,
): { item: BucketItem; photoId: string }[] {
  const open = items.filter((i) => i.status !== 'done' && i.autoComplete !== false);
  const hits: { item: BucketItem; photoId: string }[] = [];
  for (const item of open) {
    for (const c of cards) {
      if (!c.img || c.lat == null || c.lng == null) continue;
      if (item.kind === 'experience') continue;
      if (item.kind === 'country' && item.country) {
        const name = countryAt(c.lat, c.lng);
        if (name === item.country) {
          hits.push({ item, photoId: c.id });
          break;
        }
      }
      if (item.kind !== 'country' && item.lat != null && item.lng != null) {
        const d = haversineKm(item.lat, item.lng, c.lat, c.lng);
        if (d <= radiusKm) {
          hits.push({ item, photoId: c.id });
          break;
        }
      }
    }
  }
  return hits;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
