// ============================================================================
// Zod validators for the messaging wire contract (CONTRACTS §2).
//
// These mirror the MessagingProvider payload types and are the runtime guard at
// the A⇄B boundary: Track A validates a normalized `InboundMessage` before it
// encrypts + writes; Track B validates an `OutboundMessage` shape before it
// enqueues a human-approved `bridge_outbound` row. Keeping the validators here
// (next to the interface) means one source of truth for both tracks.
//
// These are real implementations (validation has no 0a/0b split). The schemas
// are kept structurally in lockstep with `messaging/interface.ts`; if that
// interface changes, change these in the same version bump.
// ============================================================================

import { z } from 'zod';

export const channelSchema = z.enum([
  'whatsapp_official',
  'whatsapp_unofficial',
  'telegram',
]);

export const connStateSchema = z.enum([
  'disconnected', 'connecting', 'pairing', 'connected',
  'reconnecting', 'logged_out', 'banned', 'error',
]);

export const disconnectReasonSchema = z.enum([
  'network', 'logged_out', 'banned', 'conflict', 'auth_expired', 'unknown',
]);

export const messageStatusSchema = z.enum([
  'queued', 'sending', 'sent', 'delivered', 'read', 'failed',
]);

export const normalizedContactSchema = z.object({
  channel: channelSchema,
  channelUserId: z.string().min(1),
  phoneE164: z.string().optional(),
  displayName: z.string().optional(),
});

export const inboundAttachmentSchema = z.object({
  kind: z.enum(['image', 'audio', 'video', 'document', 'sticker', 'location', 'other']),
  mimeType: z.string().optional(),
  url: z.string().optional(),
  caption: z.string().optional(),
  bytes: z.number().int().nonnegative().optional(),
});

export const outboundAttachmentSchema = z.object({
  kind: z.enum(['image', 'audio', 'video', 'document']),
  storageBucket: z.string().min(1),
  storagePath: z.string().min(1),
  mimeType: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  filename: z.string().optional(),
  caption: z.string().optional(),
});

export const inboundMessageSchema = z.object({
  channel: channelSchema,
  providerMessageId: z.string().min(1),
  from: normalizedContactSchema,
  threadKey: z.string().min(1),
  text: z.string().optional(),
  attachments: z.array(inboundAttachmentSchema).optional(),
  timestamp: z.string().datetime({ offset: true }), // ISO 8601, provider send time
  fromMe: z.boolean(),
  isHistorical: z.boolean().optional(),
  raw: z.unknown().optional(), // debug only — NEVER persisted, NEVER logged
});

export const outboundTemplateSchema = z.object({
  name: z.string().min(1),
  language: z.string().min(1),
  variables: z.array(z.string()),
});

export const outboundMessageSchema = z
  .object({
    channel: channelSchema,
    toChannelUserId: z.string().min(1),
    text: z.string().optional(),
    attachments: z.array(outboundAttachmentSchema).optional(),
    template: outboundTemplateSchema.optional(),
    idempotencyKey: z.string().uuid(),
  })
  .refine(
    (m) => Boolean(m.text) || (m.attachments?.length ?? 0) > 0 || Boolean(m.template),
    { message: 'OutboundMessage must carry text, at least one attachment, or a template.' },
  );

export const sendResultSchema = z.object({
  ok: z.boolean(),
  providerMessageId: z.string().optional(),
  status: messageStatusSchema,
  windowState: z.enum(['open', 'closed', 'n/a']).optional(),
  error: z.string().optional(),
});

export const providerCapabilitiesSchema = z.object({
  historySyncDays: z.number().int().nonnegative(),
  historySyncMode: z.enum(['bulk', 'paged', 'none']),
  mediaSync: z.boolean(),
  requires24hWindow: z.boolean(),
  groups: z.boolean(),
  echoesOwnDeviceMessages: z.boolean(),
  deliveryReceipts: z.boolean(),
  readReceipts: z.boolean(),
  connectMethod: z.enum(['qr', 'pair_code', 'oauth', 'bot_token']),
  messagingTier: z.number().int().optional(),
  throughputMps: z.number().optional(),
});

// Inferred types — handy when you want the validated shape rather than the
// hand-written interface (they are kept structurally identical).
export type InboundMessageInput = z.infer<typeof inboundMessageSchema>;
export type OutboundMessageInput = z.infer<typeof outboundMessageSchema>;
export type NormalizedContactInput = z.infer<typeof normalizedContactSchema>;
export type ProviderCapabilitiesInput = z.infer<typeof providerCapabilitiesSchema>;
