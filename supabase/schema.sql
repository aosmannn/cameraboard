-- Wayframe database. Safe to run again. Run in Supabase: SQL Editor -> New query -> paste all of this -> Run.
-- Every table has row level security, so people only ever see their own photos and the photos
-- friends chose to share with them.


create extension if not exists pgcrypto with schema extensions;

-- ---------- people ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 40),
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists username text;
-- Nobody appears in search until they turn this on, and they need a username first.
alter table public.profiles add column if not exists discoverable boolean not null default false;
-- A personal, unguessable code for invite links and QR codes. Works even when search is off.
alter table public.profiles add column if not exists invite_code text not null default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format check (username is null or username ~ '^[a-z0-9_]{3,20}$');
alter table public.profiles drop constraint if exists profiles_discoverable_needs_username;
alter table public.profiles add constraint profiles_discoverable_needs_username check (not discoverable or username is not null);
create unique index if not exists profiles_username_unique on public.profiles (lower(username));
create unique index if not exists profiles_invite_code_unique on public.profiles (invite_code);

-- usernames are stored lower-case
create or replace function public.clean_profile() returns trigger language plpgsql as $$
begin
  new.username = nullif(lower(trim(coalesce(new.username, ''))), '');
  new.display_name = trim(new.display_name);
  if new.username is null then new.discoverable = false; end if;
  return new;
end $$;
drop trigger if exists profiles_clean on public.profiles;
create trigger profiles_clean before insert or update on public.profiles for each row execute function public.clean_profile();

-- ---------- following ----------
create table if not exists public.follows (
  follower uuid not null default auth.uid() references auth.users on delete cascade,
  followee uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
alter table public.follows enable row level security;
drop policy if exists "see your own follows" on public.follows;
create policy "see your own follows" on public.follows
  for select to authenticated using (follower = auth.uid() or followee = auth.uid());
drop policy if exists "unfollow someone" on public.follows;
create policy "unfollow someone" on public.follows
  for delete to authenticated using (follower = auth.uid());

-- ---------- blocking and reports ----------
create table if not exists public.blocks (
  blocker uuid not null default auth.uid() references auth.users on delete cascade,
  blocked uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
alter table public.blocks enable row level security;
drop policy if exists "see your blocks" on public.blocks;
create policy "see your blocks" on public.blocks for select to authenticated using (blocker = auth.uid());
drop policy if exists "unblock" on public.blocks;
create policy "unblock" on public.blocks for delete to authenticated using (blocker = auth.uid());

-- true when either of you has blocked the other. Security definer so you can't read other people's block lists.
create or replace function public.is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a));
$$;
revoke all on function public.is_blocked(uuid, uuid) from public, anon;
grant execute on function public.is_blocked(uuid, uuid) to authenticated;

drop policy if exists "follow someone" on public.follows;
create policy "follow someone" on public.follows
  for insert to authenticated with check (follower = auth.uid() and not public.is_blocked(follower, followee));

-- Blocking also removes any follow in either direction.
create or replace function public.block_user(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or uid = auth.uid() then return; end if;
  insert into public.blocks (blocker, blocked) values (auth.uid(), uid) on conflict do nothing;
  delete from public.follows where (follower = auth.uid() and followee = uid) or (follower = uid and followee = auth.uid());
end $$;
revoke all on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

create table if not exists public.reports (
  id bigserial primary key,
  reporter uuid not null default auth.uid() references auth.users on delete cascade,
  reported uuid not null references auth.users on delete cascade,
  reason text not null default '' check (char_length(reason) <= 500),
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;   -- insert only; you read reports in the dashboard
drop policy if exists "report someone" on public.reports;
create policy "report someone" on public.reports for insert to authenticated with check (reporter = auth.uid());

-- ---------- profiles: who can read what ----------
alter table public.profiles enable row level security;
-- Direct reads are limited to your own row. Everyone else is reached through the functions below, which
-- only reveal a username when that person chose to be discoverable.
drop policy if exists "signed-in people can see names" on public.profiles;
drop policy if exists "see yourself and your follows" on public.profiles;
drop policy if exists "see yourself" on public.profiles;
create policy "see yourself" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "people edit their own name" on public.profiles;
drop policy if exists "edit your profile" on public.profiles;
create policy "edit your profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Every new account gets a profile, and its email is indexed by hash so friends can match it.
create table if not exists public.email_index (
  user_id uuid primary key references auth.users on delete cascade,
  email_hash text not null unique
);
alter table public.email_index enable row level security;   -- no policies: only match_contacts() reads it
create or replace function public.on_account_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  if new.email is not null and new.email <> '' then
    insert into public.email_index (user_id, email_hash)
    values (new.id, encode(extensions.digest(lower(trim(new.email)), 'sha256'), 'hex'))
    on conflict (user_id) do update set email_hash = excluded.email_hash;
  end if;
  return new;
end $$;
drop trigger if exists wayframe_account on auth.users;
create trigger wayframe_account after insert or update of email on auth.users
  for each row execute function public.on_account_change();
-- accounts made before this version
insert into public.profiles (id) select id from auth.users on conflict (id) do nothing;
insert into public.email_index (user_id, email_hash)
  select id, encode(extensions.digest(lower(trim(email)), 'sha256'), 'hex') from auth.users where email is not null and email <> ''
  on conflict (user_id) do nothing;
drop table if exists public.phone_index;

-- ---------- finding people ----------
create table if not exists public.search_log (user_id uuid not null, at timestamptz not null default now());
alter table public.search_log enable row level security;   -- no policies: only search_people() uses it
create index if not exists search_log_user on public.search_log (user_id, at);

-- Search by username. Only people who turned on "discoverable" appear. 2+ characters, at most 12 results,
-- never yourself or anyone you've blocked or who blocked you, and at most 30 searches a minute.
drop function if exists public.search_people(text);
create or replace function public.search_people(q text)
returns table (id uuid, display_name text, username text)
language plpgsql security definer set search_path = '' as $$
declare term text := lower(trim(coalesce(q, '')));
begin
  if auth.uid() is null or char_length(term) < 2 then return; end if;
  delete from public.search_log where at < now() - interval '1 hour';
  if (select count(*) from public.search_log where user_id = auth.uid() and at > now() - interval '1 minute') >= 30 then
    raise exception 'Too many searches. Wait a minute and try again.';
  end if;
  insert into public.search_log (user_id) values (auth.uid());
  return query
    select p.id, p.display_name, p.username from public.profiles p
    where p.discoverable and p.id <> auth.uid() and p.username like term || '%'
      and not public.is_blocked(auth.uid(), p.id)
    order by (p.username = term) desc, p.username limit 12;
end $$;
revoke all on function public.search_people(text) from public, anon;
grant execute on function public.search_people(text) to authenticated;

-- A profile card: name and (if they chose to be discoverable) username. Reachable by an invite code anytime,
-- by @username only when discoverable, and by id for yourself or someone you follow or who follows you.
drop function if exists public.public_profile(uuid, text);
create or replace function public.public_profile(uid uuid default null, handle text default null, code text default null)
returns table (id uuid, display_name text, username text, discoverable boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, case when p.discoverable or p.id = auth.uid() then p.username end, p.discoverable
  from public.profiles p
  where not public.is_blocked(auth.uid(), p.id) and (
        (uid is not null and p.id = auth.uid() and uid = p.id)
     or (code is not null and p.invite_code = trim(code))
     or (handle is not null and p.discoverable and p.username = lower(trim(handle)))
     or (uid is not null and p.id = uid and exists (select 1 from public.follows f
           where (f.follower = auth.uid() and f.followee = p.id) or (f.followee = auth.uid() and f.follower = p.id)))
  )
  limit 1;
$$;
revoke all on function public.public_profile(uuid, text, text) from public, anon;
grant execute on function public.public_profile(uuid, text, text) to authenticated;

-- What a visitor who isn't signed in sees when they open someone's invite link: just a first name or
-- display name, nothing else. The invite code is random, so it can't be guessed.
create or replace function public.invite_preview(code text)
returns table (display_name text)
language sql stable security definer set search_path = '' as $$
  select p.display_name from public.profiles p where p.invite_code = trim(code) limit 1;
$$;
revoke all on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;

-- People you both follow, shown only when the other person is discoverable.
create or replace function public.mutual_follows(uid uuid)
returns table (id uuid, display_name text, username text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, p.username
  from public.follows mine
  join public.follows theirs on theirs.followee = mine.followee and theirs.follower = uid
  join public.profiles p on p.id = mine.followee
  where mine.follower = auth.uid()
    and exists (select 1 from public.profiles t where t.id = uid and t.discoverable)
    and not public.is_blocked(auth.uid(), uid)
  limit 20;
$$;
revoke all on function public.mutual_follows(uuid) from public, anon;
grant execute on function public.mutual_follows(uuid) to authenticated;

-- The people you follow and who follow you. A username only shows for people who are discoverable.
create or replace function public.my_connections()
returns table (id uuid, display_name text, username text, i_follow boolean, follows_me boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, case when p.discoverable then p.username end,
         exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = p.id),
         exists (select 1 from public.follows f where f.follower = p.id and f.followee = auth.uid())
  from public.profiles p
  where p.id in (select followee from public.follows where follower = auth.uid()
                 union select follower from public.follows where followee = auth.uid());
$$;
revoke all on function public.my_connections() from public, anon;
grant execute on function public.my_connections() to authenticated;

-- Given hashed email addresses from someone's contacts, return the ones that have an account.
-- The username is only included when that person chose to be discoverable. Capped at 2000 per call.
create or replace function public.match_contacts(hashes text[])
returns table (id uuid, display_name text, username text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, case when p.discoverable then p.username end
  from public.email_index i join public.profiles p on p.id = i.user_id
  where i.email_hash = any (hashes[1:2000]) and i.user_id <> auth.uid() and not public.is_blocked(auth.uid(), i.user_id);
$$;
revoke all on function public.match_contacts(text[]) from public, anon;
grant execute on function public.match_contacts(text[]) to authenticated;

-- ---------- photos ----------
create table if not exists public.photos (
  id uuid primary key,
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null default '',
  story text not null default '',
  taken_at text not null default '',
  lat double precision,
  lng double precision,
  place text not null default '',
  trip text not null default '',
  seq integer not null default 0,
  look text not null default 'none',
  stamp boolean not null default false,
  pin_color text not null default '',
  cover boolean not null default false,
  rot real not null default 0,
  meta jsonb not null default '{}',
  image_path text,
  shared boolean not null default false,   -- older versions; replaced by visibility below
  updated_at timestamptz not null default now()
);
-- Who can see a photo: private (only you), friends (people who follow you), public (anyone with your link).
alter table public.photos add column if not exists visibility text not null default 'private';
alter table public.photos drop constraint if exists photos_visibility_values;
alter table public.photos add constraint photos_visibility_values check (visibility in ('private', 'friends', 'public'));
update public.photos set visibility = 'friends' where shared and visibility = 'private';
create index if not exists photos_owner on public.photos (owner);
alter table public.photos enable row level security;
drop policy if exists "see your photos and friends' shared photos" on public.photos;
create policy "see your photos and friends' shared photos" on public.photos
  for select to authenticated using (
    owner = auth.uid()
    or (visibility in ('friends', 'public') and exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = photos.owner))
  );
drop policy if exists "add your photos" on public.photos;
create policy "add your photos" on public.photos
  for insert to authenticated with check (owner = auth.uid());
drop policy if exists "change your photos" on public.photos;
create policy "change your photos" on public.photos
  for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists "delete your photos" on public.photos;
create policy "delete your photos" on public.photos
  for delete to authenticated using (owner = auth.uid());

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists photos_touch on public.photos;
create trigger photos_touch before update on public.photos for each row execute function public.touch_updated_at();

-- Public photos by owner. Reached with an invite code, a discoverable @username, or an id, and works without
-- signing in. Only photos set to "public" are ever returned.
create or replace function public.public_photos(code text default null, handle text default null, uid uuid default null)
returns table (id uuid, owner uuid, owner_name text, title text, story text, taken_at text, lat double precision,
  lng double precision, place text, trip text, seq integer, look text, stamp boolean, pin_color text, cover boolean,
  rot real, meta jsonb, image_path text)
language sql stable security definer set search_path = '' as $$
  select ph.id, ph.owner, p.display_name, ph.title, ph.story, ph.taken_at, ph.lat, ph.lng, ph.place, ph.trip, ph.seq,
         ph.look, ph.stamp, ph.pin_color, ph.cover, ph.rot, ph.meta, ph.image_path
  from public.photos ph join public.profiles p on p.id = ph.owner
  where ph.visibility = 'public' and ph.image_path is not null
    and ((code is not null and p.invite_code = trim(code))
      or (handle is not null and p.discoverable and p.username = lower(trim(handle)))
      or (uid is not null and p.id = uid))
    and (auth.uid() is null or not public.is_blocked(auth.uid(), ph.owner))
  order by ph.trip, ph.seq, ph.taken_at
  limit 300;
$$;
revoke all on function public.public_photos(text, text, uuid) from public;
grant execute on function public.public_photos(text, text, uuid) to anon, authenticated;

-- Used by the storage rule below so signed-out visitors can open public images.
create or replace function public.is_public_image(path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.photos where image_path = path and visibility = 'public');
$$;
revoke all on function public.is_public_image(text) from public;
grant execute on function public.is_public_image(text) to anon, authenticated;

-- ---------- community gallery ----------
-- "Public" means anyone with your link. The community gallery is a separate, opt-in switch on your profile:
-- only people who turn it on have their public photos listed on the Explore pages.
alter table public.profiles add column if not exists gallery boolean not null default false;

create or replace function public.camera_slug(c text) returns text
language sql immutable set search_path = '' as $$
  select trim(both '-' from lower(regexp_replace(trim(coalesce(c, '')), '[^a-zA-Z0-9]+', '-', 'g')));
$$;

-- Newest first. Optional filters: a camera slug and a search word (title, place or camera). 96 per page at most.
create or replace function public.explore_photos(lim integer default 48, off integer default 0, cam text default null, q text default null)
returns table (id uuid, owner uuid, owner_name text, title text, story text, taken_at text, lat double precision,
  lng double precision, place text, trip text, seq integer, look text, stamp boolean, pin_color text, cover boolean,
  rot real, meta jsonb, image_path text)
language sql stable security definer set search_path = '' as $$
  select ph.id, ph.owner, p.display_name, ph.title, ph.story, ph.taken_at, ph.lat, ph.lng, ph.place, ph.trip, ph.seq,
         ph.look, ph.stamp, ph.pin_color, ph.cover, ph.rot, ph.meta, ph.image_path
  from public.photos ph join public.profiles p on p.id = ph.owner
  where ph.visibility = 'public' and ph.image_path is not null and p.gallery
    and (coalesce(cam, '') = '' or public.camera_slug(ph.meta ->> 'camera') = cam)
    and (coalesce(trim(q), '') = '' or ph.title ilike '%' || replace(replace(trim(q), '%', ''), '_', '') || '%'
         or ph.place ilike '%' || replace(replace(trim(q), '%', ''), '_', '') || '%'
         or (ph.meta ->> 'camera') ilike '%' || replace(replace(trim(q), '%', ''), '_', '') || '%')
    and (auth.uid() is null or not public.is_blocked(auth.uid(), ph.owner))
  order by ph.updated_at desc
  limit least(greatest(lim, 1), 96) offset greatest(off, 0);
$$;
revoke all on function public.explore_photos(integer, integer, text, text) from public;
grant execute on function public.explore_photos(integer, integer, text, text) to anon, authenticated;

-- Stories in the gallery: a story is the photos a person set to Public under one story name.
create or replace function public.explore_stories(lim integer default 24, off integer default 0)
returns table (owner uuid, owner_name text, trip text, stops bigint, places text[], cover_path text, updated timestamptz)
language sql stable security definer set search_path = '' as $$
  select ph.owner, p.display_name, ph.trip, count(*),
         array_agg(ph.place order by ph.seq, ph.taken_at),
         (array_agg(ph.image_path order by ph.cover desc, ph.seq, ph.taken_at))[1],
         max(ph.updated_at)
  from public.photos ph join public.profiles p on p.id = ph.owner
  where ph.visibility = 'public' and ph.image_path is not null and p.gallery and ph.trip <> ''
    and (auth.uid() is null or not public.is_blocked(auth.uid(), ph.owner))
  group by ph.owner, p.display_name, ph.trip
  order by max(ph.updated_at) desc
  limit least(greatest(lim, 1), 60) offset greatest(off, 0);
$$;
revoke all on function public.explore_stories(integer, integer) from public;
grant execute on function public.explore_stories(integer, integer) to anon, authenticated;

-- Cameras people shot the gallery photos on, most photos first.
create or replace function public.explore_cameras()
returns table (camera text, slug text, photos bigint, people bigint, cover_path text)
language sql stable security definer set search_path = '' as $$
  select (array_agg(ph.meta ->> 'camera' order by ph.updated_at desc))[1], public.camera_slug(ph.meta ->> 'camera'),
         count(*), count(distinct ph.owner), (array_agg(ph.image_path order by ph.updated_at desc))[1]
  from public.photos ph join public.profiles p on p.id = ph.owner
  where ph.visibility = 'public' and ph.image_path is not null and p.gallery
    and public.camera_slug(ph.meta ->> 'camera') <> ''
    and (auth.uid() is null or not public.is_blocked(auth.uid(), ph.owner))
  group by public.camera_slug(ph.meta ->> 'camera')
  order by count(*) desc, 1
  limit 200;
$$;
revoke all on function public.explore_cameras() from public;
grant execute on function public.explore_cameras() to anon, authenticated;

-- A profile header for signed-out visitors: a name, a username only if they're discoverable, and counts of what's public.
create or replace function public.public_card(code text default null, handle text default null, uid uuid default null)
returns table (id uuid, display_name text, username text, photos bigint, stories bigint)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, case when p.discoverable then p.username end,
         (select count(*) from public.photos ph where ph.owner = p.id and ph.visibility = 'public' and ph.image_path is not null),
         (select count(distinct ph.trip) from public.photos ph where ph.owner = p.id and ph.visibility = 'public' and ph.image_path is not null and ph.trip <> '')
  from public.profiles p
  where ((code is not null and p.invite_code = trim(code))
      or (handle is not null and p.discoverable and p.username = lower(trim(handle)))
      or (uid is not null and p.id = uid and p.gallery))
    and (auth.uid() is null or not public.is_blocked(auth.uid(), p.id))
  limit 1;
$$;
revoke all on function public.public_card(text, text, uuid) from public;
grant execute on function public.public_card(text, text, uuid) to anon, authenticated;

-- ---------- likes ----------
create table if not exists public.likes (
  photo_id uuid not null references public.photos on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  primary key (photo_id, user_id)
);
alter table public.likes enable row level security;
-- the photos policy applies inside these checks, so you can only see or like photos you can see
drop policy if exists "see likes on photos you can see" on public.likes;
create policy "see likes on photos you can see" on public.likes
  for select to authenticated using (exists (select 1 from public.photos p where p.id = photo_id));
drop policy if exists "like photos you can see" on public.likes;
create policy "like photos you can see" on public.likes
  for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from public.photos p where p.id = photo_id));
drop policy if exists "unlike" on public.likes;
create policy "unlike" on public.likes
  for delete to authenticated using (user_id = auth.uid());

-- ---------- image files: private bucket, one folder per person ----------
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict (id) do nothing;
drop policy if exists "upload into your folder" on storage.objects;
create policy "upload into your folder" on storage.objects
  for insert to authenticated with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "replace files in your folder" on storage.objects;
create policy "replace files in your folder" on storage.objects
  for update to authenticated using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "delete files in your folder" on storage.objects;
create policy "delete files in your folder" on storage.objects
  for delete to authenticated using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "anyone can see public images" on storage.objects;
create policy "anyone can see public images" on storage.objects
  for select to anon, authenticated using (bucket_id = 'photos' and public.is_public_image(name));
drop policy if exists "see your files and friends' shared photos" on storage.objects;
create policy "see your files and friends' shared photos" on storage.objects
  for select to authenticated using (
    bucket_id = 'photos' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (select 1 from public.photos p where p.image_path = name)
    )
  );
-- The account trigger function is only meant to run as a trigger, never through the API.
revoke execute on function public.on_account_change() from public, anon, authenticated;
alter function public.touch_updated_at() set search_path = '';
alter function public.clean_profile() set search_path = '';
-- Account-level privacy: what new photos start as. Saving a change in the app also applies it to existing photos.
alter table public.profiles add column if not exists default_visibility text not null default 'private';
alter table public.profiles drop constraint if exists profiles_default_visibility_values;
alter table public.profiles add constraint profiles_default_visibility_values check (default_visibility in ('private', 'friends', 'public'));
-- A short bio, and one function that gives a profile page everything it shows: name, username, bio, counts.
alter table public.profiles add column if not exists bio text not null default '';
alter table public.profiles drop constraint if exists profiles_bio_length;
alter table public.profiles add constraint profiles_bio_length check (char_length(bio) <= 160);

create or replace function public.profile_card(uid uuid default null, handle text default null, code text default null)
returns table (id uuid, display_name text, username text, discoverable boolean, bio text, followers bigint, following bigint, photos bigint, stories bigint)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, case when p.discoverable or p.id = auth.uid() then p.username end, p.discoverable, p.bio,
         (select count(*) from public.follows f where f.followee = p.id),
         (select count(*) from public.follows f where f.follower = p.id),
         (select count(*) from public.photos ph where ph.owner = p.id and ph.visibility = 'public' and ph.image_path is not null),
         (select count(distinct ph.trip) from public.photos ph where ph.owner = p.id and ph.visibility = 'public' and ph.image_path is not null and ph.trip <> '')
  from public.profiles p
  where (auth.uid() is null or not public.is_blocked(auth.uid(), p.id)) and (
        (uid is not null and auth.uid() is not null and p.id = auth.uid() and uid = p.id)
     or (code is not null and p.invite_code = trim(code))
     or (handle is not null and p.discoverable and p.username = lower(trim(handle)))
     or (uid is not null and p.gallery and p.id = uid)
     or (uid is not null and p.id = uid and auth.uid() is not null and exists (select 1 from public.follows f
           where (f.follower = auth.uid() and f.followee = p.id) or (f.followee = auth.uid() and f.follower = p.id)))
  )
  limit 1;
$$;
revoke all on function public.profile_card(uuid, text, text) from public;
grant execute on function public.profile_card(uuid, text, text) to anon, authenticated;
-- Profile pictures: a public bucket (they show on public profiles) where each person can only change their own folder.
alter table public.profiles add column if not exists avatar_path text;
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do update set public = true;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'avatars: upload your own') then
    create policy "avatars: upload your own" on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'avatars: see your own') then
    create policy "avatars: see your own" on storage.objects for select to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'avatars: delete your own') then
    create policy "avatars: delete your own" on storage.objects for delete to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;

-- One function for a profile page: name, username, bio, picture and counts.
create or replace function public.profile_page(uid uuid default null, handle text default null, code text default null)
returns table (id uuid, display_name text, username text, discoverable boolean, bio text, avatar_path text, followers bigint, following bigint, photos bigint, stories bigint)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, case when p.discoverable or p.id = auth.uid() then p.username end, p.discoverable, p.bio, p.avatar_path,
         (select count(*) from public.follows f where f.followee = p.id),
         (select count(*) from public.follows f where f.follower = p.id),
         (select count(*) from public.photos ph where ph.owner = p.id and ph.visibility = 'public' and ph.image_path is not null),
         (select count(distinct ph.trip) from public.photos ph where ph.owner = p.id and ph.visibility = 'public' and ph.image_path is not null and ph.trip <> '')
  from public.profiles p
  where (auth.uid() is null or not public.is_blocked(auth.uid(), p.id)) and (
        (uid is not null and auth.uid() is not null and p.id = auth.uid() and uid = p.id)
     or (code is not null and p.invite_code = trim(code))
     or (handle is not null and p.discoverable and p.username = lower(trim(handle)))
     or (uid is not null and p.gallery and p.id = uid)
     or (uid is not null and p.id = uid and auth.uid() is not null and exists (select 1 from public.follows f
           where (f.follower = auth.uid() and f.followee = p.id) or (f.followee = auth.uid() and f.follower = p.id)))
  )
  limit 1;
$$;
revoke all on function public.profile_page(uuid, text, text) from public;
grant execute on function public.profile_page(uuid, text, text) to anon, authenticated;
drop function if exists public.profile_card(uuid, text, text);
-- Comments, notifications, the travel tracker (been / bucket list), profile highlights and site numbers.
-- Everything here only adds to what exists.

-- ---------- photos: the country they were taken in, and whether they're pinned to the profile ----------
alter table public.photos add column if not exists country text not null default '';
alter table public.photos add column if not exists pinned boolean not null default false;

-- true when the signed-in person may see this photo (their own, or a followed person's friends/public photo)
create or replace function public.can_see_photo(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.photos ph where ph.id = pid and auth.uid() is not null and (
    ph.owner = auth.uid()
    or (ph.visibility in ('friends', 'public') and exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = ph.owner)
        and not public.is_blocked(auth.uid(), ph.owner))));
$$;
revoke all on function public.can_see_photo(uuid) from public, anon;
grant execute on function public.can_see_photo(uuid) to authenticated;

-- ---------- travel: countries marked by hand, and the bucket list (both private to you) ----------
create table if not exists public.visits (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  country text not null check (char_length(country) between 2 and 80),
  created_at timestamptz not null default now(),
  primary key (user_id, country)
);
alter table public.visits enable row level security;
drop policy if exists "see your visits" on public.visits;
create policy "see your visits" on public.visits for select to authenticated using (user_id = auth.uid());
drop policy if exists "add your visits" on public.visits;
create policy "add your visits" on public.visits for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "remove your visits" on public.visits;
create policy "remove your visits" on public.visits for delete to authenticated using (user_id = auth.uid());

create table if not exists public.bucket_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  kind text not null default 'place' check (kind in ('country', 'city', 'place', 'experience')),
  country text not null default '',
  lat double precision,
  lng double precision,
  notes text not null default '' check (char_length(notes) <= 500),
  status text not null default 'wishlist' check (status in ('wishlist', 'planned', 'done')),
  fulfilled_photo uuid references public.photos on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists bucket_items_user on public.bucket_items (user_id, created_at desc);
alter table public.bucket_items enable row level security;
drop policy if exists "see your bucket list" on public.bucket_items;
create policy "see your bucket list" on public.bucket_items for select to authenticated using (user_id = auth.uid());
drop policy if exists "add to your bucket list" on public.bucket_items;
create policy "add to your bucket list" on public.bucket_items for insert to authenticated
  with check (user_id = auth.uid() and (select count(*) from public.bucket_items b where b.user_id = auth.uid()) < 200);
drop policy if exists "change your bucket list" on public.bucket_items;
create policy "change your bucket list" on public.bucket_items for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "remove from your bucket list" on public.bucket_items;
create policy "remove from your bucket list" on public.bucket_items for delete to authenticated using (user_id = auth.uid());

-- ---------- comments ----------
create table if not exists public.photo_comments (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references public.photos on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists photo_comments_photo on public.photo_comments (photo_id, created_at);
alter table public.photo_comments enable row level security;
drop policy if exists "see comments on photos you can see" on public.photo_comments;
create policy "see comments on photos you can see" on public.photo_comments for select to authenticated using (public.can_see_photo(photo_id));
drop policy if exists "comment on photos you can see" on public.photo_comments;
create policy "comment on photos you can see" on public.photo_comments for insert to authenticated
  with check (user_id = auth.uid() and public.can_see_photo(photo_id)
    and (select count(*) from public.photo_comments c where c.user_id = auth.uid() and c.created_at > now() - interval '1 minute') < 8);
drop policy if exists "delete your comments, or any on your photos" on public.photo_comments;
create policy "delete your comments, or any on your photos" on public.photo_comments for delete to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.photos p where p.id = photo_id and p.owner = auth.uid()));

create or replace function public.photo_comments_list(pid uuid)
returns table (id uuid, user_id uuid, name text, username text, avatar_path text, body text, created_at timestamptz, mine boolean, can_delete boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.user_id, p.display_name, case when p.discoverable or p.id = auth.uid() then p.username end, p.avatar_path, c.body, c.created_at,
         c.user_id = auth.uid(),
         c.user_id = auth.uid() or exists (select 1 from public.photos ph where ph.id = c.photo_id and ph.owner = auth.uid())
  from public.photo_comments c join public.profiles p on p.id = c.user_id
  where c.photo_id = pid and public.can_see_photo(pid) and not public.is_blocked(auth.uid(), c.user_id)
  order by c.created_at
  limit 200;
$$;
revoke all on function public.photo_comments_list(uuid) from public, anon;
grant execute on function public.photo_comments_list(uuid) to authenticated;

-- ---------- notifications: written by triggers, read only by the person they're for ----------
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  actor uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('follow', 'like', 'comment', 'mention')),
  photo_id uuid references public.photos on delete cascade,
  body text not null default '',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists "see your notifications" on public.notifications;
create policy "see your notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists "mark your notifications read" on public.notifications;
create policy "mark your notifications read" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "clear your notifications" on public.notifications;
create policy "clear your notifications" on public.notifications for delete to authenticated using (user_id = auth.uid());

create or replace function public.notify_follow() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_blocked(new.followee, new.follower)
     and not exists (select 1 from public.notifications n where n.user_id = new.followee and n.actor = new.follower and n.kind = 'follow' and n.created_at > now() - interval '1 day') then
    insert into public.notifications (user_id, actor, kind) values (new.followee, new.follower, 'follow');
  end if;
  return new;
end $$;
drop trigger if exists follows_notify on public.follows;
create trigger follows_notify after insert on public.follows for each row execute function public.notify_follow();

create or replace function public.notify_like() returns trigger language plpgsql security definer set search_path = '' as $$
declare o uuid;
begin
  select owner into o from public.photos where id = new.photo_id;
  if o is not null and o <> new.user_id and not public.is_blocked(o, new.user_id)
     and not exists (select 1 from public.notifications n where n.user_id = o and n.actor = new.user_id and n.kind = 'like' and n.photo_id = new.photo_id) then
    insert into public.notifications (user_id, actor, kind, photo_id) values (o, new.user_id, 'like', new.photo_id);
  end if;
  return new;
end $$;
drop trigger if exists likes_notify on public.likes;
create trigger likes_notify after insert on public.likes for each row execute function public.notify_like();

create or replace function public.notify_comment() returns trigger language plpgsql security definer set search_path = '' as $$
declare o uuid; m text; target uuid;
begin
  select owner into o from public.photos where id = new.photo_id;
  if o is not null and o <> new.user_id and not public.is_blocked(o, new.user_id) then
    insert into public.notifications (user_id, actor, kind, photo_id, body) values (o, new.user_id, 'comment', new.photo_id, left(new.body, 140));
  end if;
  -- @username mentions, for people who chose to be found
  for m in select distinct lower((regexp_matches(new.body, '@([A-Za-z0-9_.]{2,30})', 'g'))[1]) loop
    select id into target from public.profiles where username = m and discoverable;
    if target is not null and target <> new.user_id and target is distinct from o and not public.is_blocked(target, new.user_id) then
      insert into public.notifications (user_id, actor, kind, photo_id, body) values (target, new.user_id, 'mention', new.photo_id, left(new.body, 140));
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists comments_notify on public.photo_comments;
create trigger comments_notify after insert on public.photo_comments for each row execute function public.notify_comment();

create or replace function public.my_notifications(lim integer default 40)
returns table (id bigint, kind text, actor uuid, actor_name text, actor_username text, actor_avatar text, photo_id uuid, photo_title text, body text, created_at timestamptz, is_read boolean)
language sql stable security definer set search_path = '' as $$
  select n.id, n.kind, n.actor, p.display_name, case when p.discoverable then p.username end, p.avatar_path, n.photo_id, ph.title, n.body, n.created_at, n.read_at is not null
  from public.notifications n join public.profiles p on p.id = n.actor left join public.photos ph on ph.id = n.photo_id
  where n.user_id = auth.uid()
  order by n.created_at desc
  limit least(greatest(lim, 1), 100);
$$;
revoke all on function public.my_notifications(integer) from public, anon;
grant execute on function public.my_notifications(integer) to authenticated;

-- ---------- profile: travel summary and highlights, limited to what the viewer may see ----------
create or replace function public.travel_summary(who uuid)
returns table (countries integer, photos integer, top_place text, top_place_n integer, longest_trip text, longest_trip_n integer, top_camera text, top_camera_n integer)
language sql stable security definer set search_path = '' as $$
  with vis as (
    select ph.* from public.photos ph
    where ph.owner = who and ph.image_path is not null and (
      ph.owner = auth.uid() or ph.visibility = 'public'
      or (ph.visibility = 'friends' and exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = ph.owner)))
  ), place as (
    select split_part(place, ',', 1) as name, count(*) as n from vis where place <> '' group by 1 order by n desc, 1 limit 1
  ), trip as (
    select trip as name, count(*) as n from vis where trip <> '' group by 1 order by n desc, 1 limit 1
  ), cam as (
    select meta->>'camera' as name, count(*) as n from vis where coalesce(meta->>'camera', '') <> '' group by 1 order by n desc, 1 limit 1
  )
  select (select count(distinct country) from vis where country <> '')::integer, (select count(*) from vis)::integer,
         (select name from place), (select n from place)::integer, (select name from trip), (select n from trip)::integer,
         (select name from cam), (select n from cam)::integer;
$$;
revoke all on function public.travel_summary(uuid) from public;
grant execute on function public.travel_summary(uuid) to anon, authenticated;

create or replace function public.profile_highlights(who uuid)
returns table (id uuid, title text, place text, trip text, image_path text, taken_at text, look text)
language sql stable security definer set search_path = '' as $$
  select ph.id, ph.title, ph.place, ph.trip, ph.image_path, ph.taken_at, ph.look
  from public.photos ph
  where ph.owner = who and ph.pinned and ph.image_path is not null and (
    ph.owner = auth.uid() or ph.visibility = 'public'
    or (ph.visibility = 'friends' and exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = ph.owner)))
  order by ph.updated_at desc
  limit 6;
$$;
revoke all on function public.profile_highlights(uuid) from public;
grant execute on function public.profile_highlights(uuid) to anon, authenticated;

-- ---------- the numbers on the home page (totals only, nothing about any one person) ----------
create or replace function public.site_stats()
returns table (photos bigint, countries bigint, people bigint)
language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.photos where image_path is not null),
         (select count(distinct country) from public.photos where country <> '' and image_path is not null),
         (select count(distinct owner) from public.photos where image_path is not null);
$$;
revoke all on function public.site_stats() from public;
grant execute on function public.site_stats() to anon, authenticated;
