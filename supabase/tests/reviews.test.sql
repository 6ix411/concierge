-- Reviews and ratings: only completed bookings, once each, never your own business; photos follow the
-- review's visibility; report details stay private. Run on a fresh `supabase db reset`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- Seed: Emeka's completed, unreviewed booking with Royal Touch Decorations.
create temp table ids as
select bk.id as booking, bk.customer_id as customer, bk.business_id as business, b.owner_id as owner,
  'a0000000-0000-0000-0000-000000000001'::uuid as outsider
from public.bookings bk
join public.businesses b on b.id = bk.business_id
where b.slug = 'royal-touch-decorations' and bk.customer_id = 'a0000000-0000-0000-0000-000000000003'
  and bk.status = 'completed';
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

select is((select count(*)::int from ids), 1, 'fixture: one completed booking waiting for a review');

-- ---------------------------------------------------------------------------
-- Who can review
-- ---------------------------------------------------------------------------

select pg_temp.act_as((select customer from ids));
select throws_ok($$ insert into public.reviews (booking_id, customer_id, business_id, rating)
  select booking, customer, business, 5 from ids $$, '42501', null, 'customers cannot write reviews directly');
reset role;

select throws_ok($$ insert into public.reviews (booking_id, customer_id, business_id, rating)
  select booking, outsider, business, 5 from ids $$, '23514', null, 'nobody can review someone else''s booking');

select throws_ok($$ insert into public.reviews (booking_id, customer_id, business_id, rating)
  select bk.id, bk.customer_id, bk.business_id, 5 from public.bookings bk
  where bk.status = 'confirmed' limit 1 $$, '23514', null, 'a booking that isn''t completed cannot be reviewed');

select throws_ok($$ insert into public.reviews (booking_id, customer_id, business_id, rating)
  select booking, customer, business, 6 from ids $$, '23514', null, 'ratings are 1 to 5 stars');

-- A business owner can never review their own business, even through a booking. (Owners must have the
-- business role, so this needs that check switched off to set up.)
savepoint own;
alter table public.businesses disable trigger businesses_check_owner_role;
update public.businesses set owner_id = (select customer from ids) where id = (select business from ids);
select throws_ok($$ insert into public.reviews (booking_id, customer_id, business_id, rating)
  select booking, customer, business, 5 from ids $$, '23514', 'You can''t review your own business',
  'owners cannot review their own business');
rollback to savepoint own;

create temp table rating_before as select rating_count from public.businesses where id = (select business from ids);
select lives_ok($$ insert into public.reviews (booking_id, customer_id, business_id, rating, comment)
  select booking, customer, business, 4, 'Lovely decor.' from ids $$, 'the customer reviews their completed booking');
select is((select status::text from public.bookings where id = (select booking from ids)), 'reviewed',
  'the booking moves to reviewed');
select is((select rating_count from public.businesses where id = (select business from ids)),
  (select rating_count + 1 from rating_before), 'the rating counts the new review');
select throws_ok($$ insert into public.reviews (booking_id, customer_id, business_id, rating)
  select booking, customer, business, 1 from ids $$, '23505', null, 'one review per booking');

-- ---------------------------------------------------------------------------
-- Photos
-- ---------------------------------------------------------------------------

create temp table review as select r.id from public.reviews r where r.booking_id = (select booking from ids);
grant select on review to authenticated, anon;
insert into public.review_photos (review_id, storage_path, sort_order)
select (select id from review), (select id from review) || '/' || n || '.jpg', n from generate_series(1, 4) n;
select throws_ok($$ insert into public.review_photos (review_id, storage_path)
  select id, id || '/5.jpg' from review $$, '23514', null, 'at most four photos per review');

select is((select public from storage.buckets where id = 'review-photos'), false, 'review photos are in a private bucket');

select pg_temp.act_as((select customer from ids));
select throws_ok($$ insert into public.review_photos (review_id, storage_path)
  select id, id || '/x.jpg' from review $$, '42501', null, 'customers cannot add photo records directly');
reset role;

select pg_temp.act_as(null);
select is((select count(*)::int from public.review_photos where review_id = (select id from review)), 4,
  'visitors see a published review''s photos');
select is((select cardinality(photo_paths) from public.get_public_reviews((select business from ids))
  where id = (select id from review)), 4, 'public reviews include their photos');
reset role;

update public.reviews set status = 'hidden' where id = (select id from review);
select pg_temp.act_as(null);
select is((select count(*)::int from public.review_photos where review_id = (select id from review)), 0,
  'a hidden review''s photos are not public');
reset role;
select pg_temp.act_as((select customer from ids));
select is((select count(*)::int from public.review_photos where review_id = (select id from review)), 4,
  'the reviewer still sees their own photos');
reset role;
select pg_temp.act_as((select owner from ids));
select is((select count(*)::int from public.review_photos where review_id = (select id from review)), 4,
  'the business still sees photos on reviews about it');
reset role;

-- ---------------------------------------------------------------------------
-- Report details stay between the business and the Concierge team
-- ---------------------------------------------------------------------------

select pg_temp.act_as(null);
select throws_ok($$ select report_reason from public.reviews limit 1 $$, '42501', null,
  'visitors cannot read report reasons');
select lives_ok($$ select id, rating, comment, business_reply from public.reviews limit 1 $$,
  'visitors still read the public review columns');
reset role;
select pg_temp.act_as((select customer from ids));
select throws_ok($$ select reported_at from public.reviews limit 1 $$, '42501', null,
  'reviewers cannot see whether a business reported them');
reset role;

select * from finish();
rollback;
