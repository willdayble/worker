// SessionRuntime — the worker glue that turns a MessagingProvider into a running session
// for ONE user. It wires inbound (provider → encrypt+persist) and drives outbound
// (claim → decrypt-in-memory → send → status), per CONTRACTS §4.
//
// One-user-per-runtime is deliberate: the frozen `onInbound(handler)` carries no userId, and
// CONTRACTS §5 / the track brief target "one isolated session process per user" with that
// user's key in memory only while connected. So the inbound handler closes over `userId`.
// Multi-tenant dev runs one SessionRuntime per connected user.

import type { MessagingProvider, OutboundAttachment, OutboundMessage } from '@workerchat/shared';
import type { Encryptor } from '../core/crypto.js';
import type { MessageSink } from '../core/sink.js';
import { log, errorToken } from '../core/logger.js';

export interface SessionRuntimeDeps {
  userId: string;
  provider: MessagingProvider;
  sink: MessageSink;
  /** Decrypts outbound ciphertext (to/body/attachment) in memory just before send. */
  encryptor: Encryptor;
  /** Outbound poll cadence. The CRM inserts pending rows only AFTER human approval (§4). */
  pollIntervalMs?: number;
}

export class SessionRuntime {
  private timer?: ReturnType<typeof setInterval>;
  private draining = false;

  constructor(private readonly deps: SessionRuntimeDeps) {}

  /** Wire inbound, connect the provider, and begin the outbound drain loop. */
  async start(): Promise<void> {
    const { userId, provider, sink } = this.deps;

    // Inbound: provider normalizes → we encrypt-before-insert (inside the sink) → DB upsert.
    // Idempotent by (conversation_id, provider_message_id); historical bulk is flagged so the
    // CRM skips AI-assist/unread badges (CONTRACTS §4 history backfill).
    provider.onInbound(async (m) => {
      const { conversationId, deduped } = await sink.persistInbound(userId, m);
      log.info({
        event: deduped ? 'inbound.deduped' : 'inbound.upserted',
        userId, channel: m.channel, threadKey: m.threadKey,
        providerMessageId: m.providerMessageId, conversationId,
        attachments: m.attachments?.length ?? 0,
        isHistorical: m.isHistorical ?? false, fromMe: m.fromMe,
      });
    });

    await provider.connect(userId);

    const interval = this.deps.pollIntervalMs ?? 1500;
    this.timer = setInterval(() => { void this.drainOutbound(); }, interval);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.deps.provider.disconnect(this.deps.userId);
  }

  /** Drain all currently-claimable outbound rows. Re-entrancy-guarded so ticks don't overlap. */
  async drainOutbound(): Promise<number> {
    if (this.draining) return 0;
    this.draining = true;
    let sent = 0;
    try {
      // Loop until no claimable row remains this tick.
      while (await this.processOneOutbound()) sent++;
    } finally {
      this.draining = false;
    }
    return sent;
  }

  /**
   * Claim-then-send one outbound row, idempotently (CONTRACTS §4, M16):
   * atomic claim (pending→sending) → decrypt in memory → provider.send(idempotencyKey) →
   * status + provider_message_id → mirror into messages(out) → plaintext purged (sink).
   * A row that errors is marked failed (stable token), never silently re-sent.
   */
  async processOneOutbound(): Promise<boolean> {
    const { userId, provider, sink, encryptor } = this.deps;
    const row = await sink.claimOutbound(userId);
    if (!row) return false;

    try {
      const toChannelUserId = await encryptor.decrypt(userId, row.toChannelUserIdEnc);
      const text = row.bodyEnc ? await encryptor.decrypt(userId, row.bodyEnc) : undefined;
      // attachment_enc holds a ciphertext of JSON.stringify(meta) (shared's Encryptor seam).
      const attachments = row.attachmentEnc
        ? (JSON.parse(await encryptor.decrypt(userId, row.attachmentEnc)) as OutboundAttachment[])
        : undefined;

      const msg: OutboundMessage = {
        channel: provider.channel,
        toChannelUserId,
        text,
        attachments,
        idempotencyKey: row.idempotencyKey,
      };

      const result = await provider.send(userId, msg);
      if (result.ok && result.providerMessageId) {
        // threadKey is the same channel-namespaced key inbound uses, so the reply lands in-thread.
        await sink.markOutboundSent(row.id, result.providerMessageId, {
          userId,
          channel: provider.channel,
          threadKey: `${provider.channel}:${toChannelUserId}`,
          bodyEnc: row.bodyEnc,
          contentType: attachments?.length ? attachments[0]!.kind : 'text',
          attachmentUrl: attachments?.length
            ? `${attachments[0]!.storageBucket}/${attachments[0]!.storagePath}`
            : undefined,
          sentAt: new Date().toISOString(),
        });
      } else {
        await sink.markOutboundFailed(row.id, result.error ?? 'send_failed');
      }
    } catch (err) {
      // Decrypt/parse/transport fault → mark failed with a stable token (never the raw error).
      await sink.markOutboundFailed(row.id, errorToken(err));
      log.error({ event: 'outbound.failed', userId, channel: provider.channel, errorCode: errorToken(err) });
    }
    return true;
  }
}
