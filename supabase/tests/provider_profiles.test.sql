-- Public business profile figures. Run with `npm run db:test` on a freshly seeded database.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select ok(has_function_privilege('anon', 'public.get_business_stats(uuid)', 'execute'), 'visitors can read profile figures');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select results_eq(
  $$ select completed_bookings, min_price_minor, max_price_minor from public.get_business_stats('c0000000-0000-0000-0000-000000000007') $$,
  $$ values (1, 60000000::bigint, 110000000::bigint) $$,
  'an approved business shows its completed bookings and price range');
select is((select rating_breakdown from public.get_business_stats('c0000000-0000-0000-0000-000000000007')),
  array[0, 0, 0, 0, 1], 'the rating breakdown counts published reviews by stars');
select is_empty($$ select 1 from public.get_business_stats('c0000000-0000-0000-0000-000000000013') $$,
  'businesses awaiting approval have no public figures');
select is_empty($$ select 1 from public.get_business_stats('00000000-0000-0000-0000-000000000000') $$,
  'unknown businesses return nothing');
select ok((select bool_and(max_price_minor >= min_price_minor) from public.match_businesses(p_limit => 50)
           where min_price_minor is not null), 'price ranges run from low to high');

select * from finish();
rollback;
