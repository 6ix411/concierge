-- Stage 22: closing the gaps found when checking the core product rules.
--
-- Rule 1: only registered, approved businesses whose owner account is active can take bookings.
-- Rule 8: the platform controls communication: chat messages that share phone numbers, emails,
--         links or "WhatsApp me" are marked for the Concierge team.
-- Rule 10: businesses don't get the customer's private contact details by default: the street
--          address of a booking is only shown to the business once the booking is confirmed (paid).

-- ---------------------------------------------------------------------------
-- Rule 1: new bookings only for businesses that are open for them
-- ---------------------------------------------------------------------------
create function public.check_booking_business_open()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.businesses b
    join public.users owner on owner.id = b.owner_id
    where b.id = new.business_id
      and b.status = 'approved'
      and b.accepting_bookings
      and owner.status = 'active'
  ) then
    raise exception 'This business isn''t taking bookings right now.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger bookings_business_open
before insert on public.bookings
for each row execute function public.check_booking_business_open();

-- ---------------------------------------------------------------------------
-- Rule 10: the street address waits until the booking is confirmed
-- ---------------------------------------------------------------------------
-- Clients can read every booking column except address_line. Area, city and state stay visible so a
-- business can decide whether to take the job.
revoke select on public.bookings from authenticated;
grant select (
  id, reference, customer_id, business_id, status, scheduled_start, scheduled_end, city, state,
  customer_notes, quote_notes, subtotal_minor, platform_fee_minor, total_minor, currency,
  commission_rate_bps, accepted_at, confirmed_at, completed_at, cancelled_at, cancelled_by,
  cancellation_reason, created_at, updated_at, area, guests, needs_quote, change_actor_id, change_note,
  request_key
) on public.bookings to authenticated;

create function public.booking_address(p_booking_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select b.address_line
  from public.bookings b
  where b.id = p_booking_id
    and (
      b.customer_id = (select auth.uid())
      or (
        b.status in ('confirmed', 'in_progress', 'completed', 'reviewed', 'disputed')
        and exists (select 1 from public.businesses z where z.id = b.business_id and z.owner_id = (select auth.uid()))
      )
    );
$$;

comment on function public.booking_address(uuid) is
  'The booking''s street address: always for its customer, for the business only once the booking is confirmed.';
revoke execute on function public.booking_address(uuid) from public, anon;
grant execute on function public.booking_address(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Rule 8: chat messages that share contact details are marked for the team
-- ---------------------------------------------------------------------------
-- Not readable by clients. Admins see it when they open a chat they have a reason to open (a
-- report or a dispute); chats stay private otherwise.
alter table public.messages add column shares_contact boolean not null default false;

create function public.shares_contact_details(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_text, '') ~* '(\+?234|(^|[^0-9])0)[ -]?[789][01][ -]?[0-9][ -]?[0-9]{3}[ -]?[0-9]{4}([^0-9]|$)'
      or coalesce(p_text, '') ~* '[^[:space:]@]+@[^[:space:]@]+\.[a-z]{2,}'
      or coalesce(p_text, '') ~* '(https?://|www\.|wa\.me/|t\.me/)'
      or coalesce(p_text, '') ~* '\m(whats ?app|telegram|signal me|call me on|text me on)\M';
$$;

create or replace function public.check_message_sender()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  convo public.conversations;
  other uuid;
begin
  select * into convo from public.conversations where id = new.conversation_id;
  if convo.status = 'locked' then
    raise exception 'This conversation has been restricted by the Concierge team' using errcode = 'check_violation';
  end if;
  if convo.status <> 'open' then
    raise exception 'This conversation is not open' using errcode = 'check_violation';
  end if;
  if new.sender_id <> convo.customer_id
     and not exists (select 1 from public.businesses where id = convo.business_id and owner_id = new.sender_id) then
    raise exception 'Only the customer and the business can send messages here' using errcode = 'check_violation';
  end if;
  other := public.conversation_counterpart(new.conversation_id, new.sender_id);
  if exists (
    select 1 from public.user_blocks
    where (blocker_id = new.sender_id and blocked_id = other) or (blocker_id = other and blocked_id = new.sender_id)
  ) then
    raise exception 'Messages between you are blocked' using errcode = 'check_violation';
  end if;
  -- No flooding: at most 20 messages a minute per person, across all their chats.
  if (select count(*) from public.messages
      where sender_id = new.sender_id and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'You''re sending messages too quickly. Please wait a moment.' using errcode = 'P0001';
  end if;
  -- An attachment must be a file stored in this conversation's own folder.
  if new.attachment_path is not null and not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'chat-attachments' and o.name = new.attachment_path
      and public.storage_owner_id(o.name) = new.conversation_id
  ) then
    raise exception 'Attachment not found in this conversation' using errcode = 'check_violation';
  end if;
  -- Moderation fields are never set by the sender.
  new.is_flagged := false;
  new.hidden_at := null;
  new.shares_contact := public.shares_contact_details(new.body);
  return new;
end;
$$;
