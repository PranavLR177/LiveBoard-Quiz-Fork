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
