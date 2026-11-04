-- One-time setup for reminders (phone notifications). Paste into Supabase > SQL Editor and press Run.
-- Run setup.sql first. Safe to run again.

-- Each device that turned on notifications.
create table if not exists public.push_subs (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null,
  sub jsonb not null,
  tz text not null default 'UTC',
  created_at timestamptz not null default now(),
  primary key (user_id, endpoint)
);
alter table public.push_subs enable row level security;
drop policy if exists "Own rows only" on public.push_subs;
create policy "Own rows only" on public.push_subs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
grant select, insert, update, delete on public.push_subs to authenticated;

-- Notes so each reminder is sent only once, and the server's own keys.
-- No policies: only the server function can read these.
create table if not exists public.push_sent (
  user_id uuid not null references auth.users on delete cascade,
  tag text not null,
  day date not null,
  primary key (user_id, tag)
);
alter table public.push_sent enable row level security;

create table if not exists public.push_config (
  key text primary key,
  value text not null
);
alter table public.push_config enable row level security;
insert into public.push_config (key, value)
  values ('cron_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (key) do nothing;

-- Check for due reminders every 5 minutes.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
select cron.schedule(
  'todo-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://ytxfjvfayvhwoaybyyqp.supabase.co/functions/v1/todo-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.push_config where key = 'cron_secret')
    ),
    body := '{"run": true}'::jsonb
  );
  $$
);
