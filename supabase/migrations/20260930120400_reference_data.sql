-- Stage 2: reference data every environment needs.

insert into public.platform_settings (key, value, description) values
  ('default_commission_rate_bps', '1000', 'Platform commission in basis points (1000 = 10%). Businesses can have an override.'),
  ('booking_request_expiry_hours', '48', 'Hours a business has to accept a booking request before it expires.'),
  ('payment_window_hours', '24', 'Hours a customer has to pay after a booking is accepted.')
on conflict (key) do nothing;
