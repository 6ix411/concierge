-- Access-control tests. Run with `npm run db:test` (local Supabase must be running).
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'ada@test.ng',   '{"role":"customer","full_name":"Ada"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bayo@test.ng',  '{"role":"customer"}'),
  ('00000000-0000-0000-0000-00000000000c', 'chidi@test.ng', '{"role":"business"}'),
  ('00000000-0000-0000-0000-00000000000d', 'dayo@test.ng',  '{"role":"business"}'),
  ('00000000-0000-0000-0000-00000000000e', 'eve@test.ng',   '{"role":"admin"}');

select is((select role::text from public.users where email = 'eve@test.ng'), 'customer',
  'sign-up cannot self-assign the admin role');
select ok(exists (select 1 from public.customer_profiles where user_id = '00000000-0000-0000-0000-00000000000a'),
  'customers get a customer profile on sign-up');

update public.users set role = 'admin' where email = 'eve@test.ng';

insert into public.businesses (id, owner_id, name, slug, status, is_verified, verified_at) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'Chidi Cleaning', 'chidi-cleaning', 'approved', true, now()),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000d', 'Dayo Draft', 'dayo-draft', 'draft', false, null);

insert into public.business_services (business_id, name, price_minor) values
  ('10000000-0000-0000-0000-000000000001', 'Deep clean', 2500000);

insert into public.bookings (id, customer_id, business_id, subtotal_minor, platform_fee_minor, total_minor) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
   '10000000-0000-0000-0000-000000000001', 2500000, 250000, 2750000);

select throws_ok($$
  insert into public.bookings (customer_id, business_id) values
    ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002')
$$, '23514', null, 'bookings with unapproved businesses are rejected');

select throws_ok($$
  insert into public.bookings (customer_id, business_id) values
    ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-000000000001')
$$, '23514', null, 'only customers can make bookings');

select throws_ok($$
  update public.bookings set status = 'completed' where id = '20000000-0000-0000-0000-000000000001'
$$, '23514', null, 'invalid booking status jumps are rejected');

update public.bookings set status = 'accepted' where id = '20000000-0000-0000-0000-000000000001';
select ok(not exists (select 1 from public.conversations where booking_id = '20000000-0000-0000-0000-000000000001'),
  'chat does not open before payment');
update public.bookings set status = 'confirmed' where id = '20000000-0000-0000-0000-000000000001';
select ok(exists (select 1 from public.conversations where booking_id = '20000000-0000-0000-0000-000000000001'),
  'chat opens when the booking is confirmed');

insert into public.payments (booking_id, payer_id, provider, reference, amount_minor, status, paid_at, provider_payload)
values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'paystack', 'PAY-1', 2750000,
        'success', now(), '{"secret":"x"}');

select throws_ok($$
  insert into public.reviews (booking_id, customer_id, business_id, rating) values
    ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 5)
$$, '23514', null, 'reviews need a completed booking');

insert into public.admin_actions (admin_id, action, target_type, target_id)
values ('00000000-0000-0000-0000-00000000000e', 'business.approve', 'businesses', '10000000-0000-0000-0000-000000000001');
select throws_ok($$ delete from public.admin_actions $$, '42501', null, 'admin audit log is append-only');

-- Impersonation helper.
create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  if uid is null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  end if;
end;
$$;
grant execute on function pg_temp.act_as(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Anonymous visitors
-- ---------------------------------------------------------------------------
select pg_temp.act_as(null);
select results_eq($$ select slug from public.businesses where slug in ('chidi-cleaning', 'dayo-draft') $$,
  array['chidi-cleaning'], 'visitors only see approved businesses');
select ok((select bool_and(slug <> 'dayo-draft') from public.match_businesses(p_limit => 50)),
  'search never returns unapproved businesses');
select is_empty($$ select 1 from public.match_businesses('Dayo Draft') $$,
  'searching an unapproved business by name finds nothing');
select throws_ok($$ select * from public.get_booking_counterparts(array['00000000-0000-0000-0000-00000000000a'::uuid]) $$,
  '42501', null, 'visitors cannot look up booking counterparts');
select throws_ok($$ select * from public.bookings $$, '42501', null, 'visitors cannot query bookings at all');

-- ---------------------------------------------------------------------------
-- Customer Ada
-- ---------------------------------------------------------------------------
reset role; select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.bookings), 1, 'a customer sees their own booking');
select is((select count(*)::int from public.users), 1, 'a customer only sees their own user row');
select throws_ok($$ update public.users set role = 'admin' where id = auth.uid() $$, '42501', null,
  'a customer cannot change their own role');
select lives_ok($$ update public.users set full_name = 'Ada Obi' where id = auth.uid() $$,
  'a customer can edit their own name');
select throws_ok($$
  insert into public.bookings (customer_id, business_id) values (auth.uid(), '10000000-0000-0000-0000-000000000001')
$$, '42501', null, 'clients cannot create bookings directly (server only)');
select throws_ok($$
  insert into public.businesses (owner_id, name, slug) values (auth.uid(), 'Sneaky', 'sneaky')
$$, '23514', null, 'customers cannot create businesses');
select throws_ok($$ select provider_payload from public.payments $$, '42501', null,
  'raw payment provider data is hidden from customers');
select is((select count(*)::int from public.payments), 1, 'a customer sees their own payment');
select lives_ok($$
  insert into public.messages (conversation_id, sender_id, body)
  select id, auth.uid(), 'Hello!' from public.conversations limit 1
$$, 'a customer can message the business after a confirmed booking');
select is((select count(*)::int from public.admin_actions), 0, 'customers cannot read the admin audit log');

-- ---------------------------------------------------------------------------
-- Customer Bayo (not part of the booking)
-- ---------------------------------------------------------------------------
reset role; select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.bookings), 0, 'customers cannot see other customers'' bookings');
select is((select count(*)::int from public.messages), 0, 'outsiders cannot read the chat');
select throws_ok($$
  insert into public.messages (conversation_id, sender_id, body)
  values ((select id from public.conversations where booking_id = '20000000-0000-0000-0000-000000000001'), auth.uid(), 'hi')
$$, '42501', null, 'outsiders cannot post into the chat');

-- ---------------------------------------------------------------------------
-- Business owner Chidi (approved business)
-- ---------------------------------------------------------------------------
reset role; select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.bookings), 1, 'a business sees bookings made with it');
select is((select count(*)::int from public.payments), 0, 'a business cannot read customer payment records');
select throws_ok($$
  update public.businesses set status = 'approved' where owner_id = auth.uid()
$$, '42501', null, 'a business cannot change its own approval status');
select throws_ok($$
  insert into public.messages (conversation_id, sender_id, body)
  select id, '00000000-0000-0000-0000-00000000000a', 'spoofed' from public.conversations limit 1
$$, '42501', null, 'nobody can send a message as someone else');
select is((select count(*)::int from public.messages), 1, 'the business reads the customer''s message');

-- ---------------------------------------------------------------------------
-- Business owner Dayo (draft business)
-- ---------------------------------------------------------------------------
reset role; select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select lives_ok($$
  insert into public.business_services (business_id, name, price_minor)
  values ('10000000-0000-0000-0000-000000000002', 'Haircut', 500000)
$$, 'a business can add services to its own profile');
select throws_ok($$
  insert into public.business_services (business_id, name, price_minor)
  values ('10000000-0000-0000-0000-000000000001', 'Hijack', 1)
$$, '42501', null, 'a business cannot add services to another business');
select is((select count(*)::int from public.bookings), 0, 'a business cannot see other businesses'' bookings');

-- ---------------------------------------------------------------------------
-- Admin Eve
-- ---------------------------------------------------------------------------
reset role; select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select is((select count(*)::int from public.businesses where id::text like '10000000-%'), 2,
  'admins see every business');
select is((select count(*)::int from public.admin_actions), 1, 'admins read the audit log');

select * from finish();
rollback;
