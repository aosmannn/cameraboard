import type { Card } from './types';
import { cameraName, dayOf } from './photo';

export interface Filters { q: string; trip: string; camera: string; country: string; from: string; to: string }
export const filters: Filters = { q: '', trip: '', camera: '', country: '', from: '', to: '' };

/** How many filters are switched on (the search box counts as one). */
export const activeCount = () => Object.values(filters).filter(Boolean).length;
export const clearFilters = () => { for (const k of Object.keys(filters) as (keyof Filters)[]) filters[k] = ''; };

export function matches(c: Card, country: string | null): boolean {
  if (filters.trip && c.trip !== filters.trip) return false;
  if (filters.camera && cameraName(c) !== filters.camera) return false;
  if (filters.country && country !== filters.country) return false;
  const day = dayOf(c);
  if ((filters.from || filters.to) && !day) return false;
  if (filters.from && day < filters.from) return false;
  if (filters.to && day > filters.to) return false;
  if (filters.q) {
    const hay = [c.title, c.story, c.place, c.trip, cameraName(c), country ?? ''].join(' ').toLowerCase();
    if (!filters.q.toLowerCase().split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}
