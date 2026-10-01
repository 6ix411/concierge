-- Booking engine: the workflow, booking creation and the booking history. Run on a fresh `supabase db reset`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- Seed: Ada (customer), Lens & Light (approved, owned by the demo owner).
create temp table ids as
select
  'a0000000-0000-0000-0000-000000000002'::uuid as customer,
  'a0000000-0000-0000-0000-000000000003'::uuid as other_customer,
  b.id as business, b.owner_id as owner,
  (select s.id from public.business_services s where s.business_id = b.id and not s.is_addon limit 1) as service
from public.businesses b where b.id = 'c0000000-0000-0000-0000-000000000007';
grant select on ids to authenticated;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end;
$$;
grant execute on function pg_temp.act_as(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Creating a booking
-- ---------------------------------------------------------------------------

create temp table made as
select * from public.create_booking(
  (select jsonb_build_object(
    'customer_id', customer, 'business_id', business,
    'scheduled_start', now() + interval '10 days', 'scheduled_end', now() + interval '10 days 3 hours',
    'address_line', '1 Admiralty Way', 'area', 'Lekki', 'city', 'Lagos', 'state', 'Lagos', 'guests', 120,
    'customer_notes', 'Outdoor ceremony', 'subtotal_minor', 60000000, 'platform_fee_minor', 0,
    'total_minor', 60000000, 'commission_rate_bps', 1000) from ids),
  (select jsonb_build_array(jsonb_build_object('service_id', service, 'name', 'Wedding coverage',
    'unit_price_minor', 60000000, 'quantity', 1, 'kind', 'package')) from ids)
);
grant select on made to authenticated;

select is((select count(*)::int from made), 1, 'create_booking returns the new booking');
select matches((select reference from made), '^BK-[0-9A-F]{10}$', 'every booking gets a unique reference');
select is((select status::text from public.bookings where id = (select id from made)), 'pending_provider',
  'a new booking goes straight to the business');
select is((select kind from public.booking_items where booking_id = (select id from made)), 'package',
  'booking items remember whether they were a service, package or add-on');
select is((select area || ', ' || city || ' · ' || guests from public.bookings where id = (select id from made)),
  'Lekki, Lagos · 120', 'area, city and guests are stored');
select results_eq(
  $$ select event || ':' || coalesce(from_status::text, '-') || '>' || to_status || ':' || actor_role
     from public.booking_events where booking_id = (select id from made) order by created_at $$,
  $$ values ('created:->requested:customer'), ('status_changed:requested>pending_provider:system') $$,
  'creation is recorded as requested, then pending provider');
select is((select change_actor_id from public.bookings where id = (select id from made)), null,
  'change actor is never stored on the booking');

select throws_ok($$ select * from public.create_booking('{}', '[]') $$, null, null,
  'create_booking rejects an incomplete booking');
select ok(not has_function_privilege('authenticated', 'public.create_booking(jsonb, jsonb)', 'execute'),
  'only the server can call create_booking');
select throws_ok(
  $$ insert into public.bookings (customer_id, business_id, status) select customer, business, 'pending_provider' from ids $$,
  '23514', null, 'bookings must start as requested');

-- ---------------------------------------------------------------------------
-- The workflow
-- ---------------------------------------------------------------------------

select throws_ok($$ update public.bookings set status = 'confirmed' where id = (select id from made) $$,
  '23514', null, 'a booking cannot be confirmed before the business accepts and payment starts');
update public.bookings set status = 'accepted', change_actor_id = (select owner from ids) where id = (select id from made);
select throws_ok($$ update public.bookings set status = 'confirmed' where id = (select id from made) $$,
  '23514', null, 'confirmation needs payment_pending first');
update public.bookings set status = 'payment_pending', change_actor_id = (select customer from ids) where id = (select id from made);
update public.bookings set status = 'confirmed' where id = (select id from made);
update public.bookings set scheduled_start = scheduled_start + interval '1 hour', scheduled_end = scheduled_end + interval '1 hour',
  change_actor_id = (select owner from ids), change_note = 'Moved after a call' where id = (select id from made);
update public.bookings set status = 'in_progress', change_actor_id = (select owner from ids) where id = (select id from made);
update public.bookings set status = 'completed', change_actor_id = (select owner from ids) where id = (select id from made);
insert into public.reviews (booking_id, customer_id, business_id, rating)
select id, (select customer from ids), (select business from ids), 5 from made;

select is((select status::text from public.bookings where id = (select id from made)), 'reviewed',
  'leaving a review moves the booking to reviewed');
select results_eq(
  $$ select coalesce(from_status::text, '-') || '>' || to_status || ':' || actor_role
     from public.booking_events where booking_id = (select id from made) and event = 'status_changed' order by created_at $$,
  $$ values ('requested>pending_provider:system'), ('pending_provider>accepted:business'),
            ('accepted>payment_pending:customer'), ('payment_pending>confirmed:system'),
            ('confirmed>in_progress:business'), ('in_progress>completed:business'), ('completed>reviewed:customer') $$,
  'every status change is in the history with who made it');
select is(
  (select note || ' · ' || (metadata ? 'from') from public.booking_events
   where booking_id = (select id from made) and event = 'rescheduled'),
  'Moved after a call · true', 'reschedules are recorded with the old and new time');

select ok(public.is_valid_booking_transition('pending_provider', 'declined'), 'the business can decline');
select ok(public.is_valid_booking_transition('cancelled', 'refunded'), 'a cancelled, paid booking can be refunded');
select ok(not public.is_valid_booking_transition('refunded', 'confirmed'), 'refunded is final');
select throws_ok($$ update public.bookings set status = 'quote_requested' where id = (select id from made) $$,
  '23514', null, 'the old quote_requested state is no longer used');

-- ---------------------------------------------------------------------------
-- The history is append-only and private to the booking's participants
-- ---------------------------------------------------------------------------

select throws_ok($$ update public.booking_events set note = 'edited' where booking_id = (select id from made) $$,
  '23514', null, 'booking history cannot be edited');

select pg_temp.act_as((select customer from ids));
select is((select count(*)::int from public.booking_events where booking_id = (select id from made)), 9,
  'the customer sees the whole history of their booking');
reset role;
select pg_temp.act_as((select other_customer from ids));
select is((select count(*)::int from public.booking_events where booking_id = (select id from made)), 0,
  'other customers see none of it');
reset role;

select * from finish();
rollback;
