// Accounts, sync and friends, through Supabase (project psuykzkrakkdqhulrqig).
// The app works fully without this: if no key is configured, everything stays in the browser.
import { createClient, type Session } from '@supabase/supabase-js';
import type { Card } from './types';
import { normalize } from './photo';

const URL = import.meta.env.VITE_SUPABASE_URL || 'https://psuykzkrakkdqhulrqig.supabase.co';
// The publishable key is public by design; the row level security rules in supabase/schema.sql protect the data.
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_mD_qa0pJwt0HT4DmergxzQ_3-QNS-bu';
export const cloudEnabled = !!KEY;
const sb = cloudEnabled ? createClient(URL, KEY) : null;
const BUCKET = 'photos';

let session: Session | null = null;
export const me = () => session?.user ?? null;

export async function initAuth(onChange: (signedIn: boolean) => void) {
  if (!sb) return;
  session = (await sb.auth.getSession()).data.session;
  sb.auth.onAuthStateChange((_e, s) => {
    const was = !!session; session = s;
    if (was !== !!s) onChange(!!s);
  });
  onChange(!!session);
}

/** Phone numbers go to Supabase as +<country><number>, e.g. +14045551234. */
export const toE164 = (raw: string) => {
  const t = raw.trim();
  const d = t.replace(/\D/g, '');
  return t.startsWith('+') ? '+' + d : d.length === 10 ? '+1' + d : '+' + d;
};
export async function sendCode(phone: string) {
  const { error } = await sb!.auth.signInWithOtp({ phone: toE164(phone) });
  if (error) throw error;
}
export async function verifyCode(phone: string, token: string) {
  const { error } = await sb!.auth.verifyOtp({ phone: toE164(phone), token: token.trim(), type: 'sms' });
  if (error) throw error;
}
export async function signOut() { await sb?.auth.signOut(); }

export async function myName(): Promise<string> {
  const u = me(); if (!u) return '';
  const { data } = await sb!.from('profiles').select('display_name').eq('id', u.id).maybeSingle();
  return data?.display_name ?? '';
}
export async function setMyName(name: string) {
  const u = me(); if (!u) return;
  const { error } = await sb!.from('profiles').update({ display_name: name.trim().slice(0, 40) }).eq('id', u.id);
  if (error) throw error;
}

// ---------- your photos ----------
interface Row {
  id: string; owner: string; title: string; story: string; taken_at: string; lat: number | null; lng: number | null;
  place: string; trip: string; seq: number; look: string; stamp: boolean; pin_color: string; cover: boolean;
  rot: number; meta: any; image_path: string | null; shared: boolean; updated_at: string;
}
const toRow = (c: Card) => ({
  id: c.id, title: c.title, story: c.story, taken_at: c.date, lat: c.lat, lng: c.lng, place: c.place, trip: c.trip,
  seq: c.seq, look: c.look, stamp: c.stamp, pin_color: c.pinColor, cover: c.cover, rot: c.rot, meta: c.meta ?? {},
  image_path: c.imgPath || null, shared: c.shared
});
const fromRow = (r: Row, img: string): Card => normalize({
  id: r.id, owner: r.owner, title: r.title, story: r.story, date: r.taken_at, lat: r.lat, lng: r.lng, place: r.place,
  trip: r.trip, seq: r.seq, look: r.look as Card['look'], stamp: r.stamp, pinColor: r.pin_color, cover: r.cover, rot: r.rot,
  meta: r.meta ?? {}, imgPath: r.image_path ?? '', shared: r.shared, img
}, 0);

const blobToDataUrl = (b: Blob) => new Promise<string>((res, rej) => {
  const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = rej; fr.readAsDataURL(b);
});

/** What was last sent for each photo, so only real changes go up. */
const sent = new Map<string, string>();
const signature = (c: Card) => JSON.stringify(toRow(c));

/** Uploads new or changed photos you own. Images go up once, then only the details. */
export async function push(cards: Card[]) {
  const u = me(); if (!u) return;
  for (const c of cards) {
    if (!c.img || (c.owner && c.owner !== u.id)) continue;
    c.owner = u.id;
    if (!c.imgPath) {
      const path = `${u.id}/${c.id}-${Date.now()}.jpg`;
      const blob = await (await fetch(c.img)).blob();
      const { error } = await sb!.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
      if (error) throw error;
      c.imgPath = path;
    }
    const sig = signature(c);
    if (sent.get(c.id) === sig) continue;
    const { error } = await sb!.from('photos').upsert(toRow(c));
    if (error) throw error;
    sent.set(c.id, sig);
  }
}
export async function removeRemote(c: Card) {
  const u = me(); if (!u || c.owner !== u.id) return;
  await sb!.from('photos').delete().eq('id', c.id);
  if (c.imgPath) await sb!.storage.from(BUCKET).remove([c.imgPath]);
  sent.delete(c.id);
}
/** Replacing a photo's image: the old file goes, the new one uploads on the next push. */
export async function dropImage(c: Card) {
  if (me() && c.imgPath && c.owner === me()!.id) await sb!.storage.from(BUCKET).remove([c.imgPath]);
  c.imgPath = '';
}

/** Your photos saved in the cloud that this browser doesn't have yet (for example, from another device). */
export async function pullMine(have: Set<string>): Promise<Card[]> {
  const u = me(); if (!u) return [];
  const { data, error } = await sb!.from('photos').select('*').eq('owner', u.id);
  if (error) throw error;
  const out: Card[] = [];
  for (const r of data as Row[]) {
    sent.set(r.id, '');   // force a compare on the next push
    if (have.has(r.id) || !r.image_path) continue;
    const { data: blob } = await sb!.storage.from(BUCKET).download(r.image_path);
    if (!blob) continue;
    const c = fromRow(r, await blobToDataUrl(blob));
    sent.set(c.id, signature(c));
    out.push(c);
  }
  return out;
}

// ---------- friends ----------
export interface Person { id: string; display_name: string }

/** Hashes numbers the same way the database does (sha256 of the digits after the +). */
async function hashPhone(e164: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(e164.replace(/^\+/, '')));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
/** Numbers in contacts often have no country code; `cc` is used for those (e.g. "1" for the US). */
export function normaliseContact(raw: string, cc: string) {
  const t = raw.trim(); if (!t) return '';
  let d = t.replace(/\D/g, '');
  if (t.startsWith('+')) return '+' + d;
  if (d.startsWith('00')) return '+' + d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  if (cc === '1' && d.length === 11 && d.startsWith('1')) return '+' + d;
  return '+' + cc + d;
}
export async function matchContacts(numbers: string[], cc: string): Promise<Person[]> {
  const e164 = [...new Set(numbers.map(n => normaliseContact(n, cc)).filter(n => n.length > 6))].slice(0, 2000);
  const hashes = await Promise.all(e164.map(hashPhone));
  const { data, error } = await sb!.rpc('match_contacts', { hashes });
  if (error) throw error;
  return data as Person[];
}
export async function following(): Promise<Person[]> {
  const u = me(); if (!u) return [];
  const { data: f } = await sb!.from('follows').select('followee').eq('follower', u.id);
  const ids = (f ?? []).map((x: any) => x.followee);
  if (!ids.length) return [];
  const { data } = await sb!.from('profiles').select('id, display_name').in('id', ids);
  return (data ?? []) as Person[];
}
export async function follow(id: string) { const { error } = await sb!.from('follows').insert({ followee: id }); if (error && error.code !== '23505') throw error; }
export async function unfollow(id: string) { await sb!.from('follows').delete().eq('follower', me()!.id).eq('followee', id); }

/** Photos friends shared with you. Images come as short-lived signed links. */
export async function friendPhotos(ids: string[]): Promise<Card[]> {
  if (!ids.length) return [];
  const { data, error } = await sb!.from('photos').select('*').in('owner', ids).eq('shared', true);
  if (error) throw error;
  const rows = (data as Row[]).filter(r => r.image_path);
  if (!rows.length) return [];
  const { data: signed } = await sb!.storage.from(BUCKET).createSignedUrls(rows.map(r => r.image_path!), 3600);
  const url = new Map((signed ?? []).map(s => [s.path, s.signedUrl]));
  return rows.filter(r => url.get(r.image_path!)).map(r => fromRow(r, url.get(r.image_path!)!));
}

// ---------- likes ----------
export async function likeInfo(ids: string[]): Promise<Map<string, { n: number; mine: boolean }>> {
  const out = new Map<string, { n: number; mine: boolean }>();
  if (!ids.length || !me()) return out;
  const { data } = await sb!.from('likes').select('photo_id, user_id').in('photo_id', ids);
  for (const l of (data ?? []) as { photo_id: string; user_id: string }[]) {
    const v = out.get(l.photo_id) ?? { n: 0, mine: false };
    v.n++; if (l.user_id === me()!.id) v.mine = true;
    out.set(l.photo_id, v);
  }
  return out;
}
export async function setLike(id: string, on: boolean) {
  if (on) await sb!.from('likes').insert({ photo_id: id });
  else await sb!.from('likes').delete().eq('photo_id', id).eq('user_id', me()!.id);
}
