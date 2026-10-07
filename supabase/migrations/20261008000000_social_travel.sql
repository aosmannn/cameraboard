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
