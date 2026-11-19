create table if not exists public.room_quizzes (
 room text references public.live_rooms on delete cascade, id uuid, slide int not null,
 prompt text not null, image text not null, created timestamptz default now(), primary key(room,id)
);
create table if not exists public.room_quiz_answers (
 room text, quiz uuid, participant text, name text not null, answer text not null,
 primary key(room,quiz,participant), foreign key(room,quiz) references public.room_quizzes on delete cascade
);
alter table public.room_quizzes enable row level security;
alter table public.room_quiz_answers enable row level security;
revoke all on public.room_quizzes,public.room_quiz_answers from public, anon, authenticated;
create or replace function public.room_quiz(p_room text,p_action text,p_data jsonb,p_secret uuid,p_participant text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.live_rooms; host boolean; q uuid; pos int; next_slides jsonb;
begin
 select * into strict r from live_rooms where id=p_room for update;
 host := coalesce(r.secret=p_secret,false);
 if p_action='quizList' then
   return (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'slide',s.slide,'prompt',s.prompt,'image',s.image) ||
     case when host then jsonb_build_object('answers',(select coalesce(jsonb_agg(jsonb_build_object('name',a.name,'answer',a.answer)),'[]') from room_quiz_answers a where a.room=r.id and a.quiz=s.id))
     else jsonb_build_object('answered',exists(select 1 from room_quiz_answers a where a.room=r.id and a.quiz=s.id and a.participant=p_participant)) end order by s.created),'[]') from room_quizzes s where s.room=r.id);
 end if;
 q := (p_data->>'id')::uuid;
 if p_action in ('quizShare','quizComplete') and host then
   if coalesce((p_data->>'slide')::int,-1) not between 0 and jsonb_array_length(r.slides)-1
      or length(trim(coalesce(p_data->>'prompt',''))) not between 1 and 1100
      or length(p_data->>'image')>400000 or (p_data->>'image'<>'' and p_data->>'image' !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+=*$')
      then raise exception 'Invalid question or picture'; end if;
   if p_action='quizComplete' then
     if exists(select 1 from jsonb_array_elements(r.slides) s where s->>'questionId'=q::text) then return '{"ok":true}'::jsonb; end if;
     pos := (p_data->>'slide')::int+1;
     next_slides := jsonb_insert(r.slides,array[pos::text],jsonb_build_object('questionId',q,'orientation',case when p_data->>'orientation'='vertical' then 'vertical' else 'horizontal' end,'title',trim(p_data->>'prompt'),'image',p_data->>'image','kicker','Q / QUESTION','body','','detail','','notes','','visual','none'));
     if jsonb_array_length(next_slides)>40 or octet_length(next_slides::text)>5000000 then raise exception 'Room slide limit reached'; end if;
     update live_markers set slide=slide+1 where room=r.id and slide>=pos;
     update room_quizzes set slide=case when id=q then pos else slide+1 end where room=r.id and (id=q or slide>=pos);
     update live_rooms set slides=next_slides,current=current+case when current>=pos then 1 else 0 end where id=r.id;
     return '{"ok":true}'::jsonb;
   end if;
   insert into room_quizzes(room,id,slide,prompt,image) values(r.id,q,(p_data->>'slide')::int,trim(p_data->>'prompt'),p_data->>'image') on conflict do nothing;
 elsif p_action='quizAnswer' and length(trim(coalesce(p_participant,''))) between 1 and 100 and length(trim(coalesce(p_data->>'answer',''))) between 1 and 2000 then
   insert into room_quiz_answers(room,quiz,participant,name,answer) values(r.id,q,p_participant,left(coalesce(nullif(trim(p_data->>'name'),''),'Student'),40),trim(p_data->>'answer')) on conflict do nothing;
 else raise exception 'Question action unavailable'; end if;
 return '{"ok":true}'::jsonb;
end $$;
revoke all on function public.room_quiz(text,text,jsonb,uuid,text) from public;
grant execute on function public.room_quiz(text,text,jsonb,uuid,text) to anon,authenticated;
