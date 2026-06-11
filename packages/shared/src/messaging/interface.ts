// ============================================================================
// MessagingProvider — the channel abstraction (CONTRACTS §2, VERBATIM).
//
// Track B owns this file (canonical definition). Track A implements the three
// adapters (WhatsAppOfficial, WhatsAppUnofficial, Telegram) against it inside
// apps/worker/src/messaging/adapters/ and imports them from `@workerchat/shared`.
//
// CHANGE PROTOCOL (CONTRACTS §2, red-team M4): an adapter that discovers a
// missing field files an orchestrator request. **Track B** edits this file and
// bumps the `@workerchat/shared` version; Track A pins to the new version.
// Track A must NOT edit this file, even transiently.
//
// The CRM (apps/web) NEVER imports a provider. apps/worker is the only code
// that touches a provider; the CRM reads/writes the DB and enqueues outbound.
// ============================================================================

export type Channel = 'whatsapp_official' | 'whatsapp_unofficial' | 'telegram';

export type ConnState =
  | 'disconnected' | 'connecting' | 'pairing' | 'connected'
  | 'reconnecting' | 'logged_out' | 'banned' | 'error';

export type DisconnectReason =
  | 'network' | 'logged_out' | 'banned' | 'conflict' | 'auth_expired' | 'unknown';

export type MessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface NormalizedContact {
  channel: Channel;
  channelUserId: string;       // provider-native id (phone JID, telegram user id)
  phoneE164?: string;          // when known
  displayName?: string;
}

export interface InboundAttachment {          // provider → us
  kind: 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location' | 'other';
  mimeType?: string;
  url?: string;                // our stored URL AFTER the worker downloads to storage
  caption?: string;
  bytes?: number;
}

export interface OutboundAttachment {         // CRM → us → provider
  kind: 'image' | 'audio' | 'video' | 'document';
  storageBucket: string;       // e.g. 'outbound-media'
  storagePath: string;         // worker reads this blob (service_role) then uploads to provider
  mimeType: string;
  bytes: number;
  filename?: string;
  caption?: string;
}

export interface InboundMessage {
  channel: Channel;
  providerMessageId: string;   // idempotency/dedup key
  from: NormalizedContact;
  threadKey: string;           // `${channel}:${channelUserId}`
  text?: string;
  attachments?: InboundAttachment[];
  timestamp: string;           // ISO 8601 — provider send time (authoritative ordering)
  fromMe: boolean;             // true if echoed from the worker's own device (WA CoEx echoes)
  isHistorical?: boolean;      // true if delivered by a history backfill, not live
  raw?: unknown;               // debug only — NEVER persisted, NEVER logged
}

export interface OutboundMessage {
  channel: Channel;
  toChannelUserId: string;
  text?: string;
  attachments?: OutboundAttachment[];          // plural; symmetric with inbound
  template?: { name: string; language: string; variables: string[] };  // WA-official, window closed
  idempotencyKey: string;      // uuid; prevents duplicate sends across worker restarts
}

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  status: MessageStatus;
  windowState?: 'open' | 'closed' | 'n/a';     // WA-official 24h window
  error?: string;
}

export interface ProviderCapabilities {
  historySyncDays: number;       // 0 = new-onward; ~180 for WA CoEx
  historySyncMode: 'bulk' | 'paged' | 'none';
  mediaSync: boolean;
  requires24hWindow: boolean;    // true for WA official
  groups: boolean;               // false for WA official
  echoesOwnDeviceMessages: boolean; // true for WA CoEx (smb_message_echoes)
  deliveryReceipts: boolean;     // WA true, Telegram false
  readReceipts: boolean;         // WA true (settings-dependent), Telegram false, Baileys depends
  connectMethod: 'qr' | 'pair_code' | 'oauth' | 'bot_token';
  messagingTier?: number;        // WA-official only
  throughputMps?: number;        // WA-official only
}

export interface MessagingProvider {
  channel: Channel;
  capabilities: ProviderCapabilities;
  connect(userId: string): Promise<{ state: ConnState }>;   // INITIATES only; see §4 re-surfacing
  getStatus(userId: string): Promise<{ state: ConnState; channelUserId?: string }>;
  send(userId: string, msg: OutboundMessage): Promise<SendResult>;
  syncHistory(userId: string, opts?: { sinceDays?: number; cursor?: string }):
    Promise<{ done: boolean; cursor?: string; imported: number }>;
  disconnect(userId: string): Promise<void>;
  onInbound(handler: (m: InboundMessage) => Promise<void>): void;  // worker wires → encrypt → DB
}
