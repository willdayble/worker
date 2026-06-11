// ============================================================================
// Database row types — the Deliverable 1a channel contract (CONTRACTS §3).
//
// Keys are snake_case to match what supabase-js returns from Postgres, so these
// types describe query results directly for BOTH apps/web (B) and apps/worker (A).
// These columns are GUARANTEED-PRESENT-AT-A-START. The rich CRM schema
// (deals/tags/pipeline/screening) arrives in Deliverable 1b and extends these.
//
// `*_enc` columns hold ciphertext (CONTRACTS §5) — never plaintext. Text columns
// carry a base64 envelope (`Ciphertext`); jsonb `*_enc` columns carry an
// `EncryptedEnvelope`. Plaintext bodies/identifiers are never stored.
//
// SCHEMA-CHANGE PROTOCOL (CONTRACTS §3, M3): if Track A needs a column/enum it
// lacks, it requests via the orchestrator; Track B adds the migration + bumps
// these types. Track A never writes a migration.
// ============================================================================

// Channel/connection enums are re-used from the messaging contract so the DB
// types and the wire types share one source of truth. They are NOT re-exported
// here (the barrel and `@workerapp/shared/messaging` already export them) to
// avoid a duplicate-name clash across the two `export *` in src/index.ts.
import type {
  Channel,
  ConnState,
  DisconnectReason,
  MessageStatus,
  ProviderCapabilities,
} from '../messaging/interface.js';

/** A timestamptz column, serialized by supabase-js as an ISO 8601 string. */
export type Timestamptz = string;

/** A uuid column. */
export type Uuid = string;

/** Any JSON value (jsonb column). */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * Opaque ciphertext text stored in a TEXT `*_enc` column (e.g. `messages.body_enc`,
 * `conversations.last_message_preview_enc`, `contacts.flag_reason_enc`,
 * `bridge_outbound.body_enc`, `to_channel_user_id_enc`). Produced/consumed only by
 * the crypto helpers (Deliverable 0b). Treat as opaque.
 */
export type Ciphertext = string;

/**
 * Object ciphertext envelope stored in a JSONB `*_enc` column
 * (`bridge_outbound.attachment_enc` / `template_enc`). Produced by
 * `encryptJsonForUser`. Concrete shape is finalized in Deliverable 0b; do not
 * destructure it outside the crypto module.
 */
export type EncryptedEnvelope = { readonly [key: string]: Json };

// ---------------------------------------------------------------------------
// channels — one row per connected channel per user (CONTRACTS §3).
// Track A writes qr/pair_code/state/last_error/disconnect_reason on every
// rotation/state change; the CRM subscribes to this row via Realtime (§4 C6).
// ---------------------------------------------------------------------------
export type HistorySyncState = 'idle' | 'syncing' | 'complete' | 'failed';

export interface ChannelRow {
  id: Uuid;
  user_id: Uuid;
  channel: Channel;
  channel_user_id: string | null;          // provider id once paired (phone JID / bot id)
  state: ConnState;
  capabilities: ProviderCapabilities | null;
  qr: string | null;                        // current QR payload (WA rotates ~20s)
  pair_code: string | null;
  last_error: string | null;
  disconnect_reason: DisconnectReason | null;
  state_updated_at: Timestamptz | null;
  history_sync_state: HistorySyncState;
  history_synced_through: Timestamptz | null;
  connected_at: Timestamptz | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

// ---------------------------------------------------------------------------
// contacts — channel-agnostic PERSON, CRM-owned (CONTRACTS §3, 1a subset).
// Track A must NOT modify is_flagged/flag_reason_enc or re-bind a flagged
// contact (M14): flags are append-only with human-driven false-positive recovery.
// ---------------------------------------------------------------------------
export interface ContactRow {
  id: Uuid;
  user_id: Uuid;
  display_name: string | null;
  acquisition_source_id: Uuid | null;
  is_flagged: boolean;
  flag_reason_enc: Ciphertext | null;
  flag_set_by: Uuid | null;
  flag_locked_at: Timestamptz | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

// ---------------------------------------------------------------------------
// contact_channels — a person's per-channel identities (CONTRACTS §3).
// Track A upserts deterministically by (user_id, channel, channel_user_id) (M7).
// ---------------------------------------------------------------------------
export interface ContactChannelRow {
  id: Uuid;
  contact_id: Uuid;
  user_id: Uuid;
  channel: Channel;
  channel_user_id: string;
  phone_e164: string | null;
  display_name: string | null;
  created_at: Timestamptz;
}

// ---------------------------------------------------------------------------
// conversations — one thread per (user, channel, channel_user_id) (CONTRACTS §3).
// thread_key = `${channel}:${channel_user_id}`. window_expires_at = last inbound
// + 24h for WA-official (the messaging window).
// ---------------------------------------------------------------------------
export type ConversationStatus = 'open' | 'pending' | 'closed';

export interface ConversationRow {
  id: Uuid;
  user_id: Uuid;
  contact_id: Uuid;
  channel: Channel;
  thread_key: string;
  status: ConversationStatus;
  window_expires_at: Timestamptz | null;
  last_message_at: Timestamptz | null;
  last_message_preview_enc: Ciphertext | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

// ---------------------------------------------------------------------------
// messages — inbound + outbound, ordered by sent_at (provider time), NOT
// created_at (CONTRACTS §3). Idempotent upsert by (conversation_id,
// provider_message_id). `seq` is the optional monotonic tiebreaker.
// ---------------------------------------------------------------------------
export type MessageDirection = 'in' | 'out';

export type MessageContentType =
  | 'text' | 'image' | 'audio' | 'video' | 'document'
  | 'location' | 'sticker' | 'template' | 'other';

export interface MessageRow {
  id: Uuid;
  conversation_id: Uuid;
  direction: MessageDirection;
  provider_message_id: string | null;
  content_type: MessageContentType;
  body_enc: Ciphertext | null;
  attachment_url: string | null;
  is_historical: boolean;
  status: MessageStatus;
  status_updated_at: Timestamptz | null;
  error_code: string | null;
  sent_at: Timestamptz;                     // NOT NULL — authoritative ordering key
  seq: number;                              // monotonic tiebreaker within a conversation
  created_at: Timestamptz;
}

// ---------------------------------------------------------------------------
// bridge_outbound — the human-approved outbound queue (CONTRACTS §3–4).
// CRM inserts `pending` ONLY after human approval; worker claims atomically
// (pending→sending), decrypts in memory, sends with idempotency_key, then
// tombstones the plaintext. Destination identifier is encrypted; a salted HMAC
// gives a routing index without storing raw E164 (§5).
// ---------------------------------------------------------------------------
export type BridgeOutboundStatus = 'pending' | 'sending' | 'sent' | 'failed';

export interface BridgeOutboundRow {
  id: Uuid;
  user_id: Uuid;
  channel: Channel;
  to_channel_user_id_enc: Ciphertext;
  to_channel_user_id_hmac: string;          // salted HMAC — routing index, never raw E164
  body_enc: Ciphertext | null;
  attachment_enc: EncryptedEnvelope | null;  // jsonb object envelope
  template_enc: EncryptedEnvelope | null;    // jsonb object envelope
  idempotency_key: Uuid;
  status: BridgeOutboundStatus;
  claimed_at: Timestamptz | null;
  provider_message_id: string | null;
  error: string | null;
  created_at: Timestamptz;
}

// ---------------------------------------------------------------------------
// acquisition_sources — write-once first-touch client entry-point (CONTRACTS §3).
// ---------------------------------------------------------------------------
export interface AcquisitionSourceRow {
  id: Uuid;
  user_id: Uuid;
  label: string;
  utm: Json | null;
  created_at: Timestamptz;
}

// ---------------------------------------------------------------------------
// wa_templates — WhatsApp-official message templates (CONTRACTS §3).
// ---------------------------------------------------------------------------
export type WaTemplateCategory = 'marketing' | 'utility' | 'authentication';
export type WaTemplateStatus = 'pending' | 'approved' | 'rejected' | 'paused' | 'disabled';

export interface WaTemplateRow {
  id: Uuid;
  user_id: Uuid;
  channel_id: Uuid;
  name: string;
  language: string;
  category: WaTemplateCategory;
  status: WaTemplateStatus;
  body_text: string | null;
  variable_schema: Json | null;
  provider_template_id: string | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

// ---------------------------------------------------------------------------
// wa_auth_state — Baileys (WA-unofficial) session, encrypted at rest (CONTRACTS
// §3, §5). channel-scoped; Track A reads/writes via service_role.
// ---------------------------------------------------------------------------
export interface WaAuthStateRow {
  id: Uuid;
  user_id: Uuid;
  channel_id: Uuid;
  creds_enc: Ciphertext | null;
  keys_enc: Ciphertext | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}
