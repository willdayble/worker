// The Anthropic SDK's zodOutputFormat (helpers/zod) consumes the zod v4 surface,
// which zod 3.25+ ships at the `zod/v4` subpath. Build the schema with it so the
// types line up with messages.parse(); the schema API is identical to v3 here.
import { z } from 'zod/v4';
import type { InboundAnalysis } from '@workerchat/shared';

// Zod mirror of the CONTRACTS §6 InboundAnalysis, shaped for strict structured
// output: optionals are expressed as `.nullable()` (the API's strict JSON mode
// wants every property present). `toInboundAnalysis` normalizes nulls back to the
// optional shape the rest of the app uses.
export const inboundAnalysisSchema = z.object({
  is_booking: z.boolean(),
  booking_fields: z
    .object({
      service_label: z.string().nullable(),
      date: z.string().nullable(),
      time: z.string().nullable(),
      location_type: z.enum(['at_provider', 'at_client', 'remote', 'other']).nullable(),
      amount: z.number().nullable(),
    })
    .nullable(),
  intent_tags: z.array(z.string()),
  service_tags: z.array(z.string()),
  red_flags: z.array(z.string()),
  suggested_reply: z.string(),
  confidence: z.number(),
});

export type InboundAnalysisRaw = z.infer<typeof inboundAnalysisSchema>;

const undef = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

/** Normalize the strict (nullable) model output to the app's InboundAnalysis. */
export function toInboundAnalysis(raw: InboundAnalysisRaw): InboundAnalysis {
  const bf = raw.booking_fields;
  return {
    is_booking: raw.is_booking,
    booking_fields: bf
      ? {
          service_label: undef(bf.service_label),
          date: undef(bf.date),
          time: undef(bf.time),
          location_type: undef(bf.location_type),
          amount: undef(bf.amount),
        }
      : undefined,
    intent_tags: raw.intent_tags,
    service_tags: raw.service_tags,
    red_flags: raw.red_flags,
    suggested_reply: raw.suggested_reply,
    confidence: Math.max(0, Math.min(1, raw.confidence)),
  };
}
