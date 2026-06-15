// SupabaseSink — the production MessageSink, backed by Supabase Postgres via the service_role
// key (CONTRACTS §3–5). Conforms to `supabase/migrations/0001_channel_contract.sql` and the
// row types in `@workerchat/shared` (db). The worker is the ONLY code using service_role;
// service_role BYPASSES RLS, so this code sets/asserts `user_id` on every write itself.
//
// ⚠️ STATUS: code-complete but NOT yet integration-tested — schema 1a is written but not applied
// to the live DB (Supabase direct host is IPv6-only from the build machine + no pooler URL;
// human applies via the dashboard SQL editor). The VERIFIED proof of the inbound→outbound loop
// is the offline round-trip against InMemorySink (telegram.roundtrip.test.ts, 12/12). When 1a is
// live, point index.ts at this sink (SUPABASE_URL set) and re-run the round-trip against real DB.
//
// Invariants it upholds (same as InMemorySink, now over Postgres):
//   • idempotent inbound upsert by (conversation_id, provider_message_id)
//   • M7 contact identity: deterministic by (user_id, channel, channel_user_id); auto-merge only
//     on exact phone_e164; never rebinds/relabels — and NEVER touches is_flagged/flag_reason_enc
//   • encrypt-before-insert for every sensitive value; operational columns stay plaintext
//   • claim-then-send is idempotent; a row is only ever claimed once (M16)
//   • no writes to CRM-owned tables (deals/tags/pipeline) — there are simply no such writes here

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Channel, MessageStatus } from '@workerchat/shared';
import type { InboundMessage } from '@workerchat/shared';
import type {
  ChannelStatePatch, MessageSink, OutboundMirror, OutboundRow,
} from '../core/sink.js';
import type { Encryptor } from '../core/crypto.js';
import { log, errorToken } from '../core/logger.js';

/** Anything supabase-js returns; we narrow at each call site. */
type PgError = { code?: string; message?: string } | null;
const UNIQUE_VIOLATION = '23505';

function fail(op: string, error: PgError): never {
  // STABLE token only — never the raw PG message (it can echo column values).
  throw Object.assign(new Error(`supabase_sink:${op}`), { code: error?.code ?? 'pg_error' });
}

export class SupabaseSink implements MessageSink {
  constructor(
    private readonly sb: SupabaseClient,
    private readonly enc: Encryptor,
  ) {}

  // ── inbound ──────────────────────────────────────────────────────────────────

  async persistInbound(userId: string, m: InboundMessage): Promise<{ conversationId: string; deduped: boolean }> {
    const contactId = await this.resolveContact(userId, m);
    const conversationId = await this.resolveConversation(userId, contactId, m);

    const firstAtt = m.attachments?.[0];
    const bodyEnc = m.text ? await this.enc.encrypt(userId, m.text) : null;

    // Idempotent insert. The UNIQUE(conversation_id, provider_message_id) makes a replay a no-op:
    // a 23505 means we've already stored this message → deduped.
    const { error } = await this.sb.from('messages').insert({
      conversation_id: conversationId,
      direction: m.fromMe ? 'out' : 'in',
      provider_message_id: m.providerMessageId,
      content_type: firstAtt ? firstAtt.kind : 'text',
      body_enc: bodyEnc,
      attachment_url: firstAtt?.url ?? null,
      is_historical: m.isHistorical ?? false,
      status: m.fromMe ? 'sent' : 'delivered',
      sent_at: m.timestamp,
    });
    if (error) {
      if ((error as PgError)?.code === UNIQUE_VIOLATION) return { conversationId, deduped: true };
      fail('insert_message', error as PgError);
    }

    // Conversation preview + last_message_at. window_expires_at only for the WA 24h window.
    const preview = m.text ?? (firstAtt ? `[${firstAtt.kind}]` : '');
    const patch: Record<string, unknown> = {
      last_message_at: m.timestamp,
      last_message_preview_enc: preview ? await this.enc.encrypt(userId, preview) : null,
    };
    if (m.channel === 'whatsapp_official' && !m.fromMe) {
      patch.window_expires_at = new Date(new Date(m.timestamp).getTime() + 24 * 3600 * 1000).toISOString();
    }
    const { error: cErr } = await this.sb.from('conversations').update(patch).eq('id', conversationId);
    if (cErr) fail('update_conversation', cErr as PgError);

    return { conversationId, deduped: false };
  }

  /** M7 contact identity. Deterministic by (user_id, channel, channel_user_id); auto-merge only on exact phone. */
  private async resolveContact(userId: string, m: InboundMessage): Promise<string> {
    const { data: link, error } = await this.sb
      .from('contact_channels')
      .select('contact_id')
      .eq('user_id', userId).eq('channel', m.channel).eq('channel_user_id', m.from.channelUserId)
      .maybeSingle();
    if (error) fail('select_contact_channel', error as PgError);
    if (link) return (link as { contact_id: string }).contact_id;

    // No link yet. Auto-merge ONLY on an exact phone_e164 match (M7); else a fresh contact.
    let contactId: string | undefined;
    if (m.from.phoneE164) {
      const { data: byPhone } = await this.sb
        .from('contact_channels').select('contact_id')
        .eq('user_id', userId).eq('phone_e164', m.from.phoneE164).limit(1).maybeSingle();
      contactId = (byPhone as { contact_id: string } | null)?.contact_id;
    }
    if (!contactId) {
      const { data: contact, error: insErr } = await this.sb
        .from('contacts')
        .insert({ user_id: userId, display_name: m.from.displayName ?? null })
        .select('id').single();
      if (insErr) fail('insert_contact', insErr as PgError);
      contactId = (contact as { id: string }).id;
    }

    const { error: ccErr } = await this.sb.from('contact_channels').insert({
      user_id: userId, contact_id: contactId, channel: m.channel,
      channel_user_id: m.from.channelUserId,
      phone_e164: m.from.phoneE164 ?? null,
      display_name: m.from.displayName ?? null,
    });
    // A concurrent insert may have created the same link (unique) — re-resolve rather than fail.
    if (ccErr && (ccErr as PgError)?.code === UNIQUE_VIOLATION) {
      const { data: again } = await this.sb.from('contact_channels').select('contact_id')
        .eq('user_id', userId).eq('channel', m.channel).eq('channel_user_id', m.from.channelUserId).single();
      return (again as { contact_id: string }).contact_id;
    }
    if (ccErr) fail('insert_contact_channel', ccErr as PgError);
    return contactId;
  }

  /** Get-or-create the conversation for this thread (UNIQUE(user_id, thread_key)). */
  private async resolveConversation(userId: string, contactId: string, m: InboundMessage): Promise<string> {
    const { data: existing, error } = await this.sb
      .from('conversations').select('id')
      .eq('user_id', userId).eq('thread_key', m.threadKey).maybeSingle();
    if (error) fail('select_conversation', error as PgError);
    if (existing) return (existing as { id: string }).id;

    const { data: created, error: insErr } = await this.sb.from('conversations').insert({
      user_id: userId, contact_id: contactId, channel: m.channel, thread_key: m.threadKey, status: 'open',
    }).select('id').single();
    if (insErr) {
      // Lost a create race → the row now exists; re-select.
      if ((insErr as PgError)?.code === UNIQUE_VIOLATION) {
        const { data: again } = await this.sb.from('conversations').select('id')
          .eq('user_id', userId).eq('thread_key', m.threadKey).single();
        return (again as { id: string }).id;
      }
      fail('insert_conversation', insErr as PgError);
    }
    return (created as { id: string }).id;
  }

  // ── outbound (claim → send happens in the runtime → mark) ──────────────────────

  /**
   * Optimistic claim: select the oldest pending row, then conditionally flip it to 'sending'.
   * The `.eq('status','pending')` on the UPDATE makes the flip atomic against another claimer —
   * if someone else won, 0 rows match and we return null. Safe (no double-send), but a
   * `FOR UPDATE SKIP LOCKED` SECURITY DEFINER RPC is the production hardening: ORCHESTRATOR
   * REQUEST to Track B for a `claim_outbound(user_id)` function (migration — A can't add it).
   */
  async claimOutbound(userId: string): Promise<OutboundRow | null> {
    const { data: cand, error } = await this.sb
      .from('bridge_outbound').select('id')
      .eq('user_id', userId).eq('status', 'pending')
      .order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (error) fail('select_outbound', error as PgError);
    if (!cand) return null;

    const id = (cand as { id: string }).id;
    const { data: claimed, error: upErr } = await this.sb
      .from('bridge_outbound')
      .update({ status: 'sending', claimed_at: new Date().toISOString() })
      .eq('id', id).eq('status', 'pending')   // conditional → lost-race yields no row
      .select('id, channel, to_channel_user_id_enc, body_enc, attachment_enc, template_enc, idempotency_key')
      .maybeSingle();
    if (upErr) fail('claim_outbound', upErr as PgError);
    if (!claimed) return null; // another worker claimed it first

    const r = claimed as Record<string, unknown>;
    return {
      id,
      userId,
      channel: r.channel as Channel,
      toChannelUserIdEnc: r.to_channel_user_id_enc as string,
      bodyEnc: (r.body_enc as string | null) ?? undefined,
      // attachment_enc/template_enc are jsonb columns holding a ciphertext string (shared's scheme).
      attachmentEnc: asCiphertext(r.attachment_enc),
      templateEnc: asCiphertext(r.template_enc),
      idempotencyKey: r.idempotency_key as string,
    };
  }

  async markOutboundSent(rowId: string, providerMessageId: string, mirror: OutboundMirror): Promise<void> {
    // Mirror into messages(out), linked to the thread's conversation (must already exist).
    const { data: conv } = await this.sb.from('conversations').select('id')
      .eq('user_id', mirror.userId).eq('thread_key', mirror.threadKey).maybeSingle();
    if (conv) {
      const { error: mErr } = await this.sb.from('messages').insert({
        conversation_id: (conv as { id: string }).id,
        direction: 'out',
        provider_message_id: providerMessageId,
        content_type: mirror.contentType,
        body_enc: mirror.bodyEnc ?? null,
        attachment_url: mirror.attachmentUrl ?? null,
        status: 'sent',
        sent_at: mirror.sentAt,
      });
      // A duplicate mirror (idempotency replay) is fine; only real errors surface.
      if (mErr && (mErr as PgError)?.code !== UNIQUE_VIOLATION) fail('mirror_outbound', mErr as PgError);
    } else {
      log.warn({ event: 'outbound.mirror.no_conversation', userId: mirror.userId, channel: mirror.channel, threadKey: mirror.threadKey });
    }

    // Mark sent + purge the ciphertext payload (data minimization; to_channel_user_id_enc is
    // NOT NULL so it stays, but the body/attachment/template ciphertext is nulled once delivered).
    const { error } = await this.sb.from('bridge_outbound').update({
      status: 'sent', provider_message_id: providerMessageId,
      body_enc: null, attachment_enc: null, template_enc: null,
    }).eq('id', rowId);
    if (error) fail('mark_sent', error as PgError);
  }

  async markOutboundFailed(rowId: string, errorCode: string): Promise<void> {
    const { error } = await this.sb.from('bridge_outbound')
      .update({ status: 'failed', error: errorCode }).eq('id', rowId);
    if (error) fail('mark_failed', error as PgError);
  }

  // ── channel state + status webhooks ────────────────────────────────────────────

  async writeChannelState(userId: string, channel: Channel, patch: ChannelStatePatch): Promise<void> {
    // No UNIQUE(user_id, channel) in 1a, so find-then-update/insert rather than upsert.
    const row: Record<string, unknown> = { state_updated_at: new Date().toISOString() };
    if (patch.state !== undefined) row.state = patch.state;
    if (patch.channelUserId !== undefined) row.channel_user_id = patch.channelUserId;
    if (patch.qr !== undefined) row.qr = patch.qr;
    if (patch.pairCode !== undefined) row.pair_code = patch.pairCode;
    if (patch.lastError !== undefined) row.last_error = patch.lastError;
    if (patch.disconnectReason !== undefined) row.disconnect_reason = patch.disconnectReason;
    if (patch.historySyncState !== undefined) row.history_sync_state = patch.historySyncState;
    if (patch.connectedAt !== undefined) row.connected_at = patch.connectedAt;

    const { data: existing, error } = await this.sb.from('channels').select('id')
      .eq('user_id', userId).eq('channel', channel).maybeSingle();
    if (error) fail('select_channel', error as PgError);

    if (existing) {
      const { error: uErr } = await this.sb.from('channels').update(row).eq('id', (existing as { id: string }).id);
      if (uErr) fail('update_channel', uErr as PgError);
    } else {
      const { error: iErr } = await this.sb.from('channels').insert({ user_id: userId, channel, ...row });
      if (iErr) fail('insert_channel', iErr as PgError);
    }
  }

  async updateMessageStatus(providerMessageId: string, status: MessageStatus): Promise<void> {
    const { error } = await this.sb.from('messages')
      .update({ status, status_updated_at: new Date().toISOString() })
      .eq('provider_message_id', providerMessageId);
    if (error) {
      // Status for an unknown message id is non-fatal — log a token and move on.
      log.warn({ event: 'status.update.failed', providerMessageId, status, errorCode: errorToken(error) });
    }
  }
}

/** A jsonb `*_enc` column may come back as a string (the ciphertext) or null. Normalize to string|undefined. */
function asCiphertext(v: unknown): string | undefined {
  if (v == null) return undefined;
  return typeof v === 'string' ? v : JSON.stringify(v);
}
