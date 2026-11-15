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

create or replace function public.join_class(p_code text, p_display text)
returns table (id uuid, name text, code text) language plpgsql security definer set search_path = public as $$
declare v public.classes;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  select * into v from public.classes c where c.code = upper(trim(p_code));
  if v.id is null then raise exception 'class not found'; end if;
  insert into public.class_members (class_id, user_id, display_name)
    values (v.id, auth.uid(), left(coalesce(nullif(p_display, ''), 'Student'), 40))
    on conflict (class_id, user_id) do update set display_name = excluded.display_name;
  return query select v.id, v.name, v.code;
end $$;

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
grant execute on function public.join_class(text, text) to authenticated;
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

-- Profile (streak, points, name) is written through the same barrier; clients can only read it directly.
create or replace function public.push_profile(p_data jsonb, p_gen bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) > 100000 then return jsonb_build_object('status', 'invalid'); end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  if p_gen is distinct from coalesce((select gen from public.sync_generation where user_id = auth.uid()), 0) then
    return jsonb_build_object('status', 'erased');
  end if;
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
  delete from public.class_members where user_id = v;
  delete from public.ai_usage where user_id = v;
  delete from public.ai_minute where user_id = v;
  delete from public.classes c where c.owner = v and not exists (select 1 from public.class_members m where m.class_id = c.id);
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
