-- Server-side idempotency ledger for scheduled One push notifications.
create table if not exists public.one_push_deliveries (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 delivery_key text not null,
 notification_type text not null default 'task',
 sent_at timestamptz,
 last_error text,
 created_at timestamptz not null default now(),
 unique(user_id, delivery_key)
);
alter table public.one_push_deliveries enable row level security;
revoke all on public.one_push_deliveries from anon, authenticated;
create index if not exists one_push_deliveries_created_at_idx on public.one_push_deliveries(created_at);
