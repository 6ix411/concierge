-- Admin dashboard rules. Run with `npm run db:test`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

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

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin-test@test.ng', '{"role":"customer"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'cust-test@test.ng', '{"role":"customer"}');
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1';

-- ---------------------------------------------------------------------------
-- Statistics are server-only, even for admins signed in from the browser
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.admin_dashboard_stats(integer)', 'execute'),
  'visitors cannot read the admin statistics');
select ok(not has_function_privilege('authenticated', 'public.admin_dashboard_stats(integer)', 'execute'),
  'signed-in users (admins included) cannot call the statistics directly');
select ok(has_function_privilege('service_role', 'public.admin_dashboard_stats(integer)', 'execute'),
  'the server can read the statistics');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok('select public.admin_dashboard_stats()', '42501', null,
  'an admin session from the browser is refused');
reset role;

select is(
  (public.admin_dashboard_stats() ->> 'customers')::int,
  (select count(*)::int from public.users where role = 'customer'),
  'counts customers');
select is(
  jsonb_array_length(public.admin_dashboard_stats() -> 'monthly'), 6,
  'returns six months of revenue');
select ok(
  jsonb_array_length(public.admin_dashboard_stats(3) -> 'top_businesses') <= 3,
  'limits the ranked lists');

-- ---------------------------------------------------------------------------
-- Disputes
-- ---------------------------------------------------------------------------
select ok(public.is_valid_booking_transition('disputed', 'confirmed'),
  'a dismissed dispute can return a booking to confirmed');
select ok(public.is_valid_booking_transition('disputed', 'in_progress'),
  'a dismissed dispute can return a booking to in progress');
select ok(not public.is_valid_booking_transition('disputed', 'requested'),
  'a disputed booking cannot go back to a request');

select throws_ok($$
  insert into public.disputes (booking_id, opened_by, reason, status, resolved_at)
  select id, customer_id, 'Test', 'resolved', now() from public.bookings limit 1
$$, '23514', null, 'a closed dispute must record its outcome');

-- Clients can't write disputes; the server opens them after checking the user.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$
  insert into public.disputes (booking_id, opened_by, reason)
  select id, '00000000-0000-0000-0000-0000000000a2', 'Test' from public.bookings limit 1
$$, '42501', null, 'customers cannot insert disputes directly');
reset role;

select * from finish();
rollback;
