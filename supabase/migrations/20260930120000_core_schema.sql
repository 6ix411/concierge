-- Stage 2: core marketplace schema.
--
-- Conventions
-- - Money is stored as bigint in the currency's minor unit (kobo for NGN), never as floats.
-- - Every table has row level security enabled (see the next migration).
-- - Client-side code may only write "content" columns it owns. Anything involving money,
--   status transitions, verification or moderation is written by trusted server code
--   (service role) after it has checked the caller's permissions.
-- - Human-to-human chat (conversations/messages) and the AI Concierge (ai_conversations/
--   ai_messages) are separate tables with no link between them: the AI never takes part in chat.

create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.user_role as enum ('customer', 'business', 'admin');
create type public.user_status as enum ('active', 'suspended', 'deactivated');
create type public.business_status as enum ('draft', 'pending_review', 'approved', 'rejected', 'suspended');
create type public.verification_status as enum ('pending', 'approved', 'rejected', 'needs_more_info');
create type public.verification_document_type as enum (
  'cac_certificate', 'national_id', 'drivers_license', 'international_passport',
  'voters_card', 'utility_bill', 'professional_license', 'other'
);
create type public.pricing_type as enum ('fixed', 'hourly', 'starting_from', 'quote_only');
create type public.portfolio_media_type as enum ('image', 'video');
create type public.booking_status as enum (
  'quote_requested', -- customer asked for a price
  'quoted',          -- business replied with a price
  'requested',       -- customer asked to book, waiting on the business
  'accepted',        -- business accepted, waiting on payment
  'confirmed',       -- paid; chat opens
  'in_progress',
  'completed',
  'cancelled',
  'rejected',
  'expired',
  'disputed'
);
create type public.payment_provider as enum ('paystack', 'flutterwave');
create type public.payment_status as enum ('pending', 'success', 'failed', 'abandoned', 'refunded', 'partially_refunded');
create type public.payout_status as enum ('pending', 'processing', 'paid', 'failed', 'on_hold');
create type public.conversation_status as enum ('open', 'closed', 'locked');
create type public.review_status as enum ('published', 'hidden');
create type public.dispute_status as enum ('open', 'under_review', 'resolved', 'rejected');
create type public.ai_message_role as enum ('user', 'assistant', 'tool');

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'customer',
  status public.user_status not null default 'active',
  email extensions.citext not null unique,
  full_name text check (char_length(full_name) <= 120),
  phone text check (phone ~ '^\+?[0-9]{7,15}$'),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.users is 'One row per auth user. role is chosen at sign-up (customer/business) or granted by an admin.';
create index users_role_idx on public.users (role);

create table public.customer_profiles (
  user_id uuid primary key references public.users (id) on delete cascade,
  address_line text check (char_length(address_line) <= 300),
  city text,
  state text,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------

create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.service_categories (id) on delete restrict,
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text,
  icon text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_categories_not_own_parent check (parent_id is null or parent_id <> id)
);
create index service_categories_parent_idx on public.service_categories (parent_id);

-- ---------------------------------------------------------------------------
-- Businesses
-- ---------------------------------------------------------------------------

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users (id) on delete restrict,
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text check (char_length(description) <= 5000),
  primary_category_id uuid references public.service_categories (id) on delete set null,
  email extensions.citext,
  phone text check (phone ~ '^\+?[0-9]{7,15}$'),
  website text,
  address_line text,
  city text,
  state text,
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  logo_path text,
  cover_path text,
  -- Controlled by admins only (never granted to clients).
  status public.business_status not null default 'draft',
  is_verified boolean not null default false,
  verified_at timestamptz,
  status_reason text,
  commission_rate_bps integer check (commission_rate_bps between 0 and 10000), -- null = platform default
  -- Maintained by triggers.
  rating_avg numeric(3, 2) not null default 0 check (rating_avg between 0 and 5),
  rating_count integer not null default 0 check (rating_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint businesses_verified_needs_timestamp check (not is_verified or verified_at is not null)
);
comment on table public.businesses is 'Only rows with status = approved are visible to customers or to the AI Concierge.';
create index businesses_owner_idx on public.businesses (owner_id);
create index businesses_status_idx on public.businesses (status);
create index businesses_category_idx on public.businesses (primary_category_id);
create index businesses_location_idx on public.businesses (state, city) where status = 'approved';

create table public.business_verifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  submitted_by uuid not null references public.users (id) on delete restrict,
  document_type public.verification_document_type not null,
  document_number text check (char_length(document_number) <= 100),
  document_path text not null, -- private storage bucket "verification-documents"
  notes text check (char_length(notes) <= 2000),
  status public.verification_status not null default 'pending',
  reviewed_by uuid references public.users (id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_verifications_review_consistent
    check ((status = 'pending') = (reviewed_at is null))
);
create index business_verifications_business_idx on public.business_verifications (business_id);
create index business_verifications_pending_idx on public.business_verifications (created_at) where status = 'pending';

create table public.business_services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  category_id uuid references public.service_categories (id) on delete set null,
  name text not null check (char_length(name) between 2 and 120),
  description text check (char_length(description) <= 3000),
  pricing_type public.pricing_type not null default 'fixed',
  price_minor bigint check (price_minor >= 0),
  currency char(3) not null default 'NGN' check (currency = 'NGN'),
  duration_minutes integer check (duration_minutes > 0 and duration_minutes <= 60 * 24 * 30),
  is_package boolean not null default false,
  package_includes text[] not null default '{}',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_services_price_matches_type
    check ((pricing_type = 'quote_only') = (price_minor is null)),
  constraint business_services_package_items
    check (is_package or cardinality(package_includes) = 0)
);
create index business_services_business_idx on public.business_services (business_id);
create index business_services_category_idx on public.business_services (category_id) where is_active;

create table public.service_areas (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  state text not null,
  city text,
  area text,
  created_at timestamptz not null default now(),
  constraint service_areas_unique unique nulls not distinct (business_id, state, city, area)
);
create index service_areas_lookup_idx on public.service_areas (state, city);

create table public.business_availability (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  -- Either a weekly rule (day_of_week, 0 = Sunday) or a one-off date override.
  day_of_week smallint check (day_of_week between 0 and 6),
  specific_date date,
  start_time time,
  end_time time,
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_availability_one_kind check ((day_of_week is null) <> (specific_date is null)),
  constraint business_availability_times
    check (
      (start_time is null and end_time is null and not is_available and specific_date is not null)
      or (start_time is not null and end_time is not null and end_time > start_time)
    )
);
create index business_availability_business_idx on public.business_availability (business_id, day_of_week);
create index business_availability_dates_idx on public.business_availability (business_id, specific_date)
  where specific_date is not null;

create table public.business_portfolio (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  media_type public.portfolio_media_type not null,
  storage_path text not null, -- public storage bucket "business-media"
  caption text check (char_length(caption) <= 300),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index business_portfolio_business_idx on public.business_portfolio (business_id, sort_order);

-- ---------------------------------------------------------------------------
-- Bookings and money
-- ---------------------------------------------------------------------------

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('BK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  customer_id uuid not null references public.users (id) on delete restrict,
  business_id uuid not null references public.businesses (id) on delete restrict,
  status public.booking_status not null default 'requested',
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  address_line text,
  city text,
  state text,
  customer_notes text check (char_length(customer_notes) <= 3000),
  quote_notes text check (char_length(quote_notes) <= 3000),
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  platform_fee_minor bigint not null default 0 check (platform_fee_minor >= 0),
  total_minor bigint not null default 0 check (total_minor >= 0),
  currency char(3) not null default 'NGN' check (currency = 'NGN'),
  commission_rate_bps integer not null default 0 check (commission_rate_bps between 0 and 10000),
  accepted_at timestamptz,
  confirmed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.users (id) on delete set null,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_total check (total_minor = subtotal_minor + platform_fee_minor),
  constraint bookings_schedule check (scheduled_end is null or scheduled_end > scheduled_start)
);
create index bookings_customer_idx on public.bookings (customer_id, created_at desc);
create index bookings_business_idx on public.bookings (business_id, created_at desc);
create index bookings_status_idx on public.bookings (status);
create index bookings_schedule_idx on public.bookings (business_id, scheduled_start)
  where status in ('accepted', 'confirmed', 'in_progress');

create table public.booking_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  service_id uuid references public.business_services (id) on delete set null,
  -- Snapshot of the service at booking time, so later price edits don't change past bookings.
  name text not null,
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  quantity integer not null default 1 check (quantity > 0),
  total_minor bigint generated always as (unit_price_minor * quantity) stored,
  created_at timestamptz not null default now()
);
create index booking_items_booking_idx on public.booking_items (booking_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete restrict,
  payer_id uuid not null references public.users (id) on delete restrict,
  provider public.payment_provider not null,
  reference text not null unique,          -- ours, sent to the provider
  provider_reference text,                 -- theirs
  amount_minor bigint not null check (amount_minor > 0),
  refunded_minor bigint not null default 0 check (refunded_minor >= 0),
  currency char(3) not null default 'NGN' check (currency = 'NGN'),
  status public.payment_status not null default 'pending',
  paid_at timestamptz,
  failure_reason text,
  provider_payload jsonb, -- raw provider response; admin only
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_refund_le_amount check (refunded_minor <= amount_minor),
  constraint payments_paid_at check (status not in ('success', 'refunded', 'partially_refunded') or paid_at is not null),
  constraint payments_provider_reference_unique unique (provider, provider_reference)
);
create index payments_booking_idx on public.payments (booking_id);
create index payments_payer_idx on public.payments (payer_id);
create unique index payments_one_success_per_booking on public.payments (booking_id) where status = 'success';

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  booking_id uuid references public.bookings (id) on delete restrict,
  gross_minor bigint not null check (gross_minor >= 0),
  commission_minor bigint not null check (commission_minor >= 0),
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null default 'NGN' check (currency = 'NGN'),
  status public.payout_status not null default 'pending',
  provider public.payment_provider,
  provider_reference text,
  paid_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payouts_amount check (amount_minor = gross_minor - commission_minor),
  constraint payouts_paid_at check (status <> 'paid' or paid_at is not null)
);
create index payouts_business_idx on public.payouts (business_id, created_at desc);
create unique index payouts_one_per_booking on public.payouts (booking_id) where booking_id is not null and status <> 'failed';

-- ---------------------------------------------------------------------------
-- Human-to-human chat (no AI participation)
-- ---------------------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  customer_id uuid not null references public.users (id) on delete restrict,
  business_id uuid not null references public.businesses (id) on delete restrict,
  status public.conversation_status not null default 'open',
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.conversations is 'Human-to-human chat between a customer and a business after a confirmed booking. The AI never reads or writes here.';
create index conversations_customer_idx on public.conversations (customer_id, last_message_at desc nulls last);
create index conversations_business_idx on public.conversations (business_id, last_message_at desc nulls last);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.users (id) on delete restrict,
  body text check (char_length(body) between 1 and 4000),
  attachment_path text, -- private storage bucket "chat-attachments"
  attachment_type text,
  is_flagged boolean not null default false,
  hidden_at timestamptz, -- set by moderation
  created_at timestamptz not null default now(),
  constraint messages_has_content check (body is not null or attachment_path is not null)
);
comment on table public.messages is 'Written only by the two human participants. There is no AI sender.';
create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_flagged_idx on public.messages (created_at) where is_flagged;

-- ---------------------------------------------------------------------------
-- Reviews, notifications, disputes, admin audit
-- ---------------------------------------------------------------------------

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  customer_id uuid not null references public.users (id) on delete restrict,
  business_id uuid not null references public.businesses (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 2000),
  business_reply text check (char_length(business_reply) <= 2000),
  business_replied_at timestamptz,
  status public.review_status not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reviews_business_idx on public.reviews (business_id, created_at desc) where status = 'published';
create index reviews_customer_idx on public.reviews (customer_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete restrict,
  opened_by uuid not null references public.users (id) on delete restrict,
  reason text not null check (char_length(reason) between 3 and 200),
  description text check (char_length(description) <= 5000),
  status public.dispute_status not null default 'open',
  resolution text,
  resolved_by uuid references public.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint disputes_resolution check (status not in ('resolved', 'rejected') or resolved_at is not null)
);
create index disputes_booking_idx on public.disputes (booking_id);
create index disputes_open_idx on public.disputes (created_at) where status in ('open', 'under_review');
create unique index disputes_one_active_per_booking on public.disputes (booking_id)
  where status in ('open', 'under_review');

create table public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.users (id) on delete restrict,
  action text not null,        -- e.g. 'business.approve', 'user.suspend'
  target_type text not null,   -- table name
  target_id uuid,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
comment on table public.admin_actions is 'Append-only audit log of admin decisions.';
create index admin_actions_target_idx on public.admin_actions (target_type, target_id);
create index admin_actions_admin_idx on public.admin_actions (admin_id, created_at desc);

create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid references public.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- AI Concierge history (separate from human chat)
-- ---------------------------------------------------------------------------

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  title text check (char_length(title) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_conversations_user_idx on public.ai_conversations (user_id, updated_at desc);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  ai_conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  role public.ai_message_role not null,
  content text not null,
  -- Businesses the concierge recommended in this message (always approved businesses).
  recommended_business_ids uuid[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index ai_messages_conversation_idx on public.ai_messages (ai_conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'users', 'customer_profiles', 'service_categories', 'businesses', 'business_verifications',
    'business_services', 'business_availability', 'bookings', 'payments', 'payouts',
    'conversations', 'reviews', 'disputes', 'ai_conversations'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end;
$$;

create trigger platform_settings_set_updated_at
before update on public.platform_settings
for each row execute function public.set_updated_at();
