-- Likes and comments under other people's photos.
--
-- Who can react to a photo: its owner; people who follow the owner (for photos set to friends or public); and anyone
-- signed in, for photos the owner listed in the community gallery. People who blocked each other never see each other's
-- reactions. Private photos are never reachable.
create or replace function public.can_see_photo(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.photos ph join public.profiles p on p.id = ph.owner
    where ph.id = pid and auth.uid() is not null and not public.is_blocked(auth.uid(), ph.owner)
      and (ph.owner = auth.uid()
           or (ph.visibility in ('friends', 'public') and exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = ph.owner))
           or (ph.visibility = 'public' and ph.image_path is not null and p.gallery))
  );
$$;
revoke all on function public.can_see_photo(uuid) from public, anon;
grant execute on function public.can_see_photo(uuid) to authenticated;

-- Likes now follow the same rule, so community gallery photos can be liked too.
drop policy if exists "see likes on photos you can see" on public.likes;
create policy "see likes on photos you can see" on public.likes
  for select to authenticated using (public.can_see_photo(photo_id));
drop policy if exists "like photos you can see" on public.likes;
create policy "like photos you can see" on public.likes
  for insert to authenticated with check (user_id = auth.uid() and public.can_see_photo(photo_id));

-- Comments.
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references public.photos on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists comments_photo on public.comments (photo_id, created_at);
alter table public.comments enable row level security;
-- There is no select policy on purpose: comments are read through photo_comments() below, which adds names and
-- leaves out blocked people.
drop policy if exists "comment on photos you can see" on public.comments;
create policy "comment on photos you can see" on public.comments
  for insert to authenticated with check (user_id = auth.uid() and public.can_see_photo(photo_id));
drop policy if exists "remove your comments or comments on your photos" on public.comments;
create policy "remove your comments or comments on your photos" on public.comments
  for delete to authenticated using (
    user_id = auth.uid() or exists (select 1 from public.photos ph where ph.id = photo_id and ph.owner = auth.uid())
  );

-- At most 8 comments a minute per person, and no leading or trailing spaces.
create or replace function public.tidy_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.comments c where c.user_id = new.user_id and c.created_at > now() - interval '1 minute') >= 8 then
    raise exception 'You are commenting too fast. Wait a minute and try again.';
  end if;
  new.body = btrim(new.body);
  return new;
end $$;
drop trigger if exists comments_tidy on public.comments;
create trigger comments_tidy before insert on public.comments for each row execute function public.tidy_comment();

-- The comments on a photo, oldest first. Works without signing in for photos in the community gallery.
create or replace function public.photo_comments(pid uuid)
returns table (id uuid, author uuid, author_name text, username text, body text, created_at timestamptz, mine boolean, can_delete boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.user_id, coalesce(nullif(p.display_name, ''), 'A traveler'), case when p.discoverable then p.username end,
         c.body, c.created_at, c.user_id = auth.uid(), (c.user_id = auth.uid() or ph.owner = auth.uid())
  from public.comments c
  join public.photos ph on ph.id = c.photo_id
  join public.profiles o on o.id = ph.owner
  join public.profiles p on p.id = c.user_id
  where c.photo_id = pid
    and (public.can_see_photo(pid)
         or (auth.uid() is null and ph.visibility = 'public' and ph.image_path is not null and o.gallery))
    and (auth.uid() is null or not public.is_blocked(auth.uid(), c.user_id))
  order by c.created_at
  limit 200;
$$;
revoke all on function public.photo_comments(uuid) from public;
grant execute on function public.photo_comments(uuid) to anon, authenticated;

-- Like and comment counts for up to 100 photos at once, and whether you liked each one.
create or replace function public.reaction_counts(ids uuid[])
returns table (photo_id uuid, likes bigint, comments bigint, mine boolean)
language sql stable security definer set search_path = '' as $$
  select ph.id,
         (select count(*) from public.likes l where l.photo_id = ph.id and (auth.uid() is null or not public.is_blocked(auth.uid(), l.user_id))),
         (select count(*) from public.comments c where c.photo_id = ph.id and (auth.uid() is null or not public.is_blocked(auth.uid(), c.user_id))),
         exists (select 1 from public.likes l where l.photo_id = ph.id and l.user_id = auth.uid())
  from public.photos ph join public.profiles o on o.id = ph.owner
  where ph.id = any(ids) and cardinality(ids) <= 100
    and (public.can_see_photo(ph.id)
         or (auth.uid() is null and ph.visibility = 'public' and ph.image_path is not null and o.gallery));
$$;
revoke all on function public.reaction_counts(uuid[]) from public;
grant execute on function public.reaction_counts(uuid[]) to anon, authenticated;
