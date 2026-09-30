-- Local development seed data. Runs on `npm run db:reset`; never in production.

insert into public.service_categories (name, slug, description, sort_order) values
  ('Home Services', 'home-services', 'Cleaning, plumbing, electrical and repairs', 1),
  ('Beauty & Wellness', 'beauty-wellness', 'Hair, makeup, nails, spa and fitness', 2),
  ('Events', 'events', 'Catering, decoration, photography and entertainment', 3),
  ('Automotive', 'automotive', 'Mechanics, car wash and detailing', 4),
  ('Tech & Repairs', 'tech-repairs', 'Phone, laptop and appliance repair', 5),
  ('Logistics', 'logistics', 'Moving, delivery and dispatch', 6)
on conflict (slug) do nothing;
