-- Stage 22: the core product rules the database enforces on its own (docs/product-rules.md).
-- Run on a fresh `supabase db reset`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- Tolu books Lens & Light Photography (owner b...07).
create temp table ids as
select
  'a0000000-0000-0000-0000-000000000002'::uuid as customer,
  'a0000000-0000-0000-0000-000000000003'::uuid as other_customer,
  'c0000000-0000-0000-0000-000000000007'::uuid as business,
  'b0000000-0000-0000-0000-000000000007'::uuid as owner,
  'c0000000-0000-0000-0000-000000000009'::uuid as unverified,
  date_trunc('hour', now() + interval '25 days') as starts;
grant select on ids to authenticated, anon;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  if uid is null then
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  end if;
end;
$$;
grant execute on function pg_temp.act_as(uuid) to anon, authenticated;

create function pg_temp.book(p_business uuid) returns uuid language sql as $$
  select id from public.create_booking(
    jsonb_build_object(
      'customer_id', (select customer from ids), 'business_id', p_business, 'request_key', gen_random_uuid(),
      'scheduled_start', (select starts from ids), 'scheduled_end', (select starts from ids) + interval '2 hours',
      'address_line', '12 Admiralty Way', 'area', 'Lekki Phase 1', 'city', 'Lagos', 'state', 'Lagos',
      'subtotal_minor', 5000000, 'platform_fee_minor', 0, 'total_minor', 5000000, 'commission_rate_bps', 1000),
    '[]'::jsonb);
$$;

-- ---------------------------------------------------------------------------
-- Rules 1 and 2: only approved businesses with an active owner take bookings
-- ---------------------------------------------------------------------------
select throws_ok($$ select pg_temp.book((select unverified from ids)) $$,
  '23514', 'This business isn''t taking bookings right now.', 'an unapproved business can''t be booked');

update public.users set status = 'suspended' where id = (select owner from ids);
select throws_ok($$ select pg_temp.book((select business from ids)) $$,
  '23514', 'This business isn''t taking bookings right now.', 'a business whose owner is suspended can''t be booked');
update public.users set status = 'active' where id = (select owner from ids);

create temp table booking as select pg_temp.book((select business from ids)) as id;
grant select on booking to authenticated;
select isnt((select id from booking), null, 'an approved business with an active owner can be booked');

-- ---------------------------------------------------------------------------
-- Rule 10: the business doesn't get the customer's private details by default
-- ---------------------------------------------------------------------------
select ok(not has_column_privilege('authenticated', 'public.bookings', 'address_line', 'select'),
  'no client reads the street address column directly');

select pg_temp.act_as((select customer from ids));
select is(public.booking_address((select id from booking)), '12 Admiralty Way', 'the customer sees their own address');

select pg_temp.act_as((select owner from ids));
select is((select area from public.bookings where id = (select id from booking)), 'Lekki Phase 1',
  'the business sees the area, to decide whether to take the job');
select is(public.booking_address((select id from booking)), null, 'but not the street address before payment');
select is((select count(*)::int from public.users where id = (select customer from ids)), 0,
  'and never the customer''s account row (email, phone)');

select pg_temp.act_as(null);
update public.bookings set status = 'accepted', change_actor_id = (select owner from ids) where id = (select id from booking);
select pg_temp.act_as((select owner from ids));
select is(public.booking_address((select id from booking)), null, 'nor once the business has accepted but nobody has paid');

select pg_temp.act_as(null);
update public.bookings set status = 'payment_pending', change_actor_id = (select customer from ids) where id = (select id from booking);
update public.bookings set status = 'confirmed' where id = (select id from booking);

select pg_temp.act_as((select owner from ids));
select is(public.booking_address((select id from booking)), '12 Admiralty Way',
  'the business sees the street address once the booking is confirmed');

select pg_temp.act_as((select other_customer from ids));
select is(public.booking_address((select id from booking)), null, 'nobody else ever sees it');

-- ---------------------------------------------------------------------------
-- Rule 8: chat messages sharing contact details are marked for the team
-- ---------------------------------------------------------------------------
select pg_temp.act_as(null);
create temp table convo as
select id from public.conversations where booking_id = (select id from booking);
insert into convo
select id from public.conversations where status = 'open' and booking_id is not null
  and not exists (select 1 from convo) limit 1;
grant select on convo to authenticated;

select ok(public.shares_contact_details('call me on 0803 123 4567'), 'a Nigerian phone number counts as contact details');
select ok(not public.shares_contact_details('See you at 10am with 4 lights'), 'an ordinary message doesn''t');

insert into public.messages (conversation_id, sender_id, body)
select c.id, c.customer_id, 'WhatsApp me on +234 803 123 4567'
from public.conversations c where c.id = (select id from convo limit 1);
select is(
  (select shares_contact from public.messages where conversation_id = (select id from convo limit 1)
   order by created_at desc limit 1),
  true, 'the database marks a message that shares a phone number');
select ok(not has_column_privilege('authenticated', 'public.messages', 'shares_contact', 'select'),
  'the mark is for the Concierge team only');

select * from finish();
rollback;
