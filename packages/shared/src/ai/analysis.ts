// ============================================================================
// AI-assist contract — InboundAnalysis + deterministic routing (CONTRACTS §6).
//
// One schema-constrained model call per inbound message produces an
// `InboundAnalysis` (the CRM, Track B, makes the call — see apps/web/src/lib/ai).
// THIS module is SDK-agnostic: the type the model must satisfy, plus the
// confidence routing, which CONTRACTS §6 mandates live in DETERMINISTIC code,
// not the model. Kept here so it's unit-tested and reused by the CRM.
//
// HARD INVARIANTS (CONTRACTS §6): the model NEVER auto-sends and NEVER auto-blocks.
// `red_flags` are ADVISORY only — never an automated decision (GDPR Art. 22).
// Field names/enums stay NEUTRAL/general-purpose (M13) — no industry-specific terms.
// Disclosure (M15) is the CRM's responsibility, both inbound analysis and outbound drafts.
// ============================================================================

/** Neutral location enum — shared with deals + CONTRACTS §6. */
export type AnalysisLocationType = 'at_provider' | 'at_client' | 'remote' | 'other';

export interface InboundBookingFields {
  service_label?: string;          // neutral; what was requested
  date?: string;
  time?: string;
  location_type?: AnalysisLocationType;
  amount?: number;
}

/** The schema-constrained model output for one inbound message (CONTRACTS §6). */
export interface InboundAnalysis {
  is_booking: boolean;
  booking_fields?: InboundBookingFields;
  intent_tags: string[];
  service_tags: string[];          // map to the practices/tags menu
  red_flags: string[];             // ADVISORY only — never an automated decision
  suggested_reply: string;         // draft — NEVER auto-sent
  confidence: number;              // 0..1
}

/** Confidence at/above which we auto-tag and pre-fill a draft. Tunable. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/**
 * The deterministic outcome of an analysis. Note what is ABSENT by design:
 * there is no `send` and no `block` — those are never automated (CONTRACTS §6).
 */
export interface InboundRouting {
  /** confidence ≥ T → apply the model's intent/service tags automatically. */
  autoTag: boolean;
  /** confidence ≥ T and a non-empty reply → pre-fill a draft. A human still approves + sends. */
  stageDraft: boolean;
  /** confidence < T → surface to a human with the full thread; no auto-action. */
  escalate: boolean;
  /** Always advisory — shown to the human, never an automated block. */
  advisoryRedFlags: string[];
}

/**
 * Pure routing. The ONLY place the confidence threshold is applied — the model
 * does not decide routing. Returns advisory data + booleans; it can NEVER express
 * "auto-send" or "auto-block".
 */
export function routeInbound(
  analysis: InboundAnalysis,
  threshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
): InboundRouting {
  const confident = analysis.confidence >= threshold;
  return {
    autoTag: confident,
    stageDraft: confident && analysis.suggested_reply.trim().length > 0,
    escalate: !confident,
    advisoryRedFlags: analysis.red_flags,
  };
}
