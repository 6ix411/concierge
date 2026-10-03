-- Stage 20: a booking can't be made twice, and the same slot can't be booked twice. Run on a fresh `supabase db reset`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create temp table ids as
select
  'a0000000-0000-0000-0000-000000000002'::uuid as customer,
  'a0000000-0000-0000-0000-000000000003'::uuid as other_customer,
  'c0000000-0000-0000-0000-000000000007'::uuid as business,
  'b1111111-1111-4111-8111-111111111111'::uuid as key,
  date_trunc('hour', now() + interval '20 days') as starts;

create function pg_temp.book(p_customer uuid, p_key uuid, p_start timestamptz)
returns table (id uuid, reference text, created boolean) language sql as $$
  select * from public.create_booking(
    jsonb_build_object(
      'customer_id', p_customer, 'business_id', (select business from ids), 'request_key', p_key,
      'scheduled_start', p_start, 'scheduled_end', p_start + interval '2 hours',
      'city', 'Lagos', 'state', 'Lagos', 'subtotal_minor', 5000000, 'platform_fee_minor', 0,
      'total_minor', 5000000, 'commission_rate_bps', 1000),
    '[]'::jsonb);
$$;

create temp table first_try as select * from pg_temp.book((select customer from ids), (select key from ids), (select starts from ids));
select is((select created from first_try), true, 'the first submission makes a booking');

create temp table retry as select * from pg_temp.book((select customer from ids), (select key from ids), (select starts from ids));
select is((select created from retry), false, 'sending the same submission again makes nothing new');
select is((select id from retry), (select id from first_try), 'and returns the booking already made');
select is((select count(*)::int from public.bookings where request_key = (select key from ids)), 1, 'one booking for one submission');

select throws_ok(
  $$ select * from pg_temp.book((select customer from ids), gen_random_uuid(), (select starts from ids)) $$,
  '23505', 'You already have a booking with this business at that time.',
  'a new submission for the same business and time is refused');
select lives_ok(
  $$ select * from pg_temp.book((select other_customer from ids), gen_random_uuid(), (select starts from ids)) $$,
  'another customer can still ask for that time (the business decides)');
select lives_ok(
  $$ select * from pg_temp.book((select customer from ids), gen_random_uuid(), (select starts from ids) + interval '3 hours') $$,
  'and the same customer can book another time');

-- Once the first booking is cancelled, the slot is free again.
update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = (select customer from ids), change_actor_id = (select customer from ids)
where id = (select id from first_try);
select lives_ok(
  $$ select * from pg_temp.book((select customer from ids), gen_random_uuid(), (select starts from ids)) $$,
  'a cancelled booking frees the slot');

select ok(not has_column_privilege('authenticated', 'public.payments', 'checkout_url', 'select'),
  'checkout links stay on the server');

-- Payments: one counted payment per booking; a second one is only ever recorded as a duplicate.
insert into public.payments (booking_id, payer_id, provider, reference, amount_minor, status, paid_at)
select id, (select customer from ids), 'mock', 'PAY-00000000000000D1', 5000000, 'success', now() from first_try;
select throws_ok(
  $$ insert into public.payments (booking_id, payer_id, provider, reference, amount_minor, status, paid_at)
     select id, (select customer from ids), 'mock', 'PAY-00000000000000D2', 5000000, 'success', now() from first_try $$,
  '23505', null, 'a booking can''t have two counted payments');
select lives_ok(
  $$ insert into public.payments (booking_id, payer_id, provider, reference, amount_minor, status, paid_at, duplicate)
     select id, (select customer from ids), 'mock', 'PAY-00000000000000D3', 5000000, 'success', now(), true from first_try $$,
  'a second payment can be recorded as a duplicate (to refund it)');

select * from finish();
rollback;
