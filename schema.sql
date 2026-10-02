-- Run this once in Supabase > SQL Editor.
create table if not exists public.dashboard_store (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Lock the table: only the server (service role key) can read or write it.
alter table public.dashboard_store enable row level security;
