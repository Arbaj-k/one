-- Group Trip v1: account-owned trip creation, passwordless guest membership,
-- token-gated guest operations, shared expense ledger and receiver-confirmed transfers.
begin;
create extension if not exists pgcrypto;

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

create or replace function public.one_trip_create(p_title text,p_name text,p_upi_id text default null,p_upi_phone text default null,p_qr_data text default null,p_member_token text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare t public.one_trip_groups; m public.one_trip_members; raw_token text:=coalesce(p_member_token,encode(gen_random_bytes(32),'hex'));
begin
 if auth.uid() is null then raise exception 'Sign in to create a trip'; end if;
 if length(trim(p_title)) not between 2 and 80 or length(trim(p_name)) not between 1 and 60 then raise exception 'Enter a valid trip and member name'; end if;
 if p_qr_data is not null and length(p_qr_data)>400000 then raise exception 'QR image is too large'; end if;
 insert into public.one_trip_groups(owner_id,title) values(auth.uid(),trim(p_title)) returning * into t;
 insert into public.one_trip_members(trip_id,display_name,upi_id,upi_phone,upi_qr_data,token_hash,is_owner)
 values(t.id,trim(p_name),nullif(trim(p_upi_id),''),nullif(trim(p_upi_phone),''),p_qr_data,encode(digest(raw_token,'sha256'),'hex'),true) returning * into m;
 return jsonb_build_object('trip_id',t.id,'invite_code',t.invite_code,'member_id',m.id,'member_token',raw_token,'title',t.title);
end $$;

create or replace function public.one_trip_join(p_invite_code text,p_name text,p_upi_id text default null,p_upi_phone text default null,p_qr_data text default null,p_member_token text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare t public.one_trip_groups; m public.one_trip_members; raw_token text:=coalesce(p_member_token,encode(gen_random_bytes(32),'hex'));
begin
 select * into t from public.one_trip_groups where invite_code=p_invite_code and status='active';
 if not found then raise exception 'Trip link is invalid or the trip is closed'; end if;
 if length(trim(p_name)) not between 1 and 60 then raise exception 'Enter your name'; end if;
 if p_qr_data is not null and length(p_qr_data)>400000 then raise exception 'QR image is too large'; end if;
 insert into public.one_trip_members(trip_id,display_name,upi_id,upi_phone,upi_qr_data,token_hash)
 values(t.id,trim(p_name),nullif(trim(p_upi_id),''),nullif(trim(p_upi_phone),''),p_qr_data,encode(digest(raw_token,'sha256'),'hex')) returning * into m;
 return jsonb_build_object('trip_id',t.id,'invite_code',t.invite_code,'member_id',m.id,'member_token',raw_token,'title',t.title);
exception when unique_violation then raise exception 'That name is already in this trip. Add a unique name'; end $$;

create or replace function public.one_trip_get(p_invite_code text,p_member_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare t public.one_trip_groups; me public.one_trip_members;
begin
 select * into t from public.one_trip_groups where invite_code=p_invite_code;
 if not found then raise exception 'Trip not found'; end if;
 select * into me from public.one_trip_members where trip_id=t.id and token_hash=encode(digest(p_member_token,'sha256'),'hex');
 if not found then raise exception 'This device is not a trip member. Join with the invite link'; end if;
 return jsonb_build_object(
  'trip',to_jsonb(t),
  'me',jsonb_build_object('id',me.id,'display_name',me.display_name,'is_owner',me.is_owner),
  'members',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'display_name',display_name,'upi_id',upi_id,'upi_phone',upi_phone,'upi_qr_data',upi_qr_data,'is_owner',is_owner) order by created_at),'[]'::jsonb) from public.one_trip_members where trip_id=t.id),
  'expenses',(select coalesce(jsonb_agg(to_jsonb(e) order by created_at desc),'[]'::jsonb) from public.one_trip_expenses e where trip_id=t.id),
  'transfers',(select coalesce(jsonb_agg(to_jsonb(x) order by created_at desc),'[]'::jsonb) from public.one_trip_transfers x where trip_id=t.id)
 );
end $$;

create or replace function public.one_trip_add_expense(p_invite_code text,p_member_token text,p_description text,p_amount_paise bigint,p_split_member_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare t public.one_trip_groups; me public.one_trip_members; e public.one_trip_expenses;
begin
 select * into t from public.one_trip_groups where invite_code=p_invite_code and status='active';
 if not found then raise exception 'Trip is closed'; end if;
 select * into me from public.one_trip_members where trip_id=t.id and token_hash=encode(digest(p_member_token,'sha256'),'hex');
 if not found then raise exception 'Member verification failed'; end if;
 if length(trim(p_description)) not between 1 and 100 or p_amount_paise<=0 or p_amount_paise>1000000000 then raise exception 'Enter a valid expense'; end if;
 if coalesce(cardinality(p_split_member_ids),0)=0 or exists(select 1 from unnest(p_split_member_ids) x left join public.one_trip_members m on m.id=x and m.trip_id=t.id where m.id is null) then raise exception 'Invalid split participants'; end if;
 insert into public.one_trip_expenses(trip_id,payer_member_id,created_by_member_id,description,amount_paise,split_member_ids)
 values(t.id,me.id,me.id,trim(p_description),p_amount_paise,p_split_member_ids) returning * into e;
 return to_jsonb(e);
end $$;

create or replace function public.one_trip_update_profile(p_invite_code text,p_member_token text,p_upi_id text,p_upi_phone text,p_qr_data text)
returns boolean language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare t public.one_trip_groups; me public.one_trip_members;
begin
 select * into t from public.one_trip_groups where invite_code=p_invite_code and status='active';
 select * into me from public.one_trip_members where trip_id=t.id and token_hash=encode(digest(p_member_token,'sha256'),'hex');
 if not found then raise exception 'Member verification failed'; end if;
 if p_qr_data is not null and length(p_qr_data)>400000 then raise exception 'QR image is too large'; end if;
 update public.one_trip_members set upi_id=nullif(trim(p_upi_id),''),upi_phone=nullif(trim(p_upi_phone),''),upi_qr_data=p_qr_data where id=me.id;
 return true;
end $$;

create or replace function public.one_trip_record_transfer(p_invite_code text,p_member_token text,p_to_member_id uuid,p_amount_paise bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare t public.one_trip_groups; me public.one_trip_members; receiver public.one_trip_members; x public.one_trip_transfers;
begin
 select * into t from public.one_trip_groups where invite_code=p_invite_code and status='active';
 select * into me from public.one_trip_members where trip_id=t.id and token_hash=encode(digest(p_member_token,'sha256'),'hex');
 select * into receiver from public.one_trip_members where id=p_to_member_id and trip_id=t.id;
 if me.id is null or receiver.id is null or me.id=receiver.id or p_amount_paise<=0 then raise exception 'Invalid transfer'; end if;
 insert into public.one_trip_transfers(trip_id,from_member_id,to_member_id,amount_paise) values(t.id,me.id,receiver.id,p_amount_paise) returning * into x;
 return to_jsonb(x);
end $$;

create or replace function public.one_trip_confirm_transfer(p_invite_code text,p_member_token text,p_transfer_id uuid)
returns boolean language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare t public.one_trip_groups; me public.one_trip_members; x public.one_trip_transfers;
begin
 select * into t from public.one_trip_groups where invite_code=p_invite_code;
 select * into me from public.one_trip_members where trip_id=t.id and token_hash=encode(digest(p_member_token,'sha256'),'hex');
 select * into x from public.one_trip_transfers where id=p_transfer_id and trip_id=t.id;
 if me.id is null or x.to_member_id<>me.id then raise exception 'Only the receiver can confirm this transfer'; end if;
 update public.one_trip_transfers set status='confirmed',confirmed_at=now() where id=x.id;
 return true;
end $$;

create or replace function public.one_trip_close(p_invite_code text,p_member_token text)
returns boolean language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare t public.one_trip_groups; me public.one_trip_members;
begin
 select * into t from public.one_trip_groups where invite_code=p_invite_code;
 select * into me from public.one_trip_members where trip_id=t.id and token_hash=encode(digest(p_member_token,'sha256'),'hex') and is_owner=true;
 if me.id is null then raise exception 'Only the trip creator can close this trip'; end if;
 update public.one_trip_groups set status='closed' where id=t.id;
 return true;
end $$;

revoke all on function public.one_trip_create(text,text,text,text,text,text) from public;
revoke all on function public.one_trip_join(text,text,text,text,text,text) from public;
revoke all on function public.one_trip_get(text,text) from public;
revoke all on function public.one_trip_add_expense(text,text,text,bigint,uuid[]) from public;
revoke all on function public.one_trip_update_profile(text,text,text,text,text) from public;
revoke all on function public.one_trip_record_transfer(text,text,uuid,bigint) from public;
revoke all on function public.one_trip_confirm_transfer(text,text,uuid) from public;
revoke all on function public.one_trip_close(text,text) from public;
grant execute on function public.one_trip_create(text,text,text,text,text,text) to authenticated;
grant execute on function public.one_trip_join(text,text,text,text,text,text) to anon,authenticated;
grant execute on function public.one_trip_get(text,text) to anon,authenticated;
grant execute on function public.one_trip_add_expense(text,text,text,bigint,uuid[]) to anon,authenticated;
grant execute on function public.one_trip_update_profile(text,text,text,text,text) to anon,authenticated;
grant execute on function public.one_trip_record_transfer(text,text,uuid,bigint) to anon,authenticated;
grant execute on function public.one_trip_confirm_transfer(text,text,uuid) to anon,authenticated;
grant execute on function public.one_trip_close(text,text) to anon,authenticated;
commit;
