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
