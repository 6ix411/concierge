-- Stage 14: notifications.
-- In-app notifications already exist for most events. This adds what was missing (a welcome on
-- registration, booking reminders, review requests), a category per notification, de-duplication for
-- scheduled ones, and an outbox so email, SMS and push can be switched on later without touching the
-- code that creates notifications.

-- ---------------------------------------------------------------------------
-- Categories and de-duplication
-- ---------------------------------------------------------------------------

alter table public.notifications
  -- "booking.accepted" → "booking". Used for filtering and, later, per-channel preferences.
  add column category text generated always as (split_part(type, '.', 1)) stored,
  -- Scheduled notifications (reminders, review requests) are sent once per key and person.
  add column dedupe_key text check (char_length(dedupe_key) <= 200);
create unique index notifications_dedupe on public.notifications (user_id, dedupe_key) where dedupe_key is not null;

-- ---------------------------------------------------------------------------
-- Registration: a welcome for every new customer and business
-- ---------------------------------------------------------------------------

create function public.welcome_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'customer' then
    insert into public.notifications (user_id, type, title, body, dedupe_key)
    values (new.id, 'account.welcome', 'Welcome to Concierge',
      'Tell the Concierge what you need and we''ll match you with verified businesses.', 'welcome');
  elsif new.role = 'business' then
    insert into public.notifications (user_id, type, title, body, dedupe_key)
    values (new.id, 'account.welcome', 'Welcome to Concierge for Business',
      'Set up your business profile and send it for verification to start receiving bookings.', 'welcome');
  end if;
  return new;
end;
$$;

create trigger users_welcome
after insert on public.users
for each row execute function public.welcome_new_user();

-- ---------------------------------------------------------------------------
-- Scheduled: booking reminders and review requests
-- ---------------------------------------------------------------------------

-- Runs every 15 minutes (below). Safe to run any time: each notification is sent once.
create function public.queue_scheduled_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  sent integer := 0;
  n integer;
begin
  -- Reminders: confirmed bookings starting within the next 24 hours, to both sides.
  insert into public.notifications (user_id, type, title, body, data, dedupe_key)
  select person.user_id, 'booking.reminder', 'Coming up: ' || bk.reference,
    case when person.side = 'customer' then
      b.name || ' is booked for ' || to_char(bk.scheduled_start at time zone 'Africa/Lagos', 'Dy DD Mon, HH24:MI') ||
      '. Message them on Concierge if anything changes.'
    else
      'You''re booked for ' || to_char(bk.scheduled_start at time zone 'Africa/Lagos', 'Dy DD Mon, HH24:MI') ||
      '. Message the customer on Concierge if anything changes.'
    end,
    jsonb_build_object('bookingId', bk.id),
    'reminder:' || bk.id
  from public.bookings bk
  join public.businesses b on b.id = bk.business_id
  cross join lateral (values (bk.customer_id, 'customer'), (b.owner_id, 'business')) as person(user_id, side)
  where bk.status = 'confirmed'
    and bk.scheduled_start > now() and bk.scheduled_start <= now() + interval '24 hours'
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics n = row_count;
  sent := sent + n;

  -- Review requests: an hour after a job is completed, if the customer hasn't reviewed it.
  insert into public.notifications (user_id, type, title, body, data, dedupe_key)
  select bk.customer_id, 'review.request', 'How did ' || b.name || ' do?',
    'Rate your booking ' || bk.reference || '. Your review helps other customers choose.',
    jsonb_build_object('bookingId', bk.id),
    'review_request:' || bk.id
  from public.bookings bk
  join public.businesses b on b.id = bk.business_id
  where bk.status = 'completed'
    and bk.completed_at <= now() - interval '1 hour'
    and bk.completed_at > now() - interval '30 days'
    and not exists (select 1 from public.reviews r where r.booking_id = bk.id)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics n = row_count;
  return sent + n;
end;
$$;
revoke execute on function public.queue_scheduled_notifications() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
select cron.schedule('scheduled-notifications', '*/15 * * * *', $$select public.queue_scheduled_notifications()$$);

-- ---------------------------------------------------------------------------
-- Other channels: an outbox for email, SMS and push (off until a channel is enabled)
-- ---------------------------------------------------------------------------

insert into public.platform_settings (key, value, description) values
  ('notification_channels', '[]'::jsonb,
   'Channels besides in-app that notifications are also sent through: any of "email", "sms", "push". Empty: in-app only.')
on conflict (key) do nothing;

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  channel text not null check (channel in ('email', 'sms', 'push')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts smallint not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (notification_id, channel)
);
comment on table public.notification_deliveries is
  'Outbox for notifications sent outside the app. Filled for each enabled channel; sent by the server.';
create index notification_deliveries_pending on public.notification_deliveries (created_at) where status = 'pending';
-- Server only: no client grants, row level security on with no policies.
revoke all on public.notification_deliveries from anon, authenticated;
alter table public.notification_deliveries enable row level security;

create function public.queue_notification_deliveries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notification_deliveries (notification_id, channel)
  select new.id, channel
  from jsonb_array_elements_text(
    coalesce((select value from public.platform_settings where key = 'notification_channels'), '[]'::jsonb)
  ) as channel
  where channel in ('email', 'sms', 'push')
  on conflict do nothing;
  return new;
end;
$$;

create trigger notifications_queue_deliveries
after insert on public.notifications
for each row execute function public.queue_notification_deliveries();
