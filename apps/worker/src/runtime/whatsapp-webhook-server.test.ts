// WhatsApp webhook receiver tests — real HTTP (random port, global fetch). Covers the GET
// subscribe challenge, X-Hub-Signature-256 verification on POST, and routing by phone_number_id
// to the right provider. No Meta, no network beyond loopback.

import { describe, it, expect, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { InboundMessage } from '@workerchat/shared';
import {
  WhatsAppOfficialProvider, type WhatsAppCloudTransport, type WhatsAppConfig,
} from '../messaging/adapters/whatsapp-official.js';
import { startWhatsAppWebhookServer, type RunningWebhookServer } from './whatsapp-webhook-server.js';

const APP_SECRET = 'platform-app-secret';
const VERIFY_TOKEN = 'my-verify-token';
const PHONE_ID = 'PHONE_ID_1';
const CLIENT = '15557654321';

// Minimal fake transport (ingestWebhook doesn't touch it, but the provider needs one).
const fakeTransport: WhatsAppCloudTransport = {
  async getPhoneNumber() { return { id: PHONE_ID }; },
  async sendText() { return { messageId: 'x' }; },
  async sendTemplate() { return { messageId: 'x' }; },
  async sendMedia() { return { messageId: 'x' }; },
  async getMediaUrl() { return { url: '' }; },
  async downloadMedia() { return Buffer.alloc(0); },
};

function makeProvider(inbound: InboundMessage[]): WhatsAppOfficialProvider {
  const config: WhatsAppConfig = { phoneNumberId: PHONE_ID, accessToken: 't', appSecret: APP_SECRET };
  const p = new WhatsAppOfficialProvider({
    transportFactory: () => fakeTransport,
    credentials: { getWhatsAppConfig: async () => config },
    writeChannelState: async () => {},
  });
  p.onInbound(async (m) => { inbound.push(m); });
  return p;
}

function sign(raw: string, secret = APP_SECRET): string {
  return 'sha256=' + createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
}

function bodyFor(phoneNumberId: string): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
      metadata: { display_phone_number: '15550001111', phone_number_id: phoneNumberId },
      contacts: [{ profile: { name: 'Jordan' }, wa_id: CLIENT }],
      messages: [{ id: 'wamid.1', from: CLIENT, timestamp: '1700000000', type: 'text', text: { body: 'hi via webhook' } }],
    } }] }],
  });
}

let running: RunningWebhookServer | undefined;
afterEach(async () => { await running?.stop(); running = undefined; });

async function start(inbound: InboundMessage[], providers: Map<string, WhatsAppOfficialProvider>): Promise<string> {
  running = await startWhatsAppWebhookServer({
    appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN, port: 0,
    resolveProvider: (pnid) => providers.get(pnid),
  });
  void inbound;
  return `http://127.0.0.1:${running.port}`;
}

describe('WhatsApp webhook server', () => {
  it('answers the GET subscribe challenge when the verify token matches', async () => {
    const base = await start([], new Map());
    const res = await fetch(`${base}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=CHALLENGE123`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('CHALLENGE123');
  });

  it('rejects the challenge with a wrong verify token', async () => {
    const base = await start([], new Map());
    const res = await fetch(`${base}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=X`);
    expect(res.status).toBe(403);
  });

  it('accepts a correctly-signed POST and routes it to the provider by phone_number_id', async () => {
    const inbound: InboundMessage[] = [];
    const providers = new Map([[PHONE_ID, makeProvider(inbound)]]);
    const base = await start(inbound, providers);
    const raw = bodyFor(PHONE_ID);

    const res = await fetch(`${base}/webhook/whatsapp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw) },
      body: raw,
    });
    expect(res.status).toBe(200);
    expect(inbound).toHaveLength(1);
    expect(inbound[0]!.text).toBe('hi via webhook');
    expect(inbound[0]!.from.channelUserId).toBe(CLIENT);
  });

  it('rejects a POST with a bad signature and does not route it', async () => {
    const inbound: InboundMessage[] = [];
    const providers = new Map([[PHONE_ID, makeProvider(inbound)]]);
    const base = await start(inbound, providers);
    const raw = bodyFor(PHONE_ID);

    const res = await fetch(`${base}/webhook/whatsapp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw, 'wrong-secret') },
      body: raw,
    });
    expect(res.status).toBe(401);
    expect(inbound).toHaveLength(0);
  });

  it('200s but routes nothing for an unregistered phone_number_id', async () => {
    const inbound: InboundMessage[] = [];
    const providers = new Map<string, WhatsAppOfficialProvider>(); // none registered
    const base = await start(inbound, providers);
    const raw = bodyFor('UNKNOWN_NUMBER');

    const res = await fetch(`${base}/webhook/whatsapp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw) },
      body: raw,
    });
    expect(res.status).toBe(200);
    expect(inbound).toHaveLength(0);
  });

  it('serves /health', async () => {
    const base = await start([], new Map());
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
