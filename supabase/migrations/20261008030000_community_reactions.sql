-- Hearts and comments under community photos. The idea and the screens came from Steven (PR #6); this version uses
-- the same comments table, notifications and rules as the rest of the app.
-- Anyone signed in can like and comment on public photos whose owner listed them in the community gallery.
-- Anyone, signed in or not, can read the counts and comments on those photos.

create or replace function public.can_see_photo(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.photos ph where ph.id = pid and auth.uid() is not null and (
    ph.owner = auth.uid()
    or (ph.visibility in ('friends', 'public') and exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = ph.owner)
        and not public.is_blocked(auth.uid(), ph.owner))
    or (ph.visibility = 'public' and exists (select 1 from public.profiles pr where pr.id = ph.owner and pr.gallery)
        and not public.is_blocked(auth.uid(), ph.owner))));
$$;

create or replace function public.can_read_photo(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_see_photo(pid) or exists (
    select 1 from public.photos ph join public.profiles pr on pr.id = ph.owner
    where ph.id = pid and ph.visibility = 'public' and pr.gallery and (auth.uid() is null or not public.is_blocked(auth.uid(), ph.owner)));
$$;
revoke all on function public.can_read_photo(uuid) from public;
grant execute on function public.can_read_photo(uuid) to anon, authenticated;

create or replace function public.photo_comments_list(pid uuid)
returns table (id uuid, user_id uuid, name text, username text, avatar_path text, body text, created_at timestamptz, mine boolean, can_delete boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.user_id, p.display_name, case when p.discoverable or p.id = auth.uid() then p.username end, p.avatar_path, c.body, c.created_at,
         c.user_id = auth.uid(),
         c.user_id = auth.uid() or exists (select 1 from public.photos ph where ph.id = c.photo_id and ph.owner = auth.uid())
  from public.photo_comments c join public.profiles p on p.id = c.user_id
  where c.photo_id = pid and public.can_read_photo(pid) and (auth.uid() is null or not public.is_blocked(auth.uid(), c.user_id))
  order by c.created_at
  limit 200;
$$;
grant execute on function public.photo_comments_list(uuid) to anon, authenticated;

create or replace function public.reaction_counts(ids uuid[])
returns table (photo_id uuid, likes bigint, comments bigint, mine boolean)
language sql stable security definer set search_path = '' as $$
  select ph.id,
         (select count(*) from public.likes l where l.photo_id = ph.id and (auth.uid() is null or not public.is_blocked(auth.uid(), l.user_id))),
         (select count(*) from public.photo_comments c where c.photo_id = ph.id and (auth.uid() is null or not public.is_blocked(auth.uid(), c.user_id))),
         coalesce(exists (select 1 from public.likes l where l.photo_id = ph.id and l.user_id = auth.uid()), false)
  from public.photos ph
  where ph.id = any(ids[1:100]) and public.can_read_photo(ph.id);
$$;
revoke all on function public.reaction_counts(uuid[]) from public;
grant execute on function public.reaction_counts(uuid[]) to anon, authenticated;

-- likes follow the same rule (altered in place so nothing has to be dropped)
alter policy "see likes on photos you can see" on public.likes using (public.can_see_photo(photo_id));
alter policy "like photos you can see" on public.likes with check (user_id = auth.uid() and public.can_see_photo(photo_id));
