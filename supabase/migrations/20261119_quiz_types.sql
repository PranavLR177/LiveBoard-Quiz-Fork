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
