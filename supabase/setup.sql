-- One-time setup for syncing. Paste this into Supabase > SQL Editor and press Run.
-- Each row is one small piece of your data (a task, a day, one task's progress on a day).

create table if not exists public.records (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  key text not null,
  data jsonb,
  deleted boolean not null default false,
  mod bigint not null default 0,          -- when the device made the change (ms)
  server_at timestamptz not null default now(),
  primary key (user_id, key)
);

create index if not exists records_user_server_at on public.records (user_id, server_at);

-- Only you can see and change your own rows.
alter table public.records enable row level security;
drop policy if exists "Own rows only" on public.records;
create policy "Own rows only" on public.records
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.records to authenticated;

-- Stamp each change with the server's clock, and never let an older change
-- overwrite a newer one.
create or replace function public.records_touch() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.mod < old.mod then
    return null;
  end if;
  new.server_at = clock_timestamp();
  return new;
end $$;

drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.records_touch();
