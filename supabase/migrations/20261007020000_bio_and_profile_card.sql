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
