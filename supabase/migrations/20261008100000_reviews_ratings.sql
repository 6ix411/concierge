-- Stage 12: reviews and ratings.
-- Reviews already require the customer's own completed booking and are limited to one per booking
-- (unique booking_id). This adds optional photos, stops a business owner reviewing their own business,
-- lets a business report a review to the Concierge team, and returns photos with public reviews.

-- ---------------------------------------------------------------------------
-- No fake reviews: the reviewer can't be the business's owner
-- ---------------------------------------------------------------------------

create or replace function public.check_review_booking()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.bookings
    where id = new.booking_id and customer_id = new.customer_id
      and business_id = new.business_id and status in ('completed', 'reviewed')
  ) then
    raise exception 'Reviews are only allowed on your own completed bookings' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.businesses where id = new.business_id and owner_id = new.customer_id) then
    raise exception 'You can''t review your own business' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Photos: up to four per review, in a private bucket
-- ---------------------------------------------------------------------------

-- review-photos/<review_id>/<uuid>.<ext>. Uploaded and signed by the server only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('review-photos', 'review-photos', false, 5 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create table public.review_photos (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews (id) on delete cascade,
  storage_path text not null unique check (char_length(storage_path) <= 300),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);
comment on table public.review_photos is
  'Photos the customer added to their review. Shown wherever the review is visible.';
create index review_photos_review_idx on public.review_photos (review_id, sort_order);

create function public.limit_review_photos()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.review_photos where review_id = new.review_id) >= 4 then
    raise exception 'A review can have at most 4 photos' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger review_photos_limit
before insert on public.review_photos
for each row execute function public.limit_review_photos();

-- Visible exactly where the review is visible (the reviews policies apply inside the subquery).
alter table public.review_photos enable row level security;
grant select on public.review_photos to anon, authenticated;
create policy "review_photos: follow the review" on public.review_photos for select to anon, authenticated
  using (exists (select 1 from public.reviews r where r.id = review_id));

-- ---------------------------------------------------------------------------
-- A business can report a review to the Concierge team (it can't edit or remove it)
-- ---------------------------------------------------------------------------

alter table public.reviews
  add column reported_at timestamptz,
  add column report_reason text check (char_length(report_reason) <= 1000);
comment on column public.reviews.reported_at is
  'When the business reported this review for breaking the guidelines; cleared once an admin decides.';
create index reviews_reported_idx on public.reviews (reported_at) where reported_at is not null;

-- ---------------------------------------------------------------------------
-- Public reviews now include their photos
-- ---------------------------------------------------------------------------

drop function public.get_public_reviews(uuid, integer, integer);
create function public.get_public_reviews(p_business_id uuid, p_limit integer default 20, p_offset integer default 0)
returns table (
  id uuid,
  rating smallint,
  comment text,
  business_reply text,
  business_replied_at timestamptz,
  created_at timestamptz,
  reviewer_name text,
  photo_paths text[]
)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.rating, r.comment, r.business_reply, r.business_replied_at, r.created_at,
    coalesce(
      nullif(trim(split_part(u.full_name, ' ', 1) || ' ' || left(split_part(u.full_name, ' ', 2), 1) ||
        case when split_part(u.full_name, ' ', 2) <> '' then '.' else '' end), ''),
      'Customer'
    ),
    coalesce(
      (select array_agg(p.storage_path order by p.sort_order, p.created_at)
       from public.review_photos p where p.review_id = r.id),
      '{}'
    )
  from public.reviews r
  join public.users u on u.id = r.customer_id
  join public.businesses b on b.id = r.business_id
  where r.business_id = p_business_id and r.status = 'published' and b.status = 'approved'
  order by r.created_at desc
  limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0);
$$;
grant execute on function public.get_public_reviews(uuid, integer, integer) to anon, authenticated;

-- Report details are between the business and the Concierge team: clients read every other column.
revoke select on public.reviews from anon, authenticated;
grant select (id, booking_id, customer_id, business_id, rating, comment, business_reply, business_replied_at,
  status, created_at, updated_at) on public.reviews to anon, authenticated;
