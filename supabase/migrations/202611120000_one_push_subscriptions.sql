-- Store one Web Push endpoint per signed-in device. The Edge Function writes with service-role access.
create table if not exists public.one_push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null,
 p256dh text not null,
 auth text not null,
 expiration_time timestamptz,
 user_agent text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id, endpoint)
);
alter table public.one_push_subscriptions enable row level security;
revoke all on public.one_push_subscriptions from anon, authenticated;
create index if not exists one_push_subscriptions_user_id_idx on public.one_push_subscriptions(user_id);
