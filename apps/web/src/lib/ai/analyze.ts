import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { InboundAnalysis } from '@workerchat/shared';
import { inboundAnalysisSchema, toInboundAnalysis } from './schema';

// Per-message extraction/classification uses Haiku 4.5 (CONTRACTS §6 model routing).
// One schema-constrained call → InboundAnalysis. The large neutral system prompt is
// stable and cache-controlled (prompt-caching prefix); the volatile thread goes in
// the user turn after it.
const MODEL = 'claude-haiku-4-5';

const SYSTEM = `You are a CRM assistant for an independent service provider. You analyze ONE inbound client message (with optional prior thread context) and return a strict JSON analysis. You never contact anyone and never take actions — your output is advisory and is reviewed by a human.

Rules:
- NEUTRAL, general-purpose terms only. No industry-specific or explicit language. Extract generic appointment/booking data; never broker, encourage, or price a transaction.
- is_booking: true only if the message proposes, requests, or confirms an appointment/booking.
- booking_fields: extract only what is clearly stated — service_label (a neutral description of what's requested), date, time, location_type (one of: at_provider, at_client, remote, other), amount (a number). Use null for anything not clearly stated.
- intent_tags: short neutral intent labels (e.g. "enquiry", "scheduling", "pricing", "confirmation", "cancellation", "smalltalk").
- service_tags: neutral tags that could map to a services menu. Empty if unclear.
- red_flags: ADVISORY safety concerns only, for a human to review — e.g. "aggressive language", "boundary pushing", "pressure to bypass screening", "payment dispute". These are never an automated decision. Empty array if none.
- suggested_reply: a polite, professional DRAFT reply the provider could send. A human reviews and sends it; include nothing you would not want sent verbatim. Keep it concise.
- confidence: 0..1, your confidence in this analysis overall.

Return only the structured JSON.`;

export async function analyzeInbound(
  text: string,
  threadContext?: string[],
): Promise<InboundAnalysis> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'AI assist is not configured. Set ANTHROPIC_API_KEY (Doppler, project worker) to enable it.',
    );
  }
  const client = new Anthropic();

  const context =
    threadContext && threadContext.length > 0
      ? `Prior thread (oldest→newest), for context:\n${threadContext.map((t) => `- ${t}`).join('\n')}\n\n`
      : '';

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 1024,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: `${context}Latest inbound client message to analyze:\n"""\n${text}\n"""`,
      },
    ],
    output_config: { format: zodOutputFormat(inboundAnalysisSchema) },
  });

  if (response.stop_reason === 'refusal' || !response.parsed_output) {
    throw new Error('The assistant did not return a usable analysis for this message.');
  }
  return toInboundAnalysis(response.parsed_output);
}
