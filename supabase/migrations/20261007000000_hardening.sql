-- The account trigger function is only meant to run as a trigger, never through the API.
revoke execute on function public.on_account_change() from public, anon, authenticated;
alter function public.touch_updated_at() set search_path = '';
alter function public.clean_profile() set search_path = '';
