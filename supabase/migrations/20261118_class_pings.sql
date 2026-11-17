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
