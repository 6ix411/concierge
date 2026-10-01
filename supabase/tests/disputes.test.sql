-- Disputes: written by the server only, what was reported is frozen, the thread and history are
-- append-only, and each side sees only what it should. Run on a fresh `supabase db reset`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

-- Seed: Emeka's open dispute on his Fixit Plumbing booking.
create temp table ids as
select d.id as dispute, d.booking_id as booking, bk.customer_id as customer, b.owner_id as owner,
  'a0000000-0000-0000-0000-000000000001'::uuid as outsider, 'a0000000-0000-0000-0000-0000000000ad'::uuid as admin
from public.disputes d
join public.bookings bk on bk.id = d.booking_id
join public.businesses b on b.id = bk.business_id
where b.slug = 'fixit-plumbing' and d.status = 'open';
grant select on ids to authenticated, anon;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end;
$$;
grant execute on function pg_temp.act_as(uuid) to authenticated;

select is((select count(*)::int from ids), 1, 'fixture: one open dispute');
select is((select event from public.dispute_events where dispute_id = (select dispute from ids)), 'opened',
  'opening a dispute is logged');

-- ---------------------------------------------------------------------------
-- Nobody writes from the client
-- ---------------------------------------------------------------------------

select pg_temp.act_as((select customer from ids));
select throws_ok($$ update public.disputes set reason = 'changed' $$, '42501', null, 'parties cannot edit a dispute');
select throws_ok($$ insert into public.dispute_messages (dispute_id, sender_id, sender_role, body)
  select dispute, customer, 'customer', 'hi' from ids $$, '42501', null, 'parties cannot write messages directly');
select throws_ok($$ insert into public.dispute_evidence (dispute_id, uploaded_by, uploader_role, storage_path, file_name, mime_type, size_bytes)
  select dispute, customer, 'customer', dispute || '/x.jpg', 'x.jpg', 'image/jpeg', 10 from ids $$, '42501', null,
  'parties cannot add evidence records directly');
select throws_ok($$ select change_note from public.disputes $$, '42501', null, 'the write-only change columns are hidden');
reset role;

-- ---------------------------------------------------------------------------
-- What was reported is frozen (even for the server)
-- ---------------------------------------------------------------------------

select throws_ok($$ update public.disputes set description = 'rewritten' where id = (select dispute from ids) $$,
  '23514', 'What was reported in a dispute cannot be changed', 'the description cannot be rewritten');
select throws_ok($$ update public.disputes set opened_by = (select owner from ids) where id = (select dispute from ids) $$,
  '23514', null, 'who opened it cannot be changed');
select throws_ok($$ update public.disputes set reason_code = 'damage' where id = (select dispute from ids) $$,
  '23514', null, 'the reason cannot be changed');

-- ---------------------------------------------------------------------------
-- The thread
-- ---------------------------------------------------------------------------

select lives_ok($$ insert into public.dispute_messages (dispute_id, sender_id, sender_role, body)
  select dispute, customer, 'customer', 'The leak came back the next morning.' from ids $$, 'the customer can post');
select lives_ok($$ insert into public.dispute_messages (dispute_id, sender_id, sender_role, body)
  select dispute, owner, 'business', 'We can come back on Monday.' from ids $$, 'the business can post');
select lives_ok($$ insert into public.dispute_messages (dispute_id, sender_id, sender_role, body, internal)
  select dispute, admin, 'admin', 'Check the chat before deciding.', true from ids $$, 'admins can leave internal notes');
select throws_ok($$ insert into public.dispute_messages (dispute_id, sender_id, sender_role, body)
  select dispute, outsider, 'customer', 'I am also the customer' from ids $$, '23514', null,
  'an outsider cannot post as the customer');
select throws_ok($$ insert into public.dispute_messages (dispute_id, sender_id, sender_role, body)
  select dispute, owner, 'admin', 'Decided for me' from ids $$, '23514', null, 'the business cannot post as the Concierge team');
select throws_ok($$ insert into public.dispute_messages (dispute_id, sender_id, sender_role, body, internal)
  select dispute, customer, 'customer', 'secret', true from ids $$, '23514', null, 'only admins write internal notes');
insert into public.dispute_evidence (dispute_id, uploaded_by, uploader_role, storage_path, file_name, mime_type, size_bytes)
select dispute, customer, 'customer', dispute || '/leak.jpg', 'leak.jpg', 'image/jpeg', 1000 from ids;

select throws_ok($$ update public.dispute_messages set body = 'edited' $$, '23514', null, 'messages cannot be edited');
select throws_ok($$ delete from public.dispute_messages $$, '23514', null, 'messages cannot be deleted');
select throws_ok($$ delete from public.dispute_evidence $$, '23514', null, 'evidence cannot be deleted');
select throws_ok($$ delete from public.dispute_events $$, '23514', null, 'history cannot be deleted');
select throws_ok($$ delete from public.disputes where id = (select dispute from ids) $$, '23514', null,
  'a dispute with messages cannot be deleted');

-- ---------------------------------------------------------------------------
-- Who sees what
-- ---------------------------------------------------------------------------

select pg_temp.act_as((select owner from ids));
select is((select count(*)::int from public.dispute_messages), 2, 'the business sees both sides'' messages, not internal notes');
select is((select count(*)::int from public.dispute_evidence), 1, 'the business sees the customer''s evidence');
reset role;
select pg_temp.act_as((select outsider from ids));
select is((select count(*)::int from public.dispute_messages) + (select count(*)::int from public.dispute_evidence)
  + (select count(*)::int from public.dispute_events), 0, 'other customers see nothing');
reset role;
select pg_temp.act_as((select admin from ids));
select is((select count(*)::int from public.dispute_messages), 3, 'admins see internal notes too');
reset role;

-- ---------------------------------------------------------------------------
-- Status: forward only, logged, final once decided
-- ---------------------------------------------------------------------------

update public.disputes set status = 'escalated', change_actor_id = (select admin from ids), change_note = 'Needs a refund decision'
where id = (select dispute from ids);
select is((select actor_role || ':' || to_status from public.dispute_events
  where dispute_id = (select dispute from ids) and event = 'status_changed'), 'admin:escalated', 'status changes are logged with who made them');
select is((public.admin_dashboard_stats(5) ->> 'open_disputes')::int, 1, 'escalated disputes count as open');
select throws_ok($$ update public.disputes set status = 'open' where id = (select dispute from ids) $$, '23514', null,
  'a dispute cannot go back to open');

update public.disputes set status = 'resolved', outcome = 'business', resolution = 'Job stands.', resolved_at = now()
where id = (select dispute from ids);
select throws_ok($$ update public.disputes set status = 'under_review', outcome = null, resolved_at = null
  where id = (select dispute from ids) $$, '23514', null, 'a decided dispute cannot be reopened');
select throws_ok($$ update public.disputes set resolution = 'Changed my mind' where id = (select dispute from ids) $$,
  '23514', null, 'a decision cannot be rewritten');
select throws_ok($$ insert into public.dispute_messages (dispute_id, sender_id, sender_role, body)
  select dispute, customer, 'customer', 'One more thing' from ids $$, '23514', 'This dispute is closed',
  'nothing can be added once it''s closed');

select * from finish();
rollback;
