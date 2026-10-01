-- Stage 4: business registration and dashboard.
-- - One business per business account.
-- - Booking settings the owner controls (pause bookings, notice, booking window, daily limit).
-- - Add-ons as a kind of service.
-- - Business status changes follow the review flow; only server code can change them.
-- - The platform can request specific verification information from a business.

create unique index businesses_one_per_owner on public.businesses (owner_id);

alter table public.businesses
  add column accepting_bookings boolean not null default true,
  add column min_notice_hours integer not null default 24 check (min_notice_hours between 0 and 720),
  add column booking_window_days integer not null default 180 check (booking_window_days between 1 and 730),
  add column max_bookings_per_day integer check (max_bookings_per_day between 1 and 100),
  add column submitted_at timestamptz,
  add column reviewed_at timestamptz,
  -- Uploads must live in the business's own storage folder.
  add constraint businesses_media_in_own_folder check (
    (logo_path is null or logo_path like id::text || '/%')
    and (cover_path is null or cover_path like id::text || '/%')
  );

grant select (accepting_bookings, min_notice_hours, booking_window_days, max_bookings_per_day, submitted_at, reviewed_at)
  on public.businesses to anon, authenticated;
grant update (accepting_bookings, min_notice_hours, booking_window_days, max_bookings_per_day)
  on public.businesses to authenticated;

alter table public.business_portfolio
  add constraint business_portfolio_in_own_folder check (storage_path like business_id::text || '/%');
alter table public.business_verifications
  add constraint business_verifications_in_own_folder check (document_path like business_id::text || '/%');

-- ---------------------------------------------------------------------------
-- Add-ons: optional extras booked together with a main service.
-- ---------------------------------------------------------------------------
alter table public.business_services
  add column is_addon boolean not null default false,
  add constraint business_services_package_or_addon check (not (is_package and is_addon));
grant insert (is_addon), update (is_addon) on public.business_services to authenticated;

-- ---------------------------------------------------------------------------
-- Business status: the review flow, with timestamps kept by the database.
-- ---------------------------------------------------------------------------
create function public.guard_business_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if (old.status::text, new.status::text) not in (
    ('draft', 'pending'),
    ('pending', 'under_review'), ('pending', 'approved'), ('pending', 'rejected'),
    ('under_review', 'approved'), ('under_review', 'rejected'),
    ('rejected', 'pending'),
    ('approved', 'suspended'), ('approved', 'under_review'),
    ('suspended', 'approved'), ('suspended', 'under_review')
  ) then
    raise exception 'Invalid business status change from % to %', old.status, new.status using errcode = 'check_violation';
  end if;

  if new.status = 'pending' then
    new.submitted_at := now();
  elsif new.status in ('approved', 'rejected') then
    new.reviewed_at := now();
  end if;
  if new.status = 'approved' then
    new.is_verified := true;
    new.verified_at := coalesce(new.verified_at, now());
  end if;
  return new;
end;
$$;

create trigger businesses_guard_status
before update of status on public.businesses
for each row execute function public.guard_business_status();

-- ---------------------------------------------------------------------------
-- Verification requests: the platform asks a business for specific information.
-- ---------------------------------------------------------------------------
create type public.verification_request_status as enum ('open', 'submitted', 'closed');

create table public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  requested_by uuid not null references public.users (id) on delete restrict,
  document_type public.verification_document_type, -- null: any document that answers the message
  message text not null check (char_length(message) between 2 and 1000),
  status public.verification_request_status not null default 'open',
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.verification_requests is 'Written by server code only (admins request, owners respond by submitting documents).';
create index verification_requests_business_idx on public.verification_requests (business_id, status);

create trigger verification_requests_set_updated_at
before update on public.verification_requests
for each row execute function public.set_updated_at();

alter table public.verification_requests enable row level security;
grant select on public.verification_requests to authenticated;
create policy "verification_requests: owners read own" on public.verification_requests for select to authenticated
  using ((select public.owns_business(business_id)));
create policy "verification_requests: admins read all" on public.verification_requests for select to authenticated
  using ((select public.is_admin()));

alter table public.business_verifications
  add column request_id uuid references public.verification_requests (id) on delete set null;
create index business_verifications_request_idx on public.business_verifications (request_id);
grant insert (request_id) on public.business_verifications to authenticated;

-- A document can only answer a request for the same business.
create function public.check_verification_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.request_id is not null
     and not exists (select 1 from public.verification_requests r
                     where r.id = new.request_id and r.business_id = new.business_id) then
    raise exception 'Verification request belongs to another business' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger business_verifications_check_request
before insert or update of request_id on public.business_verifications
for each row execute function public.check_verification_request();

-- ---------------------------------------------------------------------------
-- Search: add-ons are extras, so they never set a business's "from" price.
-- Still approved businesses only (pending, under review, rejected and suspended never match).
-- ---------------------------------------------------------------------------
create or replace function public.search_businesses(
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
        where s.business_id = c.id and s.is_active and not s.is_addon and s.price_minor is not null
          and (ts_query is null
               or to_tsvector('english', s.name || ' ' || coalesce(s.description, '')) @@ ts_query
               or not exists (select 1 from public.business_services s2
                              where s2.business_id = c.id and s2.is_active and not s2.is_addon
                                and to_tsvector('english', s2.name || ' ' || coalesce(s2.description, '')) @@ ts_query))
      ) as from_price,
      exists (select 1 from public.business_services s
              where s.business_id = c.id and s.is_active and not s.is_addon and s.pricing_type = 'quote_only') as has_quote_only
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

