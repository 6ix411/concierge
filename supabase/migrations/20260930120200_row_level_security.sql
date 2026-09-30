-- Stage 2: role-based access control.
--
-- Two layers, both server-side:
-- 1. Table/column privileges decide WHAT a signed-in client may ever write. Anything involving
--    money, statuses, verification, moderation or roles is never granted to clients.
-- 2. Row level security decides WHICH rows they may read or write.
-- Privileged writes happen in server code with the service role, after that code has checked
-- the caller's role (src/lib/auth), and admin decisions are recorded in admin_actions.

-- Start from nothing: Supabase grants everything on new tables to anon/authenticated by default.
revoke all on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;

do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
grant select on public.users to authenticated;
grant update (full_name, phone, avatar_path) on public.users to authenticated;

create policy "users: read self" on public.users for select to authenticated
  using (id = (select auth.uid()));
create policy "users: admins read all" on public.users for select to authenticated
  using ((select public.is_admin()));
create policy "users: update own details" on public.users for update to authenticated
  using (id = (select auth.uid()) and (select public.is_active_user()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- customer_profiles
-- ---------------------------------------------------------------------------
grant select on public.customer_profiles to authenticated;
grant update (address_line, city, state, preferences) on public.customer_profiles to authenticated;

create policy "customer_profiles: read own" on public.customer_profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "customer_profiles: admins read all" on public.customer_profiles for select to authenticated
  using ((select public.is_admin()));
create policy "customer_profiles: update own" on public.customer_profiles for update to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active_user()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- service_categories (public catalogue; admins manage via server)
-- ---------------------------------------------------------------------------
grant select on public.service_categories to anon, authenticated;

create policy "service_categories: anyone reads active" on public.service_categories for select to anon, authenticated
  using (is_active);
create policy "service_categories: admins read all" on public.service_categories for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- businesses
-- ---------------------------------------------------------------------------
-- commission_rate_bps and status_reason are internal: not readable by clients.
grant select (
  id, owner_id, name, slug, description, primary_category_id, email, phone, website,
  address_line, city, state, latitude, longitude, logo_path, cover_path,
  status, is_verified, verified_at, rating_avg, rating_count, created_at, updated_at
) on public.businesses to anon, authenticated;
grant insert (
  owner_id, name, slug, description, primary_category_id, email, phone, website,
  address_line, city, state, latitude, longitude, logo_path, cover_path
) on public.businesses to authenticated;
grant update (
  name, description, primary_category_id, email, phone, website,
  address_line, city, state, latitude, longitude, logo_path, cover_path
) on public.businesses to authenticated;

create policy "businesses: anyone reads approved" on public.businesses for select to anon, authenticated
  using (status = 'approved');
create policy "businesses: owners read own" on public.businesses for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "businesses: admins read all" on public.businesses for select to authenticated
  using ((select public.is_admin()));
create policy "businesses: business accounts create their own" on public.businesses for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.current_user_role()) = 'business');
create policy "businesses: owners update own" on public.businesses for update to authenticated
  using ((select public.owns_business(id)))
  with check (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- business_verifications (private documents)
-- ---------------------------------------------------------------------------
grant select on public.business_verifications to authenticated;
grant insert (business_id, submitted_by, document_type, document_number, document_path, notes)
  on public.business_verifications to authenticated;

create policy "business_verifications: owners read own" on public.business_verifications for select to authenticated
  using ((select public.owns_business(business_id)));
create policy "business_verifications: admins read all" on public.business_verifications for select to authenticated
  using ((select public.is_admin()));
create policy "business_verifications: owners submit" on public.business_verifications for insert to authenticated
  with check (submitted_by = (select auth.uid()) and (select public.owns_business(business_id)));

-- ---------------------------------------------------------------------------
-- Business-owned content: services, areas, availability, portfolio
-- Public when the business is approved; owners manage their own.
-- ---------------------------------------------------------------------------
grant select on public.business_services, public.service_areas, public.business_availability, public.business_portfolio
  to anon, authenticated;
grant delete on public.business_services, public.service_areas, public.business_availability, public.business_portfolio
  to authenticated;

grant insert (business_id, category_id, name, description, pricing_type, price_minor, duration_minutes,
              is_package, package_includes, is_active, sort_order) on public.business_services to authenticated;
grant update (category_id, name, description, pricing_type, price_minor, duration_minutes,
              is_package, package_includes, is_active, sort_order) on public.business_services to authenticated;
grant insert (business_id, state, city, area) on public.service_areas to authenticated;
grant update (state, city, area) on public.service_areas to authenticated;
grant insert (business_id, day_of_week, specific_date, start_time, end_time, is_available)
  on public.business_availability to authenticated;
grant update (day_of_week, specific_date, start_time, end_time, is_available)
  on public.business_availability to authenticated;
grant insert (business_id, media_type, storage_path, caption, sort_order) on public.business_portfolio to authenticated;
grant update (caption, sort_order) on public.business_portfolio to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['business_services', 'service_areas', 'business_availability', 'business_portfolio'] loop
    execute format($f$
      create policy "%1$s: anyone reads approved businesses" on public.%1$I for select to anon, authenticated
        using (public.is_business_public(business_id)
               and (%2$s));
      create policy "%1$s: owners read own" on public.%1$I for select to authenticated
        using ((select public.owns_business(business_id)));
      create policy "%1$s: admins read all" on public.%1$I for select to authenticated
        using ((select public.is_admin()));
      create policy "%1$s: owners insert" on public.%1$I for insert to authenticated
        with check ((select public.owns_business(business_id)));
      create policy "%1$s: owners update" on public.%1$I for update to authenticated
        using ((select public.owns_business(business_id)))
        with check ((select public.owns_business(business_id)));
      create policy "%1$s: owners delete" on public.%1$I for delete to authenticated
        using ((select public.owns_business(business_id)));
    $f$, t, case when t = 'business_services' then 'is_active' else 'true' end);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- bookings and booking_items (written by server code only)
-- ---------------------------------------------------------------------------
grant select on public.bookings, public.booking_items to authenticated;

create policy "bookings: participants read" on public.bookings for select to authenticated
  using (customer_id = (select auth.uid()) or (select public.owns_business(business_id)));
create policy "bookings: admins read all" on public.bookings for select to authenticated
  using ((select public.is_admin()));

create policy "booking_items: participants read" on public.booking_items for select to authenticated
  using ((select public.is_booking_participant(booking_id)));
create policy "booking_items: admins read all" on public.booking_items for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- payments and payouts (written by server code only)
-- ---------------------------------------------------------------------------
-- provider_payload is admin-only and never granted to clients.
grant select (
  id, booking_id, payer_id, provider, reference, provider_reference, amount_minor, refunded_minor,
  currency, status, paid_at, failure_reason, created_at, updated_at
) on public.payments to authenticated;
grant select on public.payouts to authenticated;

create policy "payments: payer reads own" on public.payments for select to authenticated
  using (payer_id = (select auth.uid()));
create policy "payments: admins read all" on public.payments for select to authenticated
  using ((select public.is_admin()));

create policy "payouts: owners read own" on public.payouts for select to authenticated
  using ((select public.owns_business(business_id)));
create policy "payouts: admins read all" on public.payouts for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- conversations and messages (human-to-human)
-- ---------------------------------------------------------------------------
grant select on public.conversations to authenticated;
grant select (id, conversation_id, sender_id, body, attachment_path, attachment_type, created_at)
  on public.messages to authenticated;
grant insert (conversation_id, sender_id, body, attachment_path, attachment_type) on public.messages to authenticated;

create policy "conversations: participants read" on public.conversations for select to authenticated
  using (customer_id = (select auth.uid()) or (select public.owns_business(business_id)));
create policy "conversations: admins read for moderation" on public.conversations for select to authenticated
  using ((select public.is_admin()));

create policy "messages: participants read visible" on public.messages for select to authenticated
  using (hidden_at is null and (select public.is_conversation_participant(conversation_id)));
create policy "messages: admins read for moderation" on public.messages for select to authenticated
  using ((select public.is_admin()));
create policy "messages: participants send as themselves" on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (select public.is_active_user())
    and (select public.is_conversation_participant(conversation_id))
  );

-- ---------------------------------------------------------------------------
-- reviews (written by server code only)
-- ---------------------------------------------------------------------------
grant select on public.reviews to anon, authenticated;

create policy "reviews: anyone reads published" on public.reviews for select to anon, authenticated
  using (status = 'published' and public.is_business_public(business_id));
create policy "reviews: authors read own" on public.reviews for select to authenticated
  using (customer_id = (select auth.uid()));
create policy "reviews: businesses read theirs" on public.reviews for select to authenticated
  using ((select public.owns_business(business_id)));
create policy "reviews: admins read all" on public.reviews for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy "notifications: read own" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "notifications: mark own read" on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- disputes (written by server code only)
-- ---------------------------------------------------------------------------
grant select on public.disputes to authenticated;

create policy "disputes: booking participants read" on public.disputes for select to authenticated
  using ((select public.is_booking_participant(booking_id)));
create policy "disputes: admins read all" on public.disputes for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- admin_actions and platform_settings (admins only)
-- ---------------------------------------------------------------------------
grant select on public.admin_actions, public.platform_settings to authenticated;

create policy "admin_actions: admins read" on public.admin_actions for select to authenticated
  using ((select public.is_admin()));
create policy "platform_settings: admins read" on public.platform_settings for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- AI Concierge history (written by server code only; owners can read and delete)
-- ---------------------------------------------------------------------------
grant select, delete on public.ai_conversations to authenticated;
grant select on public.ai_messages to authenticated;

create policy "ai_conversations: read own" on public.ai_conversations for select to authenticated
  using (user_id = (select auth.uid()));
create policy "ai_conversations: delete own" on public.ai_conversations for delete to authenticated
  using (user_id = (select auth.uid()));
create policy "ai_messages: read own" on public.ai_messages for select to authenticated
  using (exists (
    select 1 from public.ai_conversations c
    where c.id = ai_conversation_id and c.user_id = (select auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- Realtime: chat and notifications (Realtime applies the policies above)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.messages, public.conversations, public.notifications;
