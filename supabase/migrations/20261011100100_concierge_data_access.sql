-- Stage 16: what the AI Concierge can read.
-- The concierge reads through exactly two functions, as a visitor with no session (anon key):
-- `match_businesses` (search) and `concierge_provider_details` (one provider's structured details).
-- Both return public, structured fields of eligible businesses only. Nothing else is granted for it:
-- no table access beyond what any visitor has, no customer data, no contact details, no queries
-- written by the model.

create function public.concierge_provider_details(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with eligible as (
    -- The same eligibility rules as match_businesses.
    select b.id, b.description, b.min_notice_hours, b.booking_window_days
    from public.businesses b
    join public.users owner on owner.id = b.owner_id
    where b.id = p_business_id
      and b.status = 'approved'
      and b.is_verified
      and b.accepting_bookings
      and owner.status = 'active'
      and exists (select 1 from public.business_services s
                  where s.business_id = b.id and s.is_active and not s.is_addon)
  )
  select jsonb_build_object(
    'description', left(e.description, 600),
    'min_notice_hours', e.min_notice_hours,
    'booking_window_days', e.booking_window_days,
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'description', left(s.description, 300),
        'pricing_type', s.pricing_type, 'price_minor', s.price_minor,
        'duration_minutes', s.duration_minutes, 'is_addon', s.is_addon,
        'package_includes', s.package_includes
      ) order by s.sort_order, s.name)
      from public.business_services s where s.business_id = e.id and s.is_active), '[]'::jsonb),
    'areas', coalesce((
      select jsonb_agg(jsonb_build_object('area', a.area, 'city', a.city, 'state', a.state) order by a.area)
      from public.service_areas a where a.business_id = e.id), '[]'::jsonb),
    'weekly_hours', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day_of_week', h.day_of_week, 'start_time', h.start_time, 'end_time', h.end_time
      ) order by (h.day_of_week + 6) % 7)
      from public.business_availability h
      where h.business_id = e.id and h.specific_date is null and h.is_available and h.day_of_week is not null),
      '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object('rating', r.rating, 'comment', left(r.comment, 300), 'by', r.reviewer_name))
      from public.get_public_reviews(e.id, 5, 0) r), '[]'::jsonb)
  )
  from eligible e;
$$;

comment on function public.concierge_provider_details(uuid) is
  'Structured details of one eligible business for the AI Concierge: services and prices, areas, weekly hours, notice, booking window, recent published reviews. No contact details, documents, owner or customer data.';

revoke execute on function public.concierge_provider_details(uuid) from public;
grant execute on function public.concierge_provider_details(uuid) to anon, authenticated;
