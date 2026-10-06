import type { Card } from './types';

// The whole board is stored under one key in IndexedDB.
let db: IDBDatabase;

export function openStore(): Promise<void> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('cameraboard', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => { db = r.result; res(); };
    r.onerror = () => rej(r.error);
  });
}

export function loadCards(): Promise<Card[] | undefined> {
  return new Promise((res, rej) => {
    const q = db.transaction('kv').objectStore('kv').get('cards');
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
}

export function saveCards(cards: Card[]): Promise<void> {
  return new Promise((res, rej) => {
    const t = db.transaction('kv', 'readwrite');
    t.objectStore('kv').put(cards, 'cards');
    t.oncomplete = () => res(); t.onerror = () => rej(t.error);
  });
}
