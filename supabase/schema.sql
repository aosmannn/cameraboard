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
alter table public.profiles enable row level security;
create policy "signed-in people can see names" on public.profiles
  for select to authenticated using (true);
create policy "people edit their own name" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Hashed email addresses, used only to match contacts. No policies on purpose: nobody can read this
-- table directly, only through match_contacts() below.
drop table if exists public.phone_index;   -- from an earlier version that used phone numbers
create table if not exists public.email_index (
  user_id uuid primary key references auth.users on delete cascade,
  email_hash text not null unique
);
alter table public.email_index enable row level security;

-- Every new account gets a profile, and its email is indexed by hash.
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

-- Given hashed email addresses from someone's contacts, return the ones that have an account.
-- Capped at 2000 per call.
create or replace function public.match_contacts(hashes text[])
returns table (id uuid, display_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name
  from public.email_index i join public.profiles p on p.id = i.user_id
  where i.email_hash = any (hashes[1:2000]) and i.user_id <> auth.uid();
$$;
revoke all on function public.match_contacts(text[]) from public, anon;
grant execute on function public.match_contacts(text[]) to authenticated;

-- ---------- friends: you see the shared photos of people you follow ----------
create table if not exists public.follows (
  follower uuid not null default auth.uid() references auth.users on delete cascade,
  followee uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
alter table public.follows enable row level security;
create policy "see your own follows" on public.follows
  for select to authenticated using (follower = auth.uid() or followee = auth.uid());
create policy "follow someone" on public.follows
  for insert to authenticated with check (follower = auth.uid());
create policy "unfollow someone" on public.follows
  for delete to authenticated using (follower = auth.uid());

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
  shared boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists photos_owner on public.photos (owner);
alter table public.photos enable row level security;
create policy "see your photos and friends' shared photos" on public.photos
  for select to authenticated using (
    owner = auth.uid()
    or (shared and exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = photos.owner))
  );
create policy "add your photos" on public.photos
  for insert to authenticated with check (owner = auth.uid());
create policy "change your photos" on public.photos
  for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "delete your photos" on public.photos
  for delete to authenticated using (owner = auth.uid());

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists photos_touch on public.photos;
create trigger photos_touch before update on public.photos for each row execute function public.touch_updated_at();

-- ---------- likes ----------
create table if not exists public.likes (
  photo_id uuid not null references public.photos on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  primary key (photo_id, user_id)
);
alter table public.likes enable row level security;
-- the photos policy applies inside these checks, so you can only see or like photos you can see
create policy "see likes on photos you can see" on public.likes
  for select to authenticated using (exists (select 1 from public.photos p where p.id = photo_id));
create policy "like photos you can see" on public.likes
  for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from public.photos p where p.id = photo_id));
create policy "unlike" on public.likes
  for delete to authenticated using (user_id = auth.uid());

-- ---------- image files: private bucket, one folder per person ----------
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict (id) do nothing;
create policy "upload into your folder" on storage.objects
  for insert to authenticated with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "replace files in your folder" on storage.objects
  for update to authenticated using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete files in your folder" on storage.objects
  for delete to authenticated using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "see your files and friends' shared photos" on storage.objects
  for select to authenticated using (
    bucket_id = 'photos' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (select 1 from public.photos p where p.image_path = name)
    )
  );
