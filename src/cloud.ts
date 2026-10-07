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
/** Signing in with an email and password, for people who set one. */
export async function signInWithPassword(email: string, password: string) {
  const { error } = await sb!.auth.signInWithPassword({ email: cleanEmail(email), password });
  if (error) throw error;
}
export const PASSWORD_MIN = 8;
/** Adds or changes the password. The emailed code is still always available as a way in. */
export async function setPassword(password: string) {
  if (password.length < PASSWORD_MIN) throw new Error(`Use at least ${PASSWORD_MIN} characters.`);
  const { error } = await sb!.auth.updateUser({ password, data: { pw: true } });
  if (error) throw error;
}
export const hasPassword = () => !!session?.user?.user_metadata?.pw;
export async function signOut() { await sb?.auth.signOut(); }

/** username is null unless the person chose to be discoverable (or it's you). */
export interface Person { id: string; display_name: string; username: string | null }
export interface MyProfile extends Person { discoverable: boolean; invite_code: string; gallery: boolean; default_visibility: Card['visibility']; bio: string; avatar_path: string | null }
export interface Profile extends Person { discoverable: boolean; bio?: string; avatar_path?: string | null; followers?: number; following?: number; photos?: number; stories?: number }
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const cleanUsername = (raw: string) => raw.trim().replace(/^@/, '').toLowerCase();
/** How a person is shown: their name, or @username when they haven't set a name. */
export const labelOf = (p: Pick<Person, 'display_name' | 'username'>) => p.display_name || (p.username ? '@' + p.username : 'Someone');

export async function myProfile(): Promise<MyProfile | null> {
  const u = me(); if (!u) return null;
  const q = (cols: string) => sb!.from('profiles').select(cols).eq('id', u.id).maybeSingle();
  const base = 'id, display_name, username, discoverable, invite_code';
  // Newer columns arrive with the latest database migrations; until they exist, load the profile without them.
  let { data, error } = await q(base + ', gallery, default_visibility, bio, avatar_path');
  if (error) ({ data, error } = await q(base + ', gallery, default_visibility, bio'));
  if (error) ({ data, error } = await q(base + ', gallery, default_visibility'));
  if (error) ({ data, error } = await q(base + ', gallery'));
  if (error) ({ data } = await q(base));
  const row = data as unknown as MyProfile | null;
  return row ? { ...row, gallery: !!row.gallery, default_visibility: row.default_visibility ?? 'private', bio: row.bio ?? '', avatar_path: row.avatar_path ?? null } : null;
}
export async function saveProfile(p: { display_name: string; username: string; discoverable: boolean; gallery?: boolean; default_visibility?: Card['visibility']; bio?: string }) {
  const u = me(); if (!u) return;
  const username = cleanUsername(p.username);
  if (username && !USERNAME_RE.test(username)) throw new Error('Usernames are 3 to 20 letters, numbers or underscores.');
  if (p.discoverable && !username) throw new Error('Pick a username to be discoverable.');
  const { error } = await sb!.from('profiles').update({
    display_name: p.display_name.trim().slice(0, 40), username: username || null, discoverable: p.discoverable && !!username,
    ...(p.gallery === undefined ? {} : { gallery: p.gallery }),
    ...(p.default_visibility === undefined ? {} : { default_visibility: p.default_visibility }),
    ...(p.bio === undefined ? {} : { bio: p.bio.trim().slice(0, 160) })
  }).eq('id', u.id);
  if (error) throw new Error(error.code === '23505' ? 'That username is taken. Try another.' : error.message);
}
export async function setInviteCode(code: string) {
  const { error } = await sb!.from('profiles').update({ invite_code: code }).eq('id', me()!.id);
  if (error) throw new Error(error.message);
}
/** Invite links point at the public site, never at a protected preview address. */
const SITE = (import.meta.env.VITE_PUBLIC_URL as string | undefined)?.replace(/\/$/, '') || '';
export const inviteLink = (code: string) => `${SITE || location.origin}/app.html?add=${code}`;
/** The page that tells one story: the public photos under that story name. */
export const storyLink = (ownerId: string, trip: string) => `${SITE || location.origin}/s/${ownerId}?t=${encodeURIComponent(trip)}`;
/** The name behind an invite link. Works without signing in. */
export async function invitePreview(code: string): Promise<string | null> {
  if (!sb) return null;
  const { data } = await sb.rpc('invite_preview', { code });
  const row = (data ?? [])[0] as { display_name: string } | undefined;
  return row ? (row.display_name || 'A friend') : null;
}

// ---------- your photos ----------
interface Row {
  id: string; owner: string; title: string; story: string; taken_at: string; lat: number | null; lng: number | null;
  place: string; trip: string; seq: number; look: string; stamp: boolean; pin_color: string; cover: boolean;
  rot: number; meta: any; image_path: string | null; visibility?: Card['visibility']; updated_at?: string;
  country?: string; pinned?: boolean;
}
const toRow = (c: Card) => ({
  id: c.id, title: c.title, story: c.story, taken_at: c.date, lat: c.lat, lng: c.lng, place: c.place, trip: c.trip,
  seq: c.seq, look: c.look, stamp: c.stamp, pin_color: c.pinColor, cover: c.cover, rot: c.rot, meta: c.meta ?? {},
  image_path: c.imgPath || null, visibility: c.visibility, country: c.country ?? '', pinned: !!c.pinned
});
const fromRow = (r: Row, img: string): Card => normalize({
  id: r.id, owner: r.owner, title: r.title, story: r.story, date: r.taken_at, lat: r.lat, lng: r.lng, place: r.place,
  trip: r.trip, seq: r.seq, look: r.look as Card['look'], stamp: r.stamp, pinColor: r.pin_color, cover: r.cover, rot: r.rot,
  meta: r.meta ?? {}, imgPath: r.image_path ?? '', visibility: r.visibility ?? 'public', country: r.country ?? '', pinned: !!r.pinned, img
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
  const { data, error } = await sb!.rpc('profile_page', {
    uid: who.id ?? null, handle: who.handle ? cleanUsername(who.handle) : null, code: who.code ?? null
  });
  if (error) throw new Error(error.message);
  const r = (data ?? [])[0] as (Profile & { followers: number; following: number; photos: number; stories: number }) | undefined;
  return r ? { ...r, followers: Number(r.followers), following: Number(r.following), photos: Number(r.photos), stories: Number(r.stories) } : null;
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
  const { data, error } = await sb!.from('photos').select('*').in('owner', ids).in('visibility', ['friends', 'public']);
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

/** Image links that work for anyone: public images can be signed without an account. */
async function signPaths(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const list = [...new Set(paths.filter(Boolean))];
  if (!sb || !list.length) return out;
  const { data } = await sb.storage.from(BUCKET).createSignedUrls(list, 3600);
  for (const s of data ?? []) if (s.signedUrl && s.path) out.set(s.path, s.signedUrl);
  return out;
}
type PublicRow = Row & { owner_name: string };
async function rowsToCards(rows: PublicRow[]) {
  const out = { cards: [] as Card[], owners: new Map<string, string>() };
  const url = await signPaths(rows.map(r => r.image_path!));
  for (const r of rows) {
    const u = url.get(r.image_path!); if (!u) continue;
    out.cards.push(fromRow({ ...r, visibility: 'public' }, u)); out.owners.set(r.owner, r.owner_name || 'A friend');
  }
  return out;
}

/** A person's public photos, reached with their invite link, @username or id. Works without signing in. */
export async function publicPhotos(who: { code?: string; handle?: string; id?: string }): Promise<{ cards: Card[]; owners: Map<string, string> }> {
  if (!sb) return { cards: [], owners: new Map() };
  const { data, error } = await sb.rpc('public_photos', { code: who.code ?? null, handle: who.handle ? cleanUsername(who.handle) : null, uid: who.id ?? null });
  if (error) throw new Error(error.message);
  return rowsToCards((data ?? []) as PublicRow[]);
}

// ---------- community gallery (Explore pages) ----------
/** The gallery functions arrive with the latest database migration; say so plainly when they're missing. */
const galleryError = (msg: string) => new Error(/schema cache|does not exist/i.test(msg)
  ? 'The gallery isn’t set up in the database yet. The latest supabase/schema.sql needs to be run once.' : msg);
/** Lower-case, dashes between words: the form cameras take in page addresses. */
export const slugify = (t: string) => t.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Public photos from people who turned on "Show my public photos in the community gallery". Newest first. */
export async function explorePhotos(o: { limit?: number; offset?: number; camera?: string; q?: string } = {}) {
  if (!sb) return { cards: [] as Card[], owners: new Map<string, string>(), more: false };
  const limit = o.limit ?? 48;
  const { data, error } = await sb.rpc('explore_photos', { lim: limit, off: o.offset ?? 0, cam: o.camera || null, q: o.q?.trim() || null });
  if (error) throw galleryError(error.message);
  const rows = (data ?? []) as PublicRow[];
  return { ...(await rowsToCards(rows)), more: rows.length >= limit };
}
export interface GalleryStory { owner: string; owner_name: string; trip: string; stops: number; places: string[]; cover: string; updated: string }
export async function exploreStories(limit = 24, offset = 0): Promise<{ stories: GalleryStory[]; more: boolean }> {
  if (!sb) return { stories: [], more: false };
  const { data, error } = await sb.rpc('explore_stories', { lim: limit, off: offset });
  if (error) throw galleryError(error.message);
  const rows = (data ?? []) as { owner: string; owner_name: string; trip: string; stops: number; places: string[]; cover_path: string; updated: string }[];
  const url = await signPaths(rows.map(r => r.cover_path));
  return {
    more: rows.length >= limit,
    stories: rows.map(r => ({ owner: r.owner, owner_name: r.owner_name || 'A traveler', trip: r.trip, stops: Number(r.stops), places: r.places ?? [], cover: url.get(r.cover_path) ?? '', updated: r.updated }))
  };
}
export interface CameraStat { camera: string; slug: string; photos: number; people: number; cover: string }
export async function exploreCameras(): Promise<CameraStat[]> {
  if (!sb) return [];
  const { data, error } = await sb.rpc('explore_cameras');
  if (error) throw galleryError(error.message);
  const rows = (data ?? []) as { camera: string; slug: string; photos: number; people: number; cover_path: string }[];
  const url = await signPaths(rows.map(r => r.cover_path));
  return rows.map(r => ({ camera: r.camera, slug: r.slug, photos: Number(r.photos), people: Number(r.people), cover: url.get(r.cover_path) ?? '' }));
}
export interface PublicCard { id: string; display_name: string; username: string | null; bio: string; avatar_path: string | null; photos: number; stories: number; followers: number; following: number }
/** A name, bio and counts for a profile page. Works without signing in. */
export async function publicCard(who: { code?: string; handle?: string; id?: string }): Promise<PublicCard | null> {
  if (!sb) return null;
  const { data, error } = await sb.rpc('profile_page', { code: who.code ?? null, handle: who.handle ? cleanUsername(who.handle) : null, uid: who.id ?? null });
  if (error) throw new Error(error.message);
  const r = (data ?? [])[0] as PublicCard | undefined;
  return r ? { ...r, bio: r.bio ?? '', avatar_path: r.avatar_path ?? null, photos: Number(r.photos), stories: Number(r.stories), followers: Number(r.followers), following: Number(r.following) } : null;
}

// ---------- profile picture ----------
/** Profile pictures live in a public bucket, so anyone who can see a profile can see the picture. */
export const avatarUrl = (path: string | null | undefined) => path ? `${URL}/storage/v1/object/public/avatars/${path}` : '';
export async function uploadAvatar(blob: Blob): Promise<string> {
  const u = me(); if (!u) throw new Error('Sign in first.');
  const old = (await myProfile())?.avatar_path;
  const path = `${u.id}/${Date.now()}.jpg`;
  const up = await sb!.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
  if (up.error) throw new Error(up.error.message);
  const { error } = await sb!.from('profiles').update({ avatar_path: path }).eq('id', u.id);
  if (error) throw new Error(error.message);
  if (old) await sb!.storage.from('avatars').remove([old]).catch(() => { /* an old picture left behind is harmless */ });
  return path;
}
export async function removeAvatar() {
  const u = me(); if (!u) return;
  const old = (await myProfile())?.avatar_path;
  const { error } = await sb!.from('profiles').update({ avatar_path: null }).eq('id', u.id);
  if (error) throw new Error(error.message);
  if (old) await sb!.storage.from('avatars').remove([old]).catch(() => { /* harmless */ });
}

// ---------- travel: countries you've marked, and your bucket list ----------
export type BucketKind = 'country' | 'city' | 'place' | 'experience';
export type BucketStatus = 'wishlist' | 'planned' | 'done';
export interface BucketItem {
  id: string; title: string; kind: BucketKind; country: string; lat: number | null; lng: number | null;
  notes: string; status: BucketStatus; fulfilled_photo: string | null; created_at: string;
}
export async function myVisits(): Promise<string[]> {
  if (!sb || !me()) return [];
  const { data, error } = await sb.from('visits').select('country').eq('user_id', me()!.id);
  if (error) throw error;
  return (data ?? []).map((r: { country: string }) => r.country);
}
export async function addVisit(country: string) {
  const { error } = await sb!.from('visits').upsert({ user_id: me()!.id, country }, { onConflict: 'user_id,country' });
  if (error) throw error;
}
export async function removeVisit(country: string) {
  const { error } = await sb!.from('visits').delete().eq('user_id', me()!.id).eq('country', country);
  if (error) throw error;
}
export async function myBucket(): Promise<BucketItem[]> {
  if (!sb || !me()) return [];
  const { data, error } = await sb.from('bucket_items').select('*').eq('user_id', me()!.id).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as BucketItem[];
}
export async function addBucket(item: Pick<BucketItem, 'title' | 'kind' | 'country' | 'lat' | 'lng' | 'notes'>): Promise<BucketItem> {
  const { data, error } = await sb!.from('bucket_items').insert({ ...item, user_id: me()!.id }).select('*').single();
  if (error) throw error;
  return data as BucketItem;
}
export async function updateBucket(id: string, patch: Partial<Pick<BucketItem, 'status' | 'notes' | 'title' | 'fulfilled_photo'>>) {
  const { error } = await sb!.from('bucket_items').update(patch).eq('id', id);
  if (error) throw error;
}
export async function removeBucket(id: string) {
  const { error } = await sb!.from('bucket_items').delete().eq('id', id);
  if (error) throw error;
}

// ---------- profile: travel summary and highlights ----------
export interface TravelSummary { countries: number; photos: number; top_place: string | null; top_place_n: number | null; longest_trip: string | null; longest_trip_n: number | null; top_camera: string | null; top_camera_n: number | null }
export async function travelSummary(id: string): Promise<TravelSummary | null> {
  if (!sb) return null;
  const { data, error } = await sb.rpc('travel_summary', { who: id });
  if (error) throw new Error(error.message);
  const r = (data ?? [])[0] as TravelSummary | undefined;
  return r && r.photos ? r : null;
}
export interface Highlight { id: string; title: string; place: string; trip: string; image_path: string; taken_at: string; look: string; url: string }
export async function profileHighlights(id: string): Promise<Highlight[]> {
  if (!sb) return [];
  const { data, error } = await sb.rpc('profile_highlights', { who: id });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Omit<Highlight, 'url'>[];
  const url = await signPaths(rows.map(r => r.image_path));
  return rows.filter(r => url.get(r.image_path)).map(r => ({ ...r, url: url.get(r.image_path)! }));
}
/** The totals on the home page: photos pinned, countries covered, people pinning. */
export async function siteStats(): Promise<{ photos: number; countries: number; people: number } | null> {
  if (!sb) return null;
  const { data, error } = await sb.rpc('site_stats');
  if (error) return null;
  const r = (data ?? [])[0];
  return r ? { photos: Number(r.photos), countries: Number(r.countries), people: Number(r.people) } : null;
}
export async function setPinned(id: string, pinned: boolean) {
  const { error } = await sb!.from('photos').update({ pinned }).eq('id', id);
  if (error) throw error;
}

// ---------- comments ----------
export interface Comment { id: string; user_id: string; name: string; username: string | null; avatar_path: string | null; body: string; created_at: string; mine: boolean; can_delete: boolean }
export async function photoComments(photoId: string): Promise<Comment[]> {
  if (!sb || !me()) return [];
  const { data, error } = await sb.rpc('photo_comments_list', { pid: photoId });
  if (error) throw new Error(error.message);
  return (data ?? []) as Comment[];
}
export async function addComment(photoId: string, body: string) {
  const { error } = await sb!.from('photo_comments').insert({ photo_id: photoId, user_id: me()!.id, body: body.trim() });
  if (error) throw new Error(/row-level security/i.test(error.message) ? 'Slow down a little, or follow them first to comment.' : error.message);
}
export async function deleteComment(id: string) {
  const { error } = await sb!.from('photo_comments').delete().eq('id', id);
  if (error) throw error;
}

// ---------- notifications ----------
export interface Notice { id: number; kind: 'follow' | 'like' | 'comment' | 'mention'; actor: string; actor_name: string; actor_username: string | null; actor_avatar: string | null; photo_id: string | null; photo_title: string | null; body: string; created_at: string; is_read: boolean }
export async function myNotices(lim = 40): Promise<Notice[]> {
  if (!sb || !me()) return [];
  const { data, error } = await sb.rpc('my_notifications', { lim });
  if (error) throw new Error(error.message);
  return (data ?? []) as Notice[];
}
export async function markNoticesRead() {
  if (!sb || !me()) return;
  await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', me()!.id).is('read_at', null);
}
