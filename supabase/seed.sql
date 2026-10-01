-- Local development seed data. Runs on `npm run db:reset`; never in production.
--
-- Demo logins (password for all: Password123)
--   customer@demo.ng   customer
--   tolu@demo.ng       customer (has past bookings and reviews)
--   owner@demo.ng      business owner (Lush Events Décor)
--   admin@demo.ng      admin

insert into public.service_categories (name, slug, description, icon, sort_order) values
  ('Events', 'events', 'Decoration, catering, photography and entertainment', 'sparkles', 1),
  ('Home Services', 'home-services', 'Cleaning, plumbing, electrical and repairs', 'home', 2),
  ('Beauty & Wellness', 'beauty-wellness', 'Hair, makeup, nails, spa and fitness', 'heart', 3),
  ('Automotive', 'automotive', 'Mechanics, car wash and detailing', 'car', 4),
  ('Tech & Repairs', 'tech-repairs', 'Phone, laptop and appliance repair', 'wrench', 5),
  ('Logistics', 'logistics', 'Moving, delivery and dispatch', 'truck', 6)
on conflict (slug) do nothing;

insert into public.service_categories (name, slug, parent_id, sort_order)
select v.name, v.slug, p.id, v.sort_order
from (values
  ('Event Decoration', 'event-decoration', 'events', 1),
  ('Catering', 'catering', 'events', 2),
  ('Photography & Video', 'photography-video', 'events', 3),
  ('Cleaning', 'cleaning', 'home-services', 1),
  ('Plumbing', 'plumbing', 'home-services', 2),
  ('Makeup & Hair', 'makeup-hair', 'beauty-wellness', 1),
  ('Moving', 'moving', 'logistics', 1)
) as v(name, slug, parent_slug, sort_order)
join public.service_categories p on p.slug = v.parent_slug
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Demo users
-- ---------------------------------------------------------------------------
create function pg_temp.demo_user(p_id uuid, p_email text, p_name text, p_role text)
returns void language plpgsql as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt('Password123', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', p_name, 'role', case when p_role = 'admin' then 'customer' else p_role end),
    now(), now(), '', '', '', ''
  );
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), p_id::text, p_id, jsonb_build_object('sub', p_id::text, 'email', p_email), 'email', now(), now(), now());
  if p_role = 'admin' then
    update public.users set role = 'admin' where id = p_id;
  end if;
end;
$$;

select pg_temp.demo_user('a0000000-0000-0000-0000-000000000001', 'customer@demo.ng', 'Chioma Okafor', 'customer');
select pg_temp.demo_user('a0000000-0000-0000-0000-000000000002', 'tolu@demo.ng', 'Tolu Adebayo', 'customer');
select pg_temp.demo_user('a0000000-0000-0000-0000-000000000003', 'emeka@demo.ng', 'Emeka Nwosu', 'customer');
select pg_temp.demo_user('a0000000-0000-0000-0000-0000000000ad', 'admin@demo.ng', 'Platform Admin', 'admin');

select pg_temp.demo_user('b0000000-0000-0000-0000-000000000001', 'owner@demo.ng', 'Adaeze Lush', 'business');
select pg_temp.demo_user('b0000000-0000-0000-0000-000000000002', 'royal@demo.ng', 'Kunle Royal', 'business');
select pg_temp.demo_user('b0000000-0000-0000-0000-000000000003', 'mamaput@demo.ng', 'Ngozi Eze', 'business');
select pg_temp.demo_user('b0000000-0000-0000-0000-000000000004', 'sparkle@demo.ng', 'Bisi Ade', 'business');
select pg_temp.demo_user('b0000000-0000-0000-0000-000000000005', 'fixit@demo.ng', 'Musa Ibrahim', 'business');
select pg_temp.demo_user('b0000000-0000-0000-0000-000000000006', 'glow@demo.ng', 'Funke Ola', 'business');
select pg_temp.demo_user('b0000000-0000-0000-0000-000000000007', 'lens@demo.ng', 'David Okon', 'business');
select pg_temp.demo_user('b0000000-0000-0000-0000-000000000008', 'moves@demo.ng', 'Aisha Bello', 'business');
select pg_temp.demo_user('b0000000-0000-0000-0000-000000000009', 'pending@demo.ng', 'Pending Owner', 'business');

-- ---------------------------------------------------------------------------
-- Demo businesses (all approved except the last)
-- ---------------------------------------------------------------------------
insert into public.businesses (id, owner_id, name, slug, description, primary_category_id, phone, email,
  address_line, city, state, status, is_verified, verified_at)
select v.id::uuid, v.owner::uuid, v.name, v.slug, v.description, c.id, v.phone, v.email,
  v.address, v.city, v.state, v.status::public.business_status, v.status = 'approved',
  case when v.status = 'approved' then now() end
from (values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Lush Events Décor', 'lush-events-decor',
   'Luxury wedding and event decoration across Lagos. Floral installations, stage backdrops, table styling and lighting for 50 to 1,000 guests.',
   'event-decoration', '+2348030000001', 'hello@lushevents.ng', '12 Admiralty Way', 'Lekki', 'Lagos', 'approved'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'Royal Touch Decorations', 'royal-touch-decorations',
   'Elegant traditional and white wedding decor. Known for gold-and-ivory themes, aso-ebi colour matching and fast setup.',
   'event-decoration', '+2348030000002', 'events@royaltouch.ng', '5 Adeola Odeku St', 'Victoria Island', 'Lagos', 'approved'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'Mama Put Catering Co.', 'mama-put-catering',
   'Nigerian and continental catering for weddings, birthdays and corporate events. Jollof, small chops, grills and live stations.',
   'catering', '+2348030000003', 'orders@mamaput.ng', '20 Bode Thomas St', 'Surulere', 'Lagos', 'approved'),
  ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000004', 'Sparkle Home Cleaning', 'sparkle-home-cleaning',
   'Trained, background-checked cleaners for homes and offices. Deep cleaning, post-construction and move-in/move-out cleans.',
   'cleaning', '+2348030000004', 'book@sparkle.ng', '3 Chevron Drive', 'Lekki', 'Lagos', 'approved'),
  ('c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000005', 'FixIt Plumbing Services', 'fixit-plumbing',
   'Licensed plumbers for leaks, blocked drains, water heaters and bathroom installations. Same-day call-outs in Ikeja and mainland.',
   'plumbing', '+2348030000005', 'help@fixit.ng', '8 Allen Avenue', 'Ikeja', 'Lagos', 'approved'),
  ('c0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000006', 'Glow Studio Makeup', 'glow-studio-makeup',
   'Bridal and editorial makeup artists. Bridal trials, gele tying and full bridal party packages.',
   'makeup-hair', '+2348030000006', 'glow@glowstudio.ng', '14 Awolowo Road', 'Ikoyi', 'Lagos', 'approved'),
  ('c0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000007', 'Lens & Light Photography', 'lens-and-light',
   'Wedding photography and cinematic video. Pre-wedding shoots, drone coverage and same-week highlight films.',
   'photography-video', '+2348030000007', 'studio@lensandlight.ng', '2 Fola Osibo Rd', 'Lekki', 'Lagos', 'approved'),
  ('c0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000008', 'Abuja Moves Logistics', 'abuja-moves',
   'Home and office relocation within Abuja. Packing, loading, trucks and careful handling of fragile items.',
   'moving', '+2348030000008', 'move@abujamoves.ng', '10 Aminu Kano Crescent', 'Wuse 2', 'FCT', 'approved'),
  ('c0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000009', 'Unverified Decor Hub', 'unverified-decor-hub',
   'Pending review. Must never appear to customers or the concierge.',
   'event-decoration', '+2348030000009', null, null, 'Lekki', 'Lagos', 'pending')
) as v(id, owner, name, slug, description, category, phone, email, address, city, state, status)
join public.service_categories c on c.slug = v.category;

insert into public.business_services (business_id, category_id, name, description, pricing_type, price_minor,
  duration_minutes, is_package, package_includes, sort_order)
select v.biz::uuid, c.id, v.name, v.description, v.pricing::public.pricing_type, v.price, v.duration,
  v.is_package, v.includes, v.sort_order
from (values
  ('c0000000-0000-0000-0000-000000000001', 'event-decoration', 'Classic Wedding Decor (up to 300 guests)',
   'Full reception decoration: stage backdrop, centrepieces, chair covers and ambient lighting.', 'fixed', 120000000, 480, true,
   array['Stage backdrop', 'Table centrepieces for 30 tables', 'Chair covers and sashes', 'Ambient uplighting'], 1),
  ('c0000000-0000-0000-0000-000000000001', 'event-decoration', 'Premium Wedding Decor (up to 500 guests)',
   'Luxury floral installations, ceiling draping, LED dance floor and a dedicated styling team.', 'fixed', 250000000, 600, true,
   array['Fresh floral installations', 'Ceiling draping', 'LED dance floor', 'Two stylists on the day'], 2),
  ('c0000000-0000-0000-0000-000000000001', 'event-decoration', 'Custom Event Styling',
   'Birthdays, engagements and corporate events styled to your theme.', 'quote_only', null, null, false, array[]::text[], 3),
  ('c0000000-0000-0000-0000-000000000002', 'event-decoration', 'Traditional Wedding Decor',
   'Gold-and-ivory traditional setup with aso-ebi colour matching.', 'starting_from', 90000000, 480, false, array[]::text[], 1),
  ('c0000000-0000-0000-0000-000000000002', 'event-decoration', 'White Wedding Reception Decor',
   'Reception hall decoration for up to 400 guests.', 'fixed', 140000000, 480, false, array[]::text[], 2),
  ('c0000000-0000-0000-0000-000000000003', 'catering', 'Wedding Catering (per 100 guests)',
   'Jollof, fried rice, small chops, protein and drinks service for 100 guests.', 'fixed', 45000000, 360, false, array[]::text[], 1),
  ('c0000000-0000-0000-0000-000000000003', 'catering', 'Small Chops Package',
   'Puff-puff, samosa, spring rolls and asun for 50 guests.', 'fixed', 8500000, 180, false, array[]::text[], 2),
  ('c0000000-0000-0000-0000-000000000004', 'cleaning', 'Deep Home Cleaning',
   'Top-to-bottom clean of a 3-bedroom home including kitchen and bathrooms.', 'fixed', 4500000, 300, false, array[]::text[], 1),
  ('c0000000-0000-0000-0000-000000000004', 'cleaning', 'Regular Cleaning Visit',
   'Weekly or one-off tidy, dusting, mopping and bathroom clean.', 'fixed', 2500000, 180, false, array[]::text[], 2),
  ('c0000000-0000-0000-0000-000000000004', 'cleaning', 'Post-Construction Cleaning',
   'Dust and debris removal after renovation.', 'quote_only', null, null, false, array[]::text[], 3),
  ('c0000000-0000-0000-0000-000000000005', 'plumbing', 'Plumbing Call-out (per hour)',
   'Leaks, blocked drains, taps and toilets.', 'hourly', 800000, 60, false, array[]::text[], 1),
  ('c0000000-0000-0000-0000-000000000005', 'plumbing', 'Water Heater Installation',
   'Supply-and-fit not included; installation of your heater.', 'fixed', 3500000, 180, false, array[]::text[], 2),
  ('c0000000-0000-0000-0000-000000000006', 'makeup-hair', 'Bridal Makeup + Gele',
   'Bridal makeup, lashes and gele tying on the day.', 'fixed', 15000000, 180, false, array[]::text[], 1),
  ('c0000000-0000-0000-0000-000000000006', 'makeup-hair', 'Bridal Party Package (bride + 4)',
   'Makeup for the bride and four bridesmaids.', 'fixed', 35000000, 300, true,
   array['Bride makeup and gele', 'Four bridesmaids', 'Touch-up kit'], 2),
  ('c0000000-0000-0000-0000-000000000007', 'photography-video', 'Wedding Photography (full day)',
   'Two photographers, 400+ edited photos and an online gallery.', 'fixed', 60000000, 720, false, array[]::text[], 1),
  ('c0000000-0000-0000-0000-000000000007', 'photography-video', 'Photo + Cinematic Video',
   'Photography plus a 5-minute highlight film and full ceremony video.', 'fixed', 110000000, 720, true,
   array['Two photographers', 'Videographer and drone', '5-minute highlight film'], 2),
  ('c0000000-0000-0000-0000-000000000008', 'moving', 'Home Relocation (within Abuja)',
   'Packing, loading, transport and unloading.', 'starting_from', 15000000, 480, false, array[]::text[], 1),
  ('c0000000-0000-0000-0000-000000000009', 'event-decoration', 'Budget Decor',
   'Hidden: business not approved.', 'fixed', 10000000, 240, false, array[]::text[], 1)
) as v(biz, category, name, description, pricing, price, duration, is_package, includes, sort_order)
join public.service_categories c on c.slug = v.category;

-- Add-ons: optional extras booked with a main service.
insert into public.business_services (business_id, category_id, name, description, pricing_type, price_minor,
  duration_minutes, is_addon, sort_order)
select v.biz::uuid, c.id, v.name, v.description, 'fixed', v.price, v.duration, true, v.sort_order
from (values
  ('c0000000-0000-0000-0000-000000000001', 'event-decoration', 'Fog machine for the first dance',
   'Low-lying fog effect operated by our team.', 15000000, 60, 10),
  ('c0000000-0000-0000-0000-000000000001', 'event-decoration', 'Extra 2 hours of setup',
   'Early access for venues with tight schedules.', 10000000, 120, 11),
  ('c0000000-0000-0000-0000-000000000006', 'makeup-hair', 'Extra bridesmaid',
   'Makeup for one more bridesmaid.', 6000000, 45, 10)
) as v(biz, category, name, description, price, duration, sort_order)
join public.service_categories c on c.slug = v.category;

insert into public.service_areas (business_id, state, city, area)
select v.biz::uuid, v.state, v.city, v.area
from (values
  ('c0000000-0000-0000-0000-000000000001', 'Lagos', 'Lagos', 'Lekki'),
  ('c0000000-0000-0000-0000-000000000001', 'Lagos', 'Lagos', 'Ikoyi'),
  ('c0000000-0000-0000-0000-000000000001', 'Lagos', 'Lagos', 'Victoria Island'),
  ('c0000000-0000-0000-0000-000000000001', 'Lagos', 'Lagos', 'Ajah'),
  ('c0000000-0000-0000-0000-000000000002', 'Lagos', 'Lagos', 'Victoria Island'),
  ('c0000000-0000-0000-0000-000000000002', 'Lagos', 'Lagos', 'Ikoyi'),
  ('c0000000-0000-0000-0000-000000000002', 'Lagos', 'Lagos', 'Lekki'),
  ('c0000000-0000-0000-0000-000000000003', 'Lagos', 'Lagos', 'Surulere'),
  ('c0000000-0000-0000-0000-000000000003', 'Lagos', 'Lagos', 'Yaba'),
  ('c0000000-0000-0000-0000-000000000003', 'Lagos', 'Lagos', 'Lekki'),
  ('c0000000-0000-0000-0000-000000000004', 'Lagos', 'Lagos', 'Lekki'),
  ('c0000000-0000-0000-0000-000000000004', 'Lagos', 'Lagos', 'Ajah'),
  ('c0000000-0000-0000-0000-000000000005', 'Lagos', 'Lagos', 'Ikeja'),
  ('c0000000-0000-0000-0000-000000000005', 'Lagos', 'Lagos', 'Maryland'),
  ('c0000000-0000-0000-0000-000000000006', 'Lagos', 'Lagos', 'Ikoyi'),
  ('c0000000-0000-0000-0000-000000000006', 'Lagos', 'Lagos', 'Lekki'),
  ('c0000000-0000-0000-0000-000000000006', 'Lagos', 'Lagos', 'Victoria Island'),
  ('c0000000-0000-0000-0000-000000000007', 'Lagos', 'Lagos', 'Lekki'),
  ('c0000000-0000-0000-0000-000000000007', 'Lagos', 'Lagos', 'Ikoyi'),
  ('c0000000-0000-0000-0000-000000000008', 'FCT', 'Abuja', 'Wuse'),
  ('c0000000-0000-0000-0000-000000000008', 'FCT', 'Abuja', 'Maitama'),
  ('c0000000-0000-0000-0000-000000000009', 'Lagos', 'Lagos', 'Lekki')
) as v(biz, state, city, area);

-- Weekly availability: Mon-Sat 8:00-18:00 for everyone, plus Sundays for event businesses.
insert into public.business_availability (business_id, day_of_week, start_time, end_time)
select b.id, d, '08:00', '18:00'
from public.businesses b, generate_series(1, 6) d;
insert into public.business_availability (business_id, day_of_week, start_time, end_time)
select id, 0, '12:00', '22:00' from public.businesses
where slug in ('lush-events-decor', 'royal-touch-decorations', 'mama-put-catering', 'lens-and-light', 'glow-studio-makeup');
-- Lens & Light has two days off coming up (shown on its profile).
insert into public.business_availability (business_id, specific_date, is_available)
values ('c0000000-0000-0000-0000-000000000007', current_date + 12, false),
       ('c0000000-0000-0000-0000-000000000007', current_date + 26, false);

-- ---------------------------------------------------------------------------
-- Past bookings with reviews, so ratings and reviews show up.
-- ---------------------------------------------------------------------------
create function pg_temp.past_booking(p_customer uuid, p_business_slug text, p_service text, p_days_ago int,
  p_rating int, p_comment text, p_reply text default null)
returns void language plpgsql as $$
declare
  biz uuid;
  owner uuid;
  svc public.business_services;
  bk uuid;
begin
  select id, owner_id into biz, owner from public.businesses where slug = p_business_slug;
  select * into svc from public.business_services where business_id = biz and name = p_service;
  insert into public.bookings (customer_id, business_id, status, scheduled_start, scheduled_end,
    subtotal_minor, platform_fee_minor, total_minor, commission_rate_bps, city, state)
  values (p_customer, biz, 'requested', now() - make_interval(days => p_days_ago),
    now() - make_interval(days => p_days_ago) + make_interval(mins => coalesce(svc.duration_minutes, 120)),
    coalesce(svc.price_minor, 0), 0, coalesce(svc.price_minor, 0), 1000, 'Lekki', 'Lagos')
  returning id into bk;
  insert into public.booking_items (booking_id, service_id, name, unit_price_minor, quantity, kind)
  values (bk, svc.id, svc.name, coalesce(svc.price_minor, 0), 1,
    case when svc.is_package then 'package' when svc.is_addon then 'addon' else 'service' end);
  update public.bookings set status = 'pending_provider' where id = bk;
  update public.bookings set status = 'accepted', change_actor_id = owner where id = bk;
  update public.bookings set status = 'payment_pending', change_actor_id = p_customer where id = bk;
  update public.bookings set status = 'confirmed' where id = bk;
  update public.bookings set status = 'completed', change_actor_id = owner where id = bk;
  -- Paid a few days before the job; payouts older than two weeks have been paid out.
  update public.bookings set created_at = now() - make_interval(days => p_days_ago + 5) where id = bk;
  insert into public.payments (booking_id, payer_id, provider, reference, amount_minor, status, paid_at)
  values (bk, p_customer, 'paystack', 'SEED-' || substr(bk::text, 1, 8), coalesce(svc.price_minor, 0), 'success',
    now() - make_interval(days => p_days_ago + 3));
  insert into public.payouts (business_id, booking_id, gross_minor, commission_minor, amount_minor, status, paid_at)
  values (biz, bk, coalesce(svc.price_minor, 0), coalesce(svc.price_minor, 0) / 10,
    coalesce(svc.price_minor, 0) - coalesce(svc.price_minor, 0) / 10,
    case when p_days_ago > 14 then 'paid'::public.payout_status else 'pending'::public.payout_status end,
    case when p_days_ago > 14 then now() - make_interval(days => p_days_ago - 7) end);
  if p_rating is not null then
    insert into public.reviews (booking_id, customer_id, business_id, rating, comment, business_reply, business_replied_at)
    values (bk, p_customer, biz, p_rating, p_comment, p_reply, case when p_reply is not null then now() end);
  end if;
end;
$$;

select pg_temp.past_booking('a0000000-0000-0000-0000-000000000002', 'lush-events-decor', 'Classic Wedding Decor (up to 300 guests)', 40, 5,
  'Our hall looked unreal. Setup was done two hours early and the team handled last-minute changes calmly.',
  'Thank you Tolu! It was a joy styling your day.');
select pg_temp.past_booking('a0000000-0000-0000-0000-000000000003', 'lush-events-decor', 'Premium Wedding Decor (up to 500 guests)', 75, 5,
  'Worth every naira. Guests are still talking about the floral ceiling.');
select pg_temp.past_booking('a0000000-0000-0000-0000-000000000002', 'royal-touch-decorations', 'White Wedding Reception Decor', 120, 4,
  'Beautiful decor and good value. Arrived a little late but finished on time.');
select pg_temp.past_booking('a0000000-0000-0000-0000-000000000003', 'mama-put-catering', 'Wedding Catering (per 100 guests)', 30, 5,
  'The jollof finished before the MC could announce it. Excellent service.');
select pg_temp.past_booking('a0000000-0000-0000-0000-000000000002', 'sparkle-home-cleaning', 'Deep Home Cleaning', 12, 5,
  'Spotless. They even cleaned behind the fridge.');
select pg_temp.past_booking('a0000000-0000-0000-0000-000000000003', 'sparkle-home-cleaning', 'Regular Cleaning Visit', 5, 4,
  'Good job, would book again.');
select pg_temp.past_booking('a0000000-0000-0000-0000-000000000002', 'fixit-plumbing', 'Plumbing Call-out (per hour)', 20, 4,
  'Fixed the leak quickly. Fair price.');
select pg_temp.past_booking('a0000000-0000-0000-0000-000000000003', 'glow-studio-makeup', 'Bridal Makeup + Gele', 60, 5,
  'My makeup lasted all night and the gele was perfect.');
select pg_temp.past_booking('a0000000-0000-0000-0000-000000000002', 'lens-and-light', 'Photo + Cinematic Video', 90, 5,
  'The highlight film made my mum cry. Incredible work.');

-- ---------------------------------------------------------------------------
-- A few bookings in other states, so the admin dashboard has something to manage.
-- ---------------------------------------------------------------------------

-- A completed job the customer has disputed: the payout is on hold.
select pg_temp.past_booking('a0000000-0000-0000-0000-000000000003', 'fixit-plumbing', 'Plumbing Call-out (per hour)', 3, null, null);
with bk as (
  select b.id from public.bookings b
  join public.businesses biz on biz.id = b.business_id
  where biz.slug = 'fixit-plumbing' and b.customer_id = 'a0000000-0000-0000-0000-000000000003'
)
insert into public.disputes (booking_id, opened_by, reason, description, previous_booking_status)
select id, 'a0000000-0000-0000-0000-000000000003', 'Problem came back',
  'The kitchen sink started leaking again the next day and the plumber hasn''t replied.', 'completed'
from bk;
update public.bookings set status = 'disputed', change_actor_id = 'a0000000-0000-0000-0000-000000000003',
  change_note = 'Problem came back'
where id in (select booking_id from public.disputes);
update public.payouts set status = 'on_hold'
where booking_id in (select booking_id from public.disputes);

-- The seeded jobs happened in the past: spread their history between booking and job.
alter table public.booking_events disable trigger booking_events_append_only;
with steps as (
  select e.id, b.created_at as started, coalesce(b.scheduled_end, b.created_at) + interval '1 day' as finished,
    row_number() over (partition by e.booking_id order by e.created_at, e.id) as n,
    count(*) over (partition by e.booking_id) as total
  from public.booking_events e
  join public.bookings b on b.id = e.booking_id
  where b.created_at < now() - interval '1 day'
)
update public.booking_events e
set created_at = s.started + (s.finished - s.started) * ((s.n - 1)::numeric / greatest(s.total - 1, 1))
from steps s where s.id = e.id;
alter table public.booking_events enable trigger booking_events_append_only;

-- An upcoming paid booking and a new request.
create function pg_temp.open_booking(p_customer uuid, p_business_slug text, p_service text, p_days_ahead int,
  p_status public.booking_status)
returns void language plpgsql as $$
declare
  biz uuid;
  owner uuid;
  svc public.business_services;
  bk uuid;
begin
  select id, owner_id into biz, owner from public.businesses where slug = p_business_slug;
  select * into svc from public.business_services where business_id = biz and name = p_service;
  insert into public.bookings (customer_id, business_id, status, scheduled_start, scheduled_end,
    subtotal_minor, platform_fee_minor, total_minor, commission_rate_bps, city, state)
  values (p_customer, biz, 'requested', date_trunc('day', now()) + make_interval(days => p_days_ahead, hours => 10),
    date_trunc('day', now()) + make_interval(days => p_days_ahead, hours => 13),
    coalesce(svc.price_minor, 0), 0, coalesce(svc.price_minor, 0), 1000, 'Lekki', 'Lagos')
  returning id into bk;
  insert into public.booking_items (booking_id, service_id, name, unit_price_minor, quantity, kind)
  values (bk, svc.id, svc.name, coalesce(svc.price_minor, 0), 1,
    case when svc.is_package then 'package' when svc.is_addon then 'addon' else 'service' end);
  update public.bookings set status = 'pending_provider' where id = bk;
  if p_status in ('accepted', 'confirmed', 'cancelled') then
    update public.bookings set status = 'accepted', change_actor_id = owner where id = bk;
  end if;
  if p_status = 'confirmed' then
    update public.bookings set status = 'payment_pending', change_actor_id = p_customer where id = bk;
    update public.bookings set status = 'confirmed' where id = bk;
    insert into public.payments (booking_id, payer_id, provider, reference, amount_minor, status, paid_at)
    values (bk, p_customer, 'paystack', 'SEED-' || substr(bk::text, 1, 8), coalesce(svc.price_minor, 0), 'success', now());
  elsif p_status = 'cancelled' then
    update public.bookings set status = 'cancelled', cancelled_by = p_customer, change_actor_id = p_customer,
      cancellation_reason = 'Event moved to next year.' where id = bk;
  end if;
end;
$$;

select pg_temp.open_booking('a0000000-0000-0000-0000-000000000003', 'mama-put-catering', 'Wedding Catering (per 100 guests)', 21, 'confirmed');
select pg_temp.open_booking('a0000000-0000-0000-0000-000000000002', 'royal-touch-decorations', 'White Wedding Reception Decor', 30, 'pending_provider');
select pg_temp.open_booking('a0000000-0000-0000-0000-000000000002', 'glow-studio-makeup', 'Bridal Makeup + Gele', 14, 'cancelled');

-- ---------------------------------------------------------------------------
-- More photographers, so matching has choices to rank. Two of them must never be recommended:
-- one has paused bookings and one is still waiting for review.
-- ---------------------------------------------------------------------------
select pg_temp.demo_user('b0000000-0000-0000-0000-000000000010', 'snapshot@demo.ng', 'Tunde Bakare', 'business');
select pg_temp.demo_user('b0000000-0000-0000-0000-000000000011', 'kemi@demo.ng', 'Kemi Adeyemi', 'business');
select pg_temp.demo_user('b0000000-0000-0000-0000-000000000012', 'paused@demo.ng', 'Paused Owner', 'business');
select pg_temp.demo_user('b0000000-0000-0000-0000-000000000013', 'pixels@demo.ng', 'Pending Pixels Owner', 'business');

insert into public.businesses (id, owner_id, name, slug, description, primary_category_id, phone, email,
  address_line, city, state, status, is_verified, verified_at, accepting_bookings)
select v.id::uuid, v.owner::uuid, v.name, v.slug, v.description, c.id, v.phone, v.email, v.address, v.city, 'Lagos',
  v.status::public.business_status, v.status = 'approved', case when v.status = 'approved' then now() end, v.accepting
from (values
  ('c0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000010', 'Snapshot Studios', 'snapshot-studios',
   'Event photography on the Island: birthdays, parties, launches and corporate events. Same-week edited gallery.',
   '+2348030000010', 'hello@snapshot.ng', '7 Akin Adesola St', 'Victoria Island', 'approved', true),
  ('c0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000011', 'Frames by Kemi', 'frames-by-kemi',
   'Relaxed, candid photography for birthdays, family portraits and small celebrations.',
   '+2348030000011', 'kemi@framesbykemi.ng', '4 Bisola Durosinmi-Etti Dr', 'Lekki', 'approved', true),
  ('c0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000012', 'Paused Photo Co', 'paused-photo-co',
   'Not taking bookings right now. Must never be recommended.',
   '+2348030000012', null, null, 'Victoria Island', 'approved', false),
  ('c0000000-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-000000000013', 'Pending Pixels', 'pending-pixels',
   'Pending review. Must never appear to customers or the concierge.',
   '+2348030000013', null, null, 'Victoria Island', 'pending', true)
) as v(id, owner, name, slug, description, phone, email, address, city, status, accepting)
join public.service_categories c on c.slug = 'photography-video';

insert into public.business_services (business_id, category_id, name, description, pricing_type, price_minor,
  duration_minutes, sort_order)
select v.biz::uuid, c.id, v.name, v.description, 'fixed', v.price, v.duration, v.sort_order
from (values
  ('c0000000-0000-0000-0000-000000000010', 'Birthday & Party Coverage (up to 150 guests)',
   'One photographer for up to 5 hours, 250+ edited photos and an online gallery.', 25000000, 300, 1),
  ('c0000000-0000-0000-0000-000000000010', 'Corporate Event Photography',
   'Conferences, launches and dinners. Two photographers and same-day highlights.', 35000000, 480, 2),
  ('c0000000-0000-0000-0000-000000000011', 'Birthday Shoot (up to 60 guests)',
   'Three hours of candid coverage and 150 edited photos.', 15000000, 180, 1),
  ('c0000000-0000-0000-0000-000000000011', 'Family Portrait Session',
   'One-hour outdoor or at-home portrait session.', 8000000, 60, 2),
  ('c0000000-0000-0000-0000-000000000012', 'Birthday Photography',
   'Hidden: not accepting bookings.', 10000000, 240, 1),
  ('c0000000-0000-0000-0000-000000000013', 'Birthday Photography',
   'Hidden: business not approved.', 9000000, 240, 1)
) as v(biz, name, description, price, duration, sort_order)
join public.service_categories c on c.slug = 'photography-video';

insert into public.service_areas (business_id, state, city, area)
select v.biz::uuid, 'Lagos', 'Lagos', v.area
from (values
  ('c0000000-0000-0000-0000-000000000010', 'Victoria Island'),
  ('c0000000-0000-0000-0000-000000000010', 'Ikoyi'),
  ('c0000000-0000-0000-0000-000000000010', 'Lekki'),
  ('c0000000-0000-0000-0000-000000000011', 'Lekki'),
  ('c0000000-0000-0000-0000-000000000011', 'Ajah'),
  ('c0000000-0000-0000-0000-000000000011', 'Victoria Island'),
  ('c0000000-0000-0000-0000-000000000012', 'Victoria Island'),
  ('c0000000-0000-0000-0000-000000000013', 'Victoria Island')
) as v(biz, area);

-- Snapshot works every day; Frames by Kemi only on weekdays, so a Saturday event rules it out.
insert into public.business_availability (business_id, day_of_week, start_time, end_time)
select 'c0000000-0000-0000-0000-000000000010'::uuid, d, '09:00', '22:00' from generate_series(0, 6) d;
insert into public.business_availability (business_id, day_of_week, start_time, end_time)
select 'c0000000-0000-0000-0000-000000000011'::uuid, d, '09:00', '18:00' from generate_series(1, 5) d;
insert into public.business_availability (business_id, day_of_week, start_time, end_time)
select b.id, d, '09:00', '20:00'
from public.businesses b, generate_series(0, 6) d
where b.slug in ('paused-photo-co', 'pending-pixels');
