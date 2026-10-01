-- Marketplace search and matching engine. Run with `npm run db:test` on a freshly seeded database.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

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

-- A Saturday at least a week away, so notice periods never get in the way.
create function pg_temp.saturday() returns date language sql as $$
  select (current_date + 7 + ((6 - extract(dow from current_date + 7)::int + 7) % 7))::date
$$;
grant execute on function pg_temp.saturday() to anon, authenticated;

-- Francis's example: a birthday photographer in Victoria Island on a Saturday, 100 guests, ₦300k.
create function pg_temp.example() returns setof text language sql as $$
  select slug from public.match_businesses(
    p_query => 'birthday', p_category => 'photography-video',
    p_state => 'Lagos', p_city => 'Lagos', p_area => 'Victoria Island',
    p_date => pg_temp.saturday(), p_guests => 100, p_budget_minor => 30000000)
$$;
grant execute on function pg_temp.example() to anon, authenticated;

select ok(has_function_privilege('anon', 'public.match_businesses(text, text, text, text, text, date, time, integer, bigint, bigint, text, integer, integer)', 'execute'),
  'visitors can search');
select hasnt_function('public', 'search_businesses', 'the old search path is gone');

select pg_temp.act_as(null);

-- ---------------------------------------------------------------------------
-- Eligibility
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.match_businesses(p_limit => 50) m
           join public.businesses b on b.id = m.id
           where b.status <> 'approved' or not b.is_verified or not b.accepting_bookings), 0,
  'only approved, verified businesses that accept bookings are returned');
select is_empty($$ select 1 from public.match_businesses('Pending Pixels') where slug = 'pending-pixels' $$,
  'businesses awaiting approval are never returned');
select is_empty($$ select 1 from public.match_businesses('Paused Photo') where slug = 'paused-photo-co' $$,
  'businesses that paused bookings are never returned');

-- ---------------------------------------------------------------------------
-- Francis's example
-- ---------------------------------------------------------------------------
select is((select array_agg(s) from pg_temp.example() s),
  array['snapshot-studios', 'frames-by-kemi', 'lens-and-light'],
  'the example ranks the available, in-area, in-budget studio first');
select results_eq($$
  select location_match, availability, within_budget, fits_guests
  from public.match_businesses(p_query => 'birthday', p_category => 'photography-video', p_state => 'Lagos',
    p_city => 'Lagos', p_area => 'Victoria Island', p_date => pg_temp.saturday(), p_guests => 100,
    p_budget_minor => 30000000)
  where slug = 'snapshot-studios' $$,
  $$ values ('area'::text, 'available'::text, true, true) $$,
  'the best match explains which needs it meets');
select results_eq($$
  select availability, availability_note, fits_guests
  from public.match_businesses(p_query => 'birthday', p_category => 'photography-video', p_state => 'Lagos',
    p_city => 'Lagos', p_area => 'Victoria Island', p_date => pg_temp.saturday(), p_guests => 100)
  where slug = 'frames-by-kemi' $$,
  $$ values ('unavailable'::text, 'Not working that day'::text, false) $$,
  'a weekday-only studio is flagged unavailable on a Saturday and too small for 100 guests');
select is((select location_match from public.match_businesses(p_category => 'photography-video',
            p_state => 'Lagos', p_city => 'Lagos', p_area => 'Victoria Island') where slug = 'lens-and-light'),
  'nearby', 'a business elsewhere in the state is a weaker, nearby match');
select is_empty($$ select 1 from public.match_businesses(p_category => 'photography-video', p_state => 'FCT',
    p_city => 'Abuja', p_area => 'Wuse') $$,
  'businesses in another state are never matched');

-- ---------------------------------------------------------------------------
-- Owners and price filters
-- ---------------------------------------------------------------------------
reset role;
update public.users set status = 'suspended' where id = 'b0000000-0000-0000-0000-000000000010';
select pg_temp.act_as(null);
select is_empty($$ select 1 from public.match_businesses('Snapshot') where slug = 'snapshot-studios' $$,
  'a business whose owner is suspended is never returned');
reset role;
update public.users set status = 'active' where id = 'b0000000-0000-0000-0000-000000000010';
update public.businesses set status = 'suspended' where id = 'c0000000-0000-0000-0000-000000000010';
select pg_temp.act_as(null);
select is_empty($$ select 1 from public.match_businesses('Snapshot') where slug = 'snapshot-studios' $$,
  'a suspended business is never returned');

select is((select count(*)::int from public.match_businesses(p_category => 'photography-video', p_max_price_minor => 30000000)
           where min_price_minor > 30000000), 0,
  'the price filter removes businesses above it');
select ok((select bool_and(score between 0 and 100) from public.match_businesses(p_limit => 50)),
  'scores stay between 0 and 100');

select * from finish();
rollback;
