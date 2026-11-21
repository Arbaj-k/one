-- One account isolation, least-privilege grants, server-side abuse controls,
-- device-bound Group Trip sessions, and quarantined document uploads.
begin;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','user_workspaces','ai_chat_messages','tasks','notes','projects','expenses',
    'user_documents','student_brain_note_embeddings','bank_sms_transactions',
    'one_push_subscriptions','whatsapp_connections','whatsapp_processed_messages'
  ] loop
    if to_regclass('public.'||t) is not null then
      execute format('revoke all privileges on table public.%I from anon, authenticated',t);
    end if;
  end loop;
end $$;

grant select,insert,update on public.profiles to authenticated;
grant select,insert,update,delete on public.user_workspaces,public.ai_chat_messages,
  public.tasks,public.notes,public.projects,public.expenses,public.user_documents,
  public.student_brain_note_embeddings to authenticated;
grant select,delete on public.one_push_subscriptions to authenticated;
grant select on public.whatsapp_connections,public.whatsapp_processed_messages to authenticated;
grant insert on public.one_analytics_events to anon,authenticated;
grant select on public.one_analytics_events to authenticated;

alter table public.profiles force row level security;
alter table public.user_workspaces force row level security;
alter table public.ai_chat_messages force row level security;
alter table public.tasks force row level security;
alter table public.notes force row level security;
alter table public.projects force row level security;
alter table public.expenses force row level security;
alter table public.user_documents force row level security;
alter table public.student_brain_note_embeddings force row level security;
alter table public.bank_sms_transactions force row level security;
alter table public.one_trip_groups force row level security;
alter table public.one_trip_members force row level security;
alter table public.one_trip_expenses force row level security;
alter table public.one_trip_transfers force row level security;

alter table public.one_trip_members add column if not exists device_public_key jsonb;
create table if not exists public.one_trip_request_nonces (
  member_id uuid not null references public.one_trip_members(id) on delete cascade,
  nonce text not null check (length(nonce) between 20 and 80),
  created_at timestamptz not null default now(),
  primary key(member_id,nonce)
);
create index if not exists one_trip_request_nonces_created_idx on public.one_trip_request_nonces(created_at);
alter table public.one_trip_request_nonces enable row level security;
revoke all on public.one_trip_request_nonces from anon,authenticated;
grant select,insert,delete on public.one_trip_request_nonces to service_role;

create table if not exists public.one_api_rate_limits (
  bucket_key text primary key check (length(bucket_key) between 8 and 200),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now()
);
alter table public.one_api_rate_limits enable row level security;
revoke all on public.one_api_rate_limits from anon,authenticated;
grant select,insert,update,delete on public.one_api_rate_limits to service_role;

create or replace function public.one_consume_rate_limit(
  p_bucket_key text, p_limit integer, p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare allowed boolean;
begin
  if p_bucket_key is null or length(p_bucket_key) < 8 or length(p_bucket_key) > 200
     or p_limit < 1 or p_limit > 10000
     or p_window_seconds < 1 or p_window_seconds > 86400 then
    return false;
  end if;
  insert into public.one_api_rate_limits(bucket_key,window_started_at,request_count,updated_at)
  values(p_bucket_key,clock_timestamp(),1,clock_timestamp())
  on conflict(bucket_key) do update set
    request_count = case
      when public.one_api_rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= clock_timestamp() then 1
      else public.one_api_rate_limits.request_count + 1 end,
    window_started_at = case
      when public.one_api_rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= clock_timestamp() then clock_timestamp()
      else public.one_api_rate_limits.window_started_at end,
    updated_at = clock_timestamp()
  returning request_count <= p_limit into allowed;
  if mod(extract(epoch from clock_timestamp())::bigint,100)=0 then
    delete from public.one_api_rate_limits where updated_at < clock_timestamp()-interval '2 days';
    delete from public.one_trip_request_nonces where created_at < clock_timestamp()-interval '2 days';
  end if;
  return coalesce(allowed,false);
end;
$$;
revoke all on function public.one_consume_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.one_consume_rate_limit(text,integer,integer) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('one-document-staging','one-document-staging',false,12582912,
 array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict(id) do update set public=false,file_size_limit=12582912,allowed_mime_types=excluded.allowed_mime_types;
update storage.buckets set public=false,file_size_limit=12582912,
 allowed_mime_types=array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif']
where id='one-user-documents';

drop policy if exists "One documents owner upload" on storage.objects;
drop policy if exists "One documents owner update" on storage.objects;
drop policy if exists "One staging owner upload" on storage.objects;
create policy "One staging owner upload" on storage.objects for insert to authenticated
with check(bucket_id='one-document-staging' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "One staging owner delete" on storage.objects;
create policy "One staging owner delete" on storage.objects for delete to authenticated
using(bucket_id='one-document-staging' and (storage.foldername(name))[1]=(select auth.uid())::text);

commit;
