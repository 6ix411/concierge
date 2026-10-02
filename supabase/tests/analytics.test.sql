-- Stage 18: anonymous analytics events and the reports built from them. Run on a fresh `supabase db reset`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

create temp table ids as
select
  'c0000000-0000-0000-0000-000000000011'::uuid as frames,
  'b0000000-0000-0000-0000-000000000011'::uuid as frames_owner,
  'c0000000-0000-0000-0000-000000000007'::uuid as lens,
  'b0000000-0000-0000-0000-000000000007'::uuid as lens_owner,
  (select id from public.service_categories where slug = 'photography-video') as photography;
grant select on ids to authenticated, anon;

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
-- What is stored
-- ---------------------------------------------------------------------------

select hasnt_column('public', 'analytics_events', 'user_id', 'events record no user');
select hasnt_column('public', 'analytics_events', 'ip_address', 'no IP address');
select hasnt_column('public', 'analytics_events', 'query', 'and none of the words a customer typed');
select throws_ok($$ insert into public.analytics_events (event_type, source, business_id) select 'search', 'search', frames from ids $$,
  '23514', null, 'a search is never tied to a business');
select throws_ok($$ insert into public.analytics_events (event_type, source) values ('profile_view', 'profile') $$,
  '23514', null, 'a profile view always is');

insert into public.analytics_events (event_type, source, category_id, state, city, result_count)
select 'search'::public.analytics_event_type, 'search', photography, 'Lagos', 'Lagos', 2 from ids
union all select 'search', 'concierge', photography, 'Lagos', 'Lagos', 1 from ids
union all select 'search', 'search', null, null, null, 0 from ids;
insert into public.analytics_events (event_type, source, business_id, category_id, state, city)
select 'provider_match'::public.analytics_event_type, 'search', frames, photography, 'Lagos', 'Lagos' from ids
union all select 'provider_match', 'search', lens, photography, 'Lagos', 'Lagos' from ids
union all select 'provider_match', 'concierge', frames, photography, 'Lagos', 'Lagos' from ids;
insert into public.analytics_events (event_type, source, business_id)
select 'profile_view'::public.analytics_event_type, 'profile', frames from ids, generate_series(1, 4);

-- ---------------------------------------------------------------------------
-- Nobody reads or writes events through the API
-- ---------------------------------------------------------------------------

select pg_temp.act_as(null);
select throws_ok($$ select count(*) from public.analytics_events $$, '42501', null, 'visitors cannot read events');
select throws_ok($$ insert into public.analytics_events (event_type, source, business_id) select 'profile_view', 'profile', frames from ids $$,
  '42501', null, 'or add fake views');
reset role;
select pg_temp.act_as((select frames_owner from ids));
select throws_ok($$ select count(*) from public.analytics_events $$, '42501', null, 'businesses cannot read raw events');
select throws_ok($$ select public.get_business_analytics((select frames from ids), now() - interval '1 day', 'infinity') $$,
  '42501', null, 'their numbers come through the server, after an ownership check');
select throws_ok($$ select public.get_platform_analytics(now() - interval '1 day', 'infinity') $$, '42501', null,
  'and platform analytics are admin only');
reset role;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

create temp table report as select public.get_platform_analytics(now() - interval '1 day', 'infinity') as r;
select is((select (r ->> 'searches')::int from report), 3, 'searches are counted');
select is((select (r ->> 'concierge_searches')::int from report), 1, 'including the concierge''s');
select is((select (r ->> 'searches_with_results')::int from report), 2, 'and how many found someone');
select is((select (r ->> 'provider_matches')::int from report), 3, 'every provider shown is a match');
select is((select (r ->> 'providers_matched')::int from report), 2, 'across two providers');
select is((select (r ->> 'profile_views')::int from report), 4, 'profile views are counted');
select is(
  (select r -> 'categories' -> 0 ->> 'slug' from report), 'events',
  'photography rolls up into its main category');
select ok(
  (select (r -> 'locations') @> '[{"state": "Lagos", "city": "Lagos", "searches": 2}]' from report),
  'popular locations count searches by the place the platform recognised');

select results_eq(
  $$ select profile_views, search_appearances from public.get_business_analytics((select frames from ids), now() - interval '1 day', 'infinity') $$,
  $$ values (4, 2) $$, 'a business sees its own views and search appearances');

select ok(public.prune_analytics_events() >= 0 and (select count(*) from cron.job where jobname = 'analytics-retention') = 1,
  'old events are deleted on a schedule');

select * from finish();
rollback;
