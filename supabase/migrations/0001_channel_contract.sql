-- ============================================================================
-- Deliverable 1a — the minimum channel contract (CONTRACTS §3).
--
-- Applies IMMEDIATELY to unblock Track A. These columns are
-- GUARANTEED-PRESENT-AT-A-START. The rich CRM schema (deals/tags/pipeline/
-- screening) lands in Deliverable 1b and extends — never rewrites — this.
--
-- Mirrors packages/shared/src/db/types.ts exactly (one source of truth).
--
-- Security (CONTRACTS §5):
--   • RLS on EVERY table, deny-by-default, keyed by user_id.
--   • NO `WITH CHECK (true)` / `USING (true)` anywhere (the first_attempt schema
--     shipped these at 001:185 and 015:45 — fixed here; CI-enforced).
--   • `*_enc` columns hold ciphertext only; plaintext bodies/identifiers never stored.
--   • service_role (worker) BYPASSES RLS by design; every client-facing policy is
--     still ownership-constrained so a leaked anon/authenticated key cannot cross tenants.
--
-- Idempotent: IF NOT EXISTS for tables/indexes; DROP POLICY IF EXISTS before CREATE
-- (Postgres has no CREATE POLICY IF NOT EXISTS).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- updated_at trigger (same idiom as the prior schema).
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- acquisition_sources — write-once first-touch client entry-point.
-- (Defined first: contacts references it.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS acquisition_sources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  utm         JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_acquisition_sources_user ON acquisition_sources(user_id);

ALTER TABLE acquisition_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS acquisition_sources_owner ON acquisition_sources;
CREATE POLICY acquisition_sources_owner ON acquisition_sources FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- contacts — channel-agnostic PERSON, CRM-owned (1a subset; 1b extends).
-- Flags are append-only; false-positive recovery is human-driven (M14).
-- ============================================================================
CREATE TABLE IF NOT EXISTS contacts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name           TEXT,
  acquisition_source_id  UUID REFERENCES acquisition_sources(id) ON DELETE SET NULL,
  is_flagged             BOOLEAN NOT NULL DEFAULT FALSE,
  flag_reason_enc        TEXT,        -- ciphertext
  flag_set_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  flag_locked_at         TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_acq_source ON contacts(acquisition_source_id);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contacts_owner ON contacts;
CREATE POLICY contacts_owner ON contacts FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- channels — one row per connected channel per user.
-- Track A writes qr/pair_code/state/last_error/disconnect_reason on every
-- rotation/state change (service_role); the CRM SUBSCRIBES to this row via
-- Realtime (§4 C6). Clients are read-only here — channel state is worker-owned.
-- ============================================================================
CREATE TABLE IF NOT EXISTS channels (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel                 TEXT NOT NULL
                            CHECK (channel IN ('whatsapp_official','whatsapp_unofficial','telegram')),
  channel_user_id         TEXT,
  state                   TEXT NOT NULL DEFAULT 'disconnected'
                            CHECK (state IN ('disconnected','connecting','pairing','connected',
                                             'reconnecting','logged_out','banned','error')),
  capabilities            JSONB,
  qr                      TEXT,
  pair_code               TEXT,
  last_error              TEXT,
  disconnect_reason       TEXT
                            CHECK (disconnect_reason IS NULL OR disconnect_reason IN
                              ('network','logged_out','banned','conflict','auth_expired','unknown')),
  state_updated_at        TIMESTAMPTZ,
  history_sync_state      TEXT NOT NULL DEFAULT 'idle'
                            CHECK (history_sync_state IN ('idle','syncing','complete','failed')),
  history_synced_through  TIMESTAMPTZ,
  connected_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_channels_user ON channels(user_id);
CREATE INDEX IF NOT EXISTS idx_channels_user_channel ON channels(user_id, channel);

ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
-- Client read-only (QR/state display); worker (service_role) owns all writes.
DROP POLICY IF EXISTS channels_owner_select ON channels;
CREATE POLICY channels_owner_select ON channels FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================================
-- contact_channels — a person's per-channel identities.
-- Track A upserts deterministically by (user_id, channel, channel_user_id) (M7).
-- ============================================================================
CREATE TABLE IF NOT EXISTS contact_channels (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id       UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel          TEXT NOT NULL
                     CHECK (channel IN ('whatsapp_official','whatsapp_unofficial','telegram')),
  channel_user_id  TEXT NOT NULL,
  phone_e164       TEXT,
  display_name     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, channel, channel_user_id)
);
CREATE INDEX IF NOT EXISTS idx_contact_channels_user ON contact_channels(user_id);
CREATE INDEX IF NOT EXISTS idx_contact_channels_contact ON contact_channels(contact_id);

ALTER TABLE contact_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_channels_owner ON contact_channels;
CREATE POLICY contact_channels_owner ON contact_channels FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- conversations — one thread per (user, channel, channel_user_id).
-- thread_key = `${channel}:${channel_user_id}`. window_expires_at = last inbound
-- + 24h for WA-official.
-- ============================================================================
CREATE TABLE IF NOT EXISTS conversations (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id                UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel                   TEXT NOT NULL
                              CHECK (channel IN ('whatsapp_official','whatsapp_unofficial','telegram')),
  thread_key                TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open','pending','closed')),
  window_expires_at         TIMESTAMPTZ,
  last_message_at           TIMESTAMPTZ,
  last_message_preview_enc  TEXT,        -- ciphertext
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, thread_key)
);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_contact ON conversations(contact_id);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversations_owner ON conversations;
CREATE POLICY conversations_owner ON conversations FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- messages — inbound + outbound. Ordered by sent_at (provider time), NOT
-- created_at. Idempotent upsert by (conversation_id, provider_message_id).
-- No user_id column: ownership is derived from the parent conversation (this is
-- the policy that replaces the first_attempt `WITH CHECK (true)` at 001:185).
-- ============================================================================
CREATE TABLE IF NOT EXISTS messages (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id      UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction            TEXT NOT NULL CHECK (direction IN ('in','out')),
  provider_message_id  TEXT,
  content_type         TEXT NOT NULL DEFAULT 'text'
                         CHECK (content_type IN ('text','image','audio','video','document',
                                                 'location','sticker','template','other')),
  body_enc             TEXT,            -- ciphertext
  attachment_url       TEXT,
  is_historical        BOOLEAN NOT NULL DEFAULT FALSE,
  status               TEXT NOT NULL DEFAULT 'sent'
                         CHECK (status IN ('queued','sending','sent','delivered','read','failed')),
  status_updated_at    TIMESTAMPTZ,
  error_code           TEXT,
  sent_at              TIMESTAMPTZ NOT NULL,
  seq                  BIGINT GENERATED ALWAYS AS IDENTITY,   -- monotonic tiebreaker
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (conversation_id, provider_message_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_sent ON messages(conversation_id, sent_at);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
-- Ownership via the parent conversation. Applies to SELECT/INSERT/UPDATE/DELETE
-- for client roles; the worker writes inbound via service_role (bypasses RLS).
DROP POLICY IF EXISTS messages_owner ON messages;
CREATE POLICY messages_owner ON messages FOR ALL
  USING (EXISTS (SELECT 1 FROM conversations c
                 WHERE c.id = messages.conversation_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM conversations c
                      WHERE c.id = messages.conversation_id AND c.user_id = auth.uid()));

-- ============================================================================
-- bridge_outbound — human-approved outbound queue (§3–4).
-- CRM inserts `pending` ONLY after human approval; worker (service_role) claims
-- atomically, decrypts in memory, sends with idempotency_key, then tombstones
-- the plaintext. Destination identifier encrypted; salted HMAC = routing index.
-- ============================================================================
CREATE TABLE IF NOT EXISTS bridge_outbound (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel                  TEXT NOT NULL
                             CHECK (channel IN ('whatsapp_official','whatsapp_unofficial','telegram')),
  to_channel_user_id_enc   TEXT NOT NULL,     -- ciphertext
  to_channel_user_id_hmac  TEXT NOT NULL,     -- salted HMAC — routing index, never raw E164
  body_enc                 TEXT,              -- ciphertext
  attachment_enc           JSONB,             -- ciphertext envelope
  template_enc             JSONB,             -- ciphertext envelope
  idempotency_key          UUID NOT NULL DEFAULT gen_random_uuid(),
  status                   TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','sending','sent','failed')),
  claimed_at               TIMESTAMPTZ,
  provider_message_id      TEXT,
  error                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_bridge_outbound_user ON bridge_outbound(user_id);
CREATE INDEX IF NOT EXISTS idx_bridge_outbound_status ON bridge_outbound(status);
CREATE INDEX IF NOT EXISTS idx_bridge_outbound_hmac ON bridge_outbound(to_channel_user_id_hmac);

ALTER TABLE bridge_outbound ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bridge_outbound_owner ON bridge_outbound;
CREATE POLICY bridge_outbound_owner ON bridge_outbound FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- wa_templates — WhatsApp-official message templates (user-managed, worker-read).
-- ============================================================================
CREATE TABLE IF NOT EXISTS wa_templates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id            UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  language              TEXT NOT NULL DEFAULT 'en',
  category              TEXT NOT NULL DEFAULT 'utility'
                          CHECK (category IN ('marketing','utility','authentication')),
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected','paused','disabled')),
  body_text             TEXT,
  variable_schema       JSONB,
  provider_template_id  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_templates_user ON wa_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_wa_templates_channel ON wa_templates(channel_id);

ALTER TABLE wa_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wa_templates_owner ON wa_templates;
CREATE POLICY wa_templates_owner ON wa_templates FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- wa_auth_state — Baileys (WA-unofficial) session, encrypted at rest (§3, §5).
-- Session creds are the most sensitive blob in the system. RLS is enabled with
-- NO client policy: deny-by-default means authenticated/anon roles get ZERO
-- access; only the worker (service_role, BYPASSRLS) reads/writes it. user_id is
-- retained for server-side scoping/joins. (Stricter than ownership-by-design,
-- and intentionally so — these bytes must never reach a browser.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS wa_auth_state (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  creds_enc   TEXT,            -- ciphertext
  keys_enc    TEXT,            -- ciphertext
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel_id)
);
CREATE INDEX IF NOT EXISTS idx_wa_auth_state_user ON wa_auth_state(user_id);

ALTER TABLE wa_auth_state ENABLE ROW LEVEL SECURITY;  -- no client policy: worker-only.

-- ============================================================================
-- updated_at triggers
-- ============================================================================
DROP TRIGGER IF EXISTS set_updated_at ON contacts;
DROP TRIGGER IF EXISTS set_updated_at ON channels;
DROP TRIGGER IF EXISTS set_updated_at ON conversations;
DROP TRIGGER IF EXISTS set_updated_at ON wa_templates;
DROP TRIGGER IF EXISTS set_updated_at ON wa_auth_state;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON contacts       FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON channels       FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON conversations  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON wa_templates   FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON wa_auth_state  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Realtime — the CRM subscribes to channel state (QR/connect) + live messages.
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND tablename = 'messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND tablename = 'conversations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND tablename = 'channels') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE channels;
  END IF;
END $$;
