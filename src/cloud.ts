// Accounts (email code sign-in), profiles, following, sync and likes, through Supabase (project psuykzkrakkdqhulrqig).
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

export const cleanEmail = (raw: string) => raw.trim().toLowerCase();
/** Emails the person a sign-in code (and a link that does the same thing). */
export async function sendCode(email: string) {
  const { error } = await sb!.auth.signInWithOtp({
    email: cleanEmail(email), options: { emailRedirectTo: location.origin + '/app.html' }
  });
  if (error) throw error;
}
export async function verifyCode(email: string, token: string) {
  const { error } = await sb!.auth.verifyOtp({ email: cleanEmail(email), token: token.trim(), type: 'email' });
  if (error) throw error;
}
export async function signOut() { await sb?.auth.signOut(); }

/** username is null unless the person chose to be discoverable (or it's you). */
export interface Person { id: string; display_name: string; username: string | null }
export interface MyProfile extends Person { discoverable: boolean; invite_code: string }
export interface Profile extends Person { discoverable: boolean }
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const cleanUsername = (raw: string) => raw.trim().replace(/^@/, '').toLowerCase();
/** How a person is shown: their name, or @username when they haven't set a name. */
export const labelOf = (p: Pick<Person, 'display_name' | 'username'>) => p.display_name || (p.username ? '@' + p.username : 'Someone');

export async function myProfile(): Promise<MyProfile | null> {
  const u = me(); if (!u) return null;
  const { data } = await sb!.from('profiles').select('id, display_name, username, discoverable, invite_code').eq('id', u.id).maybeSingle();
  return (data as MyProfile | null) ?? null;
}
export async function saveProfile(p: { display_name: string; username: string; discoverable: boolean }) {
  const u = me(); if (!u) return;
  const username = cleanUsername(p.username);
  if (username && !USERNAME_RE.test(username)) throw new Error('Usernames are 3 to 20 letters, numbers or underscores.');
  if (p.discoverable && !username) throw new Error('Pick a username to be discoverable.');
  const { error } = await sb!.from('profiles').update({
    display_name: p.display_name.trim().slice(0, 40), username: username || null, discoverable: p.discoverable && !!username
  }).eq('id', u.id);
  if (error) throw new Error(error.code === '23505' ? 'That username is taken. Try another.' : error.message);
}
export async function setInviteCode(code: string) {
  const { error } = await sb!.from('profiles').update({ invite_code: code }).eq('id', me()!.id);
  if (error) throw new Error(error.message);
}
export const inviteLink = (code: string) => `${location.origin}/app.html?add=${code}`;

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

// ---------- people and following ----------
/** Search by username. Only people who turned on "discoverable" appear. */
export async function searchPeople(q: string): Promise<Person[]> {
  const { data, error } = await sb!.rpc('search_people', { q: cleanUsername(q) });
  if (error) throw new Error(error.message);
  return (data ?? []) as Person[];
}
/** A profile by id (people you're connected to), @username (discoverable people) or invite code (anyone). */
export async function publicProfile(who: { id?: string; handle?: string; code?: string }): Promise<Profile | null> {
  const { data, error } = await sb!.rpc('public_profile', {
    uid: who.id ?? null, handle: who.handle ? cleanUsername(who.handle) : null, code: who.code ?? null
  });
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as Profile | undefined) ?? null;
}
/** People you both follow. Empty unless the other person is discoverable. */
export async function mutualFollows(id: string): Promise<Person[]> {
  const { data } = await sb!.rpc('mutual_follows', { uid: id });
  return (data ?? []) as Person[];
}
/** Which of these email addresses belong to Wayframe accounts. Sent as one-way hashes. */
export async function matchContacts(emails: string[]): Promise<Person[]> {
  const ok = [...new Set(emails.map(cleanEmail).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))].slice(0, 2000);
  if (!ok.length) return [];
  const hashes = await Promise.all(ok.map(async e => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(e));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }));
  const { data, error } = await sb!.rpc('match_contacts', { hashes });
  if (error) throw new Error(error.message);
  return (data ?? []) as Person[];
}
export async function blockUser(id: string) { const { error } = await sb!.rpc('block_user', { uid: id }); if (error) throw new Error(error.message); }
export async function unblockUser(id: string) { await sb!.from('blocks').delete().eq('blocker', me()!.id).eq('blocked', id); }
export async function blockedIds(): Promise<string[]> {
  const { data } = await sb!.from('blocks').select('blocked').eq('blocker', me()!.id);
  return (data ?? []).map((x: any) => x.blocked);
}
export async function reportUser(id: string, reason: string) {
  const { error } = await sb!.from('reports').insert({ reported: id, reason: reason.slice(0, 500) });
  if (error) throw new Error(error.message);
}
export interface Connection extends Person { i_follow: boolean; follows_me: boolean }
/** Everyone you follow or who follows you. */
export async function connections(): Promise<Connection[]> {
  if (!me()) return [];
  const { data } = await sb!.rpc('my_connections');
  return (data ?? []) as Connection[];
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
