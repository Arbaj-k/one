-- Creator-controlled approval gate for new Group Trip members.
begin;
alter table public.one_trip_groups
  add column if not exists require_approval boolean not null default false;
alter table public.one_trip_members
  add column if not exists approval_status text not null default 'approved';
alter table public.one_trip_members
  drop constraint if exists one_trip_members_approval_status_check;
alter table public.one_trip_members
  add constraint one_trip_members_approval_status_check
  check (approval_status in ('pending','approved','rejected'));
create index if not exists one_trip_members_pending_idx
  on public.one_trip_members(trip_id, approval_status, created_at);
commit;