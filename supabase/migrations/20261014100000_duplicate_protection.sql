-- Stage 20: no duplicate bookings or payments.
--
-- Bookings: the booking form sends a one-off request key. A retry of the same submission (a double
-- tap, or a resend after the connection dropped mid-request) returns the booking already made
-- instead of a second one. A customer also can't hold two open bookings with the same business
-- for the same start time.
--
-- Payments: a checkout that is still open is reused rather than starting a second charge, and a
-- second successful payment for a booking that is already paid is refunded (see finalizePayment).

alter table public.bookings add column request_key uuid;

create unique index bookings_request_key_idx on public.bookings (customer_id, request_key)
  where request_key is not null;

create unique index bookings_one_open_slot_idx on public.bookings (customer_id, business_id, scheduled_start)
  where status in ('requested', 'pending_provider', 'accepted', 'payment_pending', 'confirmed', 'in_progress');

-- The provider's checkout page for a pending payment, so a second tap reuses it. Server only.
alter table public.payments add column checkout_url text check (char_length(checkout_url) <= 2000);

-- A second payment that succeeded for a booking someone already paid for. It is recorded as taken
-- (so it can be refunded) without counting as the booking's payment.
alter table public.payments add column duplicate boolean not null default false;

drop index public.payments_one_success_per_booking;
create unique index payments_one_success_per_booking on public.payments (booking_id)
  where status = 'success' and not duplicate;

drop function public.create_booking(jsonb, jsonb);

create function public.create_booking(p_booking jsonb, p_items jsonb)
returns table (id uuid, reference text, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  bk public.bookings;
  key uuid := (p_booking ->> 'request_key')::uuid;
  customer uuid := (p_booking ->> 'customer_id')::uuid;
  violated text;
begin
  -- The same submission again: hand back what it created the first time.
  if key is not null then
    select * into bk from public.bookings b where b.customer_id = customer and b.request_key = key;
    if found then
      return query select bk.id, bk.reference, false;
      return;
    end if;
  end if;

  begin
    insert into public.bookings (
      customer_id, business_id, status, scheduled_start, scheduled_end, address_line, area, city, state,
      guests, customer_notes, needs_quote, subtotal_minor, platform_fee_minor, total_minor, commission_rate_bps,
      change_actor_id, request_key
    ) values (
      customer,
      (p_booking ->> 'business_id')::uuid,
      'requested',
      (p_booking ->> 'scheduled_start')::timestamptz,
      (p_booking ->> 'scheduled_end')::timestamptz,
      p_booking ->> 'address_line',
      p_booking ->> 'area',
      p_booking ->> 'city',
      p_booking ->> 'state',
      (p_booking ->> 'guests')::integer,
      p_booking ->> 'customer_notes',
      coalesce((p_booking ->> 'needs_quote')::boolean, false),
      (p_booking ->> 'subtotal_minor')::bigint,
      (p_booking ->> 'platform_fee_minor')::bigint,
      (p_booking ->> 'total_minor')::bigint,
      (p_booking ->> 'commission_rate_bps')::integer,
      customer,
      key
    )
    returning * into bk;
  exception when unique_violation then
    get stacked diagnostics violated = constraint_name;
    if violated = 'bookings_request_key_idx' then
      -- Two copies of the same submission arrived together; the other one won.
      select * into bk from public.bookings b where b.customer_id = customer and b.request_key = key;
      return query select bk.id, bk.reference, false;
      return;
    end if;
    raise exception 'You already have a booking with this business at that time.'
      using errcode = '23505', constraint = violated;
  end;

  insert into public.booking_items (booking_id, service_id, name, unit_price_minor, quantity, kind)
  select bk.id, (item ->> 'service_id')::uuid, item ->> 'name', (item ->> 'unit_price_minor')::bigint,
    (item ->> 'quantity')::integer, item ->> 'kind'
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as item;

  update public.bookings b set status = 'pending_provider'
  where b.id = bk.id;

  return query select bk.id, bk.reference, true;
end;
$$;

comment on function public.create_booking(jsonb, jsonb) is
  'Creates a booking and its items atomically and sends it to the business (requested → pending_provider). '
  'Repeating a request key returns the existing booking (created = false). Server only.';
revoke execute on function public.create_booking(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_booking(jsonb, jsonb) to service_role;
