-- Business registration and review rules. Run with `npm run db:test`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 'fola@test.ng', '{"role":"business","full_name":"Fola"}'),
  ('00000000-0000-0000-0000-0000000000f2', 'gbenga@test.ng', '{"role":"business","full_name":"Gbenga"}'),
  ('00000000-0000-0000-0000-0000000000f3', 'hauwa@test.ng', '{"role":"customer"}'),
  ('00000000-0000-0000-0000-0000000000f4', 'ife@test.ng', '{"role":"customer"}');
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-0000000000f4';

-- ---------------------------------------------------------------------------
-- Registration as the owner
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
select lives_ok($$
  insert into public.businesses (owner_id, name, slug, city, state)
  values ('00000000-0000-0000-0000-0000000000f1', 'Fola Fresh Cuts', 'fola-fresh-cuts', 'Yaba', 'Lagos')
$$, 'a business account registers its business');
-- A fixed id makes the rest of the file easier to read.
reset role;
update public.businesses set id = '30000000-0000-0000-0000-000000000001' where slug = 'fola-fresh-cuts';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
select is((select status::text from public.businesses where id = '30000000-0000-0000-0000-000000000001'), 'draft',
  'new registrations start as drafts');
select throws_ok($$
  insert into public.businesses (owner_id, name, slug) values ('00000000-0000-0000-0000-0000000000f1', 'Second', 'second-one')
$$, '23505', null, 'one business per account');
select throws_ok($$
  update public.businesses set status = 'approved' where id = '30000000-0000-0000-0000-000000000001'
$$, '42501', null, 'owners cannot change their own status');
select throws_ok($$
  update public.businesses set logo_path = 'someone-else/logo.png' where id = '30000000-0000-0000-0000-000000000001'
$$, '23514', null, 'the logo must be in the business''s own folder');
select lives_ok($$
  insert into public.business_services (business_id, name, price_minor, is_addon)
  values ('30000000-0000-0000-0000-000000000001', 'Beard trim', 300000, true)
$$, 'owners add add-ons');
select throws_ok($$
  insert into public.business_services (business_id, name, price_minor, is_addon, is_package, package_includes)
  values ('30000000-0000-0000-0000-000000000001', 'Both', 1, true, true, array['x'])
$$, '23514', null, 'a service cannot be both a package and an add-on');
select throws_ok($$
  insert into public.verification_requests (business_id, requested_by, message)
  values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', 'Self-request')
$$, '42501', null, 'owners cannot create verification requests');

-- ---------------------------------------------------------------------------
-- Review flow (server code runs as the service role; the database checks every step)
-- ---------------------------------------------------------------------------
reset role;
select throws_ok($$
  update public.businesses set status = 'approved' where id = '30000000-0000-0000-0000-000000000001'
$$, '23514', null, 'a draft cannot jump straight to approved');
update public.businesses set status = 'pending' where id = '30000000-0000-0000-0000-000000000001';
select isnt((select submitted_at from public.businesses where id = '30000000-0000-0000-0000-000000000001'), null,
  'submitting records the time');
update public.businesses set status = 'under_review' where id = '30000000-0000-0000-0000-000000000001';
insert into public.verification_requests (id, business_id, requested_by, document_type, message)
values ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000f4', 'utility_bill', 'Please upload proof of address.');

select pg_temp.act_as(null);
select is_empty($$ select 1 from public.search_businesses('Fola') $$,
  'businesses under review never appear in search or the concierge');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
select is_empty($$ select 1 from public.verification_requests $$,
  'other businesses cannot see a business''s verification requests');
select throws_ok($$
  insert into public.business_verifications (business_id, submitted_by, document_type, document_path, request_id)
  values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f2', 'utility_bill',
          '30000000-0000-0000-0000-000000000001/x.pdf', '40000000-0000-0000-0000-000000000001')
$$, null, null, 'other businesses cannot answer the request');

reset role; select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
select is((select count(*)::int from public.verification_requests), 1, 'the owner sees the platform''s request');

reset role;
update public.businesses set status = 'approved' where id = '30000000-0000-0000-0000-000000000001';
select ok((select is_verified from public.businesses where id = '30000000-0000-0000-0000-000000000001'),
  'approval marks the business verified');
select pg_temp.act_as(null);
select results_eq($$ select slug from public.search_businesses('Fola') $$, array['fola-fresh-cuts'],
  'approved businesses appear in search');

select * from finish();
rollback;
