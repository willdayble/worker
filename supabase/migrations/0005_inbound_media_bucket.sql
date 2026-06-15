-- Private storage bucket for inbound WhatsApp media (images).
--
-- The worker (service_role) downloads + decrypts media via Baileys and uploads it here under
-- `<user_id>/<message_id>.<ext>`. The CRM serves it via a short-lived SIGNED URL (also service_role;
-- the message rows are already RLS-scoped to the owner). Bucket is PRIVATE (public=false) — no
-- anonymous access. Media relies on Supabase at-rest encryption + private access + signed URLs; it
-- is NOT yet app-layer encrypted like message bodies (CONTRACTS §5) — a tracked follow-up.
insert into storage.buckets (id, name, public)
values ('inbound-media', 'inbound-media', false)
on conflict (id) do nothing;
