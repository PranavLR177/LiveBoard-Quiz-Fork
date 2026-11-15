-- Behavioral checks for sync revisions, row isolation, AI limits and recall scoring. Run as a superuser after the schema.
grant select, insert, update on all tables in schema public to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

-- first write
select public.push_rows('notes', '[{"id":"n1","base_rev":0,"data":{"title":"A1"},"updated_at":1,"deleted":false}]', 0)->0->>'status' = 'ok' as first_write_ok \gset
\if :first_write_ok \else \echo 'FAIL first write' \quit \endif
-- write on top of the latest revision
select public.push_rows('notes', '[{"id":"n1","base_rev":1,"data":{"title":"A2"},"updated_at":2}]', 0)->0->>'rev' = '2' as second_ok \gset
\if :second_ok \else \echo 'FAIL second write' \quit \endif
-- a stale device (still on rev 1) is refused and gets the server copy back
select (public.push_rows('notes', '[{"id":"n1","base_rev":1,"data":{"title":"STALE"},"updated_at":99}]', 0)->0) as r \gset
select (:'r'::jsonb->>'status') = 'conflict' and (:'r'::jsonb->'data'->>'title') = 'A2' as stale_refused \gset
\if :stale_refused \else \echo 'FAIL stale overwrite allowed' :r \quit \endif
select (select data->>'title' from public.notes where id = 'n1') = 'A2' as server_kept \gset
\if :server_kept \else \echo 'FAIL server lost data' \quit \endif
-- legacy rows (no base) only apply when newer
select public.push_rows('notes', '[{"id":"n1","base_rev":null,"data":{"title":"OLD"},"updated_at":1}]', 0)->0->>'status' = 'stale' as legacy_old \gset
\if :legacy_old \else \echo 'FAIL legacy older row applied' \quit \endif
-- direct writes that bypass revisions: insert works only for own rows
select (select count(*) from public.notes) = 1 as sees_own \gset
\if :sees_own \else \echo 'FAIL A row count' \quit \endif
-- bad ids are rejected
select public.push_rows('notes', '[{"id":"../x","data":{}}]', 0)->0->>'status' = 'invalid' as bad_id \gset
\if :bad_id \else \echo 'FAIL bad id accepted' \quit \endif

-- user B can't see or take over A's row
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select (select count(*) from public.notes) = 0 as b_isolated \gset
\if :b_isolated \else \echo 'FAIL B sees A rows' \quit \endif
select public.push_rows('notes', '[{"id":"n1","base_rev":0,"data":{"title":"HIJACK"},"updated_at":5}]', 0)->0->>'status' = 'invalid' as no_hijack \gset
\if :no_hijack \else \echo 'FAIL B overwrote A' \quit \endif
update public.notes set data = '{"title":"X"}' where id = 'n1';
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
\echo '(expected) a direct write that skips push_rows is refused:'
\set ON_ERROR_STOP 0
update public.notes set data = '{"title":"DIRECT"}' where id = 'n1';
insert into public.notes (id, user_id, data, updated_at) values ('n9', auth.uid(), '{}', 1);
\set ON_ERROR_STOP 1
reset role;
select (select data->>'title' from public.notes where id = 'n1') = 'A2' as a_intact \gset
\if :a_intact \else \echo 'FAIL A row changed by B' \quit \endif

-- pull cursor: seq increases with each write
select (select seq from public.notes where id = 'n1') > 0 as has_seq \gset
\if :has_seq \else \echo 'FAIL seq missing' \quit \endif

-- AI limits: per-minute cap 2, daily cap 3, global cap 4
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select (public.begin_ai_request(3, 2, 4)->>'allowed')::boolean as a1 \gset
select (public.begin_ai_request(3, 2, 4)->>'allowed')::boolean as a2 \gset
select public.begin_ai_request(3, 2, 4)->>'reason' = 'minute' as a3_minute \gset
\if :a1 \else \echo 'FAIL first AI request refused' \quit \endif
\if :a3_minute \else \echo 'FAIL per-minute limit' \quit \endif
reset role;
update public.ai_minute set minute = minute - interval '5 minutes';
set role authenticated;
select (public.begin_ai_request(3, 2, 4)->>'allowed')::boolean as a4 \gset
select public.begin_ai_request(3, 2, 4)->>'reason' = 'daily' as a5_daily \gset
\if :a5_daily \else \echo 'FAIL daily limit' \quit \endif
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select (public.begin_ai_request(3, 2, 4)->>'allowed')::boolean as b1 \gset
select public.begin_ai_request(3, 2, 4)->>'reason' = 'global' as b2_global \gset
\if :b2_global \else \echo 'FAIL global limit' \quit \endif
-- anonymous callers get nothing
\echo '(expected) signed-out AI request is refused:'
set request.jwt.claim.sub = '';
\set ON_ERROR_STOP 0
select public.begin_ai_request(3, 2, 4);
\set ON_ERROR_STOP 1

-- recall scoring: server decides points, once per marker per day
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select id as cls from public.create_class('BIO', 'Ana') \gset
select public.log_recall(:'cls', 'm1', true) = 10 as r1 \gset
select public.log_recall(:'cls', 'm1', true) = 0 as r2_once \gset
\if :r1 \else \echo 'FAIL recall points' \quit \endif
\if :r2_once \else \echo 'FAIL recall replay scored' \quit \endif
\echo '(expected) direct point insert is refused:'
\set ON_ERROR_STOP 0
insert into public.recall_events (class_id, points) values (:'cls', 20);
\set ON_ERROR_STOP 1
select (select points from public.class_leaderboard(:'cls') limit 1) = 10 as lb_ok \gset
\if :lb_ok \else \echo 'FAIL direct point insert counted' \quit \endif
-- account deletion removes only the caller's data
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.push_rows('notes', '[{"id":"nb1","base_rev":0,"data":{"title":"B"},"updated_at":1}]', 0) is not null as b_wrote \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.delete_my_data() = 1 as gen_bumped \gset
\if :gen_bumped \else \echo 'FAIL generation not bumped' \quit \endif
reset role;
select (select count(*) from public.notes where user_id = '00000000-0000-0000-0000-00000000000a') = 0
   and (select count(*) from public.notes where user_id = '00000000-0000-0000-0000-00000000000b') = 1
   and (select count(*) from public.recall_events where user_id = '00000000-0000-0000-0000-00000000000a') = 0 as deleted_only_mine \gset
\if :deleted_only_mine \else \echo 'FAIL account deletion' \quit \endif
-- after deletion, a device still on generation 0 can't upload, and its profile write is refused
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.push_rows('notes', '[{"id":"old1","base_rev":0,"data":{"title":"resurrected"},"updated_at":9}]', 0)->0->>'status' = 'erased' as stale_gen_refused \gset
\if :stale_gen_refused \else \echo 'FAIL stale device re-uploaded deleted data' \quit \endif
select public.push_profile('{"points":5}', 0)->>'status' = 'erased' as profile_refused \gset
\if :profile_refused \else \echo 'FAIL stale profile write' \quit \endif
select (public.sync_state()->>'gen')::int = 1 as gen_visible \gset
select public.push_rows('notes', '[{"id":"new1","base_rev":0,"data":{"title":"fresh"},"updated_at":9}]', 1)->0->>'status' = 'ok' as new_gen_ok \gset
\if :new_gen_ok \else \echo 'FAIL current generation refused' \quit \endif
reset role;
select (select count(*) from public.notes where user_id = '00000000-0000-0000-0000-00000000000a') = 1 as only_fresh \gset
\if :only_fresh \else \echo 'FAIL deleted note came back' \quit \endif
\echo '(expected) the old two-argument upload no longer exists:'
\set ON_ERROR_STOP 0
set role authenticated;
select public.push_rows('notes', '[]');
reset role;
\set ON_ERROR_STOP 1

-- Live classes: anonymous students with a room code, a host with the room secret.
reset role;
set role anon;
\set ON_ERROR_STOP 0
\echo '(expected) anonymous visitors cannot read room tables directly:'
select count(*) from public.live_rooms;
\echo '(expected) a deck with a slide missing its fields is refused:'
select public.room_create('Bad', '[{"title":"x"}]');
\set ON_ERROR_STOP 1
select public.room_create('Equilibrium', '[{"title":"One","kicker":"01","body":"b","detail":"d","visual":"none","notes":"secret notes"},{"title":"Two","kicker":"02","body":"b","detail":"d","visual":"none","notes":"more"}]') as made \gset
select :'made'::jsonb->>'id' as rid, :'made'::jsonb->>'secret' as rsecret \gset
select length(:'rid') = 8 as code_ok \gset
\if :code_ok \else \echo 'FAIL room code' \quit \endif
select (public.room_get(lower(:'rid'), null, 'stu1')->'slides'->0->>'notes') = '' as notes_hidden \gset
\if :notes_hidden \else \echo 'FAIL students see speaker notes' \quit \endif
select (public.room_get(:'rid', :'rsecret'::uuid)->'slides'->0->>'notes') = 'secret notes' as host_notes \gset
\if :host_notes \else \echo 'FAIL host cannot see notes' \quit \endif
\set ON_ERROR_STOP 0
\echo '(expected) a student cannot move the class or end it:'
select public.room_act(:'rid', 'control', '{"current":1}', null, 'stu1');
select public.room_act(:'rid', 'end', '{}', gen_random_uuid(), 'stu1');
\echo '(expected) a marker off the slides is refused:'
select public.room_act(:'rid', 'marker', '{"kind":"question","body":"why","slide":5,"x":50,"y":50}', null, 'stu1');
\echo '(expected) a screenshot without a region is refused:'
select public.room_act(:'rid', 'marker', '{"kind":"question","body":"why","slide":0,"x":50,"y":50,"screenshot":"data:image/jpeg;base64,AAAA"}', null, 'stu1');
\set ON_ERROR_STOP 1
select public.room_act(:'rid', 'marker', '{"kind":"question","body":"Why does it stop?","slide":0,"x":150,"y":40,"author":"Teacher","region":{"left":10,"top":10,"width":20,"height":20},"screenshot":"data:image/jpeg;base64,AAAA"}', null, 'stu1')->>'id' as m1 \gset
select public.room_act(:'rid', 'marker', '{"kind":"idea","body":"Mine too","slide":0,"x":20,"y":20,"author":"Ana"}', null, 'stu2')->>'id' as m2 \gset
select public.room_get(:'rid', null, 'stu1') as v1 \gset
select jsonb_array_length(:'v1'::jsonb->'markers') = 1 and :'v1'::jsonb->'markers'->0->>'author' = 'Student' and (:'v1'::jsonb->'markers'->0->>'x')::real = 98 as own_only \gset
\if :own_only \else \echo 'FAIL a student sees only their own markers, and cannot sign as Teacher' \quit \endif
select jsonb_array_length(public.room_get(:'rid', :'rsecret'::uuid)->'markers') = 2 as host_all \gset
\if :host_all \else \echo 'FAIL host sees every marker' \quit \endif
select jsonb_array_length(public.room_get(:'rid', :'rsecret'::uuid, null, true)->'markers') = 0 as projector_private \gset
\if :projector_private \else \echo 'FAIL projector shows student markers' \quit \endif
select public.room_screenshot(:'rid', :'m1'::uuid, null, 'stu2') is null and public.room_screenshot(:'rid', :'m1'::uuid, null, 'stu1') is not null as shot_private \gset
\if :shot_private \else \echo 'FAIL screenshots follow marker visibility' \quit \endif
\set ON_ERROR_STOP 0
\echo '(expected) a student cannot reply on someone else''s marker:'
select public.room_act(:'rid', 'reply', jsonb_build_object('id', :'m1', 'body', 'hi'), null, 'stu2');
\set ON_ERROR_STOP 1
select public.room_act(:'rid', 'reply', jsonb_build_object('id', :'m1', 'body', 'Rates are equal.'), :'rsecret'::uuid) is not null as replied \gset
select jsonb_array_length(public.room_get(:'rid', null, 'stu1')->'replies') = 1 and jsonb_array_length(public.room_get(:'rid', null, 'stu2')->'replies') = 0 as replies_ok \gset
\if :replies_ok \else \echo 'FAIL replies follow marker visibility' \quit \endif
\set ON_ERROR_STOP 0
\echo '(expected) a student cannot switch student markers back on, and cannot add one while they are paused:'
select public.room_act(:'rid', 'control', '{"studentMarkers":false}', null, 'stu1');
\set ON_ERROR_STOP 1
select public.room_act(:'rid', 'control', '{"studentMarkers":false}', :'rsecret'::uuid) is not null as paused \gset
select (public.room_get(:'rid')->>'studentMarkers')::int = 0 as paused_seen \gset
\if :paused_seen \else \echo 'FAIL students can see that markers are paused' \quit \endif
\set ON_ERROR_STOP 0
select public.room_act(:'rid', 'marker', '{"kind":"question","body":"while paused","slide":0,"x":50,"y":50}', null, 'stu1');
\set ON_ERROR_STOP 1
select not exists (select 1 from jsonb_array_elements(public.room_get(:'rid', :'rsecret'::uuid)->'markers') m where m->>'body' = 'while paused') as pause_held \gset
\if :pause_held \else \echo 'FAIL a paused room accepted a student marker' \quit \endif
select public.room_act(:'rid', 'marker', '{"kind":"idea","body":"teacher still can","slide":0,"x":50,"y":50}', :'rsecret'::uuid) is not null
   and public.room_act(:'rid', 'control', '{"studentMarkers":true}', :'rsecret'::uuid) is not null as resumed \gset
\set ON_ERROR_STOP 0
\echo '(expected) a slide object that links to another site is refused:'
select public.room_create('Bad', '[{"title":"One","kicker":"01","body":"b","detail":"d","visual":"none","notes":"","elements":[{"id":"a","kind":"image","src":"https://tracker.example/pixel.png"}]}]');
\set ON_ERROR_STOP 1
select public.room_act(:'rid', 'control', '{"current":9,"duration":60}', :'rsecret'::uuid) is not null as moved \gset
select (public.room_get(:'rid')->>'current')::int = 1 and (public.room_get(:'rid')->>'until')::bigint > 0 as control_ok \gset
\if :control_ok \else \echo 'FAIL host control (slide clamped, question time set)' \quit \endif
select public.room_act(:'rid', 'end', '{}', :'rsecret'::uuid) is not null as ended \gset
reset role;
select not exists (select 1 from public.live_rooms where id = :'rid') and not exists (select 1 from public.live_markers where room = :'rid') as gone \gset
\if :gone \else \echo 'FAIL ending a class deletes its slides and markers' \quit \endif
insert into public.live_rooms (id, secret, title, slides, created) values ('OLDROOM1', gen_random_uuid(), 'old', '[]', now() - interval '13 hours');
set role anon;
select public.room_create('New', '[{"title":"One","kicker":"01","body":"b","detail":"d","visual":"none","notes":""}]') is not null as made2 \gset
reset role;
select not exists (select 1 from public.live_rooms where id = 'OLDROOM1') as expired \gset
\if :expired \else \echo 'FAIL rooms older than 12 hours are cleared' \quit \endif

\echo 'ALL SQL CHECKS PASS'
