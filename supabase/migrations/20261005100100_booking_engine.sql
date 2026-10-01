-- Stage 9: booking engine, part 2.
-- The booking workflow, what customers choose (package, area, guests), and a complete, append-only
-- history of every booking.

-- ---------------------------------------------------------------------------
-- What the customer chose
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column area text check (char_length(area) <= 80),
  add column guests integer check (guests between 1 and 100000),
  add column needs_quote boolean not null default false,
  -- Who is making the change being written, and why. Read by the history trigger and then cleared,
  -- so they're never stored on the booking itself.
  add column change_actor_id uuid references public.users (id) on delete set null,
  add column change_note text check (char_length(change_note) <= 500);

comment on column public.bookings.area is 'Neighbourhood, e.g. Lekki. city holds the city, e.g. Lagos.';
comment on column public.bookings.needs_quote is
  'The business must send a price before accepting (a quote request, or "starting from" / "quote only" services).';
comment on column public.bookings.change_actor_id is
  'Write-only: set alongside a change to record who made it in booking_events. Always null when read.';
comment on column public.bookings.change_note is
  'Write-only: a note for the booking_events entry of this change. Always null when read.';

alter table public.booking_items
  add column kind text not null default 'service' check (kind in ('service', 'package', 'addon'));

update public.booking_items bi
set kind = case when s.is_package then 'package' when s.is_addon then 'addon' else 'service' end
from public.business_services s
where s.id = bi.service_id;

-- ---------------------------------------------------------------------------
-- Booking history: every status change and reschedule, with who did it. Append-only.
-- ---------------------------------------------------------------------------

create table public.booking_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  event text not null check (event in ('created', 'status_changed', 'rescheduled')),
  from_status public.booking_status,
  to_status public.booking_status,
  actor_id uuid references public.users (id) on delete set null,
  actor_role text not null check (actor_role in ('customer', 'business', 'admin', 'system')),
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index booking_events_booking_idx on public.booking_events (booking_id, created_at);

comment on table public.booking_events is
  'Complete history of each booking: creation, every status change and every reschedule. Written by a trigger; never edited.';

alter table public.booking_events enable row level security;
grant select on public.booking_events to authenticated;
-- Visible to whoever can see the booking (its customer, the business owner, admins).
create policy "booking_events: visible with the booking" on public.booking_events for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id));

create function public.protect_booking_events()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only a cascade from deleting the booking itself may remove history.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'Booking history cannot be changed' using errcode = 'check_violation';
end;
$$;

create trigger booking_events_append_only
before update or delete on public.booking_events
for each row execute function public.protect_booking_events();

-- ---------------------------------------------------------------------------
-- The workflow
-- ---------------------------------------------------------------------------

create or replace function public.is_valid_booking_transition(from_status public.booking_status, to_status public.booking_status)
returns boolean
language sql immutable set search_path = ''
as $$
  select from_status = to_status or (from_status, to_status) in (
    ('requested', 'pending_provider'), ('requested', 'cancelled'),
    ('pending_provider', 'accepted'), ('pending_provider', 'quoted'), ('pending_provider', 'declined'),
    ('pending_provider', 'cancelled'), ('pending_provider', 'expired'),
    ('quoted', 'accepted'), ('quoted', 'cancelled'), ('quoted', 'expired'),
    ('accepted', 'payment_pending'), ('accepted', 'cancelled'), ('accepted', 'expired'),
    ('payment_pending', 'confirmed'), ('payment_pending', 'cancelled'), ('payment_pending', 'expired'),
    ('confirmed', 'in_progress'), ('confirmed', 'completed'), ('confirmed', 'cancelled'), ('confirmed', 'disputed'),
    ('in_progress', 'completed'), ('in_progress', 'disputed'), ('in_progress', 'cancelled'),
    ('completed', 'reviewed'), ('completed', 'disputed'),
    ('reviewed', 'disputed'),
    ('disputed', 'completed'), ('disputed', 'reviewed'), ('disputed', 'cancelled'),
    ('disputed', 'confirmed'), ('disputed', 'in_progress'),
    ('cancelled', 'refunded')
  );
$$;

create or replace function public.guard_booking_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor uuid := coalesce(new.change_actor_id, auth.uid());
  actor_role text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'requested' then
      raise exception 'New bookings must start as requested' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.businesses where id = new.business_id and status = 'approved') then
      raise exception 'Bookings can only be made with approved businesses' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.users where id = new.customer_id and role = 'customer' and status = 'active') then
      raise exception 'Only active customers can make bookings' using errcode = 'check_violation';
    end if;
  else
    if new.customer_id <> old.customer_id or new.business_id <> old.business_id then
      raise exception 'A booking cannot change customer or business' using errcode = 'check_violation';
    end if;
    if not public.is_valid_booking_transition(old.status, new.status) then
      raise exception 'Invalid booking status change from % to %', old.status, new.status using errcode = 'check_violation';
    end if;
    if new.status <> old.status then
      case new.status
        when 'accepted' then new.accepted_at := coalesce(new.accepted_at, now());
        when 'confirmed' then new.confirmed_at := coalesce(new.confirmed_at, now());
        when 'completed' then new.completed_at := coalesce(new.completed_at, now());
        when 'cancelled' then new.cancelled_at := coalesce(new.cancelled_at, now());
        else null;
      end case;
    end if;
  end if;

  -- Record the change in the booking's history (creation is recorded once the row exists, below).
  select u.role::text into actor_role from public.users u where u.id = actor;
  if tg_op = 'UPDATE' then
    if new.status <> old.status then
      insert into public.booking_events (booking_id, event, from_status, to_status, actor_id, actor_role, note, metadata)
      values (new.id, 'status_changed', old.status, new.status, actor, coalesce(actor_role, 'system'),
        coalesce(new.change_note, case when new.status in ('cancelled', 'declined') then new.cancellation_reason end),
        case when new.total_minor <> old.total_minor then jsonb_build_object('total_minor', new.total_minor) else '{}'::jsonb end);
    end if;
    if new.scheduled_start is distinct from old.scheduled_start then
      insert into public.booking_events (booking_id, event, from_status, to_status, actor_id, actor_role, note, metadata)
      values (new.id, 'rescheduled', new.status, new.status, actor, coalesce(actor_role, 'system'), new.change_note,
        jsonb_build_object('from', old.scheduled_start, 'to', new.scheduled_start));
    end if;
  end if;
  new.change_actor_id := null;
  new.change_note := null;
  return new;
end;
$$;

-- A booking is always created by its customer.
create function public.record_booking_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.booking_events (booking_id, event, to_status, actor_id, actor_role)
  values (new.id, 'created', new.status, new.customer_id, 'customer');
  return new;
end;
$$;

create trigger bookings_record_created
after insert on public.bookings
for each row execute function public.record_booking_created();

-- Chat opens on confirmation and closes when a booking ends without going ahead.
create or replace function public.sync_conversation_with_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    insert into public.conversations (booking_id, customer_id, business_id)
    values (new.id, new.customer_id, new.business_id)
    on conflict (booking_id) do update set status = 'open';
  elsif new.status in ('cancelled', 'declined', 'expired', 'refunded') then
    update public.conversations set status = 'closed' where booking_id = new.id and status = 'open';
  end if;
  return new;
end;
$$;

-- A review can be left once the job is completed; leaving it moves the booking to reviewed.
create or replace function public.check_review_booking()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.bookings
    where id = new.booking_id and customer_id = new.customer_id
      and business_id = new.business_id and status in ('completed', 'reviewed')
  ) then
    raise exception 'Reviews are only allowed on your own completed bookings' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create function public.mark_booking_reviewed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.bookings
  set status = 'reviewed', change_actor_id = new.customer_id, change_note = new.rating || '-star review'
  where id = new.booking_id and status = 'completed';
  return new;
end;
$$;

create trigger reviews_mark_booking_reviewed
after insert on public.reviews
for each row execute function public.mark_booking_reviewed();

-- Busy-day checks now include bookings waiting for payment.
drop index public.bookings_schedule_idx;
create index bookings_schedule_idx on public.bookings (business_id, scheduled_start)
  where status in ('accepted', 'payment_pending', 'confirmed', 'in_progress');

-- ---------------------------------------------------------------------------
-- Creating a booking: the booking and its items in one transaction, then straight to the business.
-- Called by the server after it has checked and priced everything.
-- ---------------------------------------------------------------------------

create function public.create_booking(p_booking jsonb, p_items jsonb)
returns table (id uuid, reference text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  bk public.bookings;
begin
  insert into public.bookings (
    customer_id, business_id, status, scheduled_start, scheduled_end, address_line, area, city, state,
    guests, customer_notes, needs_quote, subtotal_minor, platform_fee_minor, total_minor, commission_rate_bps,
    change_actor_id
  ) values (
    (p_booking ->> 'customer_id')::uuid,
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
    (p_booking ->> 'customer_id')::uuid
  )
  returning * into bk;

  insert into public.booking_items (booking_id, service_id, name, unit_price_minor, quantity, kind)
  select bk.id, (item ->> 'service_id')::uuid, item ->> 'name', (item ->> 'unit_price_minor')::bigint,
    (item ->> 'quantity')::integer, item ->> 'kind'
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as item;

  update public.bookings b set status = 'pending_provider'
  where b.id = bk.id;

  return query select bk.id, bk.reference;
end;
$$;

comment on function public.create_booking(jsonb, jsonb) is
  'Creates a booking and its items atomically and sends it to the business (requested → pending_provider). Server only.';
revoke execute on function public.create_booking(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_booking(jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Existing bookings move to the new states.
-- ---------------------------------------------------------------------------

alter table public.bookings disable trigger bookings_guard;
alter table public.bookings disable trigger bookings_sync_conversation;
update public.bookings set needs_quote = true where status in ('quote_requested', 'quoted');
update public.bookings set status = 'pending_provider' where status in ('quote_requested', 'requested');
update public.bookings b set status = 'reviewed'
where status = 'completed' and exists (select 1 from public.reviews r where r.booking_id = b.id);
alter table public.bookings enable trigger bookings_sync_conversation;
alter table public.bookings enable trigger bookings_guard;

-- What we know about earlier bookings, so every booking has a history.
insert into public.booking_events (booking_id, event, to_status, actor_id, actor_role, created_at)
select id, 'created', 'requested', customer_id, 'customer', created_at from public.bookings;
insert into public.booking_events (booking_id, event, from_status, to_status, actor_role, created_at)
select id, 'status_changed', 'requested', 'pending_provider', 'system', created_at from public.bookings;
insert into public.booking_events (booking_id, event, from_status, to_status, actor_role, note, created_at)
select id, 'status_changed', null, status, 'system', 'Status when the booking history began', updated_at
from public.bookings where status <> 'pending_provider';

-- quote_requested is no longer used: quote requests are pending_provider with needs_quote.
alter table public.bookings add constraint bookings_no_legacy_quote_status check (status <> 'quote_requested');

-- ---------------------------------------------------------------------------
-- Completed jobs include reviewed ones; busy days include bookings waiting for payment.
-- ---------------------------------------------------------------------------

create or replace function public.match_businesses(
  p_query text default null,            -- free text: "birthday photographer"
  p_category text default null,         -- category slug; includes its sub-categories
  p_state text default null,            -- e.g. 'Lagos', 'FCT'
  p_city text default null,             -- e.g. 'Lagos', 'Abuja'
  p_area text default null,             -- e.g. 'Victoria Island'; also matched against cities
  p_date date default null,             -- the day the service is needed (Lagos time)
  p_time time default null,             -- optional start time on that day
  p_guests integer default null,
  p_budget_minor bigint default null,   -- the customer's budget, in kobo (ranks; doesn't filter)
  p_max_price_minor bigint default null, -- hard price cap from the search filters (quote-only still shows)
  p_sort text default 'match',          -- match | rating | price_low | price_high
  p_limit integer default 20,
  p_offset integer default 0,
  p_ids uuid[] default null              -- only these businesses (the concierge's details and comparisons)
)
returns table (
  id uuid,
  name text,
  slug text,
  description text,
  logo_path text,
  cover_path text,
  city text,
  state text,
  is_verified boolean,
  rating_avg numeric,
  rating_count integer,
  category_name text,
  min_price_minor bigint,
  max_price_minor bigint,     -- highest price among the same services, for a price range
  has_quote_only boolean,
  matched_services text[],
  served_areas text[],
  completed_bookings integer,
  location_match text,        -- area | city | state | nearby (null when no location was asked for)
  availability text,          -- available | unavailable | unknown (unknown when no date was asked for)
  availability_note text,     -- why it's unavailable, in plain words
  within_budget boolean,      -- null when there's no budget or no listed price
  guest_capacity integer,     -- largest "up to N guests" among the matched services, if any
  fits_guests boolean,        -- null when unknown
  score real,                 -- 0-100, higher is a better match
  score_parts jsonb
)
language plpgsql
stable
security definer -- reads booking counts and owner status; returns public fields of eligible businesses only
set search_path = ''
as $$
#variable_conflict use_column
declare
  ts_query tsquery;
  terms text;
  lagos_now timestamp := now() at time zone 'Africa/Lagos';
  dow smallint := case when p_date is null then null else extract(dow from p_date)::smallint end;
begin
  -- "birthday photographer" -> birthday:* | photograph:*
  select string_agg(w || ':*', ' | ')
  into terms
  from regexp_split_to_table(lower(regexp_replace(coalesce(p_query, ''), '[^[:alnum:] ]', ' ', 'g')), '\s+') w
  where length(w) >= 3;
  if terms is not null then
    ts_query := to_tsquery('english', terms);
  end if;

  return query
  with
  category_ids as (
    select c.id from public.service_categories c
    where p_category is not null
      and (c.slug = p_category
           or c.parent_id in (select c2.id from public.service_categories c2 where c2.slug = p_category))
  ),
  -- Platform eligibility rules. Nothing outside this set is ever returned.
  eligible as (
    select b.*
    from public.businesses b
    join public.users owner on owner.id = b.owner_id
    where b.status = 'approved'
      and (p_ids is null or b.id = any (p_ids))
      and b.is_verified
      and b.accepting_bookings
      and owner.status = 'active'
      and exists (select 1 from public.business_services s
                  where s.business_id = b.id and s.is_active and not s.is_addon)
  ),
  candidates as (
    select
      b.id, b.name, b.slug, b.description, b.logo_path, b.cover_path, b.city, b.state,
      b.is_verified, b.rating_avg, b.rating_count, b.min_notice_hours, b.booking_window_days,
      b.max_bookings_per_day,
      pc.name as primary_category_name,
      (b.primary_category_id in (select ci.id from category_ids ci)
        or exists (select 1 from public.business_services s
                   where s.business_id = b.id and s.is_active and not s.is_addon
                     and s.category_id in (select ci.id from category_ids ci))) as in_category,
      (
        setweight(to_tsvector('english', b.name), 'A')
        || setweight(to_tsvector('english', coalesce(b.description, '')), 'C')
        || setweight(to_tsvector('english', coalesce(pc.name, '')), 'B')
        || setweight(to_tsvector('english', coalesce((
             select string_agg(s.name || ' ' || coalesce(s.description, '') || ' ' || array_to_string(s.package_includes, ' '), ' ')
             from public.business_services s where s.business_id = b.id and s.is_active and not s.is_addon
           ), '')), 'B')
      ) as doc,
      array(
        select distinct coalesce(sa.area, sa.city, sa.state)
        from public.service_areas sa where sa.business_id = b.id
      ) as areas,
      case
        when p_state is null and p_city is null and p_area is null then null
        when p_area is not null and exists (
          select 1 from public.service_areas sa where sa.business_id = b.id
            and (sa.area ilike p_area or (sa.area is null and sa.city ilike p_area))) then 'area'
        when p_area is not null and b.city ilike p_area then 'area'
        -- City-wide: serves the whole city, or the customer only named the city.
        when p_city is not null and exists (
          select 1 from public.service_areas sa where sa.business_id = b.id
            and sa.city ilike p_city and (sa.area is null or p_area is null)) then 'city'
        when p_city is not null and p_area is null and b.city ilike p_city then 'city'
        -- State-wide: serves the whole state, or the customer only named the state.
        when p_state is not null and exists (
          select 1 from public.service_areas sa where sa.business_id = b.id
            and sa.state ilike p_state and ((sa.area is null and sa.city is null) or (p_city is null and p_area is null))) then 'state'
        when p_state is not null and p_city is null and p_area is null and b.state ilike p_state then 'state'
        -- Elsewhere in the same state: shown as a weaker, nearby match.
        when p_state is not null and (b.state ilike p_state or exists (
          select 1 from public.service_areas sa where sa.business_id = b.id and sa.state ilike p_state)) then 'region'
        else 'none'
      end as location_hit
    from eligible b
    left join public.service_categories pc on pc.id = b.primary_category_id
  ),
  filtered as (
    select c.*,
      case when ts_query is null then 0 else ts_rank(c.doc, ts_query) end as text_rank
    from candidates c
    where (p_category is null or c.in_category)
      and (ts_query is null or c.doc @@ ts_query or (p_category is not null and c.in_category))
      -- Outside the customer's state is never a match; nearby areas in the same state can be.
      and (c.location_hit is null or c.location_hit <> 'none')
  ),
  detailed as (
    select f.*,
      -- Services that fit the request (all of them when there's nothing to match on).
      array(
        select s.name from public.business_services s
        where s.business_id = f.id and s.is_active and not s.is_addon
          and (ts_query is null
               or to_tsvector('english', s.name || ' ' || coalesce(s.description, '') || ' ' || array_to_string(s.package_includes, ' ')) @@ ts_query
               or (p_category is not null and s.category_id in (select ci.id from category_ids ci)))
        order by s.sort_order, s.name
        limit 3
      ) as services_hit,
      (
        select min(s.price_minor) from public.business_services s
        where s.business_id = f.id and s.is_active and not s.is_addon and s.price_minor is not null
          and (ts_query is null
               or to_tsvector('english', s.name || ' ' || coalesce(s.description, '') || ' ' || array_to_string(s.package_includes, ' ')) @@ ts_query
               or not exists (select 1 from public.business_services s2
                              where s2.business_id = f.id and s2.is_active and not s2.is_addon
                                and to_tsvector('english', s2.name || ' ' || coalesce(s2.description, '') || ' ' || array_to_string(s2.package_includes, ' ')) @@ ts_query))
      ) as from_price,
      (
        select max(s.price_minor) from public.business_services s
        where s.business_id = f.id and s.is_active and not s.is_addon and s.price_minor is not null
          and (ts_query is null
               or to_tsvector('english', s.name || ' ' || coalesce(s.description, '') || ' ' || array_to_string(s.package_includes, ' ')) @@ ts_query
               or not exists (select 1 from public.business_services s2
                              where s2.business_id = f.id and s2.is_active and not s2.is_addon
                                and to_tsvector('english', s2.name || ' ' || coalesce(s2.description, '') || ' ' || array_to_string(s2.package_includes, ' ')) @@ ts_query))
      ) as to_price,
      exists (select 1 from public.business_services s
              where s.business_id = f.id and s.is_active and not s.is_addon and s.pricing_type = 'quote_only') as quote_only,
      (
        select max((m[1])::int) from public.business_services s,
          lateral regexp_matches(s.name || ' ' || coalesce(s.description, '') || ' ' || array_to_string(s.package_includes, ' '),
                                 '(?:up to|max(?:imum)?|for)\s+(\d{1,5})\s+(?:guests|people|persons|pax)', 'gi') m
        where s.business_id = f.id and s.is_active and not s.is_addon
      ) as capacity,
      (select count(*)::int from public.bookings bk where bk.business_id = f.id and bk.status in ('completed', 'reviewed')) as completed,
      -- Availability on the requested day.
      case
        when p_date is null then null
        when (p_date + coalesce(p_time, time '23:59')) < lagos_now + make_interval(hours => f.min_notice_hours)
          then 'Needs ' || case when f.min_notice_hours >= 48 then (f.min_notice_hours / 24) || ' days’' else f.min_notice_hours || ' hours’' end || ' notice'
        when p_date > (lagos_now::date + f.booking_window_days)
          then 'Only takes bookings ' || f.booking_window_days || ' days ahead'
        when exists (select 1 from public.business_availability a
                     where a.business_id = f.id and a.specific_date = p_date and not a.is_available)
          then 'Not working that day'
        when not exists (
          select 1 from public.business_availability a
          where a.business_id = f.id and a.is_available
            and (a.specific_date = p_date or (a.specific_date is null and a.day_of_week = dow))
            and (p_time is null or (p_time >= a.start_time and p_time < a.end_time)))
          then case when p_time is null then 'Not working that day' else 'Not working at that time' end
        when f.max_bookings_per_day is not null and (
          select count(*) from public.bookings bk
          where bk.business_id = f.id and bk.status in ('accepted', 'payment_pending', 'confirmed', 'in_progress')
            and (bk.scheduled_start at time zone 'Africa/Lagos')::date = p_date) >= f.max_bookings_per_day
          then 'Fully booked that day'
        else ''
      end as unavailable_reason
    from filtered f
  ),
  scored as (
    select d.*,
      -- Relevance: right category and services that match the words used (0-30).
      least(30, (case when p_category is not null and d.in_category then 15 else 0 end)
        + (case when ts_query is null then (case when p_category is null then 15 else 10 end)
                else least(15, d.text_rank * 60) end))::real as s_relevance,
      -- Location: exact area beats the whole city, which beats the state (0-20).
      (case d.location_hit when 'area' then 20 when 'city' then 15 when 'state' then 10
         when 'region' then 4 else 10 end)::real as s_location,
      -- Availability on the date (0-15).
      (case when d.unavailable_reason is null then 8 when d.unavailable_reason = '' then 15 else 0 end)::real as s_availability,
      -- Price against the budget (0-15). Over-budget scores fall with how far over they are.
      (case
         when p_budget_minor is null then 8
         when d.from_price is null then (case when d.quote_only then 8 else 4 end)
         when d.from_price <= p_budget_minor then 15
         else greatest(0, 15 - 30 * (d.from_price - p_budget_minor)::numeric / greatest(p_budget_minor, 1))
       end)::real as s_price,
      -- Rating, pulled towards 4.0 when there are few reviews (0-10).
      ((d.rating_avg * d.rating_count + 4.0 * 3) / (d.rating_count + 3) / 5 * 10)::real as s_rating,
      -- Track record: completed bookings on Concierge (0-5).
      (5 * ln(1 + least(d.completed, 50)) / ln(51))::real as s_experience,
      (case when d.is_verified then 5 else 0 end)::real as s_verified,
      -- Group size: a small penalty when every matched service is too small.
      (case when p_guests is null or d.capacity is null then 0
            when d.capacity >= p_guests then 0 else -10 end)::real as s_guests
    from detailed d
  ),
  final as (
    select s.*,
      greatest(0, least(100, s.s_relevance + s.s_location + s.s_availability + s.s_price
        + s.s_rating + s.s_experience + s.s_verified + s.s_guests))::real as total
    from scored s
  )
  select
    f.id, f.name, f.slug, f.description, f.logo_path, f.cover_path, f.city, f.state,
    f.is_verified, f.rating_avg, f.rating_count, f.primary_category_name,
    f.from_price, f.to_price, f.quote_only, f.services_hit, f.areas, f.completed,
    case when f.location_hit = 'region' then 'nearby' else f.location_hit end,
    case when f.unavailable_reason is null then 'unknown'
         when f.unavailable_reason = '' then 'available' else 'unavailable' end,
    nullif(f.unavailable_reason, ''),
    case when p_budget_minor is null or f.from_price is null then null else f.from_price <= p_budget_minor end,
    f.capacity,
    case when p_guests is null or f.capacity is null then null else f.capacity >= p_guests end,
    round(f.total::numeric, 1)::real,
    jsonb_build_object(
      'relevance', round(f.s_relevance::numeric, 1), 'location', f.s_location,
      'availability', f.s_availability, 'price', round(f.s_price::numeric, 1),
      'rating', round(f.s_rating::numeric, 1), 'experience', round(f.s_experience::numeric, 1),
      'verified', f.s_verified, 'guests', f.s_guests
    )
  from final f
  where p_max_price_minor is null or f.from_price <= p_max_price_minor or (f.from_price is null and f.quote_only)
  order by
    case when p_sort = 'rating' then f.rating_avg end desc nulls last,
    case when p_sort = 'price_low' then f.from_price end asc nulls last,
    case when p_sort = 'price_high' then f.from_price end desc nulls last,
    f.total desc,
    f.rating_count desc,
    f.name
  limit least(greatest(p_limit, 1), 50)
  offset greatest(p_offset, 0);
end;
$$;

comment on function public.match_businesses is
  'Marketplace search and matching. Returns only eligible businesses registered on this platform: approved, verified, accepting bookings, active owner, at least one active service.';

revoke execute on function public.match_businesses from public;
grant execute on function public.match_businesses to anon, authenticated;

create or replace function public.get_business_stats(p_business_id uuid)
returns table (
  completed_bookings integer,
  min_price_minor bigint,
  max_price_minor bigint,
  has_quote_only boolean,
  rating_breakdown integer[]   -- published reviews with 1, 2, 3, 4 and 5 stars
)
language sql
stable
security definer -- counts bookings and reviews customers can't read; only for approved businesses
set search_path = ''
as $$
  select
    (select count(*)::int from public.bookings bk where bk.business_id = b.id and bk.status in ('completed', 'reviewed')),
    (select min(s.price_minor) from public.business_services s
      where s.business_id = b.id and s.is_active and not s.is_addon and s.price_minor is not null),
    (select max(s.price_minor) from public.business_services s
      where s.business_id = b.id and s.is_active and not s.is_addon and s.price_minor is not null),
    exists (select 1 from public.business_services s
      where s.business_id = b.id and s.is_active and not s.is_addon and s.pricing_type = 'quote_only'),
    array(select (select count(*)::int from public.reviews r
                  where r.business_id = b.id and r.status = 'published' and r.rating = n)
          from generate_series(1, 5) n order by n)
  from public.businesses b
  where b.id = p_business_id and b.status = 'approved';
$$;

comment on function public.get_business_stats(uuid) is
  'Public figures for an approved business profile: completed bookings, price range and rating breakdown.';

revoke execute on function public.get_business_stats(uuid) from public;
grant execute on function public.get_business_stats(uuid) to anon, authenticated;

create or replace function public.admin_dashboard_stats(top_n integer default 5)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with
  paid_bookings as (
    -- Bookings the customer has paid for (or that were completed before payments existed).
    select b.* from public.bookings b
    where b.status in ('confirmed', 'in_progress', 'completed', 'reviewed', 'disputed')
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
      where status in ('requested', 'pending_provider', 'quoted', 'accepted', 'payment_pending', 'confirmed', 'in_progress', 'disputed')),
    'completed_bookings', (select count(*) from public.bookings where status in ('completed', 'reviewed')),
    'cancelled_bookings', (select count(*) from public.bookings where status in ('cancelled', 'declined', 'refunded')),
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