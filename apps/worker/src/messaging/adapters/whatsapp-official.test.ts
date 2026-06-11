// WhatsAppOfficialProvider tests — webhook ingest (text / Coexistence echo / media / status),
// send paths (text / template / window-closed / media), connect state, and signature verification.
// Fully offline: a FakeCloudTransport + captured Cloud API webhook fixtures. No network, no Meta.

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import type { InboundMessage } from '@workerchat/shared';
import {
  WhatsAppOfficialProvider, verifyWebhookSignature,
  type WhatsAppCloudTransport, type WhatsAppConfig, type WaWebhookBody, type StatusUpdate,
} from './whatsapp-official.js';

const USER = 'clare';
const PHONE_ID = 'PHONE_ID';
const BIZ = '15550001111';      // the worker's WA Business number
const CLIENT = '15557654321';   // the client
const CONFIG: WhatsAppConfig = { phoneNumberId: PHONE_ID, accessToken: 'tok', appSecret: 'shh' };

class FakeCloudTransport implements WhatsAppCloudTransport {
  sentText: Array<{ to: string; text: string }> = [];
  sentTemplate: Array<{ to: string; name: string }> = [];
  sentMedia: Array<{ to: string; kind: string; bytes: number }> = [];
  throwMetaCodeOnText?: number;
  private n = 100;

  async getPhoneNumber() { return { id: PHONE_ID, displayPhoneNumber: BIZ }; }
  async sendText(to: string, text: string) {
    if (this.throwMetaCodeOnText) throw Object.assign(new Error('x'), { metaCode: this.throwMetaCodeOnText, code: 'http_400' });
    this.sentText.push({ to, text }); return { messageId: `wamid.out${this.n++}` };
  }
  async sendTemplate(to: string, t: { name: string; language: string; variables: string[] }) {
    this.sentTemplate.push({ to, name: t.name }); return { messageId: `wamid.tpl${this.n++}` };
  }
  async sendMedia(to: string, m: { kind: string; data: Buffer }) {
    this.sentMedia.push({ to, kind: m.kind, bytes: m.data.length }); return { messageId: `wamid.med${this.n++}` };
  }
  async getMediaUrl(mediaId: string) { return { url: `https://cdn.test/${mediaId}`, mimeType: 'image/jpeg' }; }
  async downloadMedia() { return Buffer.from('BYTES'); }
}

function build(opts?: { transport?: FakeCloudTransport; config?: WhatsAppConfig | null }) {
  const transport = opts?.transport ?? new FakeCloudTransport();
  const config = opts?.config === undefined ? CONFIG : opts.config;
  const inbound: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  const states: string[] = [];

  const provider = new WhatsAppOfficialProvider({
    transportFactory: () => transport,
    credentials: { getWhatsAppConfig: async () => config },
    writeChannelState: async (_u, _c, patch) => { if (patch.state) states.push(patch.state); },
    mediaStore: { read: async () => Buffer.from('JPEGDATA') },
  });
  provider.onInbound(async (m) => { inbound.push(m); });
  provider.onStatus(async (s) => { statuses.push(s); });
  return { provider, transport, inbound, statuses, states };
}

function webhook(value: Record<string, unknown>): WaWebhookBody {
  return { object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value }] }] };
}

describe('WhatsAppOfficialProvider capabilities', () => {
  it('reports CoEx capabilities (qr, 24h window, echoes own device, 180d paged history)', () => {
    const { provider } = build();
    expect(provider.channel).toBe('whatsapp_official');
    expect(provider.capabilities.connectMethod).toBe('qr');
    expect(provider.capabilities.requires24hWindow).toBe(true);
    expect(provider.capabilities.echoesOwnDeviceMessages).toBe(true);
    expect(provider.capabilities.historySyncDays).toBe(180);
    expect(provider.capabilities.historySyncMode).toBe('paged');
  });
});

describe('WhatsAppOfficialProvider connect', () => {
  it('connects when a phone number is configured', async () => {
    const { provider, states } = build();
    expect(await provider.connect(USER)).toEqual({ state: 'connected' });
    expect((await provider.getStatus(USER)).channelUserId).toBe(PHONE_ID);
    expect(states).toContain('connected');
  });

  it('reports logged_out when no WA config exists', async () => {
    const { provider } = build({ config: null });
    expect(await provider.connect(USER)).toEqual({ state: 'logged_out' });
  });
});

describe('WhatsAppOfficialProvider webhook ingest', () => {
  it('normalizes an inbound text message (client → us, fromMe=false)', async () => {
    const { provider, inbound } = build();
    const res = await provider.ingestWebhook(webhook({
      contacts: [{ profile: { name: 'Jordan' }, wa_id: CLIENT }],
      messages: [{ id: 'wamid.1', from: CLIENT, timestamp: '1700000000', type: 'text', text: { body: 'hello wa' } }],
    }));
    expect(res.messages).toBe(1);
    const m = inbound[0]!;
    expect(m.fromMe).toBe(false);
    expect(m.channel).toBe('whatsapp_official');
    expect(m.from.channelUserId).toBe(CLIENT);
    expect(m.from.phoneE164).toBe(`+${CLIENT}`);
    expect(m.threadKey).toBe(`whatsapp_official:${CLIENT}`);
    expect(m.text).toBe('hello wa');
    expect(m.from.displayName).toBe('Jordan');
  });

  it('treats a Coexistence smb_message_echoes entry as own-device (fromMe=true), keyed to the client', async () => {
    const { provider, inbound } = build();
    await provider.ingestWebhook(webhook({
      smb_message_echoes: [{ id: 'wamid.echo', from: BIZ, to: CLIENT, timestamp: '1700000100', type: 'text', text: { body: 'sent from my phone' } }],
    }));
    const m = inbound[0]!;
    expect(m.fromMe).toBe(true);
    // The thread is the CLIENT's, even though the echo's `from` is our own business number.
    expect(m.from.channelUserId).toBe(CLIENT);
    expect(m.threadKey).toBe(`whatsapp_official:${CLIENT}`);
    expect(m.text).toBe('sent from my phone');
  });

  it('normalizes inbound media (image) into an attachment', async () => {
    const { provider, inbound } = build();
    await provider.ingestWebhook(webhook({
      contacts: [{ profile: { name: 'Jordan' }, wa_id: CLIENT }],
      messages: [{ id: 'wamid.2', from: CLIENT, timestamp: '1700000200', type: 'image', image: { id: 'MID', mime_type: 'image/jpeg', caption: 'a pic' } }],
    }));
    const m = inbound[0]!;
    expect(m.attachments?.[0]?.kind).toBe('image');
    expect(m.attachments?.[0]?.mimeType).toBe('image/jpeg');
    expect(m.text).toBe('a pic'); // caption surfaces as the body
  });

  it('dispatches delivery/read status updates to onStatus', async () => {
    const { provider, statuses } = build();
    const res = await provider.ingestWebhook(webhook({
      statuses: [{ id: 'wamid.out1', status: 'delivered', timestamp: '1700000300', recipient_id: CLIENT }],
    }));
    expect(res.statuses).toBe(1);
    expect(statuses[0]).toEqual({ providerMessageId: 'wamid.out1', status: 'delivered' });
  });
});

describe('WhatsAppOfficialProvider send', () => {
  it('sends free-form text while the window is open', async () => {
    const { provider, transport } = build();
    await provider.connect(USER);
    const r = await provider.send(USER, { channel: 'whatsapp_official', toChannelUserId: CLIENT, text: 'on my way', idempotencyKey: 'i1' });
    expect(r.ok).toBe(true);
    expect(r.windowState).toBe('open');
    expect(transport.sentText).toEqual([{ to: CLIENT, text: 'on my way' }]);
  });

  it('sends an approved template (window-closed path)', async () => {
    const { provider, transport } = build();
    await provider.connect(USER);
    const r = await provider.send(USER, {
      channel: 'whatsapp_official', toChannelUserId: CLIENT, idempotencyKey: 'i2',
      template: { name: 'appointment_reminder', language: 'en_US', variables: ['Jordan'] },
    });
    expect(r.ok).toBe(true);
    expect(r.windowState).toBe('closed');
    expect(transport.sentTemplate).toEqual([{ to: CLIENT, name: 'appointment_reminder' }]);
  });

  it('reports windowState=closed when Meta rejects a free-form text outside the 24h window', async () => {
    const transport = new FakeCloudTransport();
    transport.throwMetaCodeOnText = 131047;
    const { provider } = build({ transport });
    await provider.connect(USER);
    const r = await provider.send(USER, { channel: 'whatsapp_official', toChannelUserId: CLIENT, text: 'too late', idempotencyKey: 'i3' });
    expect(r.ok).toBe(false);
    expect(r.windowState).toBe('closed');
    expect(r.error).toBe('window_closed');
  });

  it('sends media via the MediaStore seam', async () => {
    const { provider, transport } = build();
    await provider.connect(USER);
    const r = await provider.send(USER, {
      channel: 'whatsapp_official', toChannelUserId: CLIENT, idempotencyKey: 'i4',
      attachments: [{ kind: 'image', storageBucket: 'outbound-media', storagePath: 'u/1.jpg', mimeType: 'image/jpeg', bytes: 8 }],
    });
    expect(r.ok).toBe(true);
    expect(transport.sentMedia[0]).toMatchObject({ to: CLIENT, kind: 'image' });
  });

  it('fails cleanly when not connected', async () => {
    const { provider } = build();
    const r = await provider.send(USER, { channel: 'whatsapp_official', toChannelUserId: CLIENT, text: 'hi', idempotencyKey: 'i5' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('not_connected');
  });
});

describe('verifyWebhookSignature', () => {
  const body = JSON.stringify({ hello: 'world' });
  const good = 'sha256=' + createHmac('sha256', 'shh').update(body, 'utf8').digest('hex');

  it('accepts a correct signature', () => {
    expect(verifyWebhookSignature(body, good, 'shh')).toBe(true);
  });
  it('rejects a tampered body', () => {
    expect(verifyWebhookSignature(body + 'x', good, 'shh')).toBe(false);
  });
  it('rejects a missing/!sha256 header', () => {
    expect(verifyWebhookSignature(body, undefined, 'shh')).toBe(false);
    expect(verifyWebhookSignature(body, 'md5=abc', 'shh')).toBe(false);
  });
  it('rejects the wrong secret', () => {
    expect(verifyWebhookSignature(body, good, 'wrong')).toBe(false);
  });
});
