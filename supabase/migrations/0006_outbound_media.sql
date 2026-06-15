-- Private bucket for OUTBOUND media (CRM → WhatsApp): images, video, voice notes, documents the
-- worker attaches in the composer. The CRM browser (authenticated) uploads to `<user_id>/<uuid>.<ext>`
-- (RLS below limits each user to their own folder); the worker reads via service_role and sends; the
-- CRM displays sent media via a short-lived signed URL. Like inbound-media: storage-encrypted +
-- access-controlled, NOT app-layer encrypted yet (tracked follow-up).
insert into storage.buckets (id, name, public)
values ('outbound-media', 'outbound-media', false)
on conflict (id) do nothing;

-- Browser uploads/reads ONLY its own folder; worker + URL-signing use service_role (bypass RLS).
drop policy if exists "outbound_media_owner_insert" on storage.objects;
create policy "outbound_media_owner_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'outbound-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "outbound_media_owner_select" on storage.objects;
create policy "outbound_media_owner_select" on storage.objects for select to authenticated
  using (bucket_id = 'outbound-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
