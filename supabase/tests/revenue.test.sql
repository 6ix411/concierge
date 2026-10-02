-- Stage 17: plans, featured placement, the booking fee and business payments. Run on a fresh `supabase db reset`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

create temp table ids as
select
  'c0000000-0000-0000-0000-000000000011'::uuid as frames,
  'b0000000-0000-0000-0000-000000000011'::uuid as frames_owner,
  'c0000000-0000-0000-0000-000000000010'::uuid as snapshot,
  'c0000000-0000-0000-0000-000000000007'::uuid as lens,
  'b0000000-0000-0000-0000-000000000007'::uuid as lens_owner,
  'c0000000-0000-0000-0000-000000000013'::uuid as pending_biz,
  'b0000000-0000-0000-0000-000000000013'::uuid as pending_owner,
  'a0000000-0000-0000-0000-000000000002'::uuid as customer,
  (select s.id from public.business_services s
   where s.business_id = 'c0000000-0000-0000-0000-000000000007' and not s.is_addon limit 1) as lens_service;
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

-- A paid charge, completed as the payment provider's verification would.
create function pg_temp.pay(p_business uuid, p_payer uuid, p_kind text, p_code text, p_ref text) returns jsonb
language plpgsql as $$
begin
  insert into public.business_charges (business_id, payer_id, kind, item_code, reference, provider, amount_minor)
  values (p_business, p_payer, p_kind, p_code, p_ref, 'mock', 1);
  return public.complete_business_charge(p_ref, now(), 'MOCK', 'card', '{}');
end;
$$;

-- ---------------------------------------------------------------------------
-- Plans and prices
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select code, monthly_price_minor from public.subscription_plans order by sort_order $$,
  $$ values ('free', 0::bigint), ('starter', 2500000::bigint), ('growth', 5000000::bigint), ('pro', 10000000::bigint) $$,
  'Free, Starter ₦25,000, Growth ₦50,000 and Pro ₦100,000 a month');
select throws_ok($$ update public.subscription_plans set monthly_price_minor = 100 where code = 'free' $$, '23514', null,
  'Free is always free');
select lives_ok($$ update public.subscription_plans set monthly_price_minor = 3000000 where code = 'starter' $$,
  'admins can change prices (through the server)');

select pg_temp.act_as(null);
select is((select count(*)::int from public.subscription_plans), 4, 'visitors can see the plans');
select throws_ok($$ select commission_rate_bps from public.subscription_plans $$, '42501', null,
  'but not their commission settings');
select throws_ok($$ update public.subscription_plans set monthly_price_minor = 1 $$, '42501', null,
  'and nobody changes prices through the API');
reset role;

-- ---------------------------------------------------------------------------
-- Business payments
-- ---------------------------------------------------------------------------

select pg_temp.act_as((select frames_owner from ids));
select throws_ok($$ insert into public.business_charges (business_id, payer_id, kind, item_code, reference, provider, amount_minor)
  select frames, frames_owner, 'subscription', 'pro', 'CHG-0000000000000001', 'mock', 1 from ids $$, '42501', null,
  'businesses cannot create charges themselves');
select throws_ok($$ select public.complete_business_charge('CHG-0000000000000001', now(), 'x', 'x', '{}') $$, '42501', null,
  'or mark one paid');
reset role;

insert into public.business_charges (business_id, payer_id, kind, item_code, reference, provider, amount_minor)
select frames, frames_owner, 'subscription', 'starter', 'CHG-00000000000000A1', 'mock', 1 from ids;
select is((select amount_minor from public.business_charges where reference = 'CHG-00000000000000A1'), 3000000::bigint,
  'the price always comes from the plan, never the caller');
select throws_ok($$ update public.business_charges set amount_minor = 1 where reference = 'CHG-00000000000000A1' $$,
  '23514', null, 'and cannot be changed');
select throws_ok($$ insert into public.business_charges (business_id, payer_id, kind, item_code, reference, provider, amount_minor)
  select frames, lens_owner, 'subscription', 'starter', 'CHG-00000000000000A2', 'mock', 1 from ids $$, '23514', null,
  'only the owner pays for a business');
select throws_ok($$ insert into public.business_charges (business_id, payer_id, kind, item_code, reference, provider, amount_minor)
  select pending_biz, pending_owner, 'featured', 'week', 'CHG-00000000000000A3', 'mock', 1 from ids $$, '23514', null,
  'a business must be approved to pay for anything');
select throws_ok($$ insert into public.business_charges (business_id, payer_id, kind, item_code, reference, provider, amount_minor)
  select frames, frames_owner, 'subscription', 'free', 'CHG-00000000000000A4', 'mock', 1 from ids $$, '23514', null,
  'there is nothing to pay for Free');

-- ---------------------------------------------------------------------------
-- Subscriptions
-- ---------------------------------------------------------------------------

select is(public.current_plan_code((select frames from ids)), 'free', 'businesses start on Free');
select is((public.complete_business_charge('CHG-00000000000000A1', now(), 'MOCK', 'card', '{}') ->> 'activated')::boolean, true,
  'a verified payment switches the plan on');
select is(public.current_plan_code((select frames from ids)), 'starter', 'the business is now on Starter');
select is((public.complete_business_charge('CHG-00000000000000A1', now(), 'MOCK', 'card', '{}') ->> 'activated')::boolean, false,
  'completing the same payment again does nothing');
select is((select count(*)::int from public.business_subscriptions where business_id = (select frames from ids)), 1,
  'one month for one payment');

select pg_temp.pay(frames, frames_owner, 'subscription', 'starter', 'CHG-00000000000000A5') from ids;
select ok(
  (select bool_and(period_start = lag_end) from (
     select period_start, lag(period_end) over (order by period_start) as lag_end
     from public.business_subscriptions where business_id = (select frames from ids)) x where lag_end is not null),
  'renewing adds the next month after the current one');
select pg_temp.pay(frames, frames_owner, 'subscription', 'pro', 'CHG-00000000000000A6') from ids;
select is(public.current_plan_code((select frames from ids)), 'pro', 'a different plan starts straight away');
select is((select count(*)::int from public.business_subscriptions where business_id = (select frames from ids) and status = 'replaced'), 2,
  'and replaces what was left of the old one');

-- Commission: the business's custom rate, then its plan's, then the platform's.
update public.subscription_plans set commission_rate_bps = 700 where code = 'pro';
select is(public.current_commission_rate_bps((select frames from ids)), 700, 'a plan can set its own commission');
select is(public.current_commission_rate_bps((select snapshot from ids)), 1000, 'others pay the platform rate');
update public.businesses set commission_rate_bps = 500 where id = (select frames from ids);
select is(public.current_commission_rate_bps((select frames from ids)), 500, 'a custom rate wins over the plan');
update public.businesses set commission_rate_bps = null where id = (select frames from ids);

-- Access
select pg_temp.act_as((select frames_owner from ids));
select is((select count(*)::int from public.business_charges), 3, 'owners see their own payments');
select is((select count(*)::int from public.business_subscriptions), 3, 'and their own plan history');
reset role;
select pg_temp.act_as((select lens_owner from ids));
select is((select count(*)::int from public.business_charges) + (select count(*)::int from public.business_subscriptions), 0,
  'other businesses see none of it');
select throws_ok($$ select provider_payload from public.business_charges $$, '42501', null, 'provider details stay private');
select throws_ok($$ select public.get_revenue_summary(now() - interval '1 day', now()) $$, '42501', null,
  'revenue figures are server only');
reset role;

-- ---------------------------------------------------------------------------
-- Featured placement never beats the matching rules
-- ---------------------------------------------------------------------------

select pg_temp.pay(frames, frames_owner, 'featured', 'week', 'CHG-00000000000000B1') from ids;
select pg_temp.pay(lens, lens_owner, 'featured', 'month', 'CHG-00000000000000B2') from ids;
insert into public.featured_placements (business_id, package_code, price_minor, starts_at, ends_at)
select pending_biz, 'week', 0, now() - interval '1 hour', now() + interval '7 days' from ids;

select is(
  (select array_agg(name order by ord) from (
     select name, row_number() over () as ord
     from public.match_businesses(p_query => 'photographer', p_state => 'Lagos', p_area => 'Victoria Island')) m),
  array['Frames by Kemi', 'Snapshot Studios', 'Lens & Light Photography'],
  'a featured provider that meets every requirement is shown first');
select is(
  (select is_featured from public.match_businesses(p_query => 'photographer', p_state => 'Lagos', p_area => 'Victoria Island')
   where name = 'Lens & Light Photography'),
  false, 'a featured provider outside the area gets no lift');
select ok(
  (select bool_and(not is_featured) from public.match_businesses(p_query => 'photographer', p_state => 'Lagos',
     p_area => 'Victoria Island', p_budget_minor => 5000000)),
  'or one over the customer''s budget');
select is((select count(*)::int from public.match_businesses(p_query => 'pixels photographer') where name ilike '%pending%'), 0,
  'paying never makes an unapproved business appear');
select ok((select bool_and(not is_featured) from public.match_businesses(p_query => 'photographer', p_sort => 'rating')),
  'sorting by rating or price ignores placement');
select is(
  (select score from public.match_businesses(p_query => 'photographer', p_state => 'Lagos', p_area => 'Victoria Island')
   where name = 'Frames by Kemi'),
  (select score from public.match_businesses(p_query => 'photographer', p_state => 'Lagos', p_area => 'Victoria Island', p_sort => 'rating')
   where name = 'Frames by Kemi'),
  'placement never changes the match score');
update public.platform_settings set value = '0' where key = 'featured_slots';
select ok((select bool_and(not is_featured) from public.match_businesses(p_query => 'photographer')),
  'admins can turn featured slots off');

-- ---------------------------------------------------------------------------
-- Customer booking fee: all to the platform, no commission on it
-- ---------------------------------------------------------------------------

create temp table made as
select * from public.create_booking(
  (select jsonb_build_object(
    'customer_id', customer, 'business_id', lens,
    'scheduled_start', now() + interval '10 days', 'scheduled_end', now() + interval '10 days 3 hours',
    'city', 'Lagos', 'state', 'Lagos', 'subtotal_minor', 10000000, 'platform_fee_minor', 250000,
    'total_minor', 10250000, 'commission_rate_bps', 1000) from ids),
  (select jsonb_build_array(jsonb_build_object('service_id', lens_service, 'name', 'Portrait session',
    'unit_price_minor', 10000000, 'quantity', 1, 'kind', 'service')) from ids)
);
insert into public.payments (booking_id, payer_id, provider, reference, amount_minor, status)
select (select id from made), customer, 'mock', 'PAY-00000000000000F1', 10250000, 'pending' from ids;
select results_eq(
  $$ select booking_fee_minor, platform_fee_minor, provider_amount_minor from public.payments where reference = 'PAY-00000000000000F1' $$,
  $$ values (250000::bigint, 1250000::bigint, 9000000::bigint) $$,
  'the platform keeps the ₦2,500 fee plus 10% of the ₦100,000 service; the business gets ₦90,000');

-- ---------------------------------------------------------------------------
-- Reminders
-- ---------------------------------------------------------------------------

update public.business_subscriptions set period_end = now() + interval '2 days'
where business_id = (select frames from ids) and status = 'active';
select ok(public.queue_billing_reminders() >= 1, 'owners are reminded before a plan ends');
select is((select count(*)::int from cron.job where jobname = 'billing-reminders'), 1, 'reminders run on a schedule');

select * from finish();
rollback;
