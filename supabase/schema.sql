-- LiveBoard database schema for Supabase.
-- Run this whole file in the Supabase SQL editor (Project → SQL Editor → New query → paste → Run).
-- It is safe to run again: upgrades add what is missing. supabase/migrations/ holds each upgrade on its own.

-- Each synced record is stored whole as JSON; the newest updated_at wins.
create table if not exists public.notes (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  data jsonb not null,
  updated_at bigint not null,
  deleted boolean not null default false
);
create table if not exists public.markers (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  data jsonb not null,
  updated_at bigint not null,
  deleted boolean not null default false
);
create table if not exists public.courses (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  data jsonb not null,
  updated_at bigint not null,
  deleted boolean not null default false
);

create index if not exists notes_user_updated on public.notes (user_id, updated_at);
create index if not exists markers_user_updated on public.markers (user_id, updated_at);
create index if not exists courses_user_updated on public.courses (user_id, updated_at);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users on delete cascade default auth.uid(),
  data jsonb not null default '{}',
  updated_at bigint not null default 0
);

alter table public.notes enable row level security;
alter table public.markers enable row level security;
alter table public.courses enable row level security;
alter table public.profiles enable row level security;

do $$
declare t text;
begin
  foreach t in array array['notes','markers','courses','profiles'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- Classes: a course a teacher or student shares with a join code. Powers the class leaderboard.
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  owner uuid not null references auth.users on delete cascade default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.class_members (
  class_id uuid references public.classes on delete cascade,
  user_id uuid references auth.users on delete cascade default auth.uid(),
  display_name text not null,
  joined_at timestamptz not null default now(),
  primary key (class_id, user_id)
);
create table if not exists public.recall_events (
  id bigserial primary key,
  class_id uuid not null references public.classes on delete cascade,
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  points int not null check (points between 0 and 20),
  at timestamptz not null default now()
);
alter table public.classes enable row level security;
alter table public.class_members enable row level security;
alter table public.recall_events enable row level security;

drop policy if exists "members read class" on public.classes;
create policy "members read class" on public.classes for select
  using (exists (select 1 from public.class_members m where m.class_id = id and m.user_id = auth.uid()));
drop policy if exists "own membership" on public.class_members;
create policy "own membership" on public.class_members for select using (user_id = auth.uid());
drop policy if exists "log own points" on public.recall_events;
create policy "log own points" on public.recall_events for insert
  with check (user_id = auth.uid() and exists (select 1 from public.class_members m where m.class_id = recall_events.class_id and m.user_id = auth.uid()));

create or replace function public.create_class(p_name text, p_display text)
returns table (id uuid, code text) language plpgsql security definer set search_path = public as $$
declare v_code text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from public.classes c where c.code = v_code);
  end loop;
  insert into public.classes (code, name, owner) values (v_code, left(p_name, 60), auth.uid()) returning classes.id into v_id;
  insert into public.class_members (class_id, user_id, display_name) values (v_id, auth.uid(), left(coalesce(nullif(p_display, ''), 'Student'), 40));
  return query select v_id, v_code;
end $$;

-- join_class is defined with the teacher-class sections at the end of this file.

create or replace function public.class_leaderboard(p_class uuid)
returns table (display_name text, points bigint, is_me boolean) language sql security definer set search_path = public as $$
  select m.display_name,
         coalesce((select sum(e.points) from public.recall_events e where e.class_id = m.class_id and e.user_id = m.user_id and e.at > now() - interval '7 days'), 0) as points,
         m.user_id = auth.uid() as is_me
  from public.class_members m
  where m.class_id = p_class
    and exists (select 1 from public.class_members me where me.class_id = p_class and me.user_id = auth.uid())
  order by points desc, m.display_name
  limit 50;
$$;

-- Daily AI usage counter used by /api/marker to enforce the free-tier cap.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users on delete cascade,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
drop policy if exists "read own usage" on public.ai_usage;
create policy "read own usage" on public.ai_usage for select using (user_id = auth.uid());

create or replace function public.bump_ai_usage()
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  insert into public.ai_usage (user_id, day, count) values (auth.uid(), current_date, 1)
    on conflict (user_id, day) do update set count = ai_usage.count + 1
    returning count into v;
  return v;
end $$;

grant execute on function public.create_class(text, text) to authenticated;
grant execute on function public.class_leaderboard(uuid) to authenticated;
grant execute on function public.bump_ai_usage() to authenticated;

-- ===================================================================================
-- Sync revisions (added 2026-11-03). Every write goes through push_rows, which only
-- applies a change when the device saw the latest server revision. Pulls follow a
-- server-assigned sequence number, so device clocks never decide what is "new".
-- ===================================================================================
create sequence if not exists public.liveboard_seq;
grant usage on sequence public.liveboard_seq to authenticated;

do $$
declare t text;
begin
  foreach t in array array['notes','markers','courses'] loop
    execute format('alter table public.%I add column if not exists rev bigint not null default 0', t);
    execute format('alter table public.%I add column if not exists seq bigint not null default 0', t);
    execute format('create index if not exists %I on public.%I (user_id, seq)', t || '_user_seq', t);
  end loop;
end $$;

-- Records saved before revisions existed have seq = 0, which a fresh device (asking for seq > 0) would never download.
-- Give each one a sequence number. The table locks keep uploads out while this runs; it does nothing once done.
do $$
declare t text;
begin
  foreach t in array array['notes','markers','courses'] loop
    execute format('lock table public.%I in share row exclusive mode', t);
    execute format('update public.%I set seq = nextval(''public.liveboard_seq'') where seq = 0', t);
  end loop;
end $$;

-- p_rows: [{ id, base_rev (number, or null = "apply only if newer"), data, updated_at, deleted }]
-- Returns one result per row: { id, status: ok | conflict | stale | invalid, rev, data?, deleted? }
create or replace function public.push_rows(p_kind text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; out jsonb := '[]'::jsonb; v_rev bigint; v_base bigint;
  c_rev bigint; c_data jsonb; c_deleted boolean; c_updated bigint;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if p_kind not in ('notes', 'markers', 'courses') then raise exception 'unknown kind'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then raise exception 'rows must be an array of at most 200'; end if;
  -- One writer per account at a time keeps seq order equal to commit order, so pulls never skip a row.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  for r in select * from jsonb_array_elements(p_rows) loop
    if coalesce(r->>'id', '') !~ '^[A-Za-z0-9_-]{1,64}$' or jsonb_typeof(r->'data') <> 'object' or pg_column_size(r->'data') > 2000000 then
      out := out || jsonb_build_object('id', r->>'id', 'status', 'invalid'); continue;
    end if;
    c_rev := null; c_data := null; c_deleted := null; c_updated := null;
    execute format('select rev, data, deleted, updated_at from public.%I where id = $1 and user_id = $2 for update', p_kind) into c_rev, c_data, c_deleted, c_updated using r->>'id', auth.uid();
    v_base := case when r ? 'base_rev' and jsonb_typeof(r->'base_rev') = 'number' then (r->>'base_rev')::bigint else null end;
    if c_rev is null then
      begin
        execute format('insert into public.%I (id, user_id, data, updated_at, deleted, rev, seq) values ($1, auth.uid(), $2, $3, $4, 1, nextval(''public.liveboard_seq''))', p_kind)
          using r->>'id', r->'data', coalesce((r->>'updated_at')::bigint, 0), coalesce((r->>'deleted')::boolean, false);
        out := out || jsonb_build_object('id', r->>'id', 'status', 'ok', 'rev', 1);
      exception when unique_violation then
        out := out || jsonb_build_object('id', r->>'id', 'status', 'invalid'); -- the id belongs to someone else
      end;
    elsif (v_base is not null and c_rev = v_base) or (v_base is null and coalesce((r->>'updated_at')::bigint, 0) > c_updated) then
      v_rev := c_rev + 1;
      execute format('update public.%I set data = $2, updated_at = $3, deleted = $4, rev = $5, seq = nextval(''public.liveboard_seq'') where id = $1 and user_id = $6', p_kind)
        using r->>'id', r->'data', coalesce((r->>'updated_at')::bigint, 0), coalesce((r->>'deleted')::boolean, false), v_rev, auth.uid();
      out := out || jsonb_build_object('id', r->>'id', 'status', 'ok', 'rev', v_rev);
    else
      out := out || jsonb_build_object('id', r->>'id', 'status', case when v_base is null then 'stale' else 'conflict' end,
                                       'rev', c_rev, 'data', c_data, 'deleted', c_deleted);
    end if;
  end loop;
  return out;
end $$;
grant execute on function public.push_rows(text, jsonb) to authenticated;

-- Writes go only through push_rows (which checks the owner itself); clients can read their own rows and nothing else.
-- Direct upserts from older app versions are refused, so they can't skip the revision check.
do $$
declare t text;
begin
  foreach t in array array['notes','markers','courses'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('drop policy if exists "read own rows" on public.%I', t);
    execute format('create policy "read own rows" on public.%I for select using (user_id = auth.uid())', t);
  end loop;
end $$;
revoke execute on function public.push_rows(text, jsonb) from public;

-- ===================================================================================
-- AI limits (added 2026-11-03). One atomic call per AI request: per-user daily,
-- per-user per-minute, and an app-wide daily cap. /api/marker refuses to call the
-- model unless this returns allowed = true.
-- ===================================================================================
create table if not exists public.ai_minute (
  user_id uuid not null references auth.users on delete cascade,
  minute timestamptz not null,
  count int not null default 0,
  primary key (user_id, minute)
);
create table if not exists public.ai_global (
  day date primary key,
  count int not null default 0
);
alter table public.ai_minute enable row level security;
alter table public.ai_global enable row level security;

create or replace function public.begin_ai_request(p_daily int, p_per_minute int, p_global int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_day int; v_min int; v_glob int; v_now timestamptz := date_trunc('minute', now());
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  -- Server-side ceilings, so a misconfigured environment variable can't remove the limits.
  p_daily := least(greatest(coalesce(p_daily, 60), 1), 1000);
  p_per_minute := least(greatest(coalesce(p_per_minute, 8), 1), 60);
  p_global := least(greatest(coalesce(p_global, 5000), 1), 1000000);

  insert into public.ai_global (day, count) values (current_date, 0) on conflict (day) do nothing;
  select count into v_glob from public.ai_global where day = current_date for update;
  if v_glob >= p_global then return jsonb_build_object('allowed', false, 'reason', 'global'); end if;

  insert into public.ai_usage (user_id, day, count) values (auth.uid(), current_date, 0) on conflict (user_id, day) do nothing;
  select count into v_day from public.ai_usage where user_id = auth.uid() and day = current_date for update;
  if v_day >= p_daily then return jsonb_build_object('allowed', false, 'reason', 'daily', 'used', v_day); end if;

  insert into public.ai_minute (user_id, minute, count) values (auth.uid(), v_now, 0) on conflict (user_id, minute) do nothing;
  select count into v_min from public.ai_minute where user_id = auth.uid() and minute = v_now for update;
  if v_min >= p_per_minute then return jsonb_build_object('allowed', false, 'reason', 'minute'); end if;

  update public.ai_global set count = count + 1 where day = current_date;
  update public.ai_usage set count = count + 1 where user_id = auth.uid() and day = current_date;
  update public.ai_minute set count = count + 1 where user_id = auth.uid() and minute = v_now;
  delete from public.ai_minute where user_id = auth.uid() and minute < v_now - interval '1 hour';
  return jsonb_build_object('allowed', true, 'used', v_day + 1);
end $$;
revoke all on function public.begin_ai_request(int, int, int) from public;
grant execute on function public.begin_ai_request(int, int, int) to authenticated;
revoke execute on function public.bump_ai_usage() from authenticated;

-- ===================================================================================
-- Recall points (added 2026-11-03). The server decides the points, and each marker
-- scores at most once per day, so the leaderboard can't be inflated by replays.
-- ===================================================================================
alter table public.recall_events add column if not exists marker_id text;
alter table public.recall_events add column if not exists day date not null default current_date;
create unique index if not exists recall_events_once_a_day on public.recall_events (user_id, class_id, marker_id, day);
drop policy if exists "log own points" on public.recall_events;

create or replace function public.log_recall(p_class uuid, p_marker text, p_got boolean)
returns int language plpgsql security definer set search_path = public as $$
declare v_pts int := case when p_got then 10 else 3 end;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if coalesce(p_marker, '') !~ '^[A-Za-z0-9_-]{1,64}$' then raise exception 'bad marker id'; end if;
  if not exists (select 1 from public.class_members m where m.class_id = p_class and m.user_id = auth.uid()) then return 0; end if;
  insert into public.recall_events (class_id, user_id, points, marker_id, day) values (p_class, auth.uid(), v_pts, p_marker, current_date)
    on conflict (user_id, class_id, marker_id, day) do nothing;
  return case when found then v_pts else 0 end;
end $$;
grant execute on function public.log_recall(uuid, text, boolean) to authenticated;

-- ===================================================================================
-- Deletion barrier (added 2026-11-05). Each account has a data generation. Deleting the
-- account's data bumps it; uploads made under an older generation are refused, so a
-- device that was offline during the deletion can't put the deleted notes back.
-- ===================================================================================
create table if not exists public.sync_generation (
  user_id uuid primary key references auth.users on delete cascade,
  gen bigint not null default 0
);
alter table public.sync_generation enable row level security;
drop policy if exists "read own generation" on public.sync_generation;
create policy "read own generation" on public.sync_generation for select using (user_id = auth.uid());

create or replace function public.sync_state()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('gen', coalesce((select gen from public.sync_generation where user_id = auth.uid()), 0));
$$;
revoke all on function public.sync_state() from public;
grant execute on function public.sync_state() to authenticated;

-- Uploads now carry the generation. The two-argument version is removed so nothing can skip the check.
drop function if exists public.push_rows(text, jsonb);
create or replace function public.push_rows(p_kind text, p_rows jsonb, p_gen bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; out jsonb := '[]'::jsonb; v_rev bigint; v_base bigint; v_gen bigint;
  c_rev bigint; c_data jsonb; c_deleted boolean; c_updated bigint;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if p_kind not in ('notes', 'markers', 'courses') then raise exception 'unknown kind'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then raise exception 'rows must be an array of at most 200'; end if;
  -- One writer per account at a time (deletion takes the same lock), and seq order equals commit order.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  v_gen := coalesce((select gen from public.sync_generation where user_id = auth.uid()), 0);
  if p_gen is distinct from v_gen then
    return (select coalesce(jsonb_agg(jsonb_build_object('id', e->>'id', 'status', 'erased')), '[]'::jsonb) from jsonb_array_elements(p_rows) e);
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if coalesce(r->>'id', '') !~ '^[A-Za-z0-9_-]{1,64}$' or jsonb_typeof(r->'data') <> 'object' or pg_column_size(r->'data') > 2000000 then
      out := out || jsonb_build_object('id', r->>'id', 'status', 'invalid'); continue;
    end if;
    c_rev := null; c_data := null; c_deleted := null; c_updated := null;
    execute format('select rev, data, deleted, updated_at from public.%I where id = $1 and user_id = $2 for update', p_kind) into c_rev, c_data, c_deleted, c_updated using r->>'id', auth.uid();
    v_base := case when r ? 'base_rev' and jsonb_typeof(r->'base_rev') = 'number' then (r->>'base_rev')::bigint else null end;
    if c_rev is null then
      begin
        execute format('insert into public.%I (id, user_id, data, updated_at, deleted, rev, seq) values ($1, auth.uid(), $2, $3, $4, 1, nextval(''public.liveboard_seq''))', p_kind)
          using r->>'id', r->'data', coalesce((r->>'updated_at')::bigint, 0), coalesce((r->>'deleted')::boolean, false);
        out := out || jsonb_build_object('id', r->>'id', 'status', 'ok', 'rev', 1);
      exception when unique_violation then
        out := out || jsonb_build_object('id', r->>'id', 'status', 'invalid'); -- the id belongs to someone else
      end;
    elsif (v_base is not null and c_rev = v_base) or (v_base is null and coalesce((r->>'updated_at')::bigint, 0) > c_updated) then
      v_rev := c_rev + 1;
      execute format('update public.%I set data = $2, updated_at = $3, deleted = $4, rev = $5, seq = nextval(''public.liveboard_seq'') where id = $1 and user_id = $6', p_kind)
        using r->>'id', r->'data', coalesce((r->>'updated_at')::bigint, 0), coalesce((r->>'deleted')::boolean, false), v_rev, auth.uid();
      out := out || jsonb_build_object('id', r->>'id', 'status', 'ok', 'rev', v_rev);
    else
      out := out || jsonb_build_object('id', r->>'id', 'status', case when v_base is null then 'stale' else 'conflict' end,
                                       'rev', c_rev, 'data', c_data, 'deleted', c_deleted);
    end if;
  end loop;
  return out;
end $$;
revoke all on function public.push_rows(text, jsonb, bigint) from public;
grant execute on function public.push_rows(text, jsonb, bigint) to authenticated;

-- Profile (streak, points, name, deadlines) is written through the same barrier; clients can only read it directly.
-- Deadlines are merged, not replaced: for each one the copy changed last wins, so a device that hasn't yet seen
-- another device's deadlines can't erase them. Deleted ones are kept as tombstones for 45 days, then dropped.
create or replace function public.push_profile(p_data jsonb, p_gen bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_new jsonb; v_merged jsonb; v_cut numeric := (extract(epoch from now()) * 1000) - 45 * 86400000::numeric;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) > 100000 then return jsonb_build_object('status', 'invalid'); end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  if p_gen is distinct from coalesce((select gen from public.sync_generation where user_id = auth.uid()), 0) then
    return jsonb_build_object('status', 'erased');
  end if;
  v_old := coalesce((select data->'deadlines' from public.profiles where user_id = auth.uid()), '[]'::jsonb);
  v_new := coalesce(p_data->'deadlines', '[]'::jsonb);
  if jsonb_typeof(v_old) <> 'array' then v_old := '[]'::jsonb; end if;
  if jsonb_typeof(v_new) <> 'array' then v_new := '[]'::jsonb; end if;
  select coalesce(jsonb_agg(x.d order by x.d->>'date', x.d->>'id'), '[]'::jsonb) into v_merged from (
    select distinct on (d->>'id') d from jsonb_array_elements(v_old || v_new) d
    where jsonb_typeof(d) = 'object' and jsonb_typeof(d->'id') = 'string' and d->>'date' ~ '^\d{4}-\d\d-\d\d$'
    order by d->>'id', case when jsonb_typeof(d->'updatedAt') = 'number' then (d->>'updatedAt')::numeric else 0 end desc
  ) x where not (coalesce(x.d->'deleted', 'false'::jsonb) = 'true'::jsonb
                 and (case when jsonb_typeof(x.d->'updatedAt') = 'number' then (x.d->>'updatedAt')::numeric else 0 end) < v_cut);
  if jsonb_array_length(v_merged) > 400 then return jsonb_build_object('status', 'invalid'); end if;
  p_data := p_data || jsonb_build_object('deadlines', v_merged);
  insert into public.profiles (user_id, data, updated_at) values (auth.uid(), p_data, (extract(epoch from now()) * 1000)::bigint)
    on conflict (user_id) do update set data = excluded.data, updated_at = excluded.updated_at;
  return jsonb_build_object('status', 'ok');
end $$;
revoke all on function public.push_profile(jsonb, bigint) from public;
grant execute on function public.push_profile(jsonb, bigint) to authenticated;
drop policy if exists "own rows" on public.profiles;
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select using (user_id = auth.uid());

-- Deleting takes the account's write lock, removes everything, and bumps the generation in one transaction.
drop function if exists public.delete_my_data();
create or replace function public.delete_my_data()
returns bigint language plpgsql security definer set search_path = public as $$
declare v uuid := auth.uid(); v_gen bigint;
begin
  if v is null then raise exception 'sign in required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v::text, 0));
  delete from public.notes where user_id = v;
  delete from public.markers where user_id = v;
  delete from public.courses where user_id = v;
  delete from public.profiles where user_id = v;
  delete from public.recall_events where user_id = v;
  delete from public.quiz_results where user_id = v;
  delete from public.class_members where user_id = v;
  delete from public.ai_usage where user_id = v;
  delete from public.ai_minute where user_id = v;
  delete from public.classes c where c.owner = v and (c.kind = 'teacher' or not exists (select 1 from public.class_members m where m.class_id = c.id));
  insert into public.sync_generation (user_id, gen) values (v, 1)
    on conflict (user_id) do update set gen = sync_generation.gen + 1
    returning gen into v_gen;
  return v_gen;
end $$;
revoke all on function public.delete_my_data() from public;
grant execute on function public.delete_my_data() to authenticated;

-- ===== Live classes (see supabase/migrations/20261115_live_rooms.sql) =====
-- Live classes move into LiveBoard (they used to run on a separate Cloudflare site with its own D1 database).
-- A room holds a copy of the deck while a class is live. Students join with the room code and never sign in;
-- the teacher's control comes from the room secret returned when the room is made. Nothing here is readable
-- directly: RLS is on with no policies, and every read or write goes through the room_* functions below.
-- A room is deleted when the teacher ends the class, and any room older than 12 hours is deleted the next time
-- a room is made, so lecture slides don't sit on the server after class.

create table if not exists public.live_rooms (
  id text primary key,
  secret uuid not null,
  title text not null,
  slides jsonb not null,
  current int not null default 0,
  until bigint not null default 0,
  student_markers boolean not null default true,
  created timestamptz not null default now()
);
create table if not exists public.live_markers (
  id uuid primary key default gen_random_uuid(),
  room text not null references public.live_rooms on delete cascade,
  slide int not null,
  x real not null,
  y real not null,
  kind text not null,
  author text not null,
  body text not null,
  resolved boolean not null default false,
  region jsonb,
  screenshot text,
  owner text,
  created timestamptz not null default now()
);
create index if not exists live_markers_room on public.live_markers (room, created);
create table if not exists public.live_replies (
  id uuid primary key default gen_random_uuid(),
  marker uuid not null references public.live_markers on delete cascade,
  author text not null,
  body text not null,
  created timestamptz not null default now()
);
create index if not exists live_replies_marker on public.live_replies (marker, created);
alter table public.live_rooms add column if not exists student_markers boolean not null default true;
alter table public.live_rooms enable row level security;
alter table public.live_markers enable row level security;
alter table public.live_replies enable row level security;
revoke all on public.live_rooms, public.live_markers, public.live_replies from anon, authenticated;

create or replace function public.room_ms(t timestamptz) returns bigint language sql immutable as $$ select (extract(epoch from t) * 1000)::bigint $$;

-- Who is asking: the host (right secret), or a participant (a random id kept in their browser).
create or replace function public.room_author(p_name text, p_teacher boolean) returns text language sql immutable as $$
  select case when p_teacher then 'Teacher'
              when lower(trim(coalesce(p_name, ''))) = 'teacher' then 'Student'
              else coalesce(nullif(left(trim(coalesce(p_name, '')), 40), ''), 'Student') end
$$;

create or replace function public.room_create(p_title text, p_slides jsonb, p_student_markers boolean default true)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id text; v_secret uuid := gen_random_uuid(); s jsonb; e jsonb;
begin
  if jsonb_typeof(p_slides) is distinct from 'array' or jsonb_array_length(p_slides) not between 1 and 40 or octet_length(p_slides::text) > 5000000 then
    raise exception 'Use 1–40 slides, under 5 MB.';
  end if;
  for s in select * from jsonb_array_elements(p_slides) loop
    if jsonb_typeof(s) <> 'object'
       or exists (select 1 from unnest(array['title','kicker','body','detail','visual','notes']) k where jsonb_typeof(s->k) is distinct from 'string')
       or (s ? 'image' and s->>'image' is not null and s->>'image' !~ '^data:image/(png|jpeg|webp);base64,') then
      raise exception 'Use 1–40 slides, under 5 MB.';
    end if;
    -- objects placed with the slide editor: a bounded list, and pictures must be embedded images, never a link to another site
    if s ? 'elements' and jsonb_typeof(s->'elements') <> 'null' then
      if jsonb_typeof(s->'elements') <> 'array' or jsonb_array_length(s->'elements') > 80 then raise exception 'A slide has too many objects.'; end if;
      for e in select * from jsonb_array_elements(s->'elements') loop
        if jsonb_typeof(e) <> 'object' or (e ? 'src' and e->>'src' is not null and e->>'src' !~ '^data:image/(png|jpeg|webp|svg\+xml)[;,]') then
          raise exception 'Slide pictures must be embedded images.';
        end if;
      end loop;
    end if;
  end loop;
  delete from live_rooms where created < now() - interval '12 hours';
  -- anyone can start a class, so cap how many can exist at once: a flood can't fill the database
  if (select count(*) from live_rooms) >= 300 then raise exception 'Too many live classes are running right now. Please try again in a little while.'; end if;
  loop
    v_id := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from live_rooms where id = v_id);
  end loop;
  insert into live_rooms (id, secret, title, slides, student_markers) values (v_id, v_secret, coalesce(nullif(left(trim(coalesce(p_title, '')), 100), ''), 'Untitled lesson'), p_slides, coalesce(p_student_markers, true));
  return jsonb_build_object('id', v_id, 'secret', v_secret);
end $$;

-- Which markers a viewer may see: the host sees all; a projector and students see the teacher's; a student also sees their own.
create or replace function public.room_may_see(m public.live_markers, p_teacher boolean, p_projector boolean, p_participant text)
returns boolean language sql immutable as $$
  select (p_teacher and not p_projector) or m.author = 'Teacher' or (not p_projector and coalesce(p_participant, '') <> '' and m.owner = p_participant)
$$;

create or replace function public.room_get(p_id text, p_secret uuid default null, p_participant text default null, p_projector boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r live_rooms; v_teacher boolean; v_marks jsonb; v_replies jsonb;
begin
  select * into r from live_rooms where id = upper(trim(coalesce(p_id, '')));
  if r.id is null then raise exception 'Room not found. Check the code with your teacher.'; end if;
  v_teacher := p_secret is not null and p_secret = r.secret;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'slide', m.slide, 'x', m.x, 'y', m.y, 'kind', m.kind, 'author', m.author, 'body', m.body,
           'resolved', case when m.resolved then 1 else 0 end, 'created', room_ms(m.created), 'region', m.region, 'has_screenshot', m.screenshot is not null) order by m.created), '[]')
    into v_marks from live_markers m where m.room = r.id and room_may_see(m, v_teacher, p_projector, p_participant);
  if p_projector then v_replies := '[]';
  else
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'marker', x.marker, 'author', x.author, 'body', x.body) order by x.created), '[]')
      into v_replies from live_replies x join live_markers m on m.id = x.marker
      where m.room = r.id and room_may_see(m, v_teacher, p_projector, p_participant);
  end if;
  return jsonb_build_object('id', r.id, 'title', r.title, 'current', r.current, 'until', r.until, 'studentMarkers', case when r.student_markers then 1 else 0 end,
    'slides', case when v_teacher and not p_projector then r.slides
                   else (select jsonb_agg(s || '{"notes":""}' order by i) from jsonb_array_elements(r.slides) with ordinality t(s, i)) end,
    'markers', v_marks, 'replies', v_replies);
end $$;

create or replace function public.room_screenshot(p_room text, p_marker uuid, p_secret uuid default null, p_participant text default null)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select m.screenshot from live_markers m join live_rooms r on r.id = m.room
  where r.id = upper(trim(coalesce(p_room, ''))) and m.id = p_marker
    and room_may_see(m, p_secret is not null and p_secret = r.secret, false, p_participant)
$$;

-- Everything that changes a room: control (host), marker, resolve (host), reply, end (host).
create or replace function public.room_act(p_room text, p_action text, p_data jsonb, p_secret uuid default null, p_participant text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r live_rooms; v_teacher boolean; v_part text := nullif(left(coalesce(p_participant, ''), 100), ''); v_count int;
  v_body text := left(trim(coalesce(p_data->>'body', '')), 2000); v_region jsonb := p_data->'region'; v_shot text := p_data->>'screenshot';
  v_mark live_markers; v_id uuid; n numeric;
begin
  select * into r from live_rooms where id = upper(trim(coalesce(p_room, ''))) for update;
  if r.id is null then raise exception 'Room not found'; end if;
  v_teacher := p_secret is not null and p_secret = r.secret;
  if p_action in ('control', 'resolve', 'end') and not v_teacher then raise exception 'Only the host can do this.'; end if;
  if p_action = 'control' then
    v_count := jsonb_array_length(r.slides);
    if jsonb_typeof(p_data->'current') = 'number' and (p_data->>'current')::numeric = floor((p_data->>'current')::numeric) then
      update live_rooms set current = greatest(0, least(v_count - 1, (p_data->>'current')::int)) where id = r.id;
    end if;
    if jsonb_typeof(p_data->'duration') = 'number' then
      n := (p_data->>'duration')::numeric;
      update live_rooms set until = case when n > 0 then room_ms(now()) + (least(900, n) * 1000)::bigint else 0 end where id = r.id;
    end if;
    if jsonb_typeof(p_data->'studentMarkers') = 'boolean' then
      update live_rooms set student_markers = (p_data->>'studentMarkers')::boolean where id = r.id;
    end if;
  elsif p_action = 'marker' then
    if not v_teacher and not r.student_markers then raise exception 'Your teacher has paused student markers.'; end if;
    if coalesce(p_data->>'kind', '') not in ('question', 'explain', 'idea') or v_body = '' then raise exception 'Write your request first.'; end if;
    if jsonb_typeof(p_data->'slide') <> 'number' or (p_data->>'slide')::numeric <> floor((p_data->>'slide')::numeric)
       or (p_data->>'slide')::int not between 0 and jsonb_array_length(r.slides) - 1
       or jsonb_typeof(p_data->'x') <> 'number' or jsonb_typeof(p_data->'y') <> 'number' then
      raise exception 'Select a spot on the slide.';
    end if;
    if (select count(*) from live_markers where room = r.id) >= 500 then raise exception 'This room has reached its marker limit.'; end if;
    if v_region is not null and jsonb_typeof(v_region) <> 'null' then
      if jsonb_typeof(v_region) <> 'object' or exists (select 1 from unnest(array['left','top','width','height']) k where jsonb_typeof(v_region->k) <> 'number')
         or (v_region->>'left')::numeric < 0 or (v_region->>'top')::numeric < 0 or (v_region->>'width')::numeric <= 0 or (v_region->>'height')::numeric <= 0
         or (v_region->>'left')::numeric + (v_region->>'width')::numeric > 100.001 or (v_region->>'top')::numeric + (v_region->>'height')::numeric > 100.001 then
        raise exception 'Select a region inside the slide.';
      end if;
      v_region := jsonb_build_object('left', v_region->'left', 'top', v_region->'top', 'width', v_region->'width', 'height', v_region->'height');
    else v_region := null; end if;
    if v_shot is not null and (v_region is null or length(v_shot) > 250000 or v_shot !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+=*$') then
      raise exception 'Invalid slide screenshot.';
    end if;
    insert into live_markers (room, slide, x, y, kind, author, body, region, screenshot, owner)
      values (r.id, (p_data->>'slide')::int, greatest(2, least(98, (p_data->>'x')::real)), greatest(2, least(98, (p_data->>'y')::real)),
              p_data->>'kind', room_author(p_data->>'author', v_teacher), v_body, v_region, v_shot, v_part)
      returning id into v_id;
    return jsonb_build_object('id', v_id);
  elsif p_action = 'resolve' then
    update live_markers set resolved = coalesce((p_data->>'resolved')::boolean, false) where id = (p_data->>'id')::uuid and room = r.id;
  elsif p_action = 'reply' then
    select * into v_mark from live_markers where id = (p_data->>'id')::uuid and room = r.id;
    if v_mark.id is null or not room_may_see(v_mark, v_teacher, false, v_part) then raise exception 'Marker not found'; end if;
    if v_body = '' then raise exception 'Write a response first.'; end if;
    if (select count(*) from live_replies x join live_markers m on m.id = x.marker where m.room = r.id) >= 2000 then raise exception 'This room has reached its reply limit.'; end if;
    insert into live_replies (marker, author, body) values (v_mark.id, room_author(p_data->>'author', v_teacher), v_body);
  elsif p_action = 'end' then
    delete from live_rooms where id = r.id;
  else
    raise exception 'Unknown action';
  end if;
  return jsonb_build_object('ok', true);
exception when invalid_text_representation then raise exception 'Marker not found';
end $$;

revoke all on function public.room_create(text, jsonb, boolean), public.room_get(text, uuid, text, boolean), public.room_screenshot(text, uuid, uuid, text), public.room_act(text, text, jsonb, uuid, text) from public;
grant execute on function public.room_create(text, jsonb, boolean), public.room_get(text, uuid, text, boolean), public.room_screenshot(text, uuid, uuid, text), public.room_act(text, text, jsonb, uuid, text) to anon, authenticated;

-- ===== Teacher classes (see supabase/migrations/20261117_teacher_classes.sql) =====
-- Teacher classes. A teacher makes a class and students join it with its code. Joining a teacher's class links one
-- of the student's courses to it and shares that course's notes and markers with the teacher, read-only: the
-- student is told so before joining and can leave at any time, which ends the sharing straight away. Nothing else
-- of the student's is visible. Live lessons can be tied to a class, so its students see them start in LiveBoard.
-- Every read below is a security-definer function that checks the caller; the tables stay closed to direct reads.

alter table public.classes add column if not exists kind text not null default 'study';
alter table public.classes add column if not exists teacher_name text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'classes_kind_check') then
    alter table public.classes add constraint classes_kind_check check (kind in ('study', 'teacher'));
  end if;
end $$;
alter table public.class_members add column if not exists course_id text;
alter table public.class_members add column if not exists shares_notes boolean not null default false;
alter table public.live_rooms add column if not exists class_id uuid references public.classes on delete set null;
create index if not exists live_rooms_class on public.live_rooms (class_id) where class_id is not null;
create index if not exists classes_owner on public.classes (owner);

-- A teacher's class: the teacher owns it and is not a member, so they never appear on its leaderboard.
create or replace function public.teacher_create_class(p_name text, p_teacher text)
returns table (id uuid, code text) language plpgsql security definer set search_path = public as $$
declare v_code text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to make a class.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the class a name.'; end if;
  if (select count(*) from public.classes c where c.owner = auth.uid() and c.kind = 'teacher') >= 50 then raise exception 'You already have 50 classes.'; end if;
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from public.classes c where c.code = v_code);
  end loop;
  insert into public.classes (code, name, owner, kind, teacher_name)
    values (v_code, left(trim(p_name), 60), auth.uid(), 'teacher', nullif(left(trim(coalesce(p_teacher, '')), 40), ''))
    returning classes.id into v_id;
  return query select v_id, v_code;
end $$;

-- The teacher's classes, with how many students and whether one of their live lessons is running for it.
create or replace function public.teacher_classes()
returns table (id uuid, name text, code text, students bigint, live_room text, live_title text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.code,
         (select count(*) from public.class_members m where m.class_id = c.id),
         r.id, r.title, c.created_at
  from public.classes c
  left join lateral (select lr.id, lr.title from public.live_rooms lr where lr.class_id = c.id and lr.created > now() - interval '12 hours' order by lr.created desc limit 1) r on true
  where c.owner = auth.uid() and c.kind = 'teacher'
  order by c.created_at desc;
$$;

create or replace function public.teacher_rename_class(p_class uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the class a name.'; end if;
  update public.classes set name = left(trim(p_name), 60) where id = p_class and owner = auth.uid() and kind = 'teacher';
end $$;

create or replace function public.teacher_delete_class(p_class uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.classes where id = p_class and owner = auth.uid() and kind = 'teacher';
$$;

-- Who is in a class and how they are doing. Counts come only from the course each student linked, and only while they
-- share it; a student who stopped sharing still shows by name, with nothing else.
create or replace function public.teacher_roster(p_class uuid)
returns table (user_id uuid, display_name text, joined_at timestamptz, shares boolean, notes bigint, markers bigint, mastered bigint, due bigint, points bigint, last_active bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.classes c where c.id = p_class and c.owner = auth.uid() and c.kind = 'teacher') then
    raise exception 'Class not found.';
  end if;
  return query
  with mem as (select m.* from public.class_members m where m.class_id = p_class),
  ns as (
    select m.user_id, n.id, n.updated_at from mem m join public.notes n
      on n.user_id = m.user_id and m.shares_notes and m.course_id is not null and not n.deleted and n.data->>'courseId' = m.course_id
  ),
  ms as (
    select ns.user_id, k.data from ns join public.markers k on k.user_id = ns.user_id and not k.deleted and k.data->>'noteId' = ns.id
  )
  select m.user_id, m.display_name, m.joined_at, m.shares_notes,
    (select count(*) from ns where ns.user_id = m.user_id),
    (select count(*) from ms where ms.user_id = m.user_id),
    (select count(*) from ms where ms.user_id = m.user_id and ms.data->>'mastery' = '2'),
    (select count(*) from ms where ms.user_id = m.user_id and jsonb_typeof(ms.data->'due') = 'number' and (ms.data->>'due')::numeric <= extract(epoch from now()) * 1000),
    coalesce((select sum(e.points) from public.recall_events e where e.class_id = p_class and e.user_id = m.user_id and e.at > now() - interval '7 days'), 0),
    (select max(ns.updated_at) from ns where ns.user_id = m.user_id)
  from mem m
  order by m.display_name;
end $$;

-- One student's shared work: the notes in the course they linked and the markers on them. Read-only, text only.
create or replace function public.teacher_student_work(p_class uuid, p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_course text;
begin
  if not exists (select 1 from public.classes c where c.id = p_class and c.owner = auth.uid() and c.kind = 'teacher') then
    raise exception 'Class not found.';
  end if;
  select m.course_id into v_course from public.class_members m where m.class_id = p_class and m.user_id = p_student and m.shares_notes;
  if v_course is null then raise exception 'This student is not sharing notes with this class.'; end if;
  return jsonb_build_object(
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'title', left(coalesce(n.data->>'title', ''), 200), 'kind', n.data->>'kind',
                'updated', n.updated_at, 'text', left(coalesce(n.data->>'plain', ''), 20000)) order by n.updated_at desc)
              from public.notes n where n.user_id = p_student and not n.deleted and n.data->>'courseId' = v_course), '[]'::jsonb),
    'markers', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'noteId', k.data->>'noteId', 'type', k.data->>'type',
                'text', left(coalesce(k.data->>'text', ''), 1000), 'mastery', k.data->'mastery', 'due', k.data->'due',
                'understanding', k.data->>'understanding') order by k.updated_at desc)
              from public.markers k join public.notes n on n.id = k.data->>'noteId' and n.user_id = p_student
              where k.user_id = p_student and not k.deleted and not n.deleted and n.data->>'courseId' = v_course), '[]'::jsonb));
end $$;

-- What a code is, before joining: so a student can see it is a teacher's class (and what joining shares) first.
create or replace function public.class_preview(p_code text)
returns table (name text, kind text, teacher_name text, students bigint)
language sql stable security definer set search_path = public as $$
  select c.name, c.kind, c.teacher_name, (select count(*) from public.class_members m where m.class_id = c.id)
  from public.classes c where auth.uid() is not null and c.code = upper(trim(p_code));
$$;

-- Joining. A teacher's class needs the student's agreement to share the linked course (p_share).
drop function if exists public.join_class(text, text);
create or replace function public.join_class(p_code text, p_display text, p_course text default null, p_share boolean default false)
returns table (id uuid, name text, code text, kind text) language plpgsql security definer set search_path = public as $$
declare v public.classes;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  select * into v from public.classes c where c.code = upper(trim(p_code));
  if v.id is null then raise exception 'class not found'; end if;
  if v.kind = 'teacher' and v.owner = auth.uid() then raise exception 'This is your own class.'; end if;
  if v.kind = 'teacher' and not coalesce(p_share, false) then raise exception 'Joining a teacher''s class shares the notes in the course you link with them. Agree to that to join.'; end if;
  insert into public.class_members (class_id, user_id, display_name, course_id, shares_notes)
    values (v.id, auth.uid(), left(coalesce(nullif(p_display, ''), 'Student'), 40), left(p_course, 64), v.kind = 'teacher' and coalesce(p_share, false))
    on conflict (class_id, user_id) do update set display_name = excluded.display_name, course_id = excluded.course_id, shares_notes = excluded.shares_notes;
  return query select v.id, v.name, v.code, v.kind;
end $$;

-- Leaving a class removes the membership, which ends any sharing with its teacher at once.
create or replace function public.leave_class(p_class uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.class_members where class_id = p_class and user_id = auth.uid();
$$;

-- A student's classes, with the teacher's name and any live lesson running for it right now.
create or replace function public.my_classes()
returns table (id uuid, name text, code text, kind text, teacher_name text, students bigint, course_id text, shares boolean, live_room text, live_title text)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.code, c.kind, c.teacher_name,
         (select count(*) from public.class_members x where x.class_id = c.id), m.course_id, m.shares_notes, r.id, r.title
  from public.class_members m join public.classes c on c.id = m.class_id
  left join lateral (select lr.id, lr.title from public.live_rooms lr where lr.class_id = c.id and lr.created > now() - interval '12 hours' order by lr.created desc limit 1) r on true
  where m.user_id = auth.uid()
  order by c.name;
$$;

-- A teacher ties a running live lesson to one of their classes (or unties it with null), so its students are told.
create or replace function public.room_for_class(p_room text, p_secret uuid, p_class uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_class is not null and not exists (select 1 from public.classes c where c.id = p_class and c.owner = auth.uid() and c.kind = 'teacher') then
    raise exception 'Class not found.';
  end if;
  update public.live_rooms set class_id = p_class where id = upper(trim(coalesce(p_room, ''))) and secret = p_secret;
  if not found then raise exception 'Only the host can do this.'; end if;
end $$;

revoke all on function public.teacher_create_class(text, text), public.teacher_classes(), public.teacher_rename_class(uuid, text), public.teacher_delete_class(uuid),
  public.teacher_roster(uuid), public.teacher_student_work(uuid, uuid), public.class_preview(text), public.join_class(text, text, text, boolean),
  public.leave_class(uuid), public.my_classes(), public.room_for_class(text, uuid, uuid) from public;
grant execute on function public.teacher_create_class(text, text), public.teacher_classes(), public.teacher_rename_class(uuid, text), public.teacher_delete_class(uuid),
  public.teacher_roster(uuid), public.teacher_student_work(uuid, uuid), public.class_preview(text), public.join_class(text, text, text, boolean),
  public.leave_class(uuid), public.my_classes(), public.room_for_class(text, uuid, uuid) to authenticated;
-- A ping per class when its teacher starts a live lesson for it, pushed to students over Supabase Realtime instead
-- of students asking every so often. One row per class at most: made when the teacher tells the class (room_for_class),
-- gone when they untell it, end the lesson (the room is deleted) or delete the class. A student can read only the
-- rows for classes they're in (row level security, which Realtime applies before sending an insert or update).
create table if not exists public.class_pings (
  class_id uuid primary key references public.classes(id) on delete cascade,
  room text not null references public.live_rooms(id) on delete cascade,
  title text not null default '',
  at timestamptz not null default now()
);
create index if not exists class_pings_room on public.class_pings(room);
alter table public.class_pings enable row level security;
drop policy if exists "members read their class pings" on public.class_pings;
create policy "members read their class pings" on public.class_pings for select to authenticated
  using (exists (select 1 from public.class_members m where m.class_id = class_pings.class_id and m.user_id = auth.uid()));
revoke all on public.class_pings from anon;
revoke insert, update, delete on public.class_pings from authenticated;
grant select on public.class_pings to authenticated;

-- Realtime sends changes only for tables in its publication. Plain Postgres (the local test database) has none.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'class_pings') then
    alter publication supabase_realtime add table public.class_pings;
  end if;
end $$;

create or replace function public.room_for_class(p_room text, p_secret uuid, p_class uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.live_rooms;
begin
  if p_class is not null and not exists (select 1 from public.classes c where c.id = p_class and c.owner = auth.uid() and c.kind = 'teacher') then
    raise exception 'Class not found.';
  end if;
  update public.live_rooms set class_id = p_class where id = upper(trim(coalesce(p_room, ''))) and secret = p_secret returning * into r;
  if not found then raise exception 'Only the host can do this.'; end if;
  delete from public.class_pings where room = r.id and class_id is distinct from p_class;
  if p_class is not null then
    insert into public.class_pings (class_id, room, title) values (p_class, r.id, left(r.title, 120))
      on conflict (class_id) do update set room = excluded.room, title = excluded.title, at = now();
  end if;
end $$;
revoke all on function public.room_for_class(text, uuid, uuid) from public;
grant execute on function public.room_for_class(text, uuid, uuid) to authenticated;
-- Pop quizzes: a teacher releases a set of questions (with their answers) to one of their classes, optionally required
-- and with a due time. Each student in the class gets it pushed (Supabase Realtime on class_quizzes, which row level
-- security limits to the class's members), takes it in the recall sheet, marks each answer Got it or Again against
-- the teacher's answer, and sends their result once. The teacher sees who has done it and how they did.
-- Self-graded like all recall: the answers reach the student's device to be compared, so this is practice and a
-- check-in, not a secure exam.
create table if not exists public.class_quizzes (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  title text not null check (length(title) between 1 and 80),
  questions jsonb not null check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) between 1 and 20),
  required boolean not null default false,
  due_at timestamptz,
  closed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists class_quizzes_class on public.class_quizzes(class_id, created_at desc);
alter table public.class_quizzes enable row level security;
drop policy if exists "members read their class quizzes" on public.class_quizzes;
create policy "members read their class quizzes" on public.class_quizzes for select to authenticated
  using (exists (select 1 from public.class_members m where m.class_id = class_quizzes.class_id and m.user_id = auth.uid()));
revoke all on public.class_quizzes from anon;
revoke insert, update, delete on public.class_quizzes from authenticated;
grant select on public.class_quizzes to authenticated;

create table if not exists public.quiz_results (
  quiz_id uuid not null references public.class_quizzes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  answers jsonb not null check (jsonb_typeof(answers) = 'array'),
  score int not null,
  total int not null,
  finished_at timestamptz not null default now(),
  primary key (quiz_id, user_id)
);
alter table public.quiz_results enable row level security;
drop policy if exists "read own quiz results" on public.quiz_results;
create policy "read own quiz results" on public.quiz_results for select to authenticated using (user_id = auth.uid());
revoke all on public.quiz_results from anon;
revoke insert, update, delete on public.quiz_results from authenticated;
grant select on public.quiz_results to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'class_quizzes') then
    alter publication supabase_realtime add table public.class_quizzes;
  end if;
end $$;

-- The teacher's side. Every function checks that the caller owns the class.
-- (teacher_release_quiz: defined below, with question kinds)


-- (teacher_quizzes: defined below, with question kinds)


create or replace function public.teacher_quiz_results(p_quiz uuid)
returns table (user_id uuid, display_name text, done boolean, score int, total int, finished_at timestamptz, answers jsonb)
language plpgsql stable security definer set search_path = public as $$
declare v_class uuid;
begin
  select q.class_id into v_class from public.class_quizzes q join public.classes c on c.id = q.class_id
    where q.id = p_quiz and c.owner = auth.uid() and c.kind = 'teacher';
  if v_class is null then raise exception 'Quiz not found.'; end if;
  return query select m.user_id, m.display_name, r.user_id is not null, r.score, r.total, r.finished_at, r.answers
    from public.class_members m left join public.quiz_results r on r.quiz_id = p_quiz and r.user_id = m.user_id
    where m.class_id = v_class order by (r.user_id is null), m.display_name;
end $$;

create or replace function public.teacher_close_quiz(p_quiz uuid, p_delete boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.class_quizzes q join public.classes c on c.id = q.class_id where q.id = p_quiz and c.owner = auth.uid()) then
    raise exception 'Quiz not found.';
  end if;
  if p_delete then delete from public.class_quizzes where id = p_quiz;
  else update public.class_quizzes set closed = true where id = p_quiz; end if;
end $$;

-- The student's side.
-- (my_quizzes: defined below, with question kinds)


-- (submit_quiz: defined below, with question kinds)


revoke all on function public.teacher_quiz_results(uuid) from public;
revoke all on function public.teacher_close_quiz(uuid, boolean) from public;
grant execute on function public.teacher_quiz_results(uuid) to authenticated;
grant execute on function public.teacher_close_quiz(uuid, boolean) to authenticated;

-- Pop quizzes get kinds of question and pictures. Each question is one of
--   short   answer from memory, then mark it Got it or Again against the teacher's answer (as before)
--   choice  multiple choice: 2 to 6 options and the index of the right one; marked by the server
--   tf      true or false: options True and False and the right one; marked by the server
-- and may carry a picture (a small image the teacher's device has already shrunk, kept inline as a data: URL, at most
-- about 200 KB each and 1.5 MB for the whole quiz), and an explanation shown after answering (`a`).
-- A quiz can also shuffle its questions and its options for each student.
alter table public.class_quizzes add column if not exists shuffle boolean not null default false;

drop function if exists public.teacher_release_quiz(uuid, text, jsonb, boolean, timestamptz);
create or replace function public.teacher_release_quiz(p_class uuid, p_title text, p_questions jsonb, p_required boolean default false, p_due timestamptz default null, p_shuffle boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_clean jsonb := '[]'::jsonb; x jsonb; v_n int := 0; v_type text; v_q text; v_opts jsonb; v_correct int; v_img text; v_item jsonb;
begin
  if not exists (select 1 from public.classes c where c.id = p_class and c.owner = auth.uid() and c.kind = 'teacher') then
    raise exception 'Class not found.';
  end if;
  if jsonb_typeof(p_questions) <> 'array' then raise exception 'Add at least one question.'; end if;
  for x in select value from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(x) <> 'object' then continue; end if;
    v_q := left(trim(coalesce(x->>'q', '')), 300);
    v_img := x->>'img';
    if v_img is not null and not (v_img ~ '^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$' and length(v_img) <= 280000) then
      raise exception 'Question %: that picture is too large or not an image.', v_n + 1;
    end if;
    if length(v_q) = 0 and v_img is null then continue; end if;
    v_n := v_n + 1;
    v_type := case x->>'type' when 'choice' then 'choice' when 'tf' then 'tf' else 'short' end;
    v_opts := null; v_correct := null;
    if v_type = 'tf' then
      v_opts := '["True","False"]'::jsonb;
      v_correct := case when (x->>'correct') in ('0', '1') then (x->>'correct')::int else null end;
      if v_correct is null then raise exception 'Question %: pick whether it''s true or false.', v_n; end if;
    elsif v_type = 'choice' then
      select coalesce(jsonb_agg(to_jsonb(left(trim(o), 120)) order by i), '[]'::jsonb) into v_opts
        from jsonb_array_elements_text(case when jsonb_typeof(x->'options') = 'array' then x->'options' else '[]'::jsonb end) with ordinality as t(o, i)
        where length(trim(o)) > 0;
      if jsonb_array_length(v_opts) < 2 or jsonb_array_length(v_opts) > 6 then raise exception 'Question %: give 2 to 6 options.', v_n; end if;
      v_correct := case when (x->>'correct') ~ '^\d$' then (x->>'correct')::int else null end;
      if v_correct is null or v_correct >= jsonb_array_length(v_opts) then raise exception 'Question %: mark the right option.', v_n; end if;
    end if;
    v_item := jsonb_strip_nulls(jsonb_build_object('type', v_type, 'q', v_q, 'a', left(trim(coalesce(x->>'a', '')), 600),
      'options', v_opts, 'correct', v_correct, 'img', v_img));
    v_clean := v_clean || jsonb_build_array(v_item);
  end loop;
  if v_n = 0 then raise exception 'Add at least one question.'; end if;
  if v_n > 20 then raise exception 'A pop quiz holds up to 20 questions.'; end if;
  if length(v_clean::text) > 1500000 then raise exception 'The pictures add up to too much. Use fewer or smaller ones.'; end if;
  if (select count(*) from public.class_quizzes q where q.class_id = p_class and q.created_at > now() - interval '1 day') >= 20 then
    raise exception 'That''s a lot of quizzes for one day. Try again tomorrow.';
  end if;
  insert into public.class_quizzes (class_id, title, questions, required, due_at, shuffle)
    values (p_class, coalesce(nullif(left(trim(p_title), 80), ''), 'Pop quiz'), v_clean, coalesce(p_required, false), p_due, coalesce(p_shuffle, false))
    returning id into v_id;
  return v_id;
end $$;

drop function if exists public.my_quizzes();
create or replace function public.my_quizzes()
returns table (id uuid, class_id uuid, class_name text, teacher_name text, title text, questions jsonb, required boolean, due_at timestamptz, created_at timestamptz, done boolean, score int, total int, shuffle boolean)
language sql stable security definer set search_path = public as $$
  select q.id, q.class_id, c.name, c.teacher_name, q.title, q.questions, q.required, q.due_at, q.created_at,
         r.user_id is not null, r.score, r.total, q.shuffle
    from public.class_quizzes q
    join public.class_members m on m.class_id = q.class_id and m.user_id = auth.uid()
    join public.classes c on c.id = q.class_id
    left join public.quiz_results r on r.quiz_id = q.id and r.user_id = auth.uid()
   where not q.closed or r.user_id is not null
   order by q.created_at desc limit 60
$$;

-- Results come back in the quiz's own order. A short answer is marked by the student; a choice or true/false one by
-- what they picked, here, whatever the device says.
create or replace function public.submit_quiz(p_quiz uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_q public.class_quizzes; v_clean jsonb := '[]'::jsonb; v_n int; v_score int := 0; i int; v_item jsonb; v_ans jsonb; v_pick int; v_got boolean;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  select q.* into v_q from public.class_quizzes q join public.class_members m on m.class_id = q.class_id and m.user_id = auth.uid() where q.id = p_quiz;
  if v_q.id is null then raise exception 'Quiz not found.'; end if;
  if v_q.closed then raise exception 'This quiz is closed.'; end if;
  v_n := jsonb_array_length(v_q.questions);
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> v_n then raise exception 'Answer every question.'; end if;
  for i in 0 .. v_n - 1 loop
    v_item := v_q.questions->i; v_ans := p_answers->i;
    v_pick := case when jsonb_typeof(v_ans->'pick') = 'number' then (v_ans->>'pick')::int else null end;
    if coalesce(v_item->>'type', 'short') in ('choice', 'tf') then
      v_got := v_pick is not null and v_pick = (v_item->>'correct')::int;
    else
      v_got := coalesce((v_ans->>'got')::boolean, false);
      v_pick := null;
    end if;
    if v_got then v_score := v_score + 1; end if;
    v_clean := v_clean || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('got', v_got, 'said', left(coalesce(v_ans->>'said', ''), 400), 'pick', v_pick)));
  end loop;
  -- one result per student: the first one sent stands
  insert into public.quiz_results (quiz_id, user_id, answers, score, total) values (p_quiz, auth.uid(), v_clean, v_score, v_n)
    on conflict (quiz_id, user_id) do nothing;
  return (select jsonb_build_object('score', r.score, 'total', r.total) from public.quiz_results r where r.quiz_id = p_quiz and r.user_id = auth.uid());
end $$;

-- the teacher's list says whether a quiz shuffles
drop function if exists public.teacher_quizzes(uuid);
create or replace function public.teacher_quizzes(p_class uuid)
returns table (id uuid, title text, questions int, required boolean, due_at timestamptz, closed boolean, created_at timestamptz, done bigint, students bigint, avg_pct int, shuffle boolean, items jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.classes c where c.id = p_class and c.owner = auth.uid() and c.kind = 'teacher') then
    raise exception 'Class not found.';
  end if;
  return query select q.id, q.title, jsonb_array_length(q.questions), q.required, q.due_at, q.closed, q.created_at,
    (select count(*) from public.quiz_results r join public.class_members m on m.class_id = q.class_id and m.user_id = r.user_id where r.quiz_id = q.id),
    (select count(*) from public.class_members m where m.class_id = q.class_id),
    (select round(100.0 * avg(r.score::numeric / nullif(r.total, 0)))::int from public.quiz_results r where r.quiz_id = q.id),
    q.shuffle,
    -- the questions without their pictures, so the results can name what each student picked
    (select coalesce(jsonb_agg(x - 'img' order by o), '[]'::jsonb) from jsonb_array_elements(q.questions) with ordinality as t(x, o))
    from public.class_quizzes q where q.class_id = p_class order by q.created_at desc limit 50;
end $$;

revoke all on function public.teacher_release_quiz(uuid, text, jsonb, boolean, timestamptz, boolean) from public;
revoke all on function public.my_quizzes() from public;
revoke all on function public.submit_quiz(uuid, jsonb) from public;
revoke all on function public.teacher_quizzes(uuid) from public;
grant execute on function public.teacher_release_quiz(uuid, text, jsonb, boolean, timestamptz, boolean) to authenticated;
grant execute on function public.my_quizzes() to authenticated;
grant execute on function public.submit_quiz(uuid, jsonb) to authenticated;
grant execute on function public.teacher_quizzes(uuid) to authenticated;
-- Quiz questions in a live lesson (classroom "Quiz +"). The host shares a question tied to a slide, or completes it into a
-- new question slide right after it; each participant answers a question once; the host reads every answer, a student only
-- learns whether they have answered. Same guards as room_act: the room code is normalised, only the host's secret can
-- share, and the room has caps (60 questions, 3000 answers) because participant ids come from the device.
-- `have` (ids the caller already holds) leaves those pictures out of quizList, so a 3.5 s poll doesn't resend images.
create table if not exists public.room_quizzes (
 room text references public.live_rooms on delete cascade, id uuid, slide int not null,
 prompt text not null, image text not null, created timestamptz default now(), primary key(room,id)
);
create table if not exists public.room_quiz_answers (
 room text, quiz uuid, participant text, name text not null, answer text not null,
 primary key(room,quiz,participant), foreign key(room,quiz) references public.room_quizzes on delete cascade
);
alter table public.room_quizzes add column if not exists credit text;
alter table public.room_quizzes enable row level security;
alter table public.room_quiz_answers enable row level security;
revoke all on public.room_quizzes,public.room_quiz_answers from public, anon, authenticated;
create or replace function public.room_quiz(p_room text,p_action text,p_data jsonb,p_secret uuid,p_participant text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.live_rooms; host boolean; q uuid; pos int; next_slides jsonb; v_slide jsonb;
  v_code text := upper(trim(coalesce(p_room,''))); v_part text := nullif(left(trim(coalesce(p_participant,'')),100),'');
  v_img text := coalesce(p_data->>'image',''); v_credit text := nullif(p_data->>'credit','');
  v_have jsonb := case when jsonb_typeof(p_data->'have')='array' then p_data->'have' else '[]'::jsonb end;
begin
 -- reading takes no lock: students poll this every few seconds
 if p_action='quizList' then select * into r from live_rooms where id=v_code;
 else select * into r from live_rooms where id=v_code for update; end if;
 if r.id is null then raise exception 'Room not found'; end if;
 host := p_secret is not null and p_secret=r.secret;
 if p_action='quizList' then
   return (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'slide',s.slide,'prompt',s.prompt)
     || case when s.credit is not null then jsonb_build_object('credit',s.credit) else '{}'::jsonb end
     || case when v_have ? s.id::text then '{}'::jsonb else jsonb_build_object('image',s.image) end
     || case when host then jsonb_build_object('answers',(select coalesce(jsonb_agg(jsonb_build_object('name',a.name,'answer',a.answer) order by a.name),'[]'::jsonb) from room_quiz_answers a where a.room=r.id and a.quiz=s.id))
        else jsonb_build_object('answered',exists(select 1 from room_quiz_answers a where a.room=r.id and a.quiz=s.id and a.participant=v_part)) end
     order by s.created),'[]'::jsonb) from room_quizzes s where s.room=r.id);
 end if;
 begin q := (p_data->>'id')::uuid; exception when invalid_text_representation then q := null; end;
 if q is null then raise exception 'Question unavailable'; end if;
 if p_action in ('quizShare','quizComplete') then
   if not host then raise exception 'Only the host can share a question.'; end if;
   if coalesce(p_data->>'slide','') !~ '^\d{1,3}$' or (p_data->>'slide')::int >= jsonb_array_length(r.slides)
      or length(trim(coalesce(p_data->>'prompt',''))) not between 1 and 1100
      or length(v_img)>400000 or (v_img<>'' and v_img !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+=*$')
      or (v_credit is not null and (length(v_credit) > 440 or v_credit !~ '^https://commons\.wikimedia\.org/wiki/File:[^\s"<>]+$'))
      then raise exception 'Invalid question or picture'; end if;
   if p_action='quizComplete' then
     if exists(select 1 from jsonb_array_elements(r.slides) s where s->>'questionId'=q::text) then return '{"ok":true}'::jsonb; end if;
     pos := (p_data->>'slide')::int+1;
     v_slide := jsonb_build_object('questionId',q,'orientation',case when p_data->>'orientation'='vertical' then 'vertical' else 'horizontal' end,
       'title',trim(p_data->>'prompt'),'image',v_img,'kicker','Q / QUESTION','body','','detail','','notes','','visual','none')
       || case when v_credit is not null then jsonb_build_object('credit',v_credit) else '{}'::jsonb end;
     next_slides := jsonb_insert(r.slides,array[pos::text],v_slide);
     if jsonb_array_length(next_slides)>40 or octet_length(next_slides::text)>5000000 then raise exception 'Room slide limit reached'; end if;
     update live_markers set slide=slide+1 where room=r.id and slide>=pos;
     update room_quizzes set slide=case when id=q then pos else slide+1 end where room=r.id and (id=q or slide>=pos);
     update live_rooms set slides=next_slides,current=current+case when current>=pos then 1 else 0 end where id=r.id;
     return '{"ok":true}'::jsonb;
   end if;
   if not exists(select 1 from room_quizzes where room=r.id and id=q) and (select count(*) from room_quizzes where room=r.id)>=60 then
     raise exception 'This lesson has reached its question limit.'; end if;
   insert into room_quizzes(room,id,slide,prompt,image,credit) values(r.id,q,(p_data->>'slide')::int,trim(p_data->>'prompt'),v_img,v_credit) on conflict do nothing;
 elsif p_action='quizAnswer' then
   if v_part is null or length(trim(coalesce(p_data->>'answer',''))) not between 1 and 2000 then raise exception 'Enter an answer.'; end if;
   if not exists(select 1 from room_quizzes where room=r.id and id=q) then raise exception 'Question unavailable'; end if;
   if (select count(*) from room_quiz_answers where room=r.id)>=3000 then raise exception 'This lesson has reached its answer limit.'; end if;
   insert into room_quiz_answers(room,quiz,participant,name,answer) values(r.id,q,v_part,left(coalesce(nullif(trim(p_data->>'name'),''),'Student'),40),trim(p_data->>'answer')) on conflict do nothing;
 else raise exception 'Question action unavailable'; end if;
 return '{"ok":true}'::jsonb;
end $$;
revoke all on function public.room_quiz(text,text,jsonb,uuid,text) from public;
grant execute on function public.room_quiz(text,text,jsonb,uuid,text) to anon,authenticated;
