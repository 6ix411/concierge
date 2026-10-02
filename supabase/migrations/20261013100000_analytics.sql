-- Stage 18: analytics.
--
-- Most numbers come from records the platform already keeps (accounts, businesses, bookings,
-- payments, concierge chats). Three things leave no record of their own, so they are logged here:
-- searches, the providers each search showed (matches) and profile views.
--
-- These events are anonymous by design: no user id, no IP address, no device details and none of
-- the words a customer typed. Only what the reports need: what kind of event, which business,
-- which category and which state or city (as the platform understood it), and when.

create type public.analytics_event_type as enum ('search', 'provider_match', 'profile_view');

create table public.analytics_events (
  id bigint generated always as identity primary key,
  event_type public.analytics_event_type not null,
  -- Where it happened: the search page, the AI concierge, or a business profile.
  source text not null check (source in ('search', 'concierge', 'profile')),
  business_id uuid references public.businesses (id) on delete cascade,
  category_id uuid references public.service_categories (id) on delete set null,
  state text check (char_length(state) <= 60),
  city text check (char_length(city) <= 60),
  -- Searches only: how many providers it showed.
  result_count integer check (result_count >= 0),
  occurred_at timestamptz not null default now(),
  constraint analytics_events_business check (
    (event_type = 'search' and business_id is null)
    or (event_type <> 'search' and business_id is not null)
  )
);

comment on table public.analytics_events is
  'Anonymous usage events (searches, matches, profile views). No personal information. Server writes only.';

create index analytics_events_type_time_idx on public.analytics_events (event_type, occurred_at);
create index analytics_events_business_idx on public.analytics_events (business_id, event_type, occurred_at)
  where business_id is not null;

alter table public.analytics_events enable row level security;
revoke all on public.analytics_events from anon, authenticated;
-- No policies: only the server (service role) reads or writes events.

-- Reports by time look these up.
create index if not exists bookings_created_idx on public.bookings (created_at);
create index if not exists ai_conversations_created_idx on public.ai_conversations (created_at);

-- Events are kept for two years, then deleted.
create function public.prune_analytics_events()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.analytics_events where occurred_at < now() - interval '2 years' returning 1
  )
  select count(*)::int from gone;
$$;
revoke execute on function public.prune_analytics_events() from public, anon, authenticated;

select cron.schedule('analytics-retention', '30 3 * * *', $$ select public.prune_analytics_events(); $$);

-- ---------------------------------------------------------------------------
-- Platform report
-- ---------------------------------------------------------------------------

create function public.get_platform_analytics(p_from timestamptz, p_to timestamptz, top_n integer default 8)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  ev as (
    select * from public.analytics_events e where e.occurred_at >= p_from and e.occurred_at < p_to
  ),
  bk as (
    select * from public.bookings b where b.created_at >= p_from and b.created_at < p_to
  ),
  paid as (
    select * from public.payments p
    where p.status in ('success', 'refunded', 'partially_refunded') and p.paid_at >= p_from and p.paid_at < p_to
  ),
  -- Businesses are filed under a main category or one of its sub-categories; both count towards the main one.
  main_category as (
    select c.id, coalesce(c.parent_id, c.id) as main_id from public.service_categories c
  ),
  business_category as (
    select biz.id as business_id, mc.main_id
    from public.businesses biz join main_category mc on mc.id = biz.primary_category_id
  ),
  category_rows as (
    select c.id, c.name, c.slug,
      (select count(*) from ev join main_category mc on mc.id = ev.category_id
        where ev.event_type = 'search' and mc.main_id = c.id) as searches,
      (select count(*) from ev join business_category bc on bc.business_id = ev.business_id
        where ev.event_type = 'profile_view' and bc.main_id = c.id) as profile_views,
      (select count(*) from bk join business_category bc on bc.business_id = bk.business_id
        where bc.main_id = c.id) as booking_requests,
      (select count(*) from public.bookings b join business_category bc on bc.business_id = b.business_id
        where bc.main_id = c.id and b.completed_at >= p_from and b.completed_at < p_to) as completed_bookings
    from public.service_categories c
    where c.parent_id is null
  ),
  -- Locations as the platform understood them: a state, or a city within it.
  place_events as (
    select ev.state, ev.city, (ev.event_type = 'search')::int as searches, 0 as booking_requests
    from ev where ev.event_type = 'search' and ev.state is not null
    union all
    select bk.state, bk.city, 0, 1 from bk where bk.state is not null
  ),
  location_rows as (
    select
      pe.state,
      pe.city,
      sum(pe.searches)::int as searches,
      sum(pe.booking_requests)::int as booking_requests
    from place_events pe
    group by 1, 2
  ),
  days as (
    select generate_series(
      date_trunc('day', greatest(p_from, now() - interval '400 days') at time zone 'Africa/Lagos'),
      date_trunc('day', least(p_to, now()) at time zone 'Africa/Lagos'),
      interval '1 day'
    ) as day
  ),
  daily as (
    select to_char(d.day, 'YYYY-MM-DD') as day,
      (select count(*) from ev where ev.event_type = 'search'
        and date_trunc('day', ev.occurred_at at time zone 'Africa/Lagos') = d.day) as searches,
      (select count(*) from bk
        where date_trunc('day', bk.created_at at time zone 'Africa/Lagos') = d.day) as booking_requests
    from days d
  ),
  -- Concierge chats whose customer asked for a booking within 7 days of starting it.
  chats as (
    select c.id, c.user_id, c.created_at from public.ai_conversations c
    where c.created_at >= p_from and c.created_at < p_to
  )
  select jsonb_build_object(
    'customer_registrations', (select count(*) from public.users u
      where u.role = 'customer' and u.created_at >= p_from and u.created_at < p_to),
    'business_registrations', (select count(*) from public.businesses biz
      where biz.status <> 'draft'
        and coalesce(biz.submitted_at, biz.created_at) >= p_from and coalesce(biz.submitted_at, biz.created_at) < p_to),
    'businesses_approved', (select count(*) from public.businesses biz
      where biz.status = 'approved'
        and coalesce(biz.reviewed_at, biz.created_at) >= p_from and coalesce(biz.reviewed_at, biz.created_at) < p_to),
    'approved_businesses_now', (select count(*) from public.businesses biz where biz.status = 'approved'),
    'searches', (select count(*) from ev where ev.event_type = 'search'),
    'concierge_searches', (select count(*) from ev where ev.event_type = 'search' and ev.source = 'concierge'),
    'searches_with_results', (select count(*) from ev where ev.event_type = 'search' and ev.result_count > 0),
    'ai_conversations', (select count(*) from chats),
    'ai_conversations_booked', (select count(*) from chats c where exists (
      select 1 from public.bookings b
      where b.customer_id = c.user_id and b.created_at >= c.created_at and b.created_at < c.created_at + interval '7 days')),
    'provider_matches', (select count(*) from ev where ev.event_type = 'provider_match'),
    'providers_matched', (select count(distinct ev.business_id) from ev where ev.event_type = 'provider_match'),
    'profile_views', (select count(*) from ev where ev.event_type = 'profile_view'),
    'booking_requests', (select count(*) from bk),
    'confirmed_bookings', (select count(*) from public.bookings b where b.confirmed_at >= p_from and b.confirmed_at < p_to),
    'completed_bookings', (select count(*) from public.bookings b where b.completed_at >= p_from and b.completed_at < p_to),
    'cancellations', (select count(*) from public.bookings b where b.cancelled_at >= p_from and b.cancelled_at < p_to),
    'declined', (select count(*) from bk where bk.status = 'declined'),
    -- Of the bookings requested in the period, how far each got.
    'requests_confirmed', (select count(*) from bk where bk.confirmed_at is not null),
    'requests_completed', (select count(*) from bk where bk.completed_at is not null),
    'requests_cancelled', (select count(*) from bk where bk.cancelled_at is not null),
    'customer_payments_minor', (select coalesce(sum(amount_minor), 0) from paid),
    'refunded_minor', (select coalesce(sum(p.refunded_minor), 0) from public.payments p
      where p.refunded_at >= p_from and p.refunded_at < p_to),
    'commission_minor', (select coalesce(sum(platform_fee_minor - booking_fee_minor), 0) from paid),
    'booking_fees_minor', (select coalesce(sum(booking_fee_minor), 0) from paid),
    'business_charges_minor', (select coalesce(sum(c.amount_minor), 0) from public.business_charges c
      where c.status = 'success' and c.paid_at >= p_from and c.paid_at < p_to),
    'provider_earnings_minor', (select coalesce(sum(provider_amount_minor), 0) from paid),
    'paid_bookings', (select count(*) from paid),
    'average_booking_minor', (select coalesce(round(avg(amount_minor)), 0) from paid),
    'categories', coalesce((select jsonb_agg(to_jsonb(r) order by r.booking_requests desc, r.searches desc, r.profile_views desc, r.name)
      from (select * from category_rows
            where searches + profile_views + booking_requests + completed_bookings > 0
            order by booking_requests desc, searches desc, profile_views desc, name limit top_n) r), '[]'::jsonb),
    'locations', coalesce((select jsonb_agg(to_jsonb(r) order by r.booking_requests desc, r.searches desc, r.state, r.city)
      from (select * from location_rows
            order by booking_requests desc, searches desc, state, city nulls first limit top_n) r), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(to_jsonb(d) order by d.day) from daily d), '[]'::jsonb)
  );
$$;

comment on function public.get_platform_analytics(timestamptz, timestamptz, integer) is
  'Admin analytics for a period. Server only: callable by the service role after an admin check.';
revoke execute on function public.get_platform_analytics(timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.get_platform_analytics(timestamptz, timestamptz, integer) to service_role;

-- ---------------------------------------------------------------------------
-- A business's own numbers
-- ---------------------------------------------------------------------------

create function public.get_business_analytics(p_business_id uuid, p_from timestamptz, p_to timestamptz)
returns table (
  profile_views integer,
  search_appearances integer,
  booking_requests integer,
  confirmed_bookings integer,
  completed_bookings integer,
  cancellations integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*)::int from public.analytics_events e
     where e.business_id = p_business_id and e.event_type = 'profile_view' and e.occurred_at >= p_from and e.occurred_at < p_to),
    (select count(*)::int from public.analytics_events e
     where e.business_id = p_business_id and e.event_type = 'provider_match' and e.occurred_at >= p_from and e.occurred_at < p_to),
    (select count(*)::int from public.bookings b
     where b.business_id = p_business_id and b.created_at >= p_from and b.created_at < p_to),
    (select count(*)::int from public.bookings b
     where b.business_id = p_business_id and b.confirmed_at >= p_from and b.confirmed_at < p_to),
    (select count(*)::int from public.bookings b
     where b.business_id = p_business_id and b.completed_at >= p_from and b.completed_at < p_to),
    (select count(*)::int from public.bookings b
     where b.business_id = p_business_id and b.cancelled_at >= p_from and b.cancelled_at < p_to);
$$;

comment on function public.get_business_analytics(uuid, timestamptz, timestamptz) is
  'One business''s views, search appearances and bookings. Server only, after checking the caller owns it.';
revoke execute on function public.get_business_analytics(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.get_business_analytics(uuid, timestamptz, timestamptz) to service_role;
