-- Payment system: the commission split, payout bank accounts and webhook storage. Run on a fresh `supabase db reset`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- Seed: Tolu (customer), Lens & Light (no bank account), Sparkle Home Cleaning (bank account on file).
create temp table ids as
select
  'a0000000-0000-0000-0000-000000000002'::uuid as customer,
  'c0000000-0000-0000-0000-000000000007'::uuid as business,
  'c0000000-0000-0000-0000-000000000004'::uuid as other_business,
  (select owner_id from public.businesses where id = 'c0000000-0000-0000-0000-000000000004') as sparkle_owner,
  (select owner_id from public.businesses where id = 'c0000000-0000-0000-0000-000000000007') as lens_owner,
  (select s.id from public.business_services s
   where s.business_id = 'c0000000-0000-0000-0000-000000000007' and not s.is_addon limit 1) as service;
grant select on ids to authenticated;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end;
$$;
grant execute on function pg_temp.act_as(uuid) to authenticated;

-- A booking at a 12.5% commission, waiting for payment.
create temp table made as
select * from public.create_booking(
  (select jsonb_build_object(
    'customer_id', customer, 'business_id', business,
    'scheduled_start', now() + interval '10 days', 'scheduled_end', now() + interval '10 days 3 hours',
    'city', 'Lagos', 'state', 'Lagos', 'subtotal_minor', 1000001, 'platform_fee_minor', 0,
    'total_minor', 1000001, 'commission_rate_bps', 1250) from ids),
  (select jsonb_build_array(jsonb_build_object('service_id', service, 'name', 'Portrait session',
    'unit_price_minor', 1000001, 'quantity', 1, 'kind', 'service')) from ids)
);
grant select on made to authenticated;
update public.bookings set status = 'accepted' where id = (select id from made);
update public.bookings set status = 'payment_pending' where id = (select id from made);

-- ---------------------------------------------------------------------------
-- The split is worked out by the database from the booking
-- ---------------------------------------------------------------------------

-- The caller tries to claim a different business and a zero fee; the database ignores both.
insert into public.payments (booking_id, payer_id, business_id, commission_rate_bps, provider, reference,
  amount_minor, platform_fee_minor, provider_amount_minor)
select (select id from made), customer, other_business, 0, 'mock', 'PAY-SPLIT', 1000001, 0, 1000001 from ids;

select is((select business_id from public.payments where reference = 'PAY-SPLIT'),
  (select business from ids), 'a payment is always for the booking''s business');
select is((select commission_rate_bps from public.payments where reference = 'PAY-SPLIT'), 1250,
  'a payment takes the booking''s commission rate');
select is((select platform_fee_minor from public.payments where reference = 'PAY-SPLIT'), 125000::bigint,
  'the platform fee is the commission on the amount, rounded to the kobo');
select is((select provider_amount_minor from public.payments where reference = 'PAY-SPLIT'), 875001::bigint,
  'the business gets the amount less the platform fee');

select throws_ok($$ update public.payments set amount_minor = 5 where reference = 'PAY-SPLIT' $$,
  '23514', null, 'a payment''s amount cannot change');
select throws_ok($$ update public.payments set commission_rate_bps = 0 where reference = 'PAY-SPLIT' $$,
  '23514', null, 'a payment''s commission cannot change');
select throws_ok($$ update public.payments set business_id = 'c0000000-0000-0000-0000-000000000004' where reference = 'PAY-SPLIT' $$,
  '23514', null, 'a payment cannot be moved to another business');
update public.payments set status = 'success', paid_at = now(), platform_fee_minor = 0 where reference = 'PAY-SPLIT';
select is((select platform_fee_minor from public.payments where reference = 'PAY-SPLIT'), 125000::bigint,
  'the fee is recomputed on every change, so it can''t be zeroed');

select pg_temp.act_as((select customer from ids));
select is((select provider_amount_minor from public.payments where reference = 'PAY-SPLIT'), 875001::bigint,
  'the customer can see how their payment is split');
reset role;

-- ---------------------------------------------------------------------------
-- Bank accounts for payouts
-- ---------------------------------------------------------------------------

select pg_temp.act_as((select sparkle_owner from ids));
select is((select count(*)::int from public.business_payout_accounts), 1, 'a business sees its own bank account');
select throws_ok($$ select recipient_code from public.business_payout_accounts $$, '42501', null,
  'the provider''s recipient code is never sent to the browser');
select throws_ok($$
  update public.business_payout_accounts set account_number = '9999999999'
$$, '42501', null, 'a business cannot change its bank account directly (server verifies it)');
reset role;

select pg_temp.act_as((select lens_owner from ids));
select is((select count(*)::int from public.business_payout_accounts), 0, 'a business cannot see another''s bank account');
select throws_ok($$
  insert into public.business_payout_accounts (business_id, provider, bank_code, bank_name, account_number, account_name)
  values ('c0000000-0000-0000-0000-000000000007', 'mock', '058', 'GTBank', '0123456789', 'Anyone')
$$, '42501', null, 'a business cannot save an unverified bank account');
reset role;

select pg_temp.act_as((select customer from ids));
select is((select count(*)::int from public.business_payout_accounts), 0, 'customers see no bank accounts');
select throws_ok($$ select * from public.payment_webhook_events $$, '42501', null, 'webhook records are server only');
select throws_ok($$ select public.current_commission_rate_bps('c0000000-0000-0000-0000-000000000007') $$, '42501', null,
  'only the server reads the commission rate for a new booking');
reset role;

-- ---------------------------------------------------------------------------
-- No hard-coded commission
-- ---------------------------------------------------------------------------

delete from public.platform_settings where key = 'default_commission_rate_bps';
update public.businesses set commission_rate_bps = null where id = (select business from ids);
select throws_ok($$ select public.current_commission_rate_bps('c0000000-0000-0000-0000-000000000007') $$, '23514', null,
  'without a commission set by an admin, new bookings are refused rather than using a built-in rate');

select * from finish();
rollback;
