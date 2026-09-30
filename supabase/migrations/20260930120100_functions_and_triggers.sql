-- Stage 2: helper functions used by RLS, and triggers that protect data integrity
-- no matter who writes (including trusted server code using the service role).

-- ---------------------------------------------------------------------------
-- Sign-up: create the public user row (and customer profile) for every auth user
-- ---------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested text := new.raw_user_meta_data ->> 'role';
  chosen public.user_role :=
    case when requested in ('customer', 'business') then requested::public.user_role else 'customer' end;
begin
  -- 'admin' can never be chosen at sign-up; it is granted server-side by another admin.
  insert into public.users (id, role, email, full_name)
  values (new.id, chosen, new.email, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''));

  if chosen = 'customer' then
    insert into public.customer_profiles (user_id) values (new.id);
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create function public.handle_auth_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.users set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
after update of email on auth.users
for each row when (old.email is distinct from new.email)
execute function public.handle_auth_email_change();

-- ---------------------------------------------------------------------------
-- Authorization helpers (security definer so RLS policies don't recurse)
-- ---------------------------------------------------------------------------

create function public.current_user_role()
returns public.user_role
language sql stable security definer set search_path = ''
as $$
  select role from public.users where id = auth.uid() and status = 'active';
$$;

create function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.current_user_role() = 'admin', false);
$$;

create function public.is_active_user()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.users where id = auth.uid() and status = 'active');
$$;

create function public.owns_business(target_business_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.businesses b
    join public.users u on u.id = b.owner_id
    where b.id = target_business_id and b.owner_id = auth.uid() and u.status = 'active'
  );
$$;

create function public.is_business_public(target_business_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.businesses where id = target_business_id and status = 'approved');
$$;

create function public.is_booking_participant(target_booking_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.bookings bk
    where bk.id = target_booking_id
      and (bk.customer_id = auth.uid() or public.owns_business(bk.business_id))
  );
$$;

create function public.is_conversation_participant(target_conversation_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = target_conversation_id
      and (c.customer_id = auth.uid() or public.owns_business(c.business_id))
  );
$$;

-- Helpers are for policies; don't let anonymous callers probe them via the API.
revoke execute on function
  public.current_user_role(), public.is_admin(), public.is_active_user(),
  public.owns_business(uuid), public.is_business_public(uuid),
  public.is_booking_participant(uuid), public.is_conversation_participant(uuid)
from public, anon;
grant execute on function
  public.current_user_role(), public.is_admin(), public.is_active_user(),
  public.owns_business(uuid), public.is_business_public(uuid),
  public.is_booking_participant(uuid), public.is_conversation_participant(uuid)
to authenticated, service_role;
-- is_business_public is also needed for anonymous browsing.
grant execute on function public.is_business_public(uuid) to anon;

revoke execute on function public.handle_new_user(), public.handle_auth_email_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Businesses: only business accounts can own one
-- ---------------------------------------------------------------------------

create function public.check_business_owner_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.users where id = new.owner_id and role = 'business') then
    raise exception 'Business owner must have the business role' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger businesses_check_owner_role
before insert or update of owner_id on public.businesses
for each row execute function public.check_business_owner_role();

-- ---------------------------------------------------------------------------
-- Bookings: valid status transitions and derived data
-- ---------------------------------------------------------------------------

create function public.is_valid_booking_transition(from_status public.booking_status, to_status public.booking_status)
returns boolean
language sql immutable set search_path = ''
as $$
  select from_status = to_status or (from_status, to_status) in (
    ('quote_requested', 'quoted'), ('quote_requested', 'rejected'), ('quote_requested', 'cancelled'), ('quote_requested', 'expired'),
    ('quoted', 'requested'), ('quoted', 'accepted'), ('quoted', 'cancelled'), ('quoted', 'expired'),
    ('requested', 'accepted'), ('requested', 'rejected'), ('requested', 'cancelled'), ('requested', 'expired'),
    ('accepted', 'confirmed'), ('accepted', 'cancelled'), ('accepted', 'expired'),
    ('confirmed', 'in_progress'), ('confirmed', 'completed'), ('confirmed', 'cancelled'), ('confirmed', 'disputed'),
    ('in_progress', 'completed'), ('in_progress', 'disputed'), ('in_progress', 'cancelled'),
    ('completed', 'disputed'),
    ('disputed', 'completed'), ('disputed', 'cancelled')
  );
$$;

create function public.guard_booking_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('quote_requested', 'requested') then
      raise exception 'New bookings must start as quote_requested or requested' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.businesses where id = new.business_id and status = 'approved') then
      raise exception 'Bookings can only be made with approved businesses' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.users where id = new.customer_id and role = 'customer' and status = 'active') then
      raise exception 'Only active customers can make bookings' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.customer_id <> old.customer_id or new.business_id <> old.business_id then
    raise exception 'A booking cannot change customer or business' using errcode = 'check_violation';
  end if;
  if not public.is_valid_booking_transition(old.status, new.status) then
    raise exception 'Invalid booking status change from % to %', old.status, new.status using errcode = 'check_violation';
  end if;

  if new.status <> old.status then
    case new.status
      when 'accepted' then new.accepted_at := coalesce(new.accepted_at, now());
      when 'confirmed' then new.confirmed_at := coalesce(new.confirmed_at, now());
      when 'completed' then new.completed_at := coalesce(new.completed_at, now());
      when 'cancelled' then new.cancelled_at := coalesce(new.cancelled_at, now());
      else null;
    end case;
  end if;
  return new;
end;
$$;

create trigger bookings_guard
before insert or update on public.bookings
for each row execute function public.guard_booking_changes();

-- Opening and closing the human chat follows the booking.
create function public.sync_conversation_with_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    insert into public.conversations (booking_id, customer_id, business_id)
    values (new.id, new.customer_id, new.business_id)
    on conflict (booking_id) do update set status = 'open';
  elsif new.status in ('cancelled', 'rejected', 'expired') then
    update public.conversations set status = 'closed' where booking_id = new.id and status = 'open';
  end if;
  return new;
end;
$$;

create trigger bookings_sync_conversation
after update of status on public.bookings
for each row execute function public.sync_conversation_with_booking();

-- ---------------------------------------------------------------------------
-- Payments and payouts must match their booking
-- ---------------------------------------------------------------------------

create function public.check_payment_matches_booking()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.bookings where id = new.booking_id and customer_id = new.payer_id) then
    raise exception 'Payer must be the booking''s customer' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger payments_check_booking
before insert or update of booking_id, payer_id on public.payments
for each row execute function public.check_payment_matches_booking();

create function public.check_payout_matches_booking()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.booking_id is not null
     and not exists (select 1 from public.bookings where id = new.booking_id and business_id = new.business_id) then
    raise exception 'Payout business must match the booking''s business' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger payouts_check_booking
before insert or update of booking_id, business_id on public.payouts
for each row execute function public.check_payout_matches_booking();

-- ---------------------------------------------------------------------------
-- Chat integrity
-- ---------------------------------------------------------------------------

create function public.check_conversation_matches_booking()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.bookings
    where id = new.booking_id and customer_id = new.customer_id and business_id = new.business_id
  ) then
    raise exception 'Conversation participants must match the booking' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger conversations_check_booking
before insert or update of booking_id, customer_id, business_id on public.conversations
for each row execute function public.check_conversation_matches_booking();

-- Only the two human participants can send, and only while the chat is open.
create function public.check_message_sender()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  convo public.conversations;
begin
  select * into convo from public.conversations where id = new.conversation_id;
  if convo.status <> 'open' then
    raise exception 'This conversation is not open' using errcode = 'check_violation';
  end if;
  if new.sender_id <> convo.customer_id
     and not exists (select 1 from public.businesses where id = convo.business_id and owner_id = new.sender_id) then
    raise exception 'Only the customer and the business can send messages here' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger messages_check_sender
before insert on public.messages
for each row execute function public.check_message_sender();

create function public.touch_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_touch_conversation
after insert on public.messages
for each row execute function public.touch_conversation_on_message();

-- ---------------------------------------------------------------------------
-- Reviews: one per completed booking, by its customer; keep ratings current
-- ---------------------------------------------------------------------------

create function public.check_review_booking()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.bookings
    where id = new.booking_id and customer_id = new.customer_id
      and business_id = new.business_id and status = 'completed'
  ) then
    raise exception 'Reviews are only allowed on your own completed bookings' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger reviews_check_booking
before insert or update of booking_id, customer_id, business_id on public.reviews
for each row execute function public.check_review_booking();

create function public.refresh_business_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := coalesce(new.business_id, old.business_id);
begin
  update public.businesses b
  set rating_avg = coalesce(s.avg_rating, 0), rating_count = coalesce(s.review_count, 0)
  from (
    select round(avg(rating)::numeric, 2) as avg_rating, count(*)::int as review_count
    from public.reviews where business_id = target and status = 'published'
  ) s
  where b.id = target;
  return null;
end;
$$;

create trigger reviews_refresh_rating
after insert or update of rating, status or delete on public.reviews
for each row execute function public.refresh_business_rating();

-- ---------------------------------------------------------------------------
-- Admin audit log is append-only, even for the service role
-- ---------------------------------------------------------------------------

create function public.prevent_admin_action_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'admin_actions is append-only' using errcode = 'insufficient_privilege';
end;
$$;

create trigger admin_actions_append_only
before update or delete on public.admin_actions
for each row execute function public.prevent_admin_action_changes();

create function public.check_admin_action_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.users where id = new.admin_id and role = 'admin') then
    raise exception 'admin_actions.admin_id must be an admin' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger admin_actions_check_actor
before insert on public.admin_actions
for each row execute function public.check_admin_action_actor();
