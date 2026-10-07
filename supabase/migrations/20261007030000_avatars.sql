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
