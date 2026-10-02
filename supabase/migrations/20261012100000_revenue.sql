-- Stage 17: revenue streams.
--   1. Platform commission on each booking (already in place; plans can now set their own rate).
--   2. Business subscriptions: Free, Starter, Growth and Pro, with prices set by admins.
--   3. Featured placement: paid extra visibility that never makes an unqualified provider a match.
--   4. An optional customer booking fee, set by admins (off by default).
-- Businesses pay for plans and placements through the same payment providers as bookings; every
-- charge is verified with the provider before anything is switched on.

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------

create table public.subscription_plans (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name text not null check (length(name) between 1 and 40),
  description text check (length(description) <= 300),
  monthly_price_minor bigint not null check (monthly_price_minor >= 0),
  -- The plan's own commission; null uses the platform rate. A business's custom rate wins over both.
  commission_rate_bps integer check (commission_rate_bps between 0 and 10000),
  perks text[] not null default '{}' check (cardinality(perks) <= 8),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  updated_by uuid references public.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  -- Free is always free and always offered: it's what every business has without a paid plan.
  constraint subscription_plans_free check (code <> 'free' or (monthly_price_minor = 0 and is_active))
);
create trigger subscription_plans_set_updated_at
before update on public.subscription_plans
for each row execute function public.set_updated_at();
comment on table public.subscription_plans is 'Business subscription tiers. Prices are set by admins.';

insert into public.subscription_plans (code, name, description, monthly_price_minor, perks, sort_order) values
  ('free', 'Free', 'List your business and take bookings.', 0,
   array['Business profile and services', 'Bookings, payments and chat'], 0),
  ('starter', 'Starter', 'For growing businesses.', 2500000,
   array['Everything in Free', 'Starter badge on your dashboard'], 1),
  ('growth', 'Growth', 'For busy businesses.', 5000000,
   array['Everything in Starter', 'Priority support'], 2),
  ('pro', 'Pro', 'For established businesses.', 10000000,
   array['Everything in Growth', 'Dedicated account manager'], 3);

-- Each paid month is one row: renewing adds the next period, so the history is the ledger.
create table public.business_subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  plan_code text not null references public.subscription_plans (code) on update cascade,
  price_minor bigint not null check (price_minor >= 0),
  period_start timestamptz not null,
  period_end timestamptz not null,
  -- replaced: the business moved to another plan before this period ended.
  status text not null default 'active' check (status in ('active', 'replaced', 'cancelled')),
  charge_id uuid,
  created_at timestamptz not null default now(),
  check (period_end > period_start)
);
create index business_subscriptions_business_idx on public.business_subscriptions (business_id, period_end desc);
comment on table public.business_subscriptions is 'Paid plan periods. A business with no current period is on Free.';

-- ---------------------------------------------------------------------------
-- Featured placement
-- ---------------------------------------------------------------------------

create table public.featured_packages (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name text not null check (length(name) between 1 and 40),
  duration_days integer not null check (duration_days between 1 and 365),
  price_minor bigint not null check (price_minor > 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  updated_by uuid references public.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger featured_packages_set_updated_at
before update on public.featured_packages
for each row execute function public.set_updated_at();
comment on table public.featured_packages is 'Featured placement options businesses can buy. Prices are set by admins.';

insert into public.featured_packages (code, name, duration_days, price_minor, sort_order) values
  ('week', '1 week', 7, 1000000, 0),
  ('month', '1 month', 30, 3500000, 1);

create table public.featured_placements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  package_code text not null references public.featured_packages (code) on update cascade,
  price_minor bigint not null check (price_minor >= 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  cancel_reason text check (length(cancel_reason) <= 500),
  cancelled_by uuid references public.users (id) on delete set null,
  charge_id uuid,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index featured_placements_business_idx on public.featured_placements (business_id, ends_at desc);
comment on table public.featured_placements is
  'Paid visibility. Only lifts a provider among those that already meet every customer requirement.';

-- ---------------------------------------------------------------------------
-- What businesses pay the platform
-- ---------------------------------------------------------------------------

create table public.business_charges (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  payer_id uuid not null references public.users (id) on delete restrict,
  kind text not null check (kind in ('subscription', 'featured')),
  item_code text not null,
  reference text not null unique check (reference ~ '^CHG-[A-F0-9]{16}$'),
  provider text not null,
  provider_reference text,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null default 'NGN' check (currency = 'NGN'),
  status text not null default 'pending' check (status in ('pending', 'success', 'failed', 'abandoned')),
  channel text,
  paid_at timestamptz,
  failure_reason text,
  provider_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index business_charges_business_idx on public.business_charges (business_id, created_at desc);
create index business_charges_paid_idx on public.business_charges (paid_at desc) where status = 'success';
create trigger business_charges_set_updated_at
before update on public.business_charges
for each row execute function public.set_updated_at();

alter table public.business_subscriptions
  add constraint business_subscriptions_charge_fk foreign key (charge_id) references public.business_charges (id),
  add constraint business_subscriptions_one_per_charge unique (charge_id);
alter table public.featured_placements
  add constraint featured_placements_charge_fk foreign key (charge_id) references public.business_charges (id),
  add constraint featured_placements_one_per_charge unique (charge_id);

-- The price always comes from the catalogue and the payer is always the owner; amounts never change.
create function public.check_business_charge()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  owner uuid;
  price bigint;
begin
  if tg_op = 'UPDATE' then
    if new.business_id <> old.business_id or new.payer_id <> old.payer_id or new.kind <> old.kind
       or new.item_code <> old.item_code or new.amount_minor <> old.amount_minor or new.reference <> old.reference then
      raise exception 'A charge''s business, item and amount cannot change' using errcode = 'check_violation';
    end if;
    if old.status = 'success' and new.status <> 'success' then
      raise exception 'A successful charge cannot be undone' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select owner_id into owner from public.businesses where id = new.business_id and status = 'approved';
  if owner is null or owner <> new.payer_id then
    raise exception 'Only the owner of an approved business can pay for it' using errcode = 'check_violation';
  end if;
  if new.kind = 'subscription' then
    select monthly_price_minor into price from public.subscription_plans where code = new.item_code and is_active;
  else
    select price_minor into price from public.featured_packages where code = new.item_code and is_active;
  end if;
  if price is null or price <= 0 then
    raise exception 'That plan or package is not available' using errcode = 'check_violation';
  end if;
  new.amount_minor := price;
  new.status := 'pending';
  return new;
end;
$$;
create trigger business_charges_check
before insert or update on public.business_charges
for each row execute function public.check_business_charge();

-- ---------------------------------------------------------------------------
-- Current plan and placement
-- ---------------------------------------------------------------------------

create function public.current_plan_code(p_business_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select s.plan_code from public.business_subscriptions s
    where s.business_id = p_business_id and s.status = 'active'
      and now() >= s.period_start and now() < s.period_end
    order by s.period_start desc
    limit 1
  ), 'free');
$$;
comment on function public.current_plan_code(uuid) is 'The business''s plan right now (free when no paid period covers today).';
revoke execute on function public.current_plan_code(uuid) from public, anon;
grant execute on function public.current_plan_code(uuid) to authenticated, service_role;

create function public.is_featured_now(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.featured_placements f
    where f.business_id = p_business_id and f.status = 'active' and now() >= f.starts_at and now() < f.ends_at
  );
$$;
revoke execute on function public.is_featured_now(uuid) from public, anon;
grant execute on function public.is_featured_now(uuid) to authenticated, service_role;

-- Commission: a business's custom rate, then its plan's rate, then the platform rate.
create or replace function public.current_commission_rate_bps(p_business_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  custom integer;
  plan_rate integer;
  platform integer;
begin
  select commission_rate_bps into custom from public.businesses where id = p_business_id;
  if custom is not null then
    return custom;
  end if;
  select p.commission_rate_bps into plan_rate from public.subscription_plans p
  where p.code = public.current_plan_code(p_business_id);
  if plan_rate is not null then
    return plan_rate;
  end if;
  select (value #>> '{}')::integer into platform from public.platform_settings where key = 'default_commission_rate_bps';
  if platform is null then
    raise exception 'The platform commission has not been set' using errcode = 'check_violation';
  end if;
  return platform;
end;
$$;
comment on function public.current_commission_rate_bps(uuid) is
  'The commission for a new booking with this business: its custom rate, its plan''s rate, or the platform rate.';

-- ---------------------------------------------------------------------------
-- Completing a charge: record the payment and switch on what was bought, in one step
-- ---------------------------------------------------------------------------

create function public.complete_business_charge(
  p_reference text,
  p_paid_at timestamptz,
  p_provider_reference text,
  p_channel text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.business_charges;
  pkg public.featured_packages;
  current_sub public.business_subscriptions;
  starts timestamptz;
  ends timestamptz;
begin
  update public.business_charges
  set status = 'success', paid_at = coalesce(p_paid_at, now()), provider_reference = p_provider_reference,
      channel = p_channel, provider_payload = p_payload, failure_reason = null
  where reference = p_reference and status in ('pending', 'failed', 'abandoned')
  returning * into c;
  if c.id is null then
    -- Already completed (the callback and the webhook can both arrive), or unknown.
    select * into c from public.business_charges where reference = p_reference;
    return jsonb_build_object('chargeId', c.id, 'businessId', c.business_id, 'kind', c.kind, 'activated', false);
  end if;

  if c.kind = 'subscription' then
    select * into current_sub from public.business_subscriptions s
    where s.business_id = c.business_id and s.status = 'active' and s.period_end > now()
    order by s.period_end desc limit 1;
    if current_sub.id is not null and current_sub.plan_code = c.item_code then
      -- Renewing the same plan: the new month starts when the current one ends.
      starts := current_sub.period_end;
    else
      -- New or different plan: starts now and replaces whatever was running.
      update public.business_subscriptions set status = 'replaced'
      where business_id = c.business_id and status = 'active' and period_end > now();
      starts := now();
    end if;
    insert into public.business_subscriptions (business_id, plan_code, price_minor, period_start, period_end, charge_id)
    values (c.business_id, c.item_code, c.amount_minor, starts, starts + interval '1 month', c.id);
  else
    select * into pkg from public.featured_packages where code = c.item_code;
    -- Back-to-back placements: a new one starts when the current one ends.
    select greatest(now(), coalesce(max(f.ends_at), now())) into starts
    from public.featured_placements f
    where f.business_id = c.business_id and f.status = 'active' and f.ends_at > now();
    ends := starts + make_interval(days => pkg.duration_days);
    insert into public.featured_placements (business_id, package_code, price_minor, starts_at, ends_at, charge_id)
    values (c.business_id, c.item_code, c.amount_minor, starts, ends, c.id);
  end if;

  return jsonb_build_object('chargeId', c.id, 'businessId', c.business_id, 'kind', c.kind, 'activated', true);
end;
$$;
revoke execute on function public.complete_business_charge(text, timestamptz, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.complete_business_charge(text, timestamptz, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Customer booking fee: the platform keeps all of it, and commission is only on the service price
-- ---------------------------------------------------------------------------

insert into public.platform_settings (key, value, description) values
  ('booking_fee', '{"percent_bps": 0, "flat_minor": 0, "cap_minor": null}',
   'Optional fee customers pay on top of the service price: a percentage plus a flat amount, with an optional cap. All zero = no fee.'),
  ('featured_slots', '3',
   'How many featured providers can be lifted to the top of results that already match the customer.')
on conflict (key) do nothing;

alter table public.payments add column booking_fee_minor bigint not null default 0 check (booking_fee_minor >= 0);
comment on column public.payments.booking_fee_minor is
  'The customer booking fee included in amount_minor. It goes to the platform in full and is not commissioned.';
grant select (booking_fee_minor) on public.payments to authenticated;

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
    new.booking_fee_minor := least(bk.platform_fee_minor, new.amount_minor);
  elsif new.business_id <> old.business_id or new.commission_rate_bps <> old.commission_rate_bps
     or new.amount_minor <> old.amount_minor or new.booking_fee_minor <> old.booking_fee_minor then
    raise exception 'A payment''s business, amount and commission cannot change' using errcode = 'check_violation';
  end if;
  -- Platform share = commission on the service price + the whole booking fee.
  new.platform_fee_minor := round((new.amount_minor - new.booking_fee_minor) * new.commission_rate_bps / 10000.0)
    + new.booking_fee_minor;
  new.provider_amount_minor := new.amount_minor - new.platform_fee_minor;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Access: catalogues are public; a business sees only its own plan, placements and charges
-- ---------------------------------------------------------------------------

alter table public.subscription_plans enable row level security;
alter table public.featured_packages enable row level security;
alter table public.business_subscriptions enable row level security;
alter table public.featured_placements enable row level security;
alter table public.business_charges enable row level security;

revoke all on public.subscription_plans, public.featured_packages, public.business_subscriptions,
  public.featured_placements, public.business_charges from anon, authenticated;

grant select (code, name, description, monthly_price_minor, perks, is_active, sort_order)
  on public.subscription_plans to anon, authenticated;
create policy "subscription_plans: active plans are public" on public.subscription_plans
  for select to anon, authenticated using (is_active);
create policy "subscription_plans: admins read all" on public.subscription_plans
  for select to authenticated using ((select public.is_admin()));

grant select (code, name, duration_days, price_minor, is_active, sort_order) on public.featured_packages to anon, authenticated;
create policy "featured_packages: active packages are public" on public.featured_packages
  for select to anon, authenticated using (is_active);
create policy "featured_packages: admins read all" on public.featured_packages
  for select to authenticated using ((select public.is_admin()));

grant select (id, business_id, plan_code, price_minor, period_start, period_end, status, created_at)
  on public.business_subscriptions to authenticated;
create policy "business_subscriptions: owners and admins read" on public.business_subscriptions
  for select to authenticated using ((select public.owns_business(business_id)) or (select public.is_admin()));

grant select (id, business_id, package_code, price_minor, starts_at, ends_at, status, created_at)
  on public.featured_placements to authenticated;
create policy "featured_placements: owners and admins read" on public.featured_placements
  for select to authenticated using ((select public.owns_business(business_id)) or (select public.is_admin()));

grant select (id, business_id, kind, item_code, reference, amount_minor, currency, status, paid_at, created_at)
  on public.business_charges to authenticated;
create policy "business_charges: owners and admins read" on public.business_charges
  for select to authenticated using ((select public.owns_business(business_id)) or (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Reminders before a plan or placement runs out
-- ---------------------------------------------------------------------------

create function public.queue_billing_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  sent integer := 0;
  n integer;
begin
  insert into public.notifications (user_id, type, title, body, data, dedupe_key)
  select b.owner_id, 'billing.plan_ending', 'Your ' || p.name || ' plan ends soon',
    'It ends on ' || to_char(s.period_end at time zone 'Africa/Lagos', 'Dy DD Mon') ||
    '. Renew to keep it; otherwise you move to Free.',
    jsonb_build_object('businessId', b.id),
    'plan_ending:' || s.id
  from public.business_subscriptions s
  join public.businesses b on b.id = s.business_id
  join public.subscription_plans p on p.code = s.plan_code
  where s.status = 'active' and s.period_end > now() and s.period_end <= now() + interval '3 days'
    and not exists (select 1 from public.business_subscriptions later
                    where later.business_id = s.business_id and later.status = 'active'
                      and later.period_start >= s.period_end)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics n = row_count;
  sent := sent + n;

  insert into public.notifications (user_id, type, title, body, data, dedupe_key)
  select b.owner_id, 'billing.featured_ending', 'Your featured placement ends soon',
    'It ends on ' || to_char(f.ends_at at time zone 'Africa/Lagos', 'Dy DD Mon') || '.',
    jsonb_build_object('businessId', b.id),
    'featured_ending:' || f.id
  from public.featured_placements f
  join public.businesses b on b.id = f.business_id
  where f.status = 'active' and f.ends_at > now() and f.ends_at <= now() + interval '2 days'
    and not exists (select 1 from public.featured_placements later
                    where later.business_id = f.business_id and later.status = 'active'
                      and later.starts_at >= f.ends_at)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics n = row_count;
  return sent + n;
end;
$$;
revoke execute on function public.queue_billing_reminders() from public, anon, authenticated;
select cron.schedule('billing-reminders', '0 * * * *', $$select public.queue_billing_reminders()$$);

-- ---------------------------------------------------------------------------
-- Revenue by stream, for the admin dashboard (server only)
-- ---------------------------------------------------------------------------

create function public.get_revenue_summary(p_from timestamptz, p_to timestamptz)
returns table (
  commission_minor bigint,
  booking_fees_minor bigint,
  subscriptions_minor bigint,
  featured_minor bigint,
  refunded_minor bigint,
  paid_bookings integer,
  active_subscriptions integer,
  active_featured integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sum(p.platform_fee_minor - p.booking_fee_minor) from public.payments p
              where p.status in ('success', 'refunded', 'partially_refunded') and p.paid_at >= p_from and p.paid_at < p_to), 0)::bigint,
    coalesce((select sum(p.booking_fee_minor) from public.payments p
              where p.status in ('success', 'refunded', 'partially_refunded') and p.paid_at >= p_from and p.paid_at < p_to), 0)::bigint,
    coalesce((select sum(c.amount_minor) from public.business_charges c
              where c.kind = 'subscription' and c.status = 'success' and c.paid_at >= p_from and c.paid_at < p_to), 0)::bigint,
    coalesce((select sum(c.amount_minor) from public.business_charges c
              where c.kind = 'featured' and c.status = 'success' and c.paid_at >= p_from and c.paid_at < p_to), 0)::bigint,
    coalesce((select sum(p.refunded_minor) from public.payments p
              where p.refunded_at >= p_from and p.refunded_at < p_to), 0)::bigint,
    (select count(*)::int from public.payments p
     where p.status in ('success', 'refunded', 'partially_refunded') and p.paid_at >= p_from and p.paid_at < p_to),
    (select count(distinct s.business_id)::int from public.business_subscriptions s
     where s.status = 'active' and now() >= s.period_start and now() < s.period_end),
    (select count(distinct f.business_id)::int from public.featured_placements f
     where f.status = 'active' and now() >= f.starts_at and now() < f.ends_at);
$$;
revoke execute on function public.get_revenue_summary(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.get_revenue_summary(timestamptz, timestamptz) to service_role;
