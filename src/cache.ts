// Remembers what a page last showed, so the next visit (or the next tab) can paint at once and refresh quietly behind it.
// Only public community data goes in here: never private photos. Everything is optional: if storage is blocked or full
// the pages simply load the slow way.
const PREFIX = 'wf-cache:';
/** Image links in cached data stop working after an hour, so cached data is only used for a little less than that. */
export const FRESH_MS = 50 * 60 * 1000;

export function remember(key: string, value: unknown): void {
  try { localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), v: value })); } catch { /* full or blocked: skip */ }
}
export function recall<T>(key: string, maxAge = FRESH_MS): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key); if (!raw) return null;
    const { at, v } = JSON.parse(raw) as { at: number; v: T };
    return Date.now() - at <= maxAge ? v : null;
  } catch { return null; }
}
/** How old a remembered value is, in milliseconds (Infinity if there is none). */
export function ageOf(key: string): number {
  try { const raw = localStorage.getItem(PREFIX + key); return raw ? Date.now() - (JSON.parse(raw) as { at: number }).at : Infinity; } catch { return Infinity; }
}
