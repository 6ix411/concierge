-- Notifications: a welcome on registration, reminders and review requests sent once each, people see
-- only their own, and the email/SMS/push outbox stays server-only. Run on a fresh `supabase db reset`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

create temp table ids as
select
  (select bk.id from public.bookings bk join public.businesses b on b.id = bk.business_id
   where b.slug = 'mama-put-catering' and bk.status = 'confirmed'
     and bk.customer_id = 'a0000000-0000-0000-0000-000000000003') as upcoming,
  (select bk.id from public.bookings bk join public.businesses b on b.id = bk.business_id
   where b.slug = 'royal-touch-decorations' and bk.status = 'completed'
     and bk.customer_id = 'a0000000-0000-0000-0000-000000000003'
     and not exists (select 1 from public.reviews r where r.booking_id = bk.id)) as unreviewed,
  'a0000000-0000-0000-0000-000000000003'::uuid as emeka,
  'a0000000-0000-0000-0000-000000000001'::uuid as other,
  (select owner_id from public.businesses where slug = 'mama-put-catering') as mamaput;
grant select on ids to authenticated, anon;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end;
$$;
grant execute on function pg_temp.act_as(uuid) to authenticated;

select isnt((select upcoming from ids), null, 'fixture: Emeka has a confirmed booking');
select isnt((select unreviewed from ids), null, 'fixture: Emeka has a completed booking he has not reviewed');

-- ---------------------------------------------------------------------------
-- Registration
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'new-customer@test.ng', '{"role":"customer"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'new-business@test.ng', '{"role":"business"}');
select is((select title from public.notifications where user_id = '00000000-0000-0000-0000-0000000000c1'),
  'Welcome to Concierge', 'a new customer is welcomed');
select is((select title from public.notifications where user_id = '00000000-0000-0000-0000-0000000000c2'),
  'Welcome to Concierge for Business', 'a new business is welcomed and pointed at setup');
select is((select category from public.notifications where user_id = '00000000-0000-0000-0000-0000000000c1'),
  'account', 'the category comes from the type');
select throws_ok($$ update public.notifications set category = 'booking'
  where user_id = '00000000-0000-0000-0000-0000000000c1' $$, '428C9', null, 'the category cannot be set by hand');

-- ---------------------------------------------------------------------------
-- Scheduled: reminders and review requests
-- ---------------------------------------------------------------------------

select is(public.queue_scheduled_notifications(), 0,
  'nothing is due on a fresh seed (the booking is weeks away; the job finished moments ago)');

update public.bookings set scheduled_start = now() + interval '3 hours', scheduled_end = now() + interval '5 hours'
where id = (select upcoming from ids);
update public.bookings set completed_at = now() - interval '2 hours' where id = (select unreviewed from ids);

select is(public.queue_scheduled_notifications(), 3, 'two reminders and one review request go out');
select is((select count(*)::int from public.notifications where type = 'booking.reminder'
  and data ->> 'bookingId' = (select upcoming::text from ids) and user_id in ((select emeka from ids), (select mamaput from ids))),
  2, 'both the customer and the business are reminded');
select is((select count(*)::int from public.notifications where type = 'review.request'), 1,
  'only the unreviewed job gets a review request');
select is((select user_id from public.notifications where type = 'review.request'), (select emeka from ids),
  'the review request goes to the customer');
select is(public.queue_scheduled_notifications(), 0, 'running again sends nothing twice');

insert into public.reviews (booking_id, customer_id, business_id, rating)
select id, customer_id, business_id, 5 from public.bookings where id = (select unreviewed from ids);
delete from public.notifications where type = 'review.request';
select is(public.queue_scheduled_notifications(), 0, 'no review request once the customer has reviewed');

select ok(not has_function_privilege('authenticated', 'public.queue_scheduled_notifications()', 'execute'),
  'signed-in users cannot run the scheduled job');
select ok(not has_function_privilege('anon', 'public.queue_scheduled_notifications()', 'execute'),
  'visitors cannot run the scheduled job');
select is((select schedule from cron.job where jobname = 'scheduled-notifications'), '*/15 * * * *',
  'the job runs every 15 minutes');

-- ---------------------------------------------------------------------------
-- Each person sees and changes only their own
-- ---------------------------------------------------------------------------

select pg_temp.act_as((select other from ids));
select is((select count(*)::int from public.notifications where user_id = (select emeka from ids)), 0,
  'nobody can read someone else''s notifications');
select throws_ok($$ insert into public.notifications (user_id, type, title) values ((select other from ids), 'x.y', 'Fake') $$,
  '42501', null, 'clients cannot create notifications');
select throws_ok($$ update public.notifications set title = 'Changed' $$, '42501', null,
  'clients cannot rewrite a notification');
select lives_ok($$ update public.notifications set read_at = now() where user_id = (select other from ids) $$,
  'people can mark their own as read');
reset role;

-- ---------------------------------------------------------------------------
-- Email, SMS and push: queued only for enabled channels, server-only
-- ---------------------------------------------------------------------------

insert into public.notifications (user_id, type, title) values ((select emeka from ids), 'booking.accepted', 'In-app only');
select is((select count(*)::int from public.notification_deliveries), 0, 'with no channels enabled nothing is queued');

update public.platform_settings set value = '["email", "sms", "fax"]' where key = 'notification_channels';
insert into public.notifications (user_id, type, title) values ((select emeka from ids), 'booking.accepted', 'Everywhere');
select is((select array_agg(channel order by channel) from public.notification_deliveries), array['email', 'sms'],
  'each enabled channel gets one pending delivery (unknown channels are ignored)');
select is((select count(*)::int from public.notification_deliveries where status = 'pending'), 2, 'queued as pending');

select pg_temp.act_as((select emeka from ids));
select throws_ok($$ select * from public.notification_deliveries $$, '42501', null,
  'clients cannot see the outbox, even for their own notifications');
reset role;

select * from finish();
rollback;
