-- Stage 13: disputes.
-- The customer or the business opens a dispute on a booking with a reason, a description and
-- evidence. Both sides and the Concierge team talk in the dispute's own message thread, and the team
-- decides. Everything is written by the server, and the record can't be rewritten afterwards:
-- what was reported is frozen, messages and evidence are append-only, and every change is logged.

-- ---------------------------------------------------------------------------
-- The dispute record
-- ---------------------------------------------------------------------------

alter table public.disputes
  add column reason_code text not null default 'other' check (reason_code in (
    'not_delivered', 'poor_quality', 'no_show', 'late', 'damage', 'overcharged', 'behaviour', 'other'
  )),
  add column escalated_at timestamptz,
  add column escalation_reason text check (char_length(escalation_reason) <= 1000),
  -- Who made the latest change and why. Write-only: read by the history trigger.
  add column change_actor_id uuid references public.users (id) on delete set null,
  add column change_note text check (char_length(change_note) <= 2000);
comment on column public.disputes.reason_code is 'The kind of problem, chosen by whoever opened the dispute.';

-- Withdrawn: whoever opened it took it back before a decision.
alter table public.disputes drop constraint disputes_outcome_check;
alter table public.disputes
  add constraint disputes_outcome_check check (outcome in ('business', 'customer', 'dismissed', 'withdrawn'));
comment on column public.disputes.outcome is
  'business: job stands, payout released. customer: booking cancelled, refund due. dismissed: no change. withdrawn: the opener took it back.';

-- Escalated disputes are still active.
drop index public.disputes_open_idx;
create index disputes_open_idx on public.disputes (created_at) where status in ('open', 'under_review', 'escalated');
drop index public.disputes_one_active_per_booking;
create unique index disputes_one_active_per_booking on public.disputes (booking_id)
  where status in ('open', 'under_review', 'escalated');

create function public.is_dispute_active(p_status public.dispute_status)
returns boolean
language sql immutable set search_path = ''
as $$
  select p_status in ('open', 'under_review', 'escalated');
$$;

create function public.is_valid_dispute_transition(from_status public.dispute_status, to_status public.dispute_status)
returns boolean
language sql immutable set search_path = ''
as $$
  select from_status = to_status or (from_status, to_status) in (
    ('open', 'under_review'), ('open', 'escalated'), ('open', 'resolved'), ('open', 'closed'),
    ('under_review', 'escalated'), ('under_review', 'resolved'), ('under_review', 'closed'),
    ('escalated', 'under_review'), ('escalated', 'resolved'), ('escalated', 'closed')
  );
$$;

-- What was reported can't be edited, a decided dispute is final, and status only moves forward.
create function public.protect_dispute()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Only an untouched dispute (the server undoing a failed open) can be removed.
    if old.status = 'open'
       and not exists (select 1 from public.dispute_messages where dispute_id = old.id)
       and not exists (select 1 from public.dispute_evidence where dispute_id = old.id) then
      return old;
    end if;
    raise exception 'Disputes cannot be deleted' using errcode = 'check_violation';
  end if;
  if new.booking_id <> old.booking_id or new.opened_by <> old.opened_by or new.reason <> old.reason
     or new.reason_code <> old.reason_code or new.description is distinct from old.description
     or new.created_at <> old.created_at or new.previous_booking_status is distinct from old.previous_booking_status then
    raise exception 'What was reported in a dispute cannot be changed' using errcode = 'check_violation';
  end if;
  if not public.is_dispute_active(old.status) and (
       new.status <> old.status or new.outcome is distinct from old.outcome
       or new.resolution is distinct from old.resolution or new.refund_due_minor <> old.refund_due_minor) then
    raise exception 'A closed dispute cannot be reopened or changed' using errcode = 'check_violation';
  end if;
  if not public.is_valid_dispute_transition(old.status, new.status) then
    raise exception 'A dispute cannot go from % to %', old.status, new.status using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger disputes_protect
before update or delete on public.disputes
for each row execute function public.protect_dispute();

-- ---------------------------------------------------------------------------
-- Messages: customer, business and the Concierge team, in the dispute's own thread
-- ---------------------------------------------------------------------------

create table public.dispute_messages (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.disputes (id) on delete cascade,
  sender_id uuid not null references public.users (id) on delete restrict,
  sender_role text not null check (sender_role in ('customer', 'business', 'admin')),
  body text not null check (char_length(trim(body)) between 1 and 5000),
  -- Notes between admins only; the customer and the business never see them.
  internal boolean not null default false,
  created_at timestamptz not null default now(),
  constraint dispute_messages_internal_admin check (not internal or sender_role = 'admin')
);
comment on table public.dispute_messages is
  'The dispute thread. Append-only and written by the server; internal notes are admin-only.';
create index dispute_messages_dispute_idx on public.dispute_messages (dispute_id, created_at);

-- ---------------------------------------------------------------------------
-- Evidence: photos, videos and PDFs, in a private bucket
-- ---------------------------------------------------------------------------

-- dispute-evidence/<dispute_id>/<uuid>.<ext>. Uploaded and signed by the server only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('dispute-evidence', 'dispute-evidence', false, 20 * 1024 * 1024,
    array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm', 'application/pdf'])
on conflict (id) do nothing;

create table public.dispute_evidence (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.disputes (id) on delete cascade,
  message_id uuid references public.dispute_messages (id) on delete cascade,
  uploaded_by uuid not null references public.users (id) on delete restrict,
  uploader_role text not null check (uploader_role in ('customer', 'business', 'admin')),
  storage_path text not null unique check (char_length(storage_path) <= 300),
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes integer not null check (size_bytes between 1 and 20971520),
  created_at timestamptz not null default now()
);
comment on table public.dispute_evidence is
  'Files added to a dispute by either side or the Concierge team. Append-only, written by the server.';
create index dispute_evidence_dispute_idx on public.dispute_evidence (dispute_id, created_at);

-- Messages and evidence: the sender really is who they say, and the dispute is still active.
create function public.check_dispute_contribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.dispute_status;
  v_customer uuid;
  v_owner uuid;
  v_user uuid;
  v_role text;
begin
  if tg_table_name = 'dispute_messages' then
    v_user := new.sender_id; v_role := new.sender_role;
  else
    v_user := new.uploaded_by; v_role := new.uploader_role;
  end if;
  select d.status, bk.customer_id, b.owner_id into v_status, v_customer, v_owner
  from public.disputes d
  join public.bookings bk on bk.id = d.booking_id
  join public.businesses b on b.id = bk.business_id
  where d.id = new.dispute_id;
  if not public.is_dispute_active(v_status) then
    raise exception 'This dispute is closed' using errcode = 'check_violation';
  end if;
  if not (
    (v_role = 'customer' and v_user = v_customer)
    or (v_role = 'business' and v_user = v_owner)
    or (v_role = 'admin' and exists (select 1 from public.users where id = v_user and role = 'admin' and status = 'active'))
  ) then
    raise exception 'Only the customer, the business and the Concierge team can add to a dispute'
      using errcode = 'check_violation';
  end if;
  if tg_table_name = 'dispute_evidence'
     and (select count(*) from public.dispute_evidence where dispute_id = new.dispute_id) >= 30 then
    raise exception 'A dispute can have at most 30 files' using errcode = 'check_violation';
  end if;
  new.created_at := now();
  return new;
end;
$$;

create trigger dispute_messages_check
before insert on public.dispute_messages
for each row execute function public.check_dispute_contribution();
create trigger dispute_evidence_check
before insert on public.dispute_evidence
for each row execute function public.check_dispute_contribution();

-- ---------------------------------------------------------------------------
-- History: every change to a dispute, append-only
-- ---------------------------------------------------------------------------

create table public.dispute_events (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.disputes (id) on delete cascade,
  event text not null check (event in ('opened', 'status_changed', 'message', 'evidence')),
  from_status public.dispute_status,
  to_status public.dispute_status,
  actor_id uuid references public.users (id) on delete set null,
  actor_role text,
  note text,
  -- Internal notes are logged too, but only admins see that entry.
  internal boolean not null default false,
  created_at timestamptz not null default now()
);
comment on table public.dispute_events is 'Dispute history, written by triggers only. Cannot be changed.';
create index dispute_events_dispute_idx on public.dispute_events (dispute_id, created_at);

create function public.dispute_actor_role(p_dispute_id uuid, p_user uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when p_user is null then 'system'
    when bk.customer_id = p_user then 'customer'
    when b.owner_id = p_user then 'business'
    when exists (select 1 from public.users u where u.id = p_user and u.role = 'admin') then 'admin'
    else 'system'
  end
  from public.disputes d
  join public.bookings bk on bk.id = d.booking_id
  join public.businesses b on b.id = bk.business_id
  where d.id = p_dispute_id;
$$;
revoke execute on function public.dispute_actor_role(uuid, uuid) from public, anon, authenticated;

create function public.log_dispute_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.dispute_events (dispute_id, event, to_status, actor_id, actor_role, note)
    values (new.id, 'opened', new.status, new.opened_by, public.dispute_actor_role(new.id, new.opened_by), new.reason);
  elsif new.status <> old.status then
    insert into public.dispute_events (dispute_id, event, from_status, to_status, actor_id, actor_role, note)
    values (new.id, 'status_changed', old.status, new.status, new.change_actor_id,
      public.dispute_actor_role(new.id, new.change_actor_id), new.change_note);
  end if;
  return new;
end;
$$;

create trigger disputes_log_change
after insert or update of status on public.disputes
for each row execute function public.log_dispute_change();

create function public.log_dispute_contribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'dispute_messages' then
    insert into public.dispute_events (dispute_id, event, actor_id, actor_role, internal)
    values (new.dispute_id, 'message', new.sender_id, new.sender_role, new.internal);
  else
    insert into public.dispute_events (dispute_id, event, actor_id, actor_role, note)
    values (new.dispute_id, 'evidence', new.uploaded_by, new.uploader_role, new.file_name);
  end if;
  return new;
end;
$$;

create trigger dispute_messages_log
after insert on public.dispute_messages
for each row execute function public.log_dispute_contribution();
create trigger dispute_evidence_log
after insert on public.dispute_evidence
for each row execute function public.log_dispute_contribution();

-- Messages, evidence and history can't be edited or removed (only a cascade from an untouched dispute).
create function public.protect_dispute_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'Dispute records cannot be changed' using errcode = 'check_violation';
end;
$$;

create trigger dispute_messages_append_only
before update or delete on public.dispute_messages
for each row execute function public.protect_dispute_history();
create trigger dispute_evidence_append_only
before update or delete on public.dispute_evidence
for each row execute function public.protect_dispute_history();
create trigger dispute_events_append_only
before update or delete on public.dispute_events
for each row execute function public.protect_dispute_history();

-- ---------------------------------------------------------------------------
-- Who can read what (nobody writes from the client)
-- ---------------------------------------------------------------------------

-- The dispute itself: participants and admins (existing policies). Hide the write-only columns.
revoke select on public.disputes from authenticated;
grant select (id, booking_id, opened_by, reason, reason_code, description, status, outcome, resolution,
  resolved_by, resolved_at, refund_due_minor, previous_booking_status, escalated_at, created_at, updated_at)
  on public.disputes to authenticated;

alter table public.dispute_messages enable row level security;
alter table public.dispute_evidence enable row level security;
alter table public.dispute_events enable row level security;
grant select on public.dispute_messages, public.dispute_evidence, public.dispute_events to authenticated;

create policy "dispute_messages: parties read shared" on public.dispute_messages for select to authenticated
  using (not internal and exists (
    select 1 from public.disputes d where d.id = dispute_id and public.is_booking_participant(d.booking_id)));
create policy "dispute_messages: admins read" on public.dispute_messages for select to authenticated
  using ((select public.is_admin()));

create policy "dispute_evidence: parties read" on public.dispute_evidence for select to authenticated
  using (exists (
    select 1 from public.disputes d where d.id = dispute_id and public.is_booking_participant(d.booking_id)));
create policy "dispute_evidence: admins read" on public.dispute_evidence for select to authenticated
  using ((select public.is_admin()));

create policy "dispute_events: parties read shared" on public.dispute_events for select to authenticated
  using (not internal and exists (
    select 1 from public.disputes d where d.id = dispute_id and public.is_booking_participant(d.booking_id)));
create policy "dispute_events: admins read" on public.dispute_events for select to authenticated
  using ((select public.is_admin()));

-- Escalated disputes count as open on the admin overview.
do $$
declare
  def text := pg_get_functiondef('public.admin_dashboard_stats(integer)'::regprocedure);
begin
  execute replace(def, $q$status in ('open', 'under_review')$q$, $q$status in ('open', 'under_review', 'escalated')$q$);
end;
$$;
