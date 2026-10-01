-- Stage 8: provider results and business profiles.
--
-- match_businesses() also returns the top of each business's price range, and
-- get_business_stats() gives a profile page the figures customers can't read directly
-- (completed bookings, price range, rating breakdown), for approved businesses only.

drop function public.match_businesses(text, text, text, text, text, date, time, integer, bigint, bigint, text, integer, integer, uuid[]);

create function public.match_businesses(
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
      (select count(*)::int from public.bookings bk where bk.business_id = f.id and bk.status = 'completed') as completed,
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
          where bk.business_id = f.id and bk.status in ('accepted', 'confirmed', 'in_progress')
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


create function public.get_business_stats(p_business_id uuid)
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
    (select count(*)::int from public.bookings bk where bk.business_id = b.id and bk.status = 'completed'),
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
