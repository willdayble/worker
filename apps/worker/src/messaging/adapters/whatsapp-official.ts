// WhatsAppOfficialProvider — Cloud API + Coexistence (CONTRACTS §2; tracks/A Deliverable 2.2).
// The DURABLE PRIMARY path: ban-safe, official. Webhook-driven (Meta POSTs to us), unlike the
// long-poll channels, so inbound arrives via `ingestWebhook()` rather than a socket the provider
// opens. The adapter does provider I/O + normalization only; encryption/persistence stay in the
// worker wiring (onInbound), same boundary as Telegram.
//
// WA-specifics handled here:
//   • Coexistence echoes (`smb_message_echoes` / `message_echoes`) → the worker's OWN-DEVICE sends
//     surface as inbound with fromMe=true (so the CRM mirrors what the worker typed on their phone).
//   • status webhooks (sent/delivered/read/failed) → onStatus → sink.updateMessageStatus (C5).
//   • the 24h customer-service window: free-form text only while open; once closed Meta rejects
//     (131047) and an approved TEMPLATE must be used. send() reports windowState so the CRM adapts.
//   • webhook signature verification (X-Hub-Signature-256) — see verifyWebhookSignature().
//
// The Graph API HTTP calls live behind the `WhatsAppCloudTransport` seam (real impl:
// ./whatsapp-cloud-transport.ts using fetch — no SDK), so the adapter is unit-testable with a fake.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  Channel, ConnState, InboundAttachment, InboundMessage, MessageStatus,
  MessagingProvider, OutboundMessage, ProviderCapabilities, SendResult,
} from '@workerchat/shared';
import type { ChannelStatePatch } from '../../core/sink.js';
import { log, errorToken } from '../../core/logger.js';

// ── Transport seam (the slice of the WhatsApp Cloud Graph API we use) ──────────

export interface WaSendResult { messageId: string }

export interface WhatsAppCloudTransport {
  /** Verify the configured phone number is registered/usable (Graph GET /{phone_number_id}). */
  getPhoneNumber(): Promise<{ id: string; displayPhoneNumber?: string; verifiedName?: string }>;
  sendText(toE164: string, text: string): Promise<WaSendResult>;
  sendTemplate(toE164: string, template: { name: string; language: string; variables: string[] }): Promise<WaSendResult>;
  sendMedia(
    toE164: string,
    media: { kind: 'image' | 'audio' | 'video' | 'document'; data: Buffer; mimeType: string; filename?: string; caption?: string },
  ): Promise<WaSendResult>;
  /** Two-step inbound media: media_id → CDN url (+ meta). The worker then downloads + stores. */
  getMediaUrl(mediaId: string): Promise<{ url: string; mimeType?: string; bytes?: number }>;
  downloadMedia(url: string): Promise<Buffer>;
}

export type WaTransportFactory = (config: WhatsAppConfig) => WhatsAppCloudTransport;

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;       // for webhook signature verification
}

export interface WhatsAppCredentialStore {
  getWhatsAppConfig(userId: string): Promise<WhatsAppConfig | null>;
}

export interface MediaStore {
  read(bucket: string, path: string): Promise<Buffer>;
}

export interface WhatsAppOfficialDeps {
  transportFactory: WaTransportFactory;
  credentials: WhatsAppCredentialStore;
  writeChannelState: (userId: string, channel: Channel, patch: ChannelStatePatch) => Promise<void>;
  mediaStore?: MediaStore;
}

/** A delivery/read status update parsed from a `statuses` webhook (C5). */
export interface StatusUpdate { providerMessageId: string; status: MessageStatus }

// ── The adapter ────────────────────────────────────────────────────────────────

const WINDOW_CLOSED_CODE = 131047; // Meta: >24h since the customer last replied → template required.

interface Session { config: WhatsAppConfig; transport: WhatsAppCloudTransport; state: ConnState; phoneNumberId?: string }

export class WhatsAppOfficialProvider implements MessagingProvider {
  readonly channel: Channel = 'whatsapp_official';

  // CoEx: ~180d history (paged), echoes own-device messages, delivery+read receipts, 24h window, no groups.
  readonly capabilities: ProviderCapabilities = {
    historySyncDays: 180,
    historySyncMode: 'paged',
    mediaSync: true,
    requires24hWindow: true,
    groups: false,
    echoesOwnDeviceMessages: true,
    deliveryReceipts: true,
    readReceipts: true,
    connectMethod: 'qr', // Coexistence pairing via the WhatsApp Business app QR
    messagingTier: 0,
    throughputMps: 0,
  };

  private readonly sessions = new Map<string, Session>();
  private inboundHandler?: (m: InboundMessage) => Promise<void>;
  private statusHandler?: (s: StatusUpdate) => Promise<void>;

  constructor(private readonly deps: WhatsAppOfficialDeps) {}

  onInbound(handler: (m: InboundMessage) => Promise<void>): void { this.inboundHandler = handler; }
  /** Delivery/read status updates (C5). Worker wires this → sink.updateMessageStatus. */
  onStatus(handler: (s: StatusUpdate) => Promise<void>): void { this.statusHandler = handler; }

  async connect(userId: string): Promise<{ state: ConnState }> {
    await this.setState(userId, 'connecting');
    const config = await this.deps.credentials.getWhatsAppConfig(userId);
    if (!config) { await this.setState(userId, 'logged_out', { reason: 'no_wa_config' }); return { state: 'logged_out' }; }

    const transport = this.deps.transportFactory(config);
    try {
      const phone = await transport.getPhoneNumber();
      this.sessions.set(userId, { config, transport, state: 'connected', phoneNumberId: phone.id });
      await this.setState(userId, 'connected', { channelUserId: phone.id });
      log.info({ event: 'wa.connected', userId, channel: this.channel, channelUserId: phone.id });
      return { state: 'connected' };
    } catch (err) {
      const code = errorToken(err);
      const state: ConnState = code === 'http_401' || code === 'http_403' ? 'logged_out' : 'error';
      await this.setState(userId, state, { reason: code });
      log.error({ event: 'wa.connect.failed', userId, channel: this.channel, state, errorCode: code });
      return { state };
    }
  }

  async getStatus(userId: string): Promise<{ state: ConnState; channelUserId?: string }> {
    const s = this.sessions.get(userId);
    return s ? { state: s.state, channelUserId: s.phoneNumberId } : { state: 'disconnected' };
  }

  async send(userId: string, msg: OutboundMessage): Promise<SendResult> {
    const session = this.sessions.get(userId);
    if (!session || session.state !== 'connected') {
      return { ok: false, status: 'failed', windowState: 'n/a', error: 'not_connected' };
    }
    const to = msg.toChannelUserId; // WA id (E164 digits)
    try {
      let providerMessageId: string | undefined;

      if (msg.template) {
        // Window-closed path: an approved template is the only allowed message.
        const r = await session.transport.sendTemplate(to, msg.template);
        log.info({ event: 'wa.sent.template', userId, channel: this.channel, channelUserId: to, providerMessageId: r.messageId });
        return { ok: true, providerMessageId: r.messageId, status: 'sent', windowState: 'closed' };
      }

      for (const att of msg.attachments ?? []) {
        if (!this.deps.mediaStore) throw Object.assign(new Error('media'), { code: 'no_media_store' });
        if (att.kind === 'audio' || att.kind === 'document' || att.kind === 'image' || att.kind === 'video') {
          const data = await this.deps.mediaStore.read(att.storageBucket, att.storagePath);
          const r = await session.transport.sendMedia(to, { kind: att.kind, data, mimeType: att.mimeType, filename: att.filename, caption: att.caption });
          providerMessageId = r.messageId;
        }
      }

      if (msg.text) {
        const r = await session.transport.sendText(to, msg.text);
        providerMessageId = r.messageId;
      }

      if (!providerMessageId) return { ok: false, status: 'failed', windowState: 'open', error: 'empty_message' };

      log.info({ event: 'wa.sent', userId, channel: this.channel, channelUserId: to, providerMessageId, attachments: msg.attachments?.length ?? 0 });
      return { ok: true, providerMessageId, status: 'sent', windowState: 'open' };
    } catch (err) {
      // Outside the 24h window → tell the CRM to switch to a template (don't mark a hard failure cause).
      const metaCode = (err as { metaCode?: number }).metaCode;
      if (metaCode === WINDOW_CLOSED_CODE) {
        log.warn({ event: 'wa.send.window_closed', userId, channel: this.channel, channelUserId: to });
        return { ok: false, status: 'failed', windowState: 'closed', error: 'window_closed' };
      }
      const code = errorToken(err);
      log.error({ event: 'wa.send.failed', userId, channel: this.channel, errorCode: code });
      return { ok: false, status: 'failed', windowState: 'open', error: code };
    }
  }

  async syncHistory(
    _userId: string,
    _opts?: { sinceDays?: number; cursor?: string },
  ): Promise<{ done: boolean; cursor?: string; imported: number }> {
    // Coexistence history backfill (~180d) is paged; not implemented this slice (Deliverable 2.2 follow-up).
    return { done: true, imported: 0 };
  }

  async disconnect(userId: string): Promise<void> {
    this.sessions.delete(userId);
    await this.setState(userId, 'disconnected');
    log.info({ event: 'wa.disconnected', userId, channel: this.channel });
  }

  // ── Webhook ingestion (Meta → us) ──────────────────────────────────────────────

  /**
   * Parse a verified Cloud API webhook body and dispatch inbound messages + status updates.
   * Idempotency/encryption/persistence happen downstream in the wiring (onInbound) + sink.
   * Returns counts for logging. Call ONLY after verifyWebhookSignature() passes.
   */
  async ingestWebhook(body: WaWebhookBody): Promise<{ messages: number; echoes: number; statuses: number }> {
    let messages = 0, echoes = 0, statuses = 0;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        const contactName = value.contacts?.[0]?.profile?.name;

        for (const wm of value.messages ?? []) {
          await this.dispatchMessage(wm, contactName, false);
          messages++;
        }
        // Coexistence own-device echoes — messages the worker sent from their WA Business app.
        for (const wm of value.message_echoes ?? value.smb_message_echoes ?? []) {
          await this.dispatchMessage(wm, contactName, true);
          echoes++;
        }
        for (const st of value.statuses ?? []) {
          const status = mapWaStatus(st.status);
          if (status && this.statusHandler) { await this.statusHandler({ providerMessageId: st.id, status }); statuses++; }
        }
      }
    }
    return { messages, echoes, statuses };
  }

  private async dispatchMessage(wm: WaMessage, contactName: string | undefined, fromMe: boolean): Promise<void> {
    try {
      const m = this.normalize(wm, contactName, fromMe);
      await this.inboundHandler?.(m);
    } catch (err) {
      log.error({ event: 'wa.inbound.failed', channel: this.channel, fromMe, errorCode: errorToken(err) });
    }
  }

  /** Map a Cloud API message → channel-agnostic InboundMessage. */
  private normalize(wm: WaMessage, contactName: string | undefined, fromMe: boolean): InboundMessage {
    // For inbound `from` is the client; for an echo the counterparty is `to` (the client we messaged).
    const channelUserId = fromMe ? (wm.to ?? wm.from) : wm.from;
    const media = extractMedia(wm);
    const attachments: InboundAttachment[] | undefined = media
      ? [{ kind: media.kind, mimeType: media.mimeType, caption: media.caption }]
      : undefined; // url filled by the media pipeline after download (CONTRACTS InboundAttachment.url)

    return {
      channel: this.channel,
      providerMessageId: wm.id,
      from: {
        channel: this.channel,
        channelUserId,
        phoneE164: channelUserId.startsWith('+') ? channelUserId : `+${channelUserId}`,
        displayName: contactName,
      },
      threadKey: `${this.channel}:${channelUserId}`,
      text: wm.text?.body ?? media?.caption,
      attachments,
      timestamp: new Date(Number(wm.timestamp) * 1000).toISOString(),
      fromMe,
    };
  }

  private async setState(userId: string, state: ConnState, extra?: { channelUserId?: string; reason?: string }): Promise<void> {
    const s = this.sessions.get(userId);
    if (s) s.state = state;
    await this.deps.writeChannelState(userId, this.channel, {
      state,
      channelUserId: extra?.channelUserId,
      lastError: extra?.reason ?? null,
      connectedAt: state === 'connected' ? new Date().toISOString() : undefined,
    });
  }
}

// ── Webhook signature verification (security) ────────────────────────────────────

/**
 * Verify Meta's `X-Hub-Signature-256` header against the RAW request body using the app secret
 * (HMAC-SHA256). Constant-time compare. Reject the webhook if this returns false — an unverified
 * payload must never reach ingestWebhook().
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined, appSecret: string): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Cloud API webhook payload shapes (the subset we read) ─────────────────────────

export interface WaMessage {
  id: string;
  from: string;
  to?: string;                 // present on echoes
  timestamp: string;           // unix seconds (string)
  type: string;                // 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location' | ...
  text?: { body: string };
  image?: WaMediaObj; audio?: WaMediaObj; video?: WaMediaObj; document?: WaMediaObj; sticker?: WaMediaObj;
}
interface WaMediaObj { id?: string; mime_type?: string; caption?: string; sha256?: string }

export interface WaWebhookBody {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
        messages?: WaMessage[];
        message_echoes?: WaMessage[];
        smb_message_echoes?: WaMessage[];
        statuses?: Array<{ id: string; status: string; timestamp?: string; recipient_id?: string }>;
      };
    }>;
  }>;
}

function extractMedia(wm: WaMessage): { kind: InboundAttachment['kind']; mimeType?: string; caption?: string } | undefined {
  const map: Array<[keyof WaMessage, InboundAttachment['kind']]> = [
    ['image', 'image'], ['audio', 'audio'], ['video', 'video'], ['document', 'document'], ['sticker', 'sticker'],
  ];
  for (const [field, kind] of map) {
    const obj = wm[field] as WaMediaObj | undefined;
    if (obj) return { kind, mimeType: obj.mime_type, caption: obj.caption };
  }
  if (wm.type === 'location') return { kind: 'location' };
  return undefined;
}

function mapWaStatus(s: string): MessageStatus | undefined {
  if (s === 'sent' || s === 'delivered' || s === 'read' || s === 'failed') return s;
  return undefined;
}
