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
create or replace function public.teacher_release_quiz(p_class uuid, p_title text, p_questions jsonb, p_required boolean default false, p_due timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_clean jsonb;
begin
  if not exists (select 1 from public.classes c where c.id = p_class and c.owner = auth.uid() and c.kind = 'teacher') then
    raise exception 'Class not found.';
  end if;
  if jsonb_typeof(p_questions) <> 'array' then raise exception 'Add at least one question.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('q', left(trim(x->>'q'), 300), 'a', left(trim(coalesce(x->>'a', '')), 600)) order by o), '[]'::jsonb) into v_clean
    from jsonb_array_elements(p_questions) with ordinality as t(x, o)
    where jsonb_typeof(x) = 'object' and length(trim(coalesce(x->>'q', ''))) > 0;
  if jsonb_array_length(v_clean) = 0 then raise exception 'Add at least one question.'; end if;
  if jsonb_array_length(v_clean) > 20 then raise exception 'A pop quiz holds up to 20 questions.'; end if;
  if (select count(*) from public.class_quizzes q where q.class_id = p_class and q.created_at > now() - interval '1 day') >= 20 then
    raise exception 'That''s a lot of quizzes for one day. Try again tomorrow.';
  end if;
  insert into public.class_quizzes (class_id, title, questions, required, due_at)
    values (p_class, coalesce(nullif(left(trim(p_title), 80), ''), 'Pop quiz'), v_clean, coalesce(p_required, false), p_due)
    returning id into v_id;
  return v_id;
end $$;

create or replace function public.teacher_quizzes(p_class uuid)
returns table (id uuid, title text, questions int, required boolean, due_at timestamptz, closed boolean, created_at timestamptz, done bigint, students bigint, avg_pct int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.classes c where c.id = p_class and c.owner = auth.uid() and c.kind = 'teacher') then
    raise exception 'Class not found.';
  end if;
  return query select q.id, q.title, jsonb_array_length(q.questions), q.required, q.due_at, q.closed, q.created_at,
    (select count(*) from public.quiz_results r join public.class_members m on m.class_id = q.class_id and m.user_id = r.user_id where r.quiz_id = q.id),
    (select count(*) from public.class_members m where m.class_id = q.class_id),
    (select round(100.0 * avg(r.score::numeric / nullif(r.total, 0)))::int from public.quiz_results r where r.quiz_id = q.id)
    from public.class_quizzes q where q.class_id = p_class order by q.created_at desc limit 50;
end $$;

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
create or replace function public.my_quizzes()
returns table (id uuid, class_id uuid, class_name text, teacher_name text, title text, questions jsonb, required boolean, due_at timestamptz, created_at timestamptz, done boolean, score int, total int)
language sql stable security definer set search_path = public as $$
  select q.id, q.class_id, c.name, c.teacher_name, q.title, q.questions, q.required, q.due_at, q.created_at,
         r.user_id is not null, r.score, r.total
    from public.class_quizzes q
    join public.class_members m on m.class_id = q.class_id and m.user_id = auth.uid()
    join public.classes c on c.id = q.class_id
    left join public.quiz_results r on r.quiz_id = q.id and r.user_id = auth.uid()
   where not q.closed or r.user_id is not null
   order by q.created_at desc limit 60
$$;

create or replace function public.submit_quiz(p_quiz uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_q public.class_quizzes; v_clean jsonb; v_n int; v_score int;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  select q.* into v_q from public.class_quizzes q join public.class_members m on m.class_id = q.class_id and m.user_id = auth.uid() where q.id = p_quiz;
  if v_q.id is null then raise exception 'Quiz not found.'; end if;
  if v_q.closed then raise exception 'This quiz is closed.'; end if;
  v_n := jsonb_array_length(v_q.questions);
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> v_n then raise exception 'Answer every question.'; end if;
  select jsonb_agg(jsonb_build_object('got', coalesce((x->>'got')::boolean, false), 'said', left(coalesce(x->>'said', ''), 400)) order by o) into v_clean
    from jsonb_array_elements(p_answers) with ordinality as t(x, o);
  select count(*) into v_score from jsonb_array_elements(v_clean) x where (x->>'got')::boolean;
  -- one result per student: the first one sent stands
  insert into public.quiz_results (quiz_id, user_id, answers, score, total) values (p_quiz, auth.uid(), v_clean, v_score, v_n)
    on conflict (quiz_id, user_id) do nothing;
  return (select jsonb_build_object('score', r.score, 'total', r.total) from public.quiz_results r where r.quiz_id = p_quiz and r.user_id = auth.uid());
end $$;

revoke all on function public.teacher_release_quiz(uuid, text, jsonb, boolean, timestamptz) from public;
revoke all on function public.teacher_quizzes(uuid) from public;
revoke all on function public.teacher_quiz_results(uuid) from public;
revoke all on function public.teacher_close_quiz(uuid, boolean) from public;
revoke all on function public.my_quizzes() from public;
revoke all on function public.submit_quiz(uuid, jsonb) from public;
grant execute on function public.teacher_release_quiz(uuid, text, jsonb, boolean, timestamptz) to authenticated;
grant execute on function public.teacher_quizzes(uuid) to authenticated;
grant execute on function public.teacher_quiz_results(uuid) to authenticated;
grant execute on function public.teacher_close_quiz(uuid, boolean) to authenticated;
grant execute on function public.my_quizzes() to authenticated;
grant execute on function public.submit_quiz(uuid, jsonb) to authenticated;

-- deleting your account's data takes your quiz results with it (and a teacher's classes, with their quizzes)
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
