-- One cloud foundation: one workspace snapshot per account, durable chat history,
-- document metadata, and a private Storage bucket. Apply in Supabase SQL Editor.
-- Client-side sync is intentionally NOT enabled by this migration.

begin;

create table if not exists public.user_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_data jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1 check (schema_version > 0),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
alter table public.user_workspaces enable row level security;
revoke all on public.user_workspaces from anon;
grant select, insert, update, delete on public.user_workspaces to authenticated;
drop policy if exists "workspace owner select" on public.user_workspaces;
create policy "workspace owner select" on public.user_workspaces for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "workspace owner insert" on public.user_workspaces;
create policy "workspace owner insert" on public.user_workspaces for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "workspace owner update" on public.user_workspaces;
create policy "workspace owner update" on public.user_workspaces for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "workspace owner delete" on public.user_workspaces;
create policy "workspace owner delete" on public.user_workspaces for delete to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.ai_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null,
  role text not null check (role in ('user','assistant')),
  content text not null check (length(content) <= 30000),
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ai_chat_messages_user_conversation_created_idx
  on public.ai_chat_messages(user_id, conversation_id, created_at);
alter table public.ai_chat_messages enable row level security;
revoke all on public.ai_chat_messages from anon;
grant select, insert, update, delete on public.ai_chat_messages to authenticated;
drop policy if exists "chat owner select" on public.ai_chat_messages;
create policy "chat owner select" on public.ai_chat_messages for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "chat owner insert" on public.ai_chat_messages;
create policy "chat owner insert" on public.ai_chat_messages for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "chat owner update" on public.ai_chat_messages;
create policy "chat owner update" on public.ai_chat_messages for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "chat owner delete" on public.ai_chat_messages;
create policy "chat owner delete" on public.ai_chat_messages for delete to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.user_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (length(file_name) <= 255),
  mime_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  extracted_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_documents_owner_path check (storage_path like user_id::text || '/%')
);
create index if not exists user_documents_owner_created_idx on public.user_documents(user_id, created_at desc);
alter table public.user_documents enable row level security;
revoke all on public.user_documents from anon;
grant select, insert, update, delete on public.user_documents to authenticated;
drop policy if exists "documents owner select" on public.user_documents;
create policy "documents owner select" on public.user_documents for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "documents owner insert" on public.user_documents;
create policy "documents owner insert" on public.user_documents for insert to authenticated with check ((select auth.uid()) = user_id and storage_path like user_id::text || '/%');
drop policy if exists "documents owner update" on public.user_documents;
create policy "documents owner update" on public.user_documents for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id and storage_path like user_id::text || '/%');
drop policy if exists "documents owner delete" on public.user_documents;
create policy "documents owner delete" on public.user_documents for delete to authenticated using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('one-user-documents', 'one-user-documents', false, 12582912,
  array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false, file_size_limit=12582912,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "One documents owner read" on storage.objects;
create policy "One documents owner read" on storage.objects for select to authenticated
using (bucket_id='one-user-documents' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "One documents owner upload" on storage.objects;
create policy "One documents owner upload" on storage.objects for insert to authenticated
with check (bucket_id='one-user-documents' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "One documents owner update" on storage.objects;
create policy "One documents owner update" on storage.objects for update to authenticated
using (bucket_id='one-user-documents' and (storage.foldername(name))[1]=(select auth.uid())::text)
with check (bucket_id='one-user-documents' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "One documents owner delete" on storage.objects;
create policy "One documents owner delete" on storage.objects for delete to authenticated
using (bucket_id='one-user-documents' and (storage.foldername(name))[1]=(select auth.uid())::text);

commit;
