-- Stage 5: admin dashboard.
-- Marketplace statistics for the admin overview, dispute handling and a few audit-friendly columns.

-- ---------------------------------------------------------------------------
-- Disputes: remember what the booking was before, and how the dispute ended
-- ---------------------------------------------------------------------------

alter table public.disputes
  add column previous_booking_status public.booking_status,
  add column outcome text check (outcome in ('business', 'customer', 'dismissed')),
  add column refund_due_minor bigint not null default 0 check (refund_due_minor >= 0);

comment on column public.disputes.previous_booking_status is
  'Booking status when the dispute was opened. A dismissed dispute returns the booking to it.';
comment on column public.disputes.outcome is
  'business: job stands and the payout is released. customer: booking cancelled, payout withheld, refund due. dismissed: no change.';
comment on column public.disputes.refund_due_minor is
  'Amount owed back to the customer. Paid out by the payments stage.';

alter table public.disputes
  add constraint disputes_outcome_when_closed
  check ((status in ('resolved', 'rejected')) = (outcome is not null));

-- A dismissed dispute puts the booking back where it was.
create or replace function public.is_valid_booking_transition(from_status public.booking_status, to_status public.booking_status)
returns boolean
language sql immutable set search_path = ''
as $$
  select from_status = to_status or (from_status, to_status) in (
    ('quote_requested', 'quoted'), ('quote_requested', 'rejected'), ('quote_requested', 'cancelled'), ('quote_requested', 'expired'),
    ('quoted', 'requested'), ('quoted', 'accepted'), ('quoted', 'cancelled'), ('quoted', 'expired'),
    ('requested', 'accepted'), ('requested', 'rejected'), ('requested', 'cancelled'), ('requested', 'expired'),
    ('accepted', 'confirmed'), ('accepted', 'cancelled'), ('accepted', 'expired'),
    ('confirmed', 'in_progress'), ('confirmed', 'completed'), ('confirmed', 'cancelled'), ('confirmed', 'disputed'),
    ('in_progress', 'completed'), ('in_progress', 'disputed'), ('in_progress', 'cancelled'),
    ('completed', 'disputed'),
    ('disputed', 'completed'), ('disputed', 'cancelled'), ('disputed', 'confirmed'), ('disputed', 'in_progress')
  );
$$;

-- ---------------------------------------------------------------------------
-- Admin overview statistics
-- Only the server (service role) may call this, after checking the caller is an admin.
-- ---------------------------------------------------------------------------

create function public.admin_dashboard_stats(top_n integer default 5)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with
  paid_bookings as (
    -- Bookings the customer has paid for (or that were completed before payments existed).
    select b.* from public.bookings b
    where b.status in ('confirmed', 'in_progress', 'completed', 'disputed')
  ),
  money as (
    select
      coalesce((select sum(amount_minor - refunded_minor) from public.payments
                where status in ('success', 'partially_refunded')), 0) as revenue_minor,
      coalesce((select sum(commission_minor) from public.payouts where status <> 'failed'), 0)
        + coalesce((select sum(platform_fee_minor) from paid_bookings), 0) as platform_fees_minor,
      coalesce((select sum(amount_minor) from public.payouts
                where status in ('pending', 'processing', 'on_hold')), 0) as pending_payouts_minor,
      (select count(*) from public.payouts where status in ('pending', 'processing', 'on_hold')) as pending_payouts
  ),
  months as (
    select generate_series(
      date_trunc('month', now() at time zone 'Africa/Lagos') - interval '5 months',
      date_trunc('month', now() at time zone 'Africa/Lagos'),
      interval '1 month'
    ) as month
  ),
  monthly as (
    select
      to_char(m.month, 'YYYY-MM') as month,
      (select count(*) from public.bookings b
        where date_trunc('month', b.created_at at time zone 'Africa/Lagos') = m.month) as bookings,
      coalesce((select sum(p.amount_minor - p.refunded_minor) from public.payments p
        where p.status in ('success', 'partially_refunded')
          and date_trunc('month', p.paid_at at time zone 'Africa/Lagos') = m.month), 0) as revenue_minor
    from months m
    order by m.month
  ),
  -- Businesses are filed under a main category or one of its sub-categories; both count towards the main one.
  business_main_category as (
    select biz.id as business_id, biz.status, coalesce(c.parent_id, c.id) as category_id
    from public.businesses biz
    join public.service_categories c on c.id = biz.primary_category_id
  ),
  top_categories as (
    select c.id, c.name, c.slug,
      (select count(*) from paid_bookings pb
        join business_main_category bmc on bmc.business_id = pb.business_id
        where bmc.category_id = c.id) as bookings,
      (select count(*) from business_main_category bmc
        where bmc.category_id = c.id and bmc.status = 'approved') as businesses
    from public.service_categories c
    where c.parent_id is null
    order by bookings desc, businesses desc, c.sort_order, c.name
    limit top_n
  ),
  top_services as (
    select s.id, s.name, biz.name as business_name, count(distinct pb.id) as bookings
    from public.booking_items bi
    join paid_bookings pb on pb.id = bi.booking_id
    join public.business_services s on s.id = bi.service_id
    join public.businesses biz on biz.id = s.business_id
    group by s.id, biz.name
    order by count(distinct pb.id) desc, s.name
    limit top_n
  ),
  top_businesses as (
    select biz.id, biz.name, biz.slug, count(pb.id) as bookings, coalesce(sum(pb.total_minor), 0) as value_minor
    from paid_bookings pb
    join public.businesses biz on biz.id = pb.business_id
    group by biz.id
    order by count(pb.id) desc, sum(pb.total_minor) desc
    limit top_n
  )
  select jsonb_build_object(
    'customers', (select count(*) from public.users where role = 'customer'),
    'businesses', (select count(*) from public.businesses where status <> 'draft'),
    'pending_businesses', (select count(*) from public.businesses where status in ('pending', 'under_review')),
    'approved_businesses', (select count(*) from public.businesses where status = 'approved'),
    'active_bookings', (select count(*) from public.bookings
      where status in ('quote_requested', 'quoted', 'requested', 'accepted', 'confirmed', 'in_progress', 'disputed')),
    'completed_bookings', (select count(*) from public.bookings where status = 'completed'),
    'cancelled_bookings', (select count(*) from public.bookings where status = 'cancelled'),
    'revenue_minor', (select revenue_minor from money),
    'platform_fees_minor', (select platform_fees_minor from money),
    'pending_payouts_minor', (select pending_payouts_minor from money),
    'pending_payouts', (select pending_payouts from money),
    'open_disputes', (select count(*) from public.disputes where status in ('open', 'under_review')),
    'disputes', (select count(*) from public.disputes),
    'reviews', (select count(*) from public.reviews),
    'hidden_reviews', (select count(*) from public.reviews where status = 'hidden'),
    'average_rating', (select round(avg(rating)::numeric, 2) from public.reviews where status = 'published'),
    'monthly', coalesce((select jsonb_agg(to_jsonb(m)) from monthly m), '[]'::jsonb),
    'popular_categories', coalesce((select jsonb_agg(to_jsonb(t)) from top_categories t), '[]'::jsonb),
    'popular_services', coalesce((select jsonb_agg(to_jsonb(t)) from top_services t), '[]'::jsonb),
    'top_businesses', coalesce((select jsonb_agg(to_jsonb(t)) from top_businesses t), '[]'::jsonb)
  );
$$;

comment on function public.admin_dashboard_stats(integer) is
  'Admin overview numbers. Server only: callable by the service role after an admin check.';

revoke execute on function public.admin_dashboard_stats(integer) from public, anon, authenticated;
grant execute on function public.admin_dashboard_stats(integer) to service_role;

-- Fast lookups for the admin lists.
create index if not exists reviews_created_idx on public.reviews (created_at desc);
create index if not exists users_created_idx on public.users (created_at desc);
create index if not exists admin_actions_created_idx on public.admin_actions (created_at desc);
