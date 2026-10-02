-- Stage 15 and 16: rate limits, the security log, chat attachments and flooding, admin chat access,
-- unused uploads, and what the AI Concierge can read. Run on a fresh `supabase db reset`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

create temp table ids as
select c.id as convo, c.customer_id as customer, b.owner_id as owner,
  (select id from public.conversations where id <> c.id and customer_id <> c.customer_id limit 1) as other_convo,
  'a0000000-0000-0000-0000-0000000000ad'::uuid as admin,
  (select id from public.businesses where slug = 'lush-events-decor') as approved_biz,
  (select id from public.businesses where slug = 'pending-pixels') as pending_biz
from public.conversations c
join public.businesses b on b.id = c.business_id
join public.bookings bk on bk.id = c.booking_id
where b.slug = 'mama-put-catering' and c.status = 'open' and bk.status = 'confirmed';
grant select on ids to authenticated, anon;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  if uid is null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  end if;
end;
$$;
grant execute on function pg_temp.act_as(uuid) to anon, authenticated;

select is((select count(*)::int from ids where other_convo is not null), 1, 'fixture: two chats with different customers');

-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------

select ok(public.hit_rate_limit('test:a', 2, 60) and public.hit_rate_limit('test:a', 2, 60), 'allowed up to the limit');
select ok(not public.hit_rate_limit('test:a', 2, 60), 'refused past the limit');
select ok(public.hit_rate_limit('test:b', 2, 60), 'each key has its own count');
select ok(not has_function_privilege('authenticated', 'public.hit_rate_limit(text, integer, integer)', 'execute'),
  'signed-in users cannot touch the limiter');
select ok(not has_function_privilege('anon', 'public.hit_rate_limit(text, integer, integer)', 'execute'),
  'visitors cannot touch the limiter');
select is((select count(*)::int from cron.job where jobname = 'rate-limit-cleanup'), 1, 'old counts are cleaned up');

-- ---------------------------------------------------------------------------
-- Security log
-- ---------------------------------------------------------------------------

update public.users set role = 'business' where id = (select customer from ids);
select is((select details ->> 'to' from public.security_events where event = 'role.changed' and user_id = (select customer from ids)),
  'business', 'role changes are always logged');
update public.users set role = 'customer' where id = (select customer from ids);
select throws_ok($$ delete from public.security_events $$, '23514', null, 'the security log cannot be deleted');
select throws_ok($$ update public.security_events set event = 'x' $$, '23514', null, 'or edited');

select pg_temp.act_as((select admin from ids));
select throws_ok($$ select * from public.security_events $$, '42501', null,
  'not even admins read the log through the API (the dashboard reads it on the server)');
select throws_ok($$ select * from public.rate_limit_hits $$, '42501', null, 'rate limit counts are private');
reset role;

-- ---------------------------------------------------------------------------
-- Chat: attachments are sent by the server, files stay in their own chat, no flooding
-- ---------------------------------------------------------------------------

insert into storage.objects (bucket_id, name, owner) values
  ('chat-attachments', (select convo::text from ids) || '/11111111-1111-1111-1111-111111111111.pdf', null),
  ('chat-attachments', (select other_convo::text from ids) || '/22222222-2222-2222-2222-222222222222.pdf', null);

select pg_temp.act_as((select customer from ids));
select throws_ok($$ insert into public.messages (conversation_id, sender_id, attachment_path)
  select convo, customer, convo || '/11111111-1111-1111-1111-111111111111.pdf' from ids $$, '42501', null,
  'people cannot attach files directly (the server checks the file first)');
select lives_ok($$ insert into public.messages (conversation_id, sender_id, body) select convo, customer, 'Hi' from ids $$,
  'text messages are still sent directly');
reset role;

select lives_ok($$ insert into public.messages (conversation_id, sender_id, attachment_path)
  select convo, customer, convo || '/11111111-1111-1111-1111-111111111111.pdf' from ids $$,
  'the server can attach a file from this chat');
select throws_ok($$ insert into public.messages (conversation_id, sender_id, attachment_path)
  select convo, customer, other_convo || '/22222222-2222-2222-2222-222222222222.pdf' from ids $$, '23514', null,
  'a message cannot point at a file from another chat');
select throws_ok($$ insert into public.messages (conversation_id, sender_id, attachment_path)
  select convo, customer, convo || '/33333333-3333-3333-3333-333333333333.pdf' from ids $$, '23514', null,
  'or at a file that does not exist');

insert into public.messages (conversation_id, sender_id, body)
select convo, owner, 'Message ' || n from ids, generate_series(1, 20) n;
select throws_ok($$ insert into public.messages (conversation_id, sender_id, body) select convo, owner, 'One more' from ids $$,
  'P0001', null, 'more than 20 messages a minute is refused');

select ok(not exists (select 1 from pg_policies where tablename in ('messages', 'conversations') and policyname like '%admins read%'),
  'admins have no direct API access to private chats');
select ok(not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'chat-attachments: admins read'),
  'or to chat files');
select ok(not exists (select 1 from pg_policies where schemaname = 'storage' and policyname like 'avatars: users %'),
  'nobody can upload to the unused public avatars bucket');
select ok(not exists (select 1 from storage.buckets where id = 'chat-attachments' and 'application/msword' = any(allowed_mime_types)),
  'old macro-capable Office formats are not accepted in chat');

-- ---------------------------------------------------------------------------
-- The AI Concierge's data access
-- ---------------------------------------------------------------------------

select pg_temp.act_as(null);
select isnt(public.concierge_provider_details((select approved_biz from ids)), null,
  'the concierge can read an eligible provider as a visitor');
select is(public.concierge_provider_details((select pending_biz from ids)), null,
  'but nothing about a provider that is not approved');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.concierge_provider_details((select approved_biz from ids))) k),
  array['areas', 'booking_window_days', 'description', 'min_notice_hours', 'reviews', 'services', 'weekly_hours'],
  'only structured matching fields come back');
select ok(public.concierge_provider_details((select approved_biz from ids))::text !~* '(phone|email|owner|document|@)',
  'no contact details, owner or documents');
select is((select count(*)::int from public.match_businesses(p_query => 'decor') m where m.id = (select pending_biz from ids)), 0,
  'search never returns unapproved businesses');
select throws_ok($$ select phone from public.businesses $$, '42501', null, 'visitors cannot read business contact details');
select throws_ok($$ select * from public.bookings $$, '42501', null, 'or any bookings');
reset role;

select * from finish();
rollback;
