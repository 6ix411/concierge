-- Stage 11: controlled customer ↔ business chat.
-- Strictly human to human: only the booking's customer and the business owner can send, and there is
-- no AI sender, no automated message and no link from the AI concierge to these tables.
-- Adds read receipts, message notifications, reports, blocking, admin restriction, wider attachment
-- types, and stops publishing businesses' phone numbers and emails to clients.

-- ---------------------------------------------------------------------------
-- Contact details stay private by default
-- ---------------------------------------------------------------------------

-- Visitors, customers and other businesses can no longer read a business's phone or email through
-- the API. The owner reads their own on the server; admins use the service role.
revoke select (phone, email) on public.businesses from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Attachments: photos, videos and common documents
-- ---------------------------------------------------------------------------

update storage.buckets
set file_size_limit = 50 * 1024 * 1024,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
      'video/mp4', 'video/quicktime', 'video/webm',
      'application/pdf', 'text/plain',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
where id = 'chat-attachments';

alter table public.messages
  add column attachment_name text check (char_length(attachment_name) <= 200),
  add column attachment_size integer check (attachment_size between 0 and 52428800);
grant select (attachment_name, attachment_size, is_flagged) on public.messages to authenticated;
grant insert (attachment_name, attachment_size) on public.messages to authenticated;

-- ---------------------------------------------------------------------------
-- Read receipts: how far each participant has read
-- ---------------------------------------------------------------------------

create table public.conversation_reads (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
comment on table public.conversation_reads is
  'When each participant last read a conversation; messages sent before that show as seen.';

alter table public.conversation_reads enable row level security;
grant select on public.conversation_reads to authenticated;
create policy "conversation_reads: participants read" on public.conversation_reads for select to authenticated
  using ((select public.is_conversation_participant(conversation_id)));

-- Called by a participant when they open or look at the chat. Also clears its message notifications.
create function public.mark_conversation_read(p_conversation_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  if not public.is_conversation_participant(p_conversation_id) then
    raise exception 'Not a participant in this conversation' using errcode = 'insufficient_privilege';
  end if;
  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  values (p_conversation_id, auth.uid(), v_now)
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
  update public.notifications set read_at = v_now
  where user_id = auth.uid() and type = 'message.new' and read_at is null
    and data ->> 'conversationId' = p_conversation_id::text;
  return v_now;
end;
$$;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Blocking: either person can stop the other messaging them
-- ---------------------------------------------------------------------------

create table public.user_blocks (
  blocker_id uuid not null references public.users (id) on delete cascade,
  blocked_id uuid not null references public.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);
comment on table public.user_blocks is
  'Who has blocked whom. Neither side can send messages to the other while a block exists.';
create index user_blocks_blocked_idx on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;
grant select on public.user_blocks to authenticated;
-- Both sides can see a block, so the chat can say why it's read-only. Written by the server only.
create policy "user_blocks: either side reads" on public.user_blocks for select to authenticated
  using (blocker_id = (select auth.uid()) or blocked_id = (select auth.uid()));
create policy "user_blocks: admins read" on public.user_blocks for select to authenticated
  using ((select public.is_admin()));

-- The other person in a conversation: the business owner for the customer and the other way round.
create function public.conversation_counterpart(p_conversation_id uuid, p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when c.customer_id = p_user_id then b.owner_id else c.customer_id end
  from public.conversations c
  join public.businesses b on b.id = c.business_id
  where c.id = p_conversation_id;
$$;
revoke execute on function public.conversation_counterpart(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sending: the two humans only, in an open chat, with no block between them
-- ---------------------------------------------------------------------------

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
  -- Moderation fields are never set by the sender.
  new.is_flagged := false;
  new.hidden_at := null;
  return new;
end;
$$;

-- A locked (restricted) chat stays locked when the booking changes; only an admin reopens it.
create or replace function public.sync_conversation_with_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    insert into public.conversations (booking_id, customer_id, business_id)
    values (new.id, new.customer_id, new.business_id)
    on conflict (booking_id) do update set status = 'open' where public.conversations.status <> 'locked';
  elsif new.status in ('cancelled', 'declined', 'expired', 'refunded') then
    update public.conversations set status = 'closed' where booking_id = new.id and status = 'open';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Notifications: one "new message" notification per conversation, not one per message
-- ---------------------------------------------------------------------------

create function public.notify_message_recipient()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient uuid := public.conversation_counterpart(new.conversation_id, new.sender_id);
  sender_name text;
  booking_ref text;
begin
  if recipient is null then
    return new;
  end if;
  select bk.reference,
         case when c.customer_id = new.sender_id then coalesce(u.full_name, 'Your customer') else b.name end
  into booking_ref, sender_name
  from public.conversations c
  join public.bookings bk on bk.id = c.booking_id
  join public.businesses b on b.id = c.business_id
  join public.users u on u.id = c.customer_id
  where c.id = new.conversation_id;

  -- Reuse the conversation's notification: it becomes unread again and moves to the top.
  update public.notifications
  set read_at = null, created_at = now()
  where id = (
    select id from public.notifications
    where user_id = recipient and type = 'message.new' and data ->> 'conversationId' = new.conversation_id::text
    order by created_at desc
    limit 1
  );
  if not found then
    insert into public.notifications (user_id, type, title, body, data)
    values (recipient, 'message.new', 'New message from ' || sender_name,
      'About booking ' || booking_ref || '. Open the chat to read it.',
      jsonb_build_object('conversationId', new.conversation_id, 'bookingReference', booking_ref));
  end if;
  return new;
end;
$$;

create trigger messages_notify_recipient
after insert on public.messages
for each row execute function public.notify_message_recipient();

-- Sending a message also marks the chat as read up to now for the sender.
create function public.read_own_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  values (new.conversation_id, new.sender_id, new.created_at)
  on conflict (conversation_id, user_id) do update
    set last_read_at = greatest(public.conversation_reads.last_read_at, excluded.last_read_at);
  return new;
end;
$$;

create trigger messages_read_own
after insert on public.messages
for each row execute function public.read_own_message();

-- ---------------------------------------------------------------------------
-- Reports: a message or the other person, for the Concierge team to review
-- ---------------------------------------------------------------------------

create type public.chat_report_reason as enum (
  'harassment', 'spam', 'scam', 'off_platform_payment', 'inappropriate', 'other'
);
create type public.chat_report_status as enum ('open', 'actioned', 'dismissed');

create table public.chat_reports (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  message_id uuid references public.messages (id) on delete set null,
  reporter_id uuid not null references public.users (id) on delete cascade,
  reported_user_id uuid not null references public.users (id) on delete cascade,
  reason public.chat_report_reason not null,
  details text check (char_length(details) <= 1000),
  status public.chat_report_status not null default 'open',
  resolution text check (char_length(resolution) <= 1000),
  reviewed_by uuid references public.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint chat_reports_not_self check (reporter_id <> reported_user_id)
);
comment on table public.chat_reports is
  'Messages or people reported from a chat. Written by the server after checking the reporter is a participant.';
create index chat_reports_open_idx on public.chat_reports (created_at desc) where status = 'open';
create index chat_reports_conversation_idx on public.chat_reports (conversation_id);
-- One open report per person per message (or per person reported, for user reports).
create unique index chat_reports_once on public.chat_reports
  (reporter_id, coalesce(message_id, '00000000-0000-0000-0000-000000000000'::uuid), reported_user_id)
  where status = 'open';

alter table public.chat_reports enable row level security;
grant select (id, conversation_id, message_id, reason, status, created_at) on public.chat_reports to authenticated;
create policy "chat_reports: reporters read own" on public.chat_reports for select to authenticated
  using (reporter_id = (select auth.uid()));
create policy "chat_reports: admins read" on public.chat_reports for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Live updates
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.conversation_reads;
