-- Stage 10: payment system.
--   Customer payment → platform → platform commission → provider payout.
-- Every payment records who paid, which business it's for, the commission the platform keeps and
-- what the business is owed. Payouts are sent to the business's verified bank account.

-- ---------------------------------------------------------------------------
-- Payments: the split is worked out in the database, from the booking's commission rate
-- ---------------------------------------------------------------------------

alter table public.payments
  add column business_id uuid references public.businesses (id) on delete restrict,
  add column commission_rate_bps integer check (commission_rate_bps between 0 and 10000),
  add column platform_fee_minor bigint check (platform_fee_minor >= 0),
  add column provider_amount_minor bigint check (provider_amount_minor >= 0),
  add column channel text check (char_length(channel) <= 40),
  add column refund_status text check (refund_status in ('pending', 'processed', 'failed')),
  add column refund_reference text,
  add column refunded_at timestamptz;

comment on column public.payments.business_id is 'The business (service provider) the payment is for.';
comment on column public.payments.platform_fee_minor is 'Commission the platform keeps, at the booking''s rate.';
comment on column public.payments.provider_amount_minor is 'What the business is owed: amount less the platform fee.';
comment on column public.payments.channel is 'How the customer paid, as reported by the provider (card, bank transfer, USSD…).';

update public.payments p
set business_id = b.business_id,
    commission_rate_bps = b.commission_rate_bps,
    platform_fee_minor = round(p.amount_minor * b.commission_rate_bps / 10000.0),
    provider_amount_minor = p.amount_minor - round(p.amount_minor * b.commission_rate_bps / 10000.0)
from public.bookings b
where b.id = p.booking_id;

alter table public.payments
  alter column business_id set not null,
  alter column commission_rate_bps set not null,
  alter column platform_fee_minor set not null,
  alter column provider_amount_minor set not null,
  -- Filled in by the trigger below; the defaults only keep inserts short.
  alter column platform_fee_minor set default 0,
  alter column provider_amount_minor set default 0,
  add constraint payments_split check (provider_amount_minor = amount_minor - platform_fee_minor);
create index payments_business_idx on public.payments (business_id, created_at desc);
create index payments_created_idx on public.payments (created_at desc);

-- The payer, business and split always come from the booking, never from the caller.
create or replace function public.check_payment_matches_booking()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  bk public.bookings;
begin
  select * into bk from public.bookings where id = new.booking_id;
  if bk.id is null or bk.customer_id <> new.payer_id then
    raise exception 'Payer must be the booking''s customer' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    new.business_id := bk.business_id;
    new.commission_rate_bps := bk.commission_rate_bps;
  elsif new.business_id <> old.business_id or new.commission_rate_bps <> old.commission_rate_bps
     or new.amount_minor <> old.amount_minor then
    raise exception 'A payment''s business, amount and commission cannot change' using errcode = 'check_violation';
  end if;
  new.platform_fee_minor := round(new.amount_minor * new.commission_rate_bps / 10000.0);
  new.provider_amount_minor := new.amount_minor - new.platform_fee_minor;
  return new;
end;
$$;

drop trigger payments_check_booking on public.payments;
create trigger payments_check_booking
before insert or update on public.payments
for each row execute function public.check_payment_matches_booking();

-- Customers can see their own payment records, including the split.
grant select (business_id, commission_rate_bps, platform_fee_minor, provider_amount_minor, channel,
  refund_status, refunded_at) on public.payments to authenticated;

-- ---------------------------------------------------------------------------
-- Where a business is paid
-- ---------------------------------------------------------------------------

create table public.business_payout_accounts (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  provider public.payment_provider not null,
  bank_code text not null check (char_length(bank_code) <= 20),
  bank_name text not null check (char_length(bank_name) <= 120),
  account_number text not null check (account_number ~ '^[0-9]{10}$'),
  -- As returned by the bank when the number was checked, not typed by the business.
  account_name text not null check (char_length(account_name) <= 200),
  recipient_code text,
  verified_at timestamptz not null default now(),
  updated_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.business_payout_accounts is
  'Bank account each business is paid into. Verified with the payment provider; written by the server only.';

create trigger business_payout_accounts_set_updated_at
before update on public.business_payout_accounts
for each row execute function public.set_updated_at();

alter table public.business_payout_accounts enable row level security;
grant select (business_id, bank_name, account_name, account_number, verified_at, updated_at)
  on public.business_payout_accounts to authenticated;
create policy "payout accounts: owners read own" on public.business_payout_accounts for select to authenticated
  using ((select public.owns_business(business_id)));
create policy "payout accounts: admins read all" on public.business_payout_accounts for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Payouts: one transfer per completed booking, with our own reference
-- ---------------------------------------------------------------------------

alter table public.payouts
  add column payment_id uuid references public.payments (id) on delete restrict,
  add column reference text unique,
  add column attempts integer not null default 0 check (attempts >= 0),
  add column sent_at timestamptz,
  add column bank_name text,
  add column account_number_last4 text check (account_number_last4 ~ '^[0-9]{4}$');

comment on column public.payouts.reference is 'Our transfer reference, sent to the payment provider.';
comment on column public.payouts.status is
  'pending: owed, ready to send. processing: transfer sent. paid: confirmed by the provider. on_hold: dispute open. failed: withheld (refunded).';

-- ---------------------------------------------------------------------------
-- Every webhook we receive, for auditing and so each is handled once
-- ---------------------------------------------------------------------------

create table public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider public.payment_provider not null,
  event text not null,
  reference text,
  body_hash text not null,
  payload jsonb not null,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  constraint payment_webhook_events_once unique (provider, body_hash)
);
create index payment_webhook_events_reference_idx on public.payment_webhook_events (reference);

comment on table public.payment_webhook_events is
  'Verified webhooks from payment providers. Only stored after the signature checks out; server only.';

alter table public.payment_webhook_events enable row level security;
-- No grants: only the service role reads or writes webhook events.

-- ---------------------------------------------------------------------------
-- The commission must be set by an admin; nothing falls back to a hard-coded rate.
-- ---------------------------------------------------------------------------

create function public.current_commission_rate_bps(p_business_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  custom integer;
  platform integer;
begin
  select commission_rate_bps into custom from public.businesses where id = p_business_id;
  if custom is not null then
    return custom;
  end if;
  select (value #>> '{}')::integer into platform from public.platform_settings where key = 'default_commission_rate_bps';
  if platform is null then
    raise exception 'The platform commission has not been set' using errcode = 'check_violation';
  end if;
  return platform;
end;
$$;

comment on function public.current_commission_rate_bps(uuid) is
  'The commission for a new booking with this business: its custom rate, or the platform rate set by an admin.';
revoke execute on function public.current_commission_rate_bps(uuid) from public, anon, authenticated;
grant execute on function public.current_commission_rate_bps(uuid) to service_role;
