-- One account profile records. Apply in Supabase SQL Editor.
create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_profiles enable row level security;
revoke all on public.user_profiles from anon;
grant select, insert, update on public.user_profiles to authenticated;
drop policy if exists "Users can view their own profile" on public.user_profiles;
create policy "Users can view their own profile" on public.user_profiles
 for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "Users can create their own profile" on public.user_profiles;
create policy "Users can create their own profile" on public.user_profiles
 for insert to authenticated with check ((select auth.uid()) = id);
drop policy if exists "Users can update their own profile" on public.user_profiles;
create policy "Users can update their own profile" on public.user_profiles
 for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
