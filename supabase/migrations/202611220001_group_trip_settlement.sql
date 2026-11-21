-- Group Trip v1: schema only. All guest/member operations run through a
-- token-verifying Edge Function; no SECURITY DEFINER RPCs are exposed.
begin;
create table if not exists public.one_trip_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) between 2 and 80),
  invite_code text not null unique default encode(gen_random_bytes(9),'hex'),
  status text not null default 'active' check (status in ('active','closed')),
  created_at timestamptz not null default now()
);
create table if not exists public.one_trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.one_trip_groups(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 60),
  upi_id text,
  upi_phone text,
  upi_qr_data text check (upi_qr_data is null or length(upi_qr_data) <= 400000),
  token_hash text not null unique,
  is_owner boolean not null default false,
  created_at timestamptz not null default now(),
  unique(trip_id, display_name)
);
create table if not exists public.one_trip_expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.one_trip_groups(id) on delete cascade,
  payer_member_id uuid not null references public.one_trip_members(id),
  created_by_member_id uuid not null references public.one_trip_members(id),
  description text not null check (length(description) between 1 and 100),
  amount_paise bigint not null check (amount_paise > 0 and amount_paise <= 1000000000),
  split_member_ids uuid[] not null,
  created_at timestamptz not null default now(),
  check (cardinality(split_member_ids) > 0)
);
create table if not exists public.one_trip_transfers (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.one_trip_groups(id) on delete cascade,
  from_member_id uuid not null references public.one_trip_members(id),
  to_member_id uuid not null references public.one_trip_members(id),
  amount_paise bigint not null check (amount_paise > 0),
  status text not null default 'pending' check (status in ('pending','confirmed')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  check (from_member_id <> to_member_id)
);
create index if not exists one_trip_members_trip_idx on public.one_trip_members(trip_id);
create index if not exists one_trip_expenses_trip_idx on public.one_trip_expenses(trip_id,created_at);
create index if not exists one_trip_transfers_trip_idx on public.one_trip_transfers(trip_id,created_at);
alter table public.one_trip_groups enable row level security;
alter table public.one_trip_members enable row level security;
alter table public.one_trip_expenses enable row level security;
alter table public.one_trip_transfers enable row level security;
revoke all on public.one_trip_groups,public.one_trip_members,public.one_trip_expenses,public.one_trip_transfers from anon,authenticated;
commit;