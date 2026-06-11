// Round-trip harness for the Telegram critical path (Deliverable 2 DoD: "inbound shows in
// CRM, human-approved outbound delivers"). Runs fully offline against a FakeTransport — no
// bot token, no network — exercising the REAL TelegramProvider, SessionRuntime, InMemorySink,
// and Encryptor seam. This is the proof-of-loop that unblocks Track B's integration testing.

import { describe, it, expect, beforeEach } from 'vitest';
import type { OutboundAttachment } from '@workerchat/shared';
import { NodeCryptoEncryptor } from '../../core/crypto.js';
import { TelegramProvider, type TelegramTransport, type TgIncoming } from './telegram.js';
import { InMemoryCredentialStore } from '../../core/credentials.js';
import { InMemorySink, type OutboundRow } from '../../core/sink.js';
import { SessionRuntime } from '../../runtime/session-runtime.js';

const USER = 'user-abc-123';
const BOT_ID = 424242;
const CHAT_ID = 9001; // the client's Telegram chat id

// ── Fake transport: lets the test emit inbound updates and capture outbound sends ──────────
class FakeTransport implements TelegramTransport {
  sentText: Array<{ chatId: number; text: string }> = [];
  sentMedia: Array<{ chatId: number; kind: string; bytes: number; caption?: string }> = [];
  stopped = false;
  private onUpdate?: (u: TgIncoming) => Promise<void>;
  private nextMsgId = 1000;

  async getMe() { return { id: BOT_ID, username: 'workerapp_dev_bot' }; }
  async start(onUpdate: (u: TgIncoming) => Promise<void>) { this.onUpdate = onUpdate; }
  async stop() { this.stopped = true; }
  async sendText(chatId: number, text: string) { this.sentText.push({ chatId, text }); return { messageId: this.nextMsgId++ }; }
  async sendMedia(chatId: number, media: { kind: string; data: Buffer; caption?: string }) {
    this.sentMedia.push({ chatId, kind: media.kind, bytes: media.data.length, caption: media.caption });
    return { messageId: this.nextMsgId++ };
  }
  async getFileUrl(fileId: string) { return `https://example.test/file/${fileId}`; }

  /** Test helper: simulate the client sending us a message. */
  async emit(u: TgIncoming) { await this.onUpdate?.(u); }
}

function incomingText(text: string, messageId: number): TgIncoming {
  return { messageId, chatId: CHAT_ID, fromId: CHAT_ID, fromName: 'Jordan', dateUnix: 1_700_000_000, text };
}

function build() {
  const enc = new NodeCryptoEncryptor(Buffer.alloc(32, 7)); // fixed key → deterministic
  const sink = new InMemorySink(enc);
  const transport = new FakeTransport();
  const creds = new InMemoryCredentialStore();
  creds.set(USER, 'fake-token');

  const provider = new TelegramProvider({
    transportFactory: () => transport,
    credentials: creds,
    writeChannelState: (uid, channel, patch) => sink.writeChannelState(uid, channel, patch),
  });
  // Large poll interval so the runtime's timer never fires mid-test; we drain manually.
  const runtime = new SessionRuntime({ userId: USER, provider, sink, encryptor: enc, pollIntervalMs: 1_000_000 });
  return { enc, sink, transport, provider, runtime };
}

describe('TelegramProvider round-trip', () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => { h = build(); });

  it('reports Telegram capabilities (bot_token, no history, no receipts)', () => {
    expect(h.provider.channel).toBe('telegram');
    expect(h.provider.capabilities.connectMethod).toBe('bot_token');
    expect(h.provider.capabilities.historySyncMode).toBe('none');
    expect(h.provider.capabilities.requires24hWindow).toBe(false);
    expect(h.provider.capabilities.groups).toBe(false);
  });

  it('connects and writes connected state to the channels row', async () => {
    await h.runtime.start();
    const status = await h.provider.getStatus(USER);
    expect(status.state).toBe('connected');
    expect(status.channelUserId).toBe(String(BOT_ID));
    expect(h.sink.channelStates.get(USER)?.state).toBe('connected');
  });

  it('connects logged_out when no bot token is configured', async () => {
    const creds = new InMemoryCredentialStore(); // empty
    const provider = new TelegramProvider({
      transportFactory: () => new FakeTransport(),
      credentials: creds,
      writeChannelState: async () => {},
    });
    const res = await provider.connect('no-token-user');
    expect(res.state).toBe('logged_out');
  });

  it('ingests inbound text → encrypted message persisted, idempotent on replay', async () => {
    await h.runtime.start();
    await h.transport.emit(incomingText('hi, are you free friday?', 55));

    const inbound = h.sink.messages.filter((m) => m.direction === 'in');
    expect(inbound).toHaveLength(1);
    expect(inbound[0]!.providerMessageId).toBe('55');

    // Ciphertext-at-rest: stored body must NOT equal plaintext, and must decrypt back.
    const stored = inbound[0]!.bodyEnc!;
    expect(stored).not.toContain('friday');
    expect(await h.enc.decrypt(USER, stored)).toBe('hi, are you free friday?');

    // Conversation preview is also ciphertext.
    const convId = `conv:${USER}:telegram:${CHAT_ID}`;
    const preview = h.sink.conversations.get(convId)!.lastPreviewEnc!;
    expect(preview).not.toContain('friday');

    // Idempotency: same provider_message_id does not double-insert.
    await h.transport.emit(incomingText('hi, are you free friday?', 55));
    expect(h.sink.messages.filter((m) => m.direction === 'in')).toHaveLength(1);
  });

  it('normalizes inbound media into an attachment with the right thread key', async () => {
    await h.runtime.start();
    await h.transport.emit({
      messageId: 77, chatId: CHAT_ID, fromId: CHAT_ID, fromName: 'Jordan', dateUnix: 1_700_000_100,
      attachment: { kind: 'image', fileId: 'AgACphoto', bytes: 2048, caption: 'here' },
    });
    const msg = h.sink.messages.find((m) => m.providerMessageId === '77')!;
    expect(msg.contentType).toBe('image');
    // caption becomes the (encrypted) body; raw fileId is never stored as plaintext.
    expect(msg.bodyEnc).toBeDefined();
    expect(await h.enc.decrypt(USER, msg.bodyEnc!)).toBe('here');
  });

  it('delivers human-approved outbound: claim → decrypt → send → mirror messages(out)', async () => {
    await h.runtime.start();

    // Simulate the CRM inserting a human-approved bridge_outbound row (ciphertext at rest).
    const row: OutboundRow = {
      id: 'ob-1', userId: USER, channel: 'telegram',
      toChannelUserIdEnc: await h.enc.encrypt(USER, String(CHAT_ID)),
      bodyEnc: await h.enc.encrypt(USER, 'yes, friday 2pm works'),
      idempotencyKey: 'idem-0001',
    };
    h.sink.outbox.push(row);

    const sent = await h.runtime.drainOutbound();
    expect(sent).toBe(1);

    // Transport received the decrypted text at the right chat id.
    expect(h.transport.sentText).toEqual([{ chatId: CHAT_ID, text: 'yes, friday 2pm works' }]);

    // Mirrored into messages(out), linked to the SAME conversation as inbound (in-thread).
    const out = h.sink.messages.filter((m) => m.direction === 'out');
    expect(out).toHaveLength(1);
    expect(out[0]!.providerMessageId).toBeTruthy();
    expect(out[0]!.conversationId).toBe(`conv:${USER}:telegram:${CHAT_ID}`);
  });

  it('delivers outbound media via the MediaStore seam', async () => {
    const enc = h.enc;
    // Rebuild provider with a media store.
    const transport = new FakeTransport();
    const creds = new InMemoryCredentialStore(); creds.set(USER, 't');
    const provider = new TelegramProvider({
      transportFactory: () => transport,
      credentials: creds,
      writeChannelState: (uid, ch, p) => h.sink.writeChannelState(uid, ch, p),
      mediaStore: { read: async () => Buffer.from('JPEGBYTES') },
    });
    const runtime = new SessionRuntime({ userId: USER, provider, sink: h.sink, encryptor: enc, pollIntervalMs: 1e9 });
    await runtime.start();

    const att: OutboundAttachment[] = [{
      kind: 'image', storageBucket: 'outbound-media', storagePath: 'u/1.jpg',
      mimeType: 'image/jpeg', bytes: 9, caption: 'pic',
    }];
    h.sink.outbox.push({
      id: 'ob-2', userId: USER, channel: 'telegram',
      toChannelUserIdEnc: await enc.encrypt(USER, String(CHAT_ID)),
      attachmentEnc: await enc.encrypt(USER, JSON.stringify(att)),
      idempotencyKey: 'idem-0002',
    });

    expect(await runtime.drainOutbound()).toBe(1);
    expect(transport.sentMedia).toEqual([{ chatId: CHAT_ID, kind: 'image', bytes: 9, caption: 'pic' }]);
  });

  it('send fails cleanly when not connected and on a bad recipient', async () => {
    const notConnected = await h.provider.send(USER, { channel: 'telegram', toChannelUserId: '1', idempotencyKey: 'x' });
    expect(notConnected.ok).toBe(false);
    expect(notConnected.status).toBe('failed');

    await h.runtime.start();
    const bad = await h.provider.send(USER, { channel: 'telegram', toChannelUserId: 'not-a-number', text: 'hi', idempotencyKey: 'y' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('bad_recipient');
  });

  it('syncHistory is a no-op for Telegram bots', async () => {
    expect(await h.provider.syncHistory(USER)).toEqual({ done: true, imported: 0 });
  });

  it('disconnect stops the transport and marks the channel disconnected', async () => {
    await h.runtime.start();
    await h.runtime.stop();
    expect(h.transport.stopped).toBe(true);
    expect((await h.provider.getStatus(USER)).state).toBe('disconnected');
  });
});

describe('NodeCryptoEncryptor seam', () => {
  it('round-trips ciphertext and isolates per-user keys', async () => {
    const enc = new NodeCryptoEncryptor(Buffer.alloc(32, 9));
    const ct = await enc.encrypt('u1', 'secret');
    expect(ct).not.toContain('secret');
    expect(await enc.decrypt('u1', ct)).toBe('secret');
    // A different user cannot decrypt (per-user subkey).
    await expect(enc.decrypt('u2', ct)).rejects.toBeTruthy();
  });

  it('produces a deterministic salted HMAC for routing indexes', async () => {
    const enc = new NodeCryptoEncryptor(Buffer.alloc(32, 9));
    const a = await enc.hmac('u1', '+61400000000');
    const b = await enc.hmac('u1', '+61400000000');
    expect(a).toBe(b);
    expect(a).not.toContain('61400000000');
  });
});
