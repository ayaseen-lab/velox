-- Reachly dashboard auth + optional app state backup
-- Run in Supabase SQL editor: https://supabase.com/dashboard/project/_/sql

create table if not exists public.reachly_store (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.reachly_store enable row level security;

drop policy if exists "reachly_store_authenticated_all" on public.reachly_store;
create policy "reachly_store_authenticated_all"
  on public.reachly_store
  for all
  to authenticated
  using (true)
  with check (true);

insert into public.reachly_store (id, data)
values (1, '{}'::jsonb)
on conflict (id) do nothing;
