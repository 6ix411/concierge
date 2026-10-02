-- Stage 15: security hardening.
-- Adds a rate limiter that works across server instances, a security event log, a cap on how fast
-- people can send chat messages, server-verified chat attachments, and removes access nobody uses
-- (admins reading every chat directly through the API, avatar uploads).

-- ---------------------------------------------------------------------------
-- Rate limiting, shared by every server instance
-- ---------------------------------------------------------------------------

create table public.rate_limit_hits (
  key text not null check (char_length(key) <= 300),
  window_start timestamptz not null,
  hits integer not null default 1,
  primary key (key, window_start)
);
comment on table public.rate_limit_hits is
  'Request counts per key (action + user or network address) per fixed window. Server only.';
revoke all on public.rate_limit_hits from anon, authenticated;
alter table public.rate_limit_hits enable row level security;

-- Counts one attempt and says whether it is allowed. Atomic, so parallel requests can't slip past.
create function public.hit_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  bucket timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  total integer;
begin
  insert into public.rate_limit_hits (key, window_start) values (left(p_key, 300), bucket)
  on conflict (key, window_start) do update set hits = public.rate_limit_hits.hits + 1
  returning hits into total;
  return total <= p_limit;
end;
$$;
revoke execute on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;

select cron.schedule('rate-limit-cleanup', '17 * * * *',
  $$delete from public.rate_limit_hits where window_start < now() - interval '1 day'$$);

-- ---------------------------------------------------------------------------
-- Security event log (failed sign-ins, blocked requests, role changes, bad webhooks…)
-- ---------------------------------------------------------------------------

create table public.security_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event text not null check (char_length(event) <= 80),
  user_id uuid references public.users (id) on delete set null,
  -- A hash of the network address, never the address itself.
  ip_hash text check (char_length(ip_hash) <= 64),
  details jsonb not null default '{}'::jsonb
);
comment on table public.security_events is
  'Append-only log of security-relevant events. Written by the server and triggers; read by admins through the server.';
create index security_events_created_idx on public.security_events (created_at desc);
create index security_events_event_idx on public.security_events (event, created_at desc);
revoke all on public.security_events from anon, authenticated;
alter table public.security_events enable row level security;

create function public.security_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'The security log cannot be changed' using errcode = 'check_violation';
end;
$$;
create trigger security_events_append_only
before update or delete on public.security_events
for each row execute function public.security_events_append_only();

-- Role changes are always logged, however they happen.
create function public.log_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.security_events (event, user_id, details)
  values ('role.changed', new.id, jsonb_build_object('from', old.role, 'to', new.role));
  return new;
end;
$$;
create trigger users_log_role_change
after update of role on public.users
for each row when (old.role is distinct from new.role)
execute function public.log_role_change();

-- ---------------------------------------------------------------------------
-- Chat: message rate cap and server-verified attachments
-- ---------------------------------------------------------------------------

create index messages_sender_recent_idx on public.messages (sender_id, created_at);

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
  return new;
end;
$$;

-- People send text directly; a message with a file is sent by the server after it has checked the
-- file's contents (src/lib/chat/attachments.ts).
drop policy "messages: participants send as themselves" on public.messages;
create policy "messages: participants send text as themselves" on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and attachment_path is null
    and (select public.is_active_user())
    and (select public.is_conversation_participant(conversation_id))
  );

-- Uploaded files are named by the app: <conversation_id>/<random id>.<extension>.
drop policy "chat-attachments: participants upload to open chats" on storage.objects;
create policy "chat-attachments: participants upload to open chats" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{1,5}$'
    and public.is_conversation_participant(public.storage_owner_id(name))
    and exists (select 1 from public.conversations c where c.id = public.storage_owner_id(name) and c.status = 'open')
  );

-- Old Word and Excel formats can carry macros; the newer .docx and .xlsx are still accepted.
update storage.buckets
set allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
      'video/mp4', 'video/quicktime', 'video/webm',
      'application/pdf', 'text/plain',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
where id = 'chat-attachments';

-- ---------------------------------------------------------------------------
-- Admins read private chats only through the dashboard, which requires a dispute or report and
-- records every access. Nothing lets them read them directly through the API.
-- ---------------------------------------------------------------------------

drop policy "conversations: admins read for moderation" on public.conversations;
drop policy "messages: admins read for moderation" on public.messages;
drop policy "chat-attachments: admins read" on storage.objects;

-- ---------------------------------------------------------------------------
-- Unused upload paths
-- ---------------------------------------------------------------------------

-- There is no profile photo feature; nobody should be able to put files in this public bucket.
drop policy "avatars: users upload own" on storage.objects;
drop policy "avatars: users update own" on storage.objects;
drop policy "avatars: users delete own" on storage.objects;
