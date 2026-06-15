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

// Baileys ships CommonJS. Under NodeNext the socket factory is the NAMED export `makeWASocket`
// (verified a function against 6.7.18); the `default` is the module object (not callable). Prefer
// the named export, fall back to the nested default for forward-compat.
const makeWASocket = ((Baileys as any).makeWASocket ?? (Baileys as any).default?.default) as (config: any) => any;
const {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  initAuthCreds,
  BufferJSON,
  downloadMediaMessage,
} = Baileys as any;
import type {
  Channel, ConnState, InboundAttachment, InboundMessage, MessagingProvider,
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
  /** Surfaces ConnState / qr onto the channels row for the CRM to render (Realtime, C6). */
  writeChannelState: (userId: string, channel: Channel, patch: ChannelStatePatch) => Promise<void>;
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
// A stored channelUserId is routed verbatim when it's already a full JID (e.g. a LID `<id>@lid`, so
// the reply reaches the exact sender); bare digits are a phone → `<digits>@s.whatsapp.net`.
const toJid = (id: string): string => (id.includes('@') ? id : `${id.replace(/\D/g, '')}@s.whatsapp.net`);

export class WhatsAppUnofficialProvider implements MessagingProvider {
  readonly channel: Channel = 'whatsapp_unofficial';

  readonly capabilities: ProviderCapabilities = {
    historySyncDays: 0,            // history backfill deferred (PoC)
    historySyncMode: 'none',
    mediaSync: false,              // media download deferred (PoC: text + bracket placeholders)
    requires24hWindow: false,
    groups: false,
    echoesOwnDeviceMessages: true, // Baileys delivers own-device sends → ingested as outbound (deduped by provider id)
    deliveryReceipts: true,
    readReceipts: false,
    connectMethod: 'qr',
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

    sock.ev.on('connection.update', async (u: any) => {
      const { connection, lastDisconnect, qr } = u;

      // QR pairing, fully app-driven (no number/env): Baileys rotates the QR ~every 20s until it's
      // scanned. Surface EACH one on the channels row so the in-CRM Connect screen renders the
      // current code; the user scans it in WhatsApp → Linked Devices → Link a Device.
      if (qr && !state.creds.registered) {
        await this.deps.writeChannelState(userId, this.channel, { state: 'pairing', qr });
        log.info({ event: 'whatsapp.qr.ready', userId, channel: this.channel });
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
          const norm = await this.toInbound(userId, sock, msg);
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
      const sent = await sess.sock.sendMessage(toJid(msg.toChannelUserId), { text: msg.text });
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
  private async toInbound(userId: string, sock: WASocketT, msg: any): Promise<InboundMessage | null> {
    const jid: string | undefined = msg?.key?.remoteJid;
    if (!jid) return null;
    if (jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter')) return null; // groups/status/channels: out of scope
    if (!msg.message) return null;

    // Own-device send (typed in WhatsApp directly, not via the CRM) → mirror as OUTBOUND so the CRM
    // shows the full thread. Deduped against CRM-originated sends by provider_message_id (sink).
    const fromMe = Boolean(msg.key?.fromMe);

    // Identity = the OTHER party (for fromMe, remoteJid is the recipient). WhatsApp addresses many
    // 1:1 chats by LID (`<id>@lid`) for privacy; the phone is NOT derivable on baileys 6.7.18. For a
    // phone JID store bare digits (+E164); for a LID preserve the full `<id>@lid` so replies route
    // back to the SAME person (no fabricated number — the cause of the earlier wrong-number bug).
    const at = jid.indexOf('@');
    const local = (at >= 0 ? jid.slice(0, at) : jid).split(':')[0] ?? '';
    const server = at >= 0 ? jid.slice(at + 1) : '';
    let channelUserId: string;
    let phoneE164: string | undefined;
    if (server === 's.whatsapp.net') {
      if (!/^\d{7,15}$/.test(local)) return null;
      channelUserId = local;
      phoneE164 = `+${local}`;
    } else if (server === 'lid') {
      channelUserId = `${local}@lid`;
      phoneE164 = undefined;
    } else {
      return null; // unknown addressing — skip
    }

    const m = msg.message;
    const providerMessageId = String(msg.key?.id ?? '');
    let text: string | undefined;
    let attachments: InboundAttachment[] | undefined;

    // Pick a downloadable media node (if any). All media uses the same Baileys download path; we
    // just record the kind so the CRM renders it (image/sticker → <img>, video → <video>, audio/
    // voice → <audio>, document → download link). Download failure falls back to a [kind] placeholder.
    const media: { node: any; kind: InboundAttachment['kind'] } | null =
      m.imageMessage ? { node: m.imageMessage, kind: 'image' }
      : m.videoMessage ? { node: m.videoMessage, kind: 'video' }
      : m.audioMessage ? { node: m.audioMessage, kind: 'audio' }
      : m.documentMessage ? { node: m.documentMessage, kind: 'document' }
      : m.stickerMessage ? { node: m.stickerMessage, kind: 'sticker' }
      : null;

    if (media) {
      const path = await this.storeMedia(userId, sock, msg, providerMessageId, media.node.mimetype);
      if (path) {
        attachments = [{ kind: media.kind, mimeType: media.node.mimetype ?? undefined, url: path }];
        // Caption (image/video) or the file name (document) becomes the message body.
        const cap =
          media.kind === 'document'
            ? media.node.caption || media.node.fileName || media.node.title
            : media.node.caption;
        text = typeof cap === 'string' && cap ? cap : undefined;
      } else {
        text = `[${media.kind}]`;
      }
    } else {
      text =
        m.conversation ??
        m.extendedTextMessage?.text ??
        (m.locationMessage ? '[location]' : undefined);
    }
    if (!text && !attachments) return null;

    const tsRaw = msg.messageTimestamp;
    const tsSec = typeof tsRaw === 'number' ? tsRaw : Number(tsRaw ?? 0);
    const timestamp = tsSec ? new Date(tsSec * 1000).toISOString() : new Date().toISOString();

    return {
      channel: this.channel,
      providerMessageId,
      from: {
        channel: this.channel,
        channelUserId,
        phoneE164,
        // pushName on a fromMe echo is OUR name, not the contact's — only trust it for inbound.
        displayName: !fromMe && typeof msg.pushName === 'string' ? msg.pushName : undefined,
      },
      threadKey: `${this.channel}:${channelUserId}`,
      text,
      attachments,
      timestamp,
      fromMe,
    };
  }

  /**
   * Download (decrypt) WhatsApp media and store it in the private `inbound-media` bucket. Returns the
   * storage path (`<userId>/<msgId>.<ext>`), or null on failure. The bucket is private; the CRM
   * serves it via a short-lived signed URL. Media is NOT yet app-layer encrypted like message text
   * (tracked follow-up) — it relies on Supabase at-rest encryption + RLS + signed URLs.
   */
  private async storeMedia(
    userId: string,
    sock: WASocketT,
    msg: any,
    msgId: string,
    mimetype?: string,
  ): Promise<string | null> {
    try {
      const buffer = (await downloadMediaMessage(
        msg,
        'buffer',
        {},
        { logger: silentLogger, reuploadRequest: sock.updateMediaMessage },
      )) as Buffer;
      const subtype = (mimetype ?? 'application/octet-stream').split('/')[1]?.split(';')[0] ?? 'bin';
      const path = `${userId}/${msgId}.${subtype}`;
      const { error } = await this.deps.sb.storage
        .from('inbound-media')
        .upload(path, buffer, { contentType: mimetype ?? 'application/octet-stream', upsert: true });
      if (error) {
        log.error({ event: 'whatsapp.media.upload_failed', userId, channel: this.channel, errorCode: 'upload_error' });
        return null;
      }
      return path;
    } catch (err) {
      log.error({ event: 'whatsapp.media.download_failed', userId, channel: this.channel, errorCode: errorToken(err) });
      return null;
    }
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
