-- Stage 2: storage buckets and access rules.
-- Path convention: the first folder is the owning id, e.g. business-media/<business_id>/logo.png.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', true, 2 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp']),
  ('business-media', 'business-media', true, 50 * 1024 * 1024,
    array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']),
  ('verification-documents', 'verification-documents', false, 10 * 1024 * 1024,
    array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('chat-attachments', 'chat-attachments', false, 20 * 1024 * 1024,
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'video/mp4'])
on conflict (id) do nothing;

-- The first path segment as a uuid, or null if it isn't one.
create function public.storage_owner_id(object_name text)
returns uuid
language sql immutable set search_path = ''
as $$
  select case
    when (storage.foldername(object_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (storage.foldername(object_name))[1]::uuid
  end;
$$;

-- avatars/<user_id>/...
create policy "avatars: users upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public.storage_owner_id(name) = (select auth.uid()));
create policy "avatars: users update own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and public.storage_owner_id(name) = (select auth.uid()));
create policy "avatars: users delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and public.storage_owner_id(name) = (select auth.uid()));

-- business-media/<business_id>/...
create policy "business-media: owners upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'business-media' and public.owns_business(public.storage_owner_id(name)));
create policy "business-media: owners update" on storage.objects for update to authenticated
  using (bucket_id = 'business-media' and public.owns_business(public.storage_owner_id(name)));
create policy "business-media: owners delete" on storage.objects for delete to authenticated
  using (bucket_id = 'business-media' and public.owns_business(public.storage_owner_id(name)));

-- verification-documents/<business_id>/... (private: owner and admins only; never deleted by owners)
create policy "verification-documents: owners upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'verification-documents' and public.owns_business(public.storage_owner_id(name)));
create policy "verification-documents: owners read own" on storage.objects for select to authenticated
  using (bucket_id = 'verification-documents' and public.owns_business(public.storage_owner_id(name)));
create policy "verification-documents: admins read" on storage.objects for select to authenticated
  using (bucket_id = 'verification-documents' and public.is_admin());

-- chat-attachments/<conversation_id>/... (private: the two participants and admins)
create policy "chat-attachments: participants upload to open chats" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and public.is_conversation_participant(public.storage_owner_id(name))
    and exists (select 1 from public.conversations c where c.id = public.storage_owner_id(name) and c.status = 'open')
  );
create policy "chat-attachments: participants read" on storage.objects for select to authenticated
  using (bucket_id = 'chat-attachments' and public.is_conversation_participant(public.storage_owner_id(name)));
create policy "chat-attachments: admins read" on storage.objects for select to authenticated
  using (bucket_id = 'chat-attachments' and public.is_admin());
