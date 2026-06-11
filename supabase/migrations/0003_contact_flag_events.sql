-- ============================================================================
-- Deliverable 2 (contacts) — append-only audit for the dangerous-client flag.
--
-- The flag itself lives on contacts (is_flagged/flag_reason_enc/flag_set_by/
-- flag_locked_at, from 0001). This table records every flag/unflag as an
-- immutable event so a false-positive recovery (unflag) is auditable and never
-- silently erases history (SCOPE §3, CONTRACTS §3 M14: flags are append-only with
-- human-driven false-positive recovery). The reason is ciphertext (CONTRACTS §5).
--
-- APPEND-ONLY enforced by RLS: only SELECT + INSERT policies exist; with RLS
-- enabled and no UPDATE/DELETE policy, edits/deletes are denied for all client
-- roles. (service_role bypasses, but Track A never touches CRM tables anyway.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS contact_flag_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  action      TEXT NOT NULL CHECK (action IN ('flag', 'unflag')),
  reason_enc  TEXT,                        -- ciphertext: why flagged / why cleared
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contact_flag_events_contact ON contact_flag_events(contact_id, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_flag_events_user ON contact_flag_events(user_id);

ALTER TABLE contact_flag_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_flag_events_select ON contact_flag_events;
DROP POLICY IF EXISTS contact_flag_events_insert ON contact_flag_events;
-- Read + append own events only. No UPDATE/DELETE policy ⇒ immutable (append-only).
CREATE POLICY contact_flag_events_select ON contact_flag_events FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY contact_flag_events_insert ON contact_flag_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);
