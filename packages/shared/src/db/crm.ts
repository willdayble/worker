// ============================================================================
// Rich CRM row types — Deliverable 1b (mirrors supabase/migrations/0002_crm_schema.sql).
//
// CRM-owned tables (Track B / apps/web). snake_case to match supabase-js results.
// `*_enc` columns hold ciphertext (CONTRACTS §5). Builds on the 1a types in
// ./types.ts. See 0002 for the neutrality/encryption deviations from first_attempt.
// ============================================================================

import type { Ciphertext, Timestamptz, Uuid } from './types.js';

// --- contacts: 1b additions (screening / demographics / rating) -------------
// These columns are added to the 1a `contacts` row by 0002. The canonical
// ContactRow in ./types.ts stays the 1a guaranteed set; merge this in when the CRM
// reads screening fields.
export type AgeGroup = '18-24' | '25-35' | '36-50' | '50s-60s' | '70+';

export interface ContactCrmFields {
  age_group: AgeGroup | null;
  star_rating: number | null;            // 1..5
  deposit_paid: boolean;
  deposit_amount: number | null;
  id_verified: boolean;
  references_provided: boolean;
  screening_notes_enc: Ciphertext | null;
}

// --- contact_notes ----------------------------------------------------------
export interface ContactNoteRow {
  id: Uuid;
  user_id: Uuid;
  contact_id: Uuid;
  body_enc: Ciphertext;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

// --- pipelines / stages -----------------------------------------------------
export interface PipelineRow {
  id: Uuid;
  user_id: Uuid;
  name: string;
  is_default: boolean;
  created_at: Timestamptz;
}

export interface PipelineStageRow {
  id: Uuid;
  pipeline_id: Uuid;
  user_id: Uuid;
  name: string;
  position: number;
  color: string;
  created_at: Timestamptz;
}

// --- deals (booking + close-loop) -------------------------------------------
export type DealStatus = 'open' | 'won' | 'lost';
export type DealLostReason =
  | 'time_waster' | 'dangerous' | 'ghosted' | 'price' | 'scheduling' | 'other';
/** Neutral location enum — shared with CONTRACTS §6 InboundAnalysis.location_type. */
export type DealLocationType = 'at_provider' | 'at_client' | 'remote' | 'other';

export interface DealRow {
  id: Uuid;
  user_id: Uuid;
  contact_id: Uuid;
  conversation_id: Uuid | null;
  pipeline_id: Uuid | null;
  stage_id: Uuid | null;
  title: string | null;
  service_label: string | null;
  status: DealStatus;
  lost_reason: DealLostReason | null;
  fee_amount: number;
  tip_amount: number;
  discount_amount: number;
  currency: string;
  rating: number | null;                 // 1..5
  scheduled_date: string | null;         // DATE (YYYY-MM-DD)
  start_time: string | null;             // TIME (HH:MM[:SS])
  end_time: string | null;
  location_type: DealLocationType | null;
  location_label: string | null;
  notes_enc: Ciphertext | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

// --- practices (the Yes/Maybe/No menu) --------------------------------------
export type PracticeStance = 'yes' | 'no' | 'maybe';

export interface PracticeRow {
  id: Uuid;
  user_id: Uuid | null;                  // NULL = shared catalog (reserved; SCOPE §4)
  name: string;
  category: string | null;
  sort_order: number;
  created_at: Timestamptz;
}

export interface ProviderPracticeRow {
  id: Uuid;
  user_id: Uuid;
  practice_id: Uuid;
  status: PracticeStance;
  notes_enc: Ciphertext | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface ContactPracticeRow {
  id: Uuid;
  contact_id: Uuid;
  practice_id: Uuid;
  status: PracticeStance;                // 'yes' | 'maybe' | 'no'
  notes_enc: Ciphertext | null;
  created_at: Timestamptz;
}

// --- contact_flag_events (append-only dangerous-flag audit) -----------------
export type FlagAction = 'flag' | 'unflag';

export interface ContactFlagEventRow {
  id: Uuid;
  user_id: Uuid;
  contact_id: Uuid;
  action: FlagAction;
  reason_enc: Ciphertext | null;
  created_at: Timestamptz;
}
