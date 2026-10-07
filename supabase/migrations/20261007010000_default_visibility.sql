-- Account-level privacy: what new photos start as. Saving a change in the app also applies it to existing photos.
alter table public.profiles add column if not exists default_visibility text not null default 'private';
alter table public.profiles drop constraint if exists profiles_default_visibility_values;
alter table public.profiles add constraint profiles_default_visibility_values check (default_visibility in ('private', 'friends', 'public'));
