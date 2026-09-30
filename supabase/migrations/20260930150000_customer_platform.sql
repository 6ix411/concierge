-- Stage 3: customer platform support.
-- - Platform-only business search (used by search pages and the concierge).
-- - Counterpart names for bookings and chat without exposing emails or phone numbers.
-- - A "mock" payment provider for development and tests (refused in production by app config).

alter type public.payment_provider add value if not exists 'mock';

-- Customers can still see businesses they've booked, even if the business is later hidden.
create policy "businesses: customers read businesses they booked" on public.businesses for select to authenticated
  using (exists (
    select 1 from public.bookings bk where bk.business_id = businesses.id and bk.customer_id = (select auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- Names of the people on the other side of a booking (no contact details).
-- ---------------------------------------------------------------------------
create function public.get_booking_counterparts(user_ids uuid[])
returns table (id uuid, full_name text, avatar_path text)
language sql stable security definer set search_path = ''
as $$
  select u.id, u.full_name, u.avatar_path
  from public.users u
  where u.id = any(user_ids)
    and (
      u.id = auth.uid()
      or public.is_admin()
      or exists (
        select 1 from public.bookings bk
        join public.businesses b on b.id = bk.business_id
        where (bk.customer_id = u.id and b.owner_id = auth.uid())
           or (bk.customer_id = auth.uid() and b.owner_id = u.id)
      )
    );
$$;
revoke execute on function public.get_booking_counterparts(uuid[]) from public, anon;
grant execute on function public.get_booking_counterparts(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Search: approved businesses only. Runs with the caller's rights, so row level
-- security still applies; there is no way for it to return unapproved businesses.
-- ---------------------------------------------------------------------------
create function public.search_businesses(
  p_query text default null,
  p_category text default null,     -- category slug (includes child categories)
  p_location text default null,     -- state, city or area, e.g. 'Lekki' or 'Lagos'
  p_max_price_minor bigint default null,
  p_sort text default 'relevance',  -- relevance | rating | price_low | price_high
  p_limit integer default 20,
  p_offset integer default 0
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
  matched_services text[],
  served_areas text[],
  relevance real
)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  ts_query tsquery;
  terms text;
begin
  -- Turn free text into an OR query of prefix terms: "wedding decorator" -> wedding:* | decor:*
  select string_agg(w || ':*', ' | ')
  into terms
  from regexp_split_to_table(lower(regexp_replace(coalesce(p_query, ''), '[^[:alnum:] ]', ' ', 'g')), '\s+') w
  where length(w) >= 3;
  if terms is not null then
    ts_query := to_tsquery('english', terms);
  end if;

  return query
  with category_ids as (
    select c.id from public.service_categories c
    where p_category is not null
      and (c.slug = p_category or c.parent_id in (select c2.id from public.service_categories c2 where c2.slug = p_category))
  ),
  candidates as (
    select
      b.id, b.name, b.slug, b.description, b.logo_path, b.cover_path, b.city, b.state,
      b.is_verified, b.rating_avg, b.rating_count,
      pc.name as primary_category_name,
      (
        setweight(to_tsvector('english', b.name), 'A')
        || setweight(to_tsvector('english', coalesce(b.description, '')), 'C')
        || setweight(to_tsvector('english', coalesce(pc.name, '')), 'B')
        || setweight(to_tsvector('english', coalesce((
             select string_agg(s.name || ' ' || coalesce(s.description, '') || ' ' || array_to_string(s.package_includes, ' '), ' ')
             from public.business_services s where s.business_id = b.id and s.is_active
           ), '')), 'B')
      ) as doc,
      array(
        select distinct coalesce(sa.area, sa.city, sa.state)
        from public.service_areas sa where sa.business_id = b.id
      ) as areas
    from public.businesses b
    left join public.service_categories pc on pc.id = b.primary_category_id
    where b.status = 'approved'
      and (
        p_category is null
        or b.primary_category_id in (select ci.id from category_ids ci)
        or exists (select 1 from public.business_services s
                   where s.business_id = b.id and s.is_active and s.category_id in (select ci.id from category_ids ci))
      )
      and (
        p_location is null
        or b.city ilike p_location or b.state ilike p_location
        or exists (
          select 1 from public.service_areas sa
          where sa.business_id = b.id
            and (sa.state ilike p_location or sa.city ilike p_location or sa.area ilike p_location)
        )
      )
  ),
  scored as (
    select
      c.*,
      case when ts_query is null then 0 else ts_rank(c.doc, ts_query) end as text_rank,
      array(
        select s.name from public.business_services s
        where s.business_id = c.id and s.is_active
          and (ts_query is null or to_tsvector('english', s.name || ' ' || coalesce(s.description, '')) @@ ts_query)
        order by s.sort_order, s.name
        limit 3
      ) as services_hit,
      (
        select min(s.price_minor) from public.business_services s
        where s.business_id = c.id and s.is_active and s.price_minor is not null
          and (ts_query is null
               or to_tsvector('english', s.name || ' ' || coalesce(s.description, '')) @@ ts_query
               or not exists (select 1 from public.business_services s2
                              where s2.business_id = c.id and s2.is_active
                                and to_tsvector('english', s2.name || ' ' || coalesce(s2.description, '')) @@ ts_query))
      ) as from_price,
      exists (select 1 from public.business_services s
              where s.business_id = c.id and s.is_active and s.pricing_type = 'quote_only') as has_quote_only
    from candidates c
    where ts_query is null or c.doc @@ ts_query
  )
  select
    s.id, s.name, s.slug, s.description, s.logo_path, s.cover_path, s.city, s.state,
    s.is_verified, s.rating_avg, s.rating_count, s.primary_category_name,
    s.from_price, s.services_hit, s.areas,
    (s.text_rank + s.rating_avg * 0.02 + least(s.rating_count, 50) * 0.001)::real as relevance
  from scored s
  where p_max_price_minor is null or s.from_price <= p_max_price_minor or (s.from_price is null and s.has_quote_only)
  order by
    case when p_sort = 'rating' then s.rating_avg end desc nulls last,
    case when p_sort = 'price_low' then s.from_price end asc nulls last,
    case when p_sort = 'price_high' then s.from_price end desc nulls last,
    (s.text_rank + s.rating_avg * 0.02 + least(s.rating_count, 50) * 0.001) desc,
    s.name
  limit least(greatest(p_limit, 1), 50)
  offset greatest(p_offset, 0);
end;
$$;

grant execute on function public.search_businesses(text, text, text, bigint, text, integer, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public reviews with a privacy-safe reviewer name ("Tolu A.").
-- ---------------------------------------------------------------------------
create function public.get_public_reviews(p_business_id uuid, p_limit integer default 20, p_offset integer default 0)
returns table (
  id uuid,
  rating smallint,
  comment text,
  business_reply text,
  business_replied_at timestamptz,
  created_at timestamptz,
  reviewer_name text
)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.rating, r.comment, r.business_reply, r.business_replied_at, r.created_at,
    coalesce(
      nullif(trim(split_part(u.full_name, ' ', 1) || ' ' || left(split_part(u.full_name, ' ', 2), 1) ||
        case when split_part(u.full_name, ' ', 2) <> '' then '.' else '' end), ''),
      'Customer'
    )
  from public.reviews r
  join public.users u on u.id = r.customer_id
  join public.businesses b on b.id = r.business_id
  where r.business_id = p_business_id and r.status = 'published' and b.status = 'approved'
  order by r.created_at desc
  limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0);
$$;
grant execute on function public.get_public_reviews(uuid, integer, integer) to anon, authenticated;
