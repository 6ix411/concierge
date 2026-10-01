-- Controlled chat: human to human only, read receipts, notifications, blocking, restriction and
-- private contact details. Run on a fresh `supabase db reset`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- Seed: Emeka's confirmed booking with Mama Put Catering has an open chat.
create temp table ids as
select c.id as convo, c.customer_id as customer, b.owner_id as owner, b.id as business,
  'a0000000-0000-0000-0000-000000000001'::uuid as outsider
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

select is((select count(*)::int from ids), 1, 'fixture: one open chat');

-- ---------------------------------------------------------------------------
-- Only the two people can talk
-- ---------------------------------------------------------------------------

select pg_temp.act_as((select customer from ids));
select lives_ok($$ insert into public.messages (conversation_id, sender_id, body)
  select convo, customer, 'Hello, can we confirm the menu?' from ids $$, 'the customer can message the business');
select lives_ok($$ insert into public.messages (conversation_id, sender_id, body)
  select convo, customer, 'Also the guest count.' from ids $$, 'and send a second message');
select throws_ok($$ insert into public.messages (conversation_id, sender_id, body, is_flagged)
  select convo, customer, 'x', true from ids $$, '42501', null, 'senders cannot set moderation flags');
reset role;

select is((select count(*)::int from public.notifications
  where user_id = (select owner from ids) and type = 'message.new' and read_at is null), 1,
  'the business gets one new-message notification, not one per message');
select ok((select body not like '%menu%' from public.notifications
  where user_id = (select owner from ids) and type = 'message.new'),
  'notifications never include the message text');

select pg_temp.act_as((select outsider from ids));
select throws_ok($$ insert into public.messages (conversation_id, sender_id, body)
  select convo, outsider, 'hi' from ids $$, '23514', null, 'outsiders cannot post');
select is((select count(*)::int from public.conversation_reads), 0, 'outsiders cannot see read receipts');
select throws_ok($$ select public.mark_conversation_read((select convo from ids)) $$, '42501', null,
  'outsiders cannot mark a chat read');
reset role;

-- No AI or system sender: a message must come from the customer or the business owner, even for the server.
select throws_ok($$ insert into public.messages (conversation_id, sender_id, body)
  select convo, (select id from public.users where role = 'admin' limit 1), 'Automated reply' from ids $$,
  '23514', null, 'nobody else can write into the chat, not even with full database access');

-- ---------------------------------------------------------------------------
-- Read receipts
-- ---------------------------------------------------------------------------

select pg_temp.act_as((select owner from ids));
select lives_ok($$ select public.mark_conversation_read((select convo from ids)) $$, 'the business reads the chat');
select is((select count(*)::int from public.notifications where type = 'message.new' and read_at is null), 0,
  'reading the chat clears its notification');
reset role;
select pg_temp.act_as((select customer from ids));
select ok((select last_read_at >= (select max(created_at) from public.messages where conversation_id = (select convo from ids))
  from public.conversation_reads where user_id = (select owner from ids)),
  'the customer can see the business has read their messages');
reset role;

-- ---------------------------------------------------------------------------
-- Blocking and restriction
-- ---------------------------------------------------------------------------

select pg_temp.act_as((select owner from ids));
select throws_ok($$ insert into public.user_blocks (blocker_id, blocked_id) select owner, customer from ids $$,
  '42501', null, 'blocks are made through the server');
select throws_ok($$ insert into public.chat_reports (conversation_id, reporter_id, reported_user_id, reason)
  select convo, owner, customer, 'spam' from ids $$, '42501', null, 'reports are made through the server');
reset role;

insert into public.user_blocks (blocker_id, blocked_id, conversation_id) select owner, customer, convo from ids;
select pg_temp.act_as((select customer from ids));
select throws_ok($$ insert into public.messages (conversation_id, sender_id, body)
  select convo, customer, 'Are you there?' from ids $$, '23514', null, 'a blocked person cannot send');
select is((select count(*)::int from public.user_blocks), 1, 'the blocked person can see the block');
reset role;
select pg_temp.act_as((select owner from ids));
select throws_ok($$ insert into public.messages (conversation_id, sender_id, body)
  select convo, owner, 'hi' from ids $$, '23514', null, 'the blocker cannot send either while it lasts');
reset role;
delete from public.user_blocks;

update public.conversations set status = 'locked' where id = (select convo from ids);
select pg_temp.act_as((select customer from ids));
select throws_ok($$ insert into public.messages (conversation_id, sender_id, body)
  select convo, customer, 'hi' from ids $$, '23514', null, 'nobody can send in a restricted chat');
reset role;
update public.bookings set status = 'in_progress' where id = (select booking_id from public.conversations where id = (select convo from ids));
select is((select status::text from public.conversations where id = (select convo from ids)), 'locked',
  'a restricted chat stays restricted when the booking moves on');

-- ---------------------------------------------------------------------------
-- Contact details stay private
-- ---------------------------------------------------------------------------

select pg_temp.act_as(null);
select throws_ok($$ select phone from public.businesses limit 1 $$, '42501', null, 'visitors cannot read business phone numbers');
select throws_ok($$ select email from public.businesses limit 1 $$, '42501', null, 'visitors cannot read business emails');
reset role;
select pg_temp.act_as((select customer from ids));
select throws_ok($$ select phone from public.businesses where slug = 'mama-put-catering' $$, '42501', null,
  'customers cannot read the business''s phone number');
select throws_ok($$ select public.conversation_counterpart((select convo from ids), auth.uid()) $$, '42501', null,
  'the counterpart lookup is internal');
reset role;

select * from finish();
rollback;
