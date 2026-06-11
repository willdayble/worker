// TelegramProvider — the sanctioned, zero-ban-risk channel and Track A's critical path
// (tracks/A-chat-layer.md Deliverable 2.1). Proves the whole inbound→DB→outbound loop.
//
// Design: the adapter does provider I/O + normalization ONLY. It depends on a small
// `TelegramTransport` interface (the slice of grammY we use), so it's fully unit-testable
// with a fake transport and never hard-couples to the SDK. Encryption + persistence live
// in the worker wiring (registered via onInbound) — the adapter just normalizes and calls
// the handler, matching the MessagingProvider boundary in CONTRACTS §2/§4.
//
// grammY (the provider SDK) is declared only in apps/worker/package.json and imported only
// by ./telegram-grammy.ts — never by packages/shared (CONTRACTS §1 structural rule).

import type {
  Channel, ConnState, InboundAttachment, InboundMessage, MessagingProvider,
  OutboundMessage, ProviderCapabilities, SendResult,
} from '@workerchat/shared';
import type { ChannelStatePatch } from '../../core/sink.js';
import { log, errorToken } from '../../core/logger.js';

// ── The transport seam (the subset of grammY this adapter needs) ──────────────

/** A single inbound Telegram message, pre-normalization (provider-native shape, trimmed). */
export interface TgIncoming {
  messageId: number;
  chatId: number;            // DM: == fromId. We route replies by chatId.
  fromId: number;
  fromUsername?: string;
  fromName?: string;
  dateUnix: number;          // provider send time (seconds)
  text?: string;
  attachment?: {
    kind: InboundAttachment['kind'];
    fileId: string;          // resolve to a downloadable URL via transport.getFileUrl
    mimeType?: string;
    bytes?: number;
    caption?: string;
  };
}

export interface TelegramTransport {
  /** Validates the token; throws on 401 (revoked token). Returns the bot's own identity. */
  getMe(): Promise<{ id: number; username?: string }>;
  /** Begin receiving updates (long-poll/webhook). Calls `onUpdate` per inbound message. */
  start(onUpdate: (u: TgIncoming) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  sendText(chatId: number, text: string): Promise<{ messageId: number }>;
  sendMedia(
    chatId: number,
    media: { kind: 'image' | 'audio' | 'video' | 'document'; data: Buffer; filename?: string; caption?: string },
  ): Promise<{ messageId: number }>;
  /** Resolve a Telegram file_id to a temporary download URL (for inbound media). */
  getFileUrl(fileId: string): Promise<string>;
}

/** Builds a transport for a given bot token. Production = grammY; tests = fake. */
export type TransportFactory = (botToken: string) => TelegramTransport;

/** Loads per-user secrets. Production reads the channels/auth-state row; tests inject a Map. */
export interface CredentialStore {
  getTelegramBotToken(userId: string): Promise<string | null>;
}

/** Reads an outbound media blob the CRM staged in Supabase Storage (service_role). Tests inject a fake. */
export interface MediaStore {
  read(bucket: string, path: string): Promise<Buffer>;
}

export interface TelegramProviderDeps {
  transportFactory: TransportFactory;
  credentials: CredentialStore;
  /** Surfaces ConnState/identity onto the channels row for Realtime re-surfacing (C6). */
  writeChannelState: (userId: string, channel: Channel, patch: ChannelStatePatch) => Promise<void>;
  /** Reads outbound media blobs (CONTRACTS §4 media upload, C4). Optional until media outbound is used. */
  mediaStore?: MediaStore;
}

// ── The adapter ───────────────────────────────────────────────────────────────

interface Session {
  transport: TelegramTransport;
  state: ConnState;
  botUserId?: string;
}

export class TelegramProvider implements MessagingProvider {
  readonly channel: Channel = 'telegram';

  // Telegram bot capabilities. Bots cannot read pre-existing history, have no delivery/read
  // receipts, no 24h window, and we scope to DMs (groups unsupported per SCOPE §4).
  readonly capabilities: ProviderCapabilities = {
    historySyncDays: 0,
    historySyncMode: 'none',
    mediaSync: true,
    requires24hWindow: false,
    groups: false,
    echoesOwnDeviceMessages: false,
    deliveryReceipts: false,
    readReceipts: false,
    connectMethod: 'bot_token',
  };

  private readonly sessions = new Map<string, Session>();
  private inboundHandler?: (m: InboundMessage) => Promise<void>;

  constructor(private readonly deps: TelegramProviderDeps) {}

  onInbound(handler: (m: InboundMessage) => Promise<void>): void {
    this.inboundHandler = handler;
  }

  async connect(userId: string): Promise<{ state: ConnState }> {
    await this.setState(userId, 'connecting');

    const token = await this.deps.credentials.getTelegramBotToken(userId);
    if (!token) {
      // No bot token configured for this user — surface as logged_out (needs (re)connect),
      // not 'error' (which implies a transient fault).
      await this.setState(userId, 'logged_out', { reason: 'no_bot_token' });
      return { state: 'logged_out' };
    }

    const transport = this.deps.transportFactory(token);
    try {
      const me = await transport.getMe();
      const session: Session = { transport, state: 'connected', botUserId: String(me.id) };
      this.sessions.set(userId, session);

      // Wire updates → normalize → worker handler. Errors per-message are isolated and
      // logged with id-only fields; one bad message never tears down the long-poll.
      await transport.start(async (u) => {
        try {
          const m = this.normalize(u);
          await this.inboundHandler?.(m);
        } catch (err) {
          log.error({ event: 'telegram.inbound.failed', userId, channel: this.channel, errorCode: errorToken(err) });
        }
      });

      await this.setState(userId, 'connected', { channelUserId: String(me.id) });
      log.info({ event: 'telegram.connected', userId, channel: this.channel, channelUserId: String(me.id) });
      return { state: 'connected' };
    } catch (err) {
      // 401 from getMe = revoked/invalid token → logged_out (re-auth needed). Else transient error.
      const code = errorToken(err);
      const state: ConnState = code === 'http_401' ? 'logged_out' : 'error';
      await this.setState(userId, state, { reason: code });
      log.error({ event: 'telegram.connect.failed', userId, channel: this.channel, state, errorCode: code });
      return { state };
    }
  }

  async getStatus(userId: string): Promise<{ state: ConnState; channelUserId?: string }> {
    const s = this.sessions.get(userId);
    return s ? { state: s.state, channelUserId: s.botUserId } : { state: 'disconnected' };
  }

  async send(userId: string, msg: OutboundMessage): Promise<SendResult> {
    const session = this.sessions.get(userId);
    if (!session || session.state !== 'connected') {
      return { ok: false, status: 'failed', windowState: 'n/a', error: 'not_connected' };
    }
    const chatId = Number(msg.toChannelUserId);
    if (!Number.isFinite(chatId)) {
      return { ok: false, status: 'failed', windowState: 'n/a', error: 'bad_recipient' };
    }

    try {
      let providerMessageId: string | undefined;

      // Attachments first (symmetric with inbound). CRM staged the blob in Storage (C4);
      // we read it via the MediaStore then upload to Telegram.
      for (const att of msg.attachments ?? []) {
        if (!this.deps.mediaStore) throw Object.assign(new Error('media'), { code: 'no_media_store' });
        const data = await this.deps.mediaStore.read(att.storageBucket, att.storagePath);
        const kind = att.kind;
        const sent = await session.transport.sendMedia(chatId, { kind, data, filename: att.filename, caption: att.caption });
        providerMessageId = String(sent.messageId);
      }

      if (msg.text) {
        const sent = await session.transport.sendText(chatId, msg.text);
        providerMessageId = String(sent.messageId);
      }

      if (!providerMessageId) {
        return { ok: false, status: 'failed', windowState: 'n/a', error: 'empty_message' };
      }

      log.info({
        event: 'telegram.sent', userId, channel: this.channel,
        channelUserId: msg.toChannelUserId, providerMessageId,
        attachments: msg.attachments?.length ?? 0,
      });
      // Telegram gives no delivery/read receipts — 'sent' is terminal-known here (C5: synthesize).
      return { ok: true, providerMessageId, status: 'sent', windowState: 'n/a' };
    } catch (err) {
      const code = errorToken(err);
      log.error({ event: 'telegram.send.failed', userId, channel: this.channel, errorCode: code });
      return { ok: false, status: 'failed', windowState: 'n/a', error: code };
    }
  }

  // Telegram bots cannot read pre-existing history (capabilities.historySyncMode === 'none').
  async syncHistory(
    _userId: string,
    _opts?: { sinceDays?: number; cursor?: string },
  ): Promise<{ done: boolean; cursor?: string; imported: number }> {
    return { done: true, imported: 0 };
  }

  async disconnect(userId: string): Promise<void> {
    const s = this.sessions.get(userId);
    if (s) {
      try { await s.transport.stop(); } catch (err) {
        log.warn({ event: 'telegram.stop.failed', userId, channel: this.channel, errorCode: errorToken(err) });
      }
      this.sessions.delete(userId);
    }
    await this.setState(userId, 'disconnected');
    log.info({ event: 'telegram.disconnected', userId, channel: this.channel });
  }

  // ── internals ────────────────────────────────────────────────────────────────

  /** Map a provider-native message → the channel-agnostic InboundMessage (CONTRACTS §2). */
  private normalize(u: TgIncoming): InboundMessage {
    const channelUserId = String(u.chatId); // route replies by chatId (== fromId in DMs)
    const attachments: InboundAttachment[] | undefined = u.attachment
      ? [{
          kind: u.attachment.kind,
          mimeType: u.attachment.mimeType,
          bytes: u.attachment.bytes,
          caption: u.attachment.caption,
          // NOTE: url is filled by the worker AFTER it downloads to storage (CONTRACTS InboundAttachment.url).
          // The wiring resolves fileId → getFileUrl → download → storage; the raw fileId never persists.
        }]
      : undefined;

    return {
      channel: this.channel,
      providerMessageId: String(u.messageId),
      from: {
        channel: this.channel,
        channelUserId,
        displayName: u.fromName ?? u.fromUsername,
        // Telegram does not expose the user's phone to a bot → phoneE164 stays undefined.
      },
      threadKey: `${this.channel}:${channelUserId}`,
      text: u.text ?? u.attachment?.caption,
      attachments,
      timestamp: new Date(u.dateUnix * 1000).toISOString(),
      fromMe: false, // Telegram does not echo the bot's own sends as updates (unlike WA CoEx)
      // raw intentionally omitted — never persisted, never logged (CONTRACTS §2).
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
