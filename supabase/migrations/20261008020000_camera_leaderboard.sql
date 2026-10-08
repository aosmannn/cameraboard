-- Camera leaderboard: how many community photos each camera took in a period.
-- Same rules as the Cameras page: public photos from people who turned on the community gallery, minus blocked people.
-- The period is given as local dates, 'YYYY-MM-DD': from_day is included, to_day is not. Leave both empty for all time.
-- taken_at is the day the photo was taken (a local date-time string, so its first ten characters are the date).
create or replace function public.camera_leaderboard(from_day text default null, to_day text default null)
returns table (camera text, slug text, photos bigint, people bigint)
language sql stable security definer set search_path = '' as $$
  select (array_agg(ph.meta ->> 'camera' order by ph.updated_at desc))[1], public.camera_slug(ph.meta ->> 'camera'),
         count(*), count(distinct ph.owner)
  from public.photos ph join public.profiles p on p.id = ph.owner
  where ph.visibility = 'public' and ph.image_path is not null and p.gallery
    and public.camera_slug(ph.meta ->> 'camera') <> ''
    and (
      (coalesce(from_day, '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and coalesce(to_day, '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
      or (ph.taken_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          and (coalesce(from_day, '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(ph.taken_at, 10) >= from_day)
          and (coalesce(to_day, '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(ph.taken_at, 10) < to_day))
    )
    and (auth.uid() is null or not public.is_blocked(auth.uid(), ph.owner))
  group by public.camera_slug(ph.meta ->> 'camera')
  order by count(*) desc, 1
  limit 50;
$$;
revoke all on function public.camera_leaderboard(text, text) from public;
grant execute on function public.camera_leaderboard(text, text) to anon, authenticated;
