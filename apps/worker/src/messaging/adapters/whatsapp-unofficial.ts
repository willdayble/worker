// WhatsAppUnofficialProvider — Baileys (WhatsApp multi-device "linked device") adapter.
//
// ⚠️ KILL-TEST DEFERRED BY OPERATOR DECISION (2026-06-15). The project gates this path behind a
// survivability kill-test verdict (docs/killtest/results.md — still PENDING) AND the
// ENABLE_WHATSAPP_UNOFFICIAL flag. Per an explicit operator call, we implement the adapter now to
// PROVE the CRM can bridge WhatsApp at all (feasibility), treating ban-survivability as separate
// later work. The FLAG-LOCK REMAINS: this only runs when ENABLE_WHATSAPP_UNOFFICIAL === 'true'.
// Ban risk is knowingly accepted, for proof-of-concept on operator-owned / throwaway numbers.
//
// Design mirrors TelegramProvider: the adapter does provider I/O + normalization ONLY; encryption
// + persistence happen in the worker wiring (SessionRuntime + sink) via the onInbound handler and
// the bridge_outbound drain. The Baileys session is persisted ENCRYPTED in wa_auth_state
// (creds_enc/keys_enc) so it survives restarts (no re-pair per deploy). Pairing uses WhatsApp's
// phone pairing-code (WHATSAPP_PAIR_NUMBER); the code is surfaced on channels.pair_code, NEVER
// logged (CONTRACTS §4). Ported from the proven first_attempt/whatsapp-bridge patterns
// (initAuthCreds + BufferJSON), adapted to the new architecture + encrypted at rest.
//
// PoC scope: text in/out + pairing + reconnect. Deferred: media download, history backfill.

import * as Baileys from '@whiskeysockets/baileys';
import type { SupabaseClient } from '@supabase/supabase-js';

// Baileys ships CommonJS; under NodeNext its default export (the socket factory) doesn't type as
// callable through a default import, so reach it via the namespace + cast (runtime-safe either way).
const makeWASocket = ((Baileys as any).default ?? Baileys) as (config: any) => any;
const {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  initAuthCreds,
  BufferJSON,
} = Baileys as any;
import type {
  Channel, ConnState, InboundMessage, MessagingProvider,
  OutboundMessage, ProviderCapabilities, SendResult,
} from '@workerchat/shared';
import type { ChannelStatePatch } from '../../core/sink.js';
import type { Encryptor } from '../../core/crypto.js';
import { log, errorToken } from '../../core/logger.js';
import { isUnofficialWhatsAppEnabled } from '../../core/flags.js';

const GATED = 'whatsapp_unofficial_gated_on_killtest_verdict';

type WASocketT = any;

export interface WhatsAppUnofficialDeps {
  /** service_role client — for wa_auth_state (session blobs) + resolving the channels row id. */
  sb: SupabaseClient;
  /** Encrypts the session blobs at rest (same Encryptor the worker uses everywhere). */
  encryptor: Encryptor;
  /** Surfaces ConnState / pair-code / qr onto the channels row for the CRM (Realtime, C6). */
  writeChannelState: (userId: string, channel: Channel, patch: ChannelStatePatch) => Promise<void>;
  /** Digits of the WhatsApp number to link (e.g. '61412345678'), for phone pairing-code login. */
  pairNumber?: string;
}

interface Session { sock: WASocketT; state: ConnState; ownId?: string; }

// Baileys wants a pino-shaped logger; a silent stub avoids the pino dep AND keeps provider
// chatter out of stdout (CONTRACTS §4). It must implement child()/level methods Baileys calls.
const silentLogger: any = {
  level: 'silent',
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
  child() { return silentLogger; },
};

const jidToDigits = (jid: string): string => (jid.split('@')[0] ?? '').split(':')[0] ?? '';
const digitsToJid = (digits: string): string => `${digits.replace(/\D/g, '')}@s.whatsapp.net`;

export class WhatsAppUnofficialProvider implements MessagingProvider {
  readonly channel: Channel = 'whatsapp_unofficial';

  readonly capabilities: ProviderCapabilities = {
    historySyncDays: 0,            // history backfill deferred (PoC)
    historySyncMode: 'none',
    mediaSync: false,              // media download deferred (PoC: text + bracket placeholders)
    requires24hWindow: false,
    groups: false,
    echoesOwnDeviceMessages: true, // Baileys delivers own-device sends; we drop fromMe (mirrored separately)
    deliveryReceipts: true,
    readReceipts: false,
    connectMethod: 'pair_code',
  };

  private readonly sessions = new Map<string, Session>();
  private inboundHandler?: (m: InboundMessage) => Promise<void>;

  constructor(private readonly deps: WhatsAppUnofficialDeps) {
    if (!isUnofficialWhatsAppEnabled()) throw new Error(GATED); // flag-lock stays (see header)
  }

  onInbound(handler: (m: InboundMessage) => Promise<void>): void {
    this.inboundHandler = handler;
  }

  async connect(userId: string): Promise<{ state: ConnState }> {
    await this.deps.writeChannelState(userId, this.channel, { state: 'connecting' });

    const channelId = await this.resolveChannelId(userId);
    if (!channelId) {
      await this.deps.writeChannelState(userId, this.channel, { state: 'error', lastError: 'no_channel_row' });
      log.error({ event: 'whatsapp.connect.failed', userId, channel: this.channel, errorCode: 'no_channel_row' });
      return { state: 'error' };
    }

    const { state, saveCreds } = await this.makeAuthState(userId, channelId);

    let version: [number, number, number] | undefined;
    try { ({ version } = await fetchLatestBaileysVersion()); }
    catch { /* fall back to Baileys' bundled default version */ }

    const sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: state,
      logger: silentLogger,
      browser: ['WorkerChat', 'Chrome', '3.0'] as [string, string, string],
      markOnlineOnConnect: false,
    });
    this.sessions.set(userId, { sock, state: 'connecting' });
    sock.ev.on('creds.update', saveCreds);

    let pairingRequested = false;
    sock.ev.on('connection.update', async (u: any) => {
      const { connection, lastDisconnect, qr } = u;

      // Pairing: when the QR window first opens and the account isn't yet linked, request a phone
      // pairing-code (entered in WhatsApp → Linked Devices → "Link with phone number instead").
      if (qr && !pairingRequested && !state.creds.registered) {
        pairingRequested = true;
        if (this.deps.pairNumber) {
          try {
            const code = await sock.requestPairingCode(this.deps.pairNumber.replace(/\D/g, ''));
            // Code is sensitive auth UX → surface on the channels row, NEVER to logs (§4).
            await this.deps.writeChannelState(userId, this.channel, { state: 'pairing', pairCode: code, qr: null });
            log.info({ event: 'whatsapp.pairing.code_ready', userId, channel: this.channel });
          } catch (err) {
            await this.deps.writeChannelState(userId, this.channel, { state: 'error', lastError: 'pairing_failed' });
            log.error({ event: 'whatsapp.pairing.failed', userId, channel: this.channel, errorCode: errorToken(err) });
          }
        } else {
          // No pair number → surface the QR string for an in-CRM connect screen to render.
          await this.deps.writeChannelState(userId, this.channel, { state: 'pairing', qr });
          log.info({ event: 'whatsapp.qr.ready', userId, channel: this.channel });
        }
      }

      if (connection === 'open') {
        const ownId = sock.user?.id ? jidToDigits(sock.user.id) : undefined;
        const sess = this.sessions.get(userId);
        if (sess) { sess.state = 'connected'; sess.ownId = ownId; }
        await this.deps.writeChannelState(userId, this.channel, {
          state: 'connected', channelUserId: ownId, qr: null, pairCode: null,
          connectedAt: new Date().toISOString(),
        });
        log.info({ event: 'whatsapp.connected', userId, channel: this.channel, channelUserId: ownId });
      }

      if (connection === 'close') {
        const code = (lastDisconnect?.error as any)?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        const sess = this.sessions.get(userId);
        if (sess) sess.state = loggedOut ? 'logged_out' : 'reconnecting';
        await this.deps.writeChannelState(userId, this.channel, {
          state: loggedOut ? 'logged_out' : 'reconnecting',
          disconnectReason: loggedOut ? 'logged_out' : 'network',
          lastError: typeof code === 'number' ? `close_${code}` : null,
        });
        log.warn({
          event: 'whatsapp.closed', userId, channel: this.channel,
          errorCode: typeof code === 'number' ? `close_${code}` : 'unknown',
        });

        this.sessions.delete(userId);
        if (loggedOut) {
          await this.clearAuthState(channelId);   // drop the dead session so the next connect re-pairs
        } else {
          // Transient close → auto-reconnect (re-loads the persisted session; no re-pair).
          setTimeout(() => {
            void this.connect(userId).catch((e) =>
              log.error({ event: 'whatsapp.reconnect.failed', userId, channel: this.channel, errorCode: errorToken(e) }));
          }, 5000);
        }
      }
    });

    sock.ev.on('messages.upsert', async (ev: any) => {
      if (ev.type !== 'notify') return;
      for (const msg of ev.messages ?? []) {
        try {
          const norm = this.normalize(msg);
          if (norm) await this.inboundHandler?.(norm);
        } catch (err) {
          log.error({ event: 'whatsapp.inbound.failed', userId, channel: this.channel, errorCode: errorToken(err) });
        }
      }
    });

    return { state: 'connecting' };
  }

  async getStatus(userId: string): Promise<{ state: ConnState; channelUserId?: string }> {
    const s = this.sessions.get(userId);
    return s ? { state: s.state, channelUserId: s.ownId } : { state: 'disconnected' };
  }

  async send(userId: string, msg: OutboundMessage): Promise<SendResult> {
    const sess = this.sessions.get(userId);
    if (!sess || sess.state !== 'connected') {
      return { ok: false, status: 'failed', windowState: 'n/a', error: 'not_connected' };
    }
    if (!msg.text) {
      // PoC: text only. Media outbound is deferred (capabilities.mediaSync = false).
      return { ok: false, status: 'failed', windowState: 'n/a', error: 'media_unsupported_poc' };
    }
    try {
      const sent = await sess.sock.sendMessage(digitsToJid(msg.toChannelUserId), { text: msg.text });
      const providerMessageId = sent?.key?.id ?? undefined;
      if (!providerMessageId) return { ok: false, status: 'failed', windowState: 'n/a', error: 'no_message_id' };
      log.info({
        event: 'whatsapp.sent', userId, channel: this.channel,
        channelUserId: msg.toChannelUserId, providerMessageId,
      });
      return { ok: true, providerMessageId, status: 'sent', windowState: 'n/a' };
    } catch (err) {
      const errCode = errorToken(err);
      log.error({ event: 'whatsapp.send.failed', userId, channel: this.channel, errorCode: errCode });
      return { ok: false, status: 'failed', windowState: 'n/a', error: errCode };
    }
  }

  // History backfill is deferred (PoC) — live messages onward only.
  async syncHistory(): Promise<{ done: boolean; cursor?: string; imported: number }> {
    return { done: true, imported: 0 };
  }

  async disconnect(userId: string): Promise<void> {
    const s = this.sessions.get(userId);
    if (s) {
      try { s.sock.end(undefined); } catch { /* already closed */ }
      this.sessions.delete(userId);
    }
    await this.deps.writeChannelState(userId, this.channel, { state: 'disconnected' });
    log.info({ event: 'whatsapp.disconnected', userId, channel: this.channel });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Map a Baileys message → channel-agnostic InboundMessage. Returns null to skip. */
  private normalize(msg: any): InboundMessage | null {
    const jid: string | undefined = msg?.key?.remoteJid;
    if (!jid) return null;
    if (jid.endsWith('@g.us') || jid === 'status@broadcast') return null; // groups/status: out of scope
    if (msg.key?.fromMe) return null;       // our own sends are mirrored separately by the runtime
    if (!msg.message) return null;
    const digits = jidToDigits(jid);
    if (!/^\d{7,15}$/.test(digits)) return null;

    const m = msg.message;
    const text: string | undefined =
      m.conversation ??
      m.extendedTextMessage?.text ??
      m.imageMessage?.caption ??
      m.videoMessage?.caption ??
      (m.imageMessage ? '[image]'
        : m.videoMessage ? '[video]'
        : m.audioMessage ? '[audio]'
        : m.documentMessage ? '[document]'
        : m.stickerMessage ? '[sticker]'
        : m.locationMessage ? '[location]'
        : undefined);
    if (!text) return null;

    const tsRaw = msg.messageTimestamp;
    const tsSec = typeof tsRaw === 'number' ? tsRaw : Number(tsRaw ?? 0);
    const timestamp = tsSec ? new Date(tsSec * 1000).toISOString() : new Date().toISOString();

    return {
      channel: this.channel,
      providerMessageId: String(msg.key?.id ?? ''),
      from: {
        channel: this.channel,
        channelUserId: digits,
        phoneE164: `+${digits}`,
        displayName: typeof msg.pushName === 'string' ? msg.pushName : undefined,
      },
      threadKey: `${this.channel}:${digits}`,
      text,
      timestamp,
      fromMe: false,
    };
  }

  private async resolveChannelId(userId: string): Promise<string | null> {
    const { data } = await this.deps.sb
      .from('channels').select('id')
      .eq('user_id', userId).eq('channel', this.channel).maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  }

  private async clearAuthState(channelId: string): Promise<void> {
    try { await this.deps.sb.from('wa_auth_state').delete().eq('channel_id', channelId); }
    catch { /* best-effort */ }
  }

  /**
   * Supabase-backed Baileys auth state, encrypted at rest in wa_auth_state (creds_enc/keys_enc).
   * Ported from first_attempt's makeSupabaseAuthState (initAuthCreds + BufferJSON), with both
   * blobs run through the worker's Encryptor before they touch the DB (CONTRACTS §5). The
   * `creds` object is mutated in place by Baileys, then re-serialized on every creds.update.
   */
  private async makeAuthState(
    userId: string,
    channelId: string,
  ): Promise<{ state: any; saveCreds: () => Promise<void> }> {
    const { sb, encryptor } = this.deps;
    const { data } = await sb
      .from('wa_auth_state').select('creds_enc, keys_enc')
      .eq('channel_id', channelId).maybeSingle();
    const row = data as { creds_enc?: string | null; keys_enc?: string | null } | null;

    const creds = row?.creds_enc
      ? JSON.parse(await encryptor.decrypt(userId, row.creds_enc), BufferJSON.reviver)
      : initAuthCreds();
    const keysMap: Record<string, Record<string, any>> = row?.keys_enc
      ? JSON.parse(await encryptor.decrypt(userId, row.keys_enc))
      : {};

    const keyStore: any = {
      get: async (type: string, ids: string[]) => {
        const out: Record<string, any> = {};
        for (const id of ids) {
          const raw = keysMap[type]?.[id];
          if (raw !== undefined) out[id] = JSON.parse(JSON.stringify(raw), BufferJSON.reviver);
        }
        return out;
      },
      set: async (data: Record<string, Record<string, any>>) => {
        for (const [type, map] of Object.entries(data)) {
          keysMap[type] = keysMap[type] ?? {};
          for (const [id, val] of Object.entries(map)) {
            if (val) keysMap[type]![id] = JSON.parse(JSON.stringify(val, BufferJSON.replacer));
            else delete keysMap[type]![id];
          }
        }
      },
    };

    const state = { creds, keys: makeCacheableSignalKeyStore(keyStore, silentLogger) };

    const saveCreds = async (): Promise<void> => {
      try {
        const credsEnc = await encryptor.encrypt(userId, JSON.stringify(creds, BufferJSON.replacer));
        const keysEnc = await encryptor.encrypt(userId, JSON.stringify(keysMap));
        await sb.from('wa_auth_state').upsert({
          channel_id: channelId, user_id: userId,
          creds_enc: credsEnc, keys_enc: keysEnc, updated_at: new Date().toISOString(),
        }, { onConflict: 'channel_id' });
      } catch (err) {
        log.error({ event: 'whatsapp.savecreds.failed', userId, channel: this.channel, errorCode: errorToken(err) });
      }
    };

    return { state, saveCreds };
  }
}
