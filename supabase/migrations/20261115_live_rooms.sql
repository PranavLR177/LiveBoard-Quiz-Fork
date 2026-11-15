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
