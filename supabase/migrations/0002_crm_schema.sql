-- ============================================================================
-- Deliverable 1b — the rich CRM schema (ported from first_attempt, not reinvented).
--
-- Builds on 0001 (the channel contract). Adds the booking close-loop (pipelines /
-- stages / deals), the screening badges, and the practices ("ice cream" Yes/Maybe/No)
-- menu. Mirrors packages/shared/src/db/crm.ts.
--
-- DELIBERATE DEVIATIONS from first_attempt (neutrality + privacy):
--   • NO seeded practice catalog. first_attempt 015 baked ~150 explicit items into
--     the migration; that makes the *repo itself* industry-specific and undercuts the
--     neutral-tooling legal posture (SCOPE §2, M13, Track C). The menu is USER data:
--     `practices.user_id` is per-provider (NULL reserved for a future shared catalog,
--     which is out of scope — SCOPE §4). Providers populate their own menu at runtime.
--   • `deals.location_type` uses the NEUTRAL CONTRACTS §6 enum
--     (at_provider/at_client/remote/other), not the ported incall/outcall/virtual.
--   • Free-text that can describe/identify a client is `*_enc` ciphertext (CONTRACTS §5):
--     deal/screening/practice/contact notes. The practice<->contact ASSOCIATION is a
--     structural FK (must stay queryable) and is therefore plaintext special-category
--     data — protected by RLS, not encryption; flagged for the DPIA (SCOPE §7).
--   • Dropped `deals.assigned_to`/profiles (solo-worker model; no teams) and the
--     generic tags table (practices are the tag system).
--
-- Security (CONTRACTS §5): RLS on every table, deny-by-default, keyed by user_id.
-- The first_attempt `practices` SELECT shipped `USING (true)` (015:45) — replaced
-- here with the row-scoped 023 policy. No CHECK (true) / USING (true) anywhere (CI-enforced).
--
-- Idempotent: IF NOT EXISTS + DROP POLICY IF EXISTS.
-- ============================================================================

-- ============================================================================
-- contacts — 1b additions (screening badges, demographics, rating).
-- ============================================================================
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS age_group TEXT
  CHECK (age_group IS NULL OR age_group IN ('18-24','25-35','36-50','50s-60s','70+'));
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS star_rating SMALLINT
  CHECK (star_rating IS NULL OR (star_rating >= 1 AND star_rating <= 5));
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS deposit_paid BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(12,2);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS id_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS references_provided BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS screening_notes_enc TEXT;   -- ciphertext

-- ============================================================================
-- contact_notes — free-form timeline notes (ciphertext).
-- ============================================================================
CREATE TABLE IF NOT EXISTS contact_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  body_enc    TEXT NOT NULL,           -- ciphertext
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contact_notes_user ON contact_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_contact_notes_contact ON contact_notes(contact_id);

ALTER TABLE contact_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_notes_owner ON contact_notes;
CREATE POLICY contact_notes_owner ON contact_notes FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- pipelines + pipeline_stages — the kanban (Enquiry→Screening→Confirmed→
-- Completed/Lost are user-created stages, not seeded).
-- ============================================================================
CREATE TABLE IF NOT EXISTS pipelines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pipelines_user ON pipelines(user_id);

ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pipelines_owner ON pipelines;
CREATE POLICY pipelines_owner ON pipelines FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id  UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  position     INTEGER NOT NULL DEFAULT 0,
  color        TEXT NOT NULL DEFAULT '#3b82f6',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline ON pipeline_stages(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_user ON pipeline_stages(user_id);

ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pipeline_stages_owner ON pipeline_stages;
CREATE POLICY pipeline_stages_owner ON pipeline_stages FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- deals — the booking + close-loop. status = resolution; lost_reason captures
-- time-waster / dangerous (the dangerous-client FLAG itself lives append-only on
-- contacts.is_flagged — these are distinct). Fee/tip/discount/date/time logged.
-- ============================================================================
CREATE TABLE IF NOT EXISTS deals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id       UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id  UUID REFERENCES conversations(id) ON DELETE SET NULL,
  pipeline_id      UUID REFERENCES pipelines(id) ON DELETE SET NULL,
  stage_id         UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  title            TEXT,
  service_label    TEXT,                                  -- neutral; what was booked
  status           TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','won','lost')),
  lost_reason      TEXT
                     CHECK (lost_reason IS NULL OR lost_reason IN
                       ('time_waster','dangerous','ghosted','price','scheduling','other')),
  fee_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  tip_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'AUD',
  rating           SMALLINT CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  scheduled_date   DATE,
  start_time       TIME,
  end_time         TIME,
  location_type    TEXT
                     CHECK (location_type IS NULL OR location_type IN
                       ('at_provider','at_client','remote','other')),   -- CONTRACTS §6 neutral
  location_label   TEXT,
  notes_enc        TEXT,                                  -- ciphertext
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deals_user ON deals(user_id);
CREATE INDEX IF NOT EXISTS idx_deals_contact ON deals(contact_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage_id);

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deals_owner ON deals;
CREATE POLICY deals_owner ON deals FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- practices — the per-provider service menu (NO seeded catalog; user-owned).
-- user_id NULL is reserved for a future shared catalog (out of scope, SCOPE §4).
-- RLS replaces first_attempt 015's `USING (true)` with the row-scoped 023 policy.
-- ============================================================================
CREATE TABLE IF NOT EXISTS practices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,   -- NULL = shared (reserved)
  name        TEXT NOT NULL,
  category    TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_practices_user ON practices(user_id);

ALTER TABLE practices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practices_select ON practices;
DROP POLICY IF EXISTS practices_insert ON practices;
DROP POLICY IF EXISTS practices_update ON practices;
DROP POLICY IF EXISTS practices_delete ON practices;
CREATE POLICY practices_select ON practices FOR SELECT TO authenticated
  USING (user_id IS NULL OR user_id = auth.uid());
CREATE POLICY practices_insert ON practices FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY practices_update ON practices FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY practices_delete ON practices FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- provider_practices — the provider's own Yes/Maybe/No stance on a practice.
CREATE TABLE IF NOT EXISTS provider_practices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  practice_id  UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'maybe' CHECK (status IN ('yes','no','maybe')),
  notes_enc    TEXT,                                      -- ciphertext
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, practice_id)
);
CREATE INDEX IF NOT EXISTS idx_provider_practices_user ON provider_practices(user_id);

ALTER TABLE provider_practices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_practices_owner ON provider_practices;
CREATE POLICY provider_practices_owner ON provider_practices FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- contact_practices — which practices a contact wants (Yes/Maybe/No). The
-- association is structural special-category data (plaintext, RLS-protected); free
-- text is encrypted. Scoped via the parent contact's ownership.
CREATE TABLE IF NOT EXISTS contact_practices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id   UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  practice_id  UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'yes' CHECK (status IN ('yes','maybe','no')),
  notes_enc    TEXT,                                      -- ciphertext
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contact_id, practice_id)
);
CREATE INDEX IF NOT EXISTS idx_contact_practices_contact ON contact_practices(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_practices_practice ON contact_practices(practice_id);

ALTER TABLE contact_practices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_practices_owner ON contact_practices;
CREATE POLICY contact_practices_owner ON contact_practices FOR ALL
  USING (EXISTS (SELECT 1 FROM contacts c
                 WHERE c.id = contact_practices.contact_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM contacts c
                      WHERE c.id = contact_practices.contact_id AND c.user_id = auth.uid()));

-- ============================================================================
-- updated_at triggers (function defined in 0001)
-- ============================================================================
DROP TRIGGER IF EXISTS set_updated_at ON contact_notes;
DROP TRIGGER IF EXISTS set_updated_at ON deals;
DROP TRIGGER IF EXISTS set_updated_at ON provider_practices;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON contact_notes       FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON deals               FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON provider_practices  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Realtime — the kanban reflects deal moves live.
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND tablename = 'deals') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE deals;
  END IF;
END $$;
