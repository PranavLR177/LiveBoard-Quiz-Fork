-- Deadlines (the calendar on the home screen) sync inside the profile. Saving the profile now merges them per
-- deadline instead of replacing the list, so two devices can each add or tick one without losing the other's.
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
