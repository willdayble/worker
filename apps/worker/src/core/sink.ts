// The persistence boundary for Track A (CONTRACTS §3 ownership, §4 queue/event, §5 crypto).
//
// The sink is the ONLY place Track A writes the DB. It is deliberately scoped to the
// tables Track A may touch — contact_channels, contacts, conversations, messages,
// channels (state), bridge_outbound (status only). It must NOT write CRM-owned tables
// (deals/tags/pipeline) and must NOT modify is_flagged/flag_reason_enc or re-bind a
// flagged contact — there is simply no method here to do so.
//
// The sink OWNS the Encryptor, so "encrypt sensitive values before insert" is a
// structural invariant, not a discipline: callers hand plaintext to persistInbound,
// and the sink encrypts body/preview/identifiers before storing. Operational columns
// (ids, timestamps, channel, status, thread_key, provider_message_id) stay plaintext
// (CONTRACTS §5 "Not encrypted (operational)").

import type {
  Channel, ConnState, InboundMessage, MessageStatus,
} from '@workerchat/shared';

/** A claimed bridge_outbound row, as the worker sees it (ciphertext at rest). */
export interface OutboundRow {
  id: string;
  userId: string;
  channel: Channel;
  toChannelUserIdEnc: string;   // ciphertext — decrypt in memory just before send
  bodyEnc?: string;             // ciphertext
  attachmentEnc?: string;       // ciphertext (CRM does JSON.stringify(meta) → encrypt; decrypt+parse in wiring)
  templateEnc?: string;         // ciphertext (same JSON-encoded scheme)
  idempotencyKey: string;
}

/** Mutable fields the worker writes onto the `channels` row for Realtime re-surfacing. */
export interface ChannelStatePatch {
  state?: ConnState;
  channelUserId?: string;
  qr?: string | null;
  pairCode?: string | null;
  lastError?: string | null;       // STABLE token only, never a provider message
  disconnectReason?: string | null;
  historySyncState?: 'idle' | 'syncing' | 'complete' | 'failed';
  connectedAt?: string | null;
}

/** What the runtime hands the sink to mirror a delivered outbound into messages(out). */
export interface OutboundMirror {
  userId: string;
  channel: Channel;
  threadKey: string;            // `${channel}:${toChannelUserId}` (runtime computes after decrypt)
  bodyEnc?: string;             // ciphertext to mirror (never plaintext)
  contentType: string;         // 'text' | attachment kind
  sentAt: string;              // ISO 8601
}

export interface MessageSink {
  /**
   * Idempotent inbound upsert by (conversation_id, provider_message_id) (CONTRACTS §3).
   * Resolves contact identity via contact_channels (M7), creating contacts/conversations
   * as needed. Encrypts text/preview/identifiers before insert. Returns whether the row
   * already existed (deduped) so the caller can skip re-processing (e.g. AI-assist).
   */
  persistInbound(userId: string, m: InboundMessage): Promise<{ conversationId: string; deduped: boolean }>;

  /**
   * Atomically claim the oldest pending bridge_outbound row for `userId`
   * (pending → sending + claimed_at). Returns null if none. Never returns a row already
   * 'sending' — that path is surfaced for manual review, never blindly re-sent (M16).
   */
  claimOutbound(userId: string): Promise<OutboundRow | null>;

  /**
   * After a successful send: status → sent, store provider_message_id, mirror into messages(out)
   * (linked to the thread via `mirror.threadKey`), then purge the outbound ciphertext columns
   * (data minimization — the row only ever held ciphertext; we null it once delivered).
   */
  markOutboundSent(rowId: string, providerMessageId: string, mirror: OutboundMirror): Promise<void>;

  /** After a failed send: status → failed, store a STABLE error token (never provider message). */
  markOutboundFailed(rowId: string, errorCode: string): Promise<void>;

  /** Write QR/pair/state/lastError onto the channels row for the CRM to re-surface via Realtime (C6). */
  writeChannelState(userId: string, channel: Channel, patch: ChannelStatePatch): Promise<void>;

  /** Delivery/read status webhook → update messages.status by provider_message_id (C5). */
  updateMessageStatus(providerMessageId: string, status: MessageStatus): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// InMemorySink — used by the round-trip harness so the whole inbound→encrypt→store
// and claim→decrypt→send→mirror loop runs offline with no Supabase. It enforces the
// same invariants as the real sink: idempotency, ciphertext-at-rest, dedup.
// ─────────────────────────────────────────────────────────────────────────────

import type { Encryptor } from './crypto.js';

interface StoredMessage {
  conversationId: string;
  providerMessageId: string;
  direction: 'in' | 'out';
  contentType: string;
  bodyEnc?: string;             // ciphertext only — never plaintext
  attachmentUrl?: string;
  isHistorical: boolean;
  status: MessageStatus;
  sentAt: string;
}

export class InMemorySink implements MessageSink {
  // Exposed for assertions in tests; production code never reads these.
  readonly messages: StoredMessage[] = [];
  readonly conversations = new Map<string, { userId: string; threadKey: string; lastPreviewEnc?: string }>();
  readonly contactChannels = new Map<string, { contactId: string }>(); // key: user:channel:channelUserId
  readonly channelStates = new Map<string, ChannelStatePatch & { channel: Channel }>();
  readonly outbox: OutboundRow[] = [];               // seeded by the test to mimic the CRM's human-approved rows
  private seq = 0;

  constructor(private readonly enc: Encryptor) {}

  private convId(userId: string, threadKey: string): string {
    return `conv:${userId}:${threadKey}`;
  }

  async persistInbound(userId: string, m: InboundMessage) {
    const conversationId = this.convId(userId, m.threadKey);

    // Idempotency: upsert by (conversation_id, provider_message_id).
    const existing = this.messages.find(
      (x) => x.conversationId === conversationId && x.providerMessageId === m.providerMessageId,
    );
    if (existing) return { conversationId, deduped: true };

    // Contact identity (M7): deterministic by user+channel+channelUserId.
    const ckey = `${userId}:${m.channel}:${m.from.channelUserId}`;
    if (!this.contactChannels.has(ckey)) {
      this.contactChannels.set(ckey, { contactId: `contact:${ckey}` });
    }
    if (!this.conversations.has(conversationId)) {
      this.conversations.set(conversationId, { userId, threadKey: m.threadKey });
    }

    // Encrypt-before-insert: body + preview. Empty text (media-only) stores no body_enc.
    const firstAtt = m.attachments?.[0];
    const bodyEnc = m.text ? await this.enc.encrypt(userId, m.text) : undefined;
    const preview = m.text ?? (firstAtt ? `[${firstAtt.kind}]` : '');
    if (preview) {
      this.conversations.get(conversationId)!.lastPreviewEnc = await this.enc.encrypt(userId, preview);
    }

    this.messages.push({
      conversationId,
      providerMessageId: m.providerMessageId,
      direction: 'in',
      contentType: firstAtt ? firstAtt.kind : 'text',
      bodyEnc,
      attachmentUrl: m.attachments?.[0]?.url,
      isHistorical: m.isHistorical ?? false,
      status: 'delivered',
      sentAt: m.timestamp,
    });
    return { conversationId, deduped: false };
  }

  async claimOutbound(userId: string): Promise<OutboundRow | null> {
    const row = this.outbox.find((r) => r.userId === userId);
    if (!row) return null;
    // Atomic claim in the real sink (UPDATE ... WHERE status='pending' RETURNING). Here: pop it.
    this.outbox.splice(this.outbox.indexOf(row), 1);
    return row;
  }

  async markOutboundSent(_rowId: string, providerMessageId: string, mirror: OutboundMirror): Promise<void> {
    // Mirror into messages(out), linked to the same conversation the reply belongs to.
    // Ciphertext only; nothing to purge in-memory (the real sink nulls the outbound *_enc columns).
    const conversationId = this.convId(mirror.userId, mirror.threadKey);
    this.messages.push({
      conversationId,
      providerMessageId,
      direction: 'out',
      contentType: mirror.contentType,
      bodyEnc: mirror.bodyEnc,
      isHistorical: false,
      status: 'sent',
      sentAt: mirror.sentAt,
    });
  }

  async markOutboundFailed(_rowId: string, _errorCode: string): Promise<void> {
    /* harness no-op; real sink updates bridge_outbound.status='failed', error=<token> */
  }

  async writeChannelState(userId: string, channel: Channel, patch: ChannelStatePatch): Promise<void> {
    const prev = this.channelStates.get(userId) ?? { channel };
    this.channelStates.set(userId, { ...prev, ...patch, channel });
  }

  async updateMessageStatus(providerMessageId: string, status: MessageStatus): Promise<void> {
    const msg = this.messages.find((x) => x.providerMessageId === providerMessageId);
    if (msg) msg.status = status;
    void this.seq;
  }
}
