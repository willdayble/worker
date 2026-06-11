// WhatsApp Cloud API webhook receiver. Meta POSTs all events for the platform app to ONE URL;
// this server verifies them and routes each payload to the right user's provider by
// `phone_number_id` (one platform Meta app → many Coexistence business numbers → many users).
//
// Responsibilities (CONTRACTS §4 C5/C6, §5):
//   • GET  challenge  — answer Meta's subscribe verification (hub.verify_token must match).
//   • POST events     — verify X-Hub-Signature-256 over the RAW body (app secret) BEFORE parsing;
//                       an unverified payload is rejected and never reaches a provider.
//   • route by phone_number_id → the registered WhatsAppOfficialProvider.ingestWebhook().
//   • respond 200 quickly so Meta doesn't retry; never log the body (id-only logs).
//
// This is the WA equivalent of Telegram's long-poll bootstrap. The provider's onInbound/onStatus
// are wired to the sink by the caller (index.ts); this server only delivers verified payloads.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  verifyWebhookSignature, type WaWebhookBody, type WhatsAppOfficialProvider,
} from '../messaging/adapters/whatsapp-official.js';
import { log, errorToken } from '../core/logger.js';

export interface WhatsAppWebhookDeps {
  /** Platform Meta app secret — verifies X-Hub-Signature-256 (one per app, not per number). */
  appSecret: string;
  /** Shared secret echoed back on the GET subscribe challenge. */
  verifyToken: string;
  port: number;
  /** Route a business phone_number_id → the provider wired for that user. */
  resolveProvider: (phoneNumberId: string) => WhatsAppOfficialProvider | undefined;
  /** Path Meta is configured to call. Default '/webhook/whatsapp'. */
  path?: string;
}

export interface RunningWebhookServer {
  server: Server;
  port: number;
  stop: () => Promise<void>;
}

export function startWhatsAppWebhookServer(deps: WhatsAppWebhookDeps): Promise<RunningWebhookServer> {
  const path = deps.path ?? '/webhook/whatsapp';

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      log.error({ event: 'wa.webhook.error', errorCode: errorToken(err) });
      if (!res.headersSent) { res.statusCode = 500; res.end('{"error":"server"}'); }
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '', 'http://localhost');
    res.setHeader('content-type', 'application/json');

    if (url.pathname === '/health') { res.end('{"ok":true}'); return; }

    if (url.pathname !== path) { res.statusCode = 404; res.end('{"error":"not_found"}'); return; }

    // GET — Meta's subscribe verification handshake.
    if (req.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && token === deps.verifyToken && challenge) {
        res.setHeader('content-type', 'text/plain');
        res.statusCode = 200;
        res.end(challenge);   // Meta requires the raw challenge echoed back
        return;
      }
      res.statusCode = 403; res.end('{"error":"verify_failed"}');
      return;
    }

    // POST — an events payload. Verify signature over the RAW bytes before trusting anything.
    if (req.method === 'POST') {
      const raw = await readBody(req);
      const sig = req.headers['x-hub-signature-256'];
      if (!verifyWebhookSignature(raw, typeof sig === 'string' ? sig : undefined, deps.appSecret)) {
        log.warn({ event: 'wa.webhook.bad_signature' });
        res.statusCode = 401; res.end('{"error":"bad_signature"}');
        return;
      }
      let body: WaWebhookBody;
      try { body = JSON.parse(raw) as WaWebhookBody; }
      catch { res.statusCode = 400; res.end('{"error":"bad_json"}'); return; }

      const routed = await dispatch(body, deps.resolveProvider);
      log.info({ event: 'wa.webhook.received', count: routed });
      res.statusCode = 200; res.end('{"ok":true}');
      return;
    }

    res.statusCode = 405; res.end('{"error":"method_not_allowed"}');
  }

  // Resolve only once the socket is bound, so address().port is the real (possibly :0-assigned) port.
  return new Promise<RunningWebhookServer>((resolve) => {
    server.listen(deps.port, '0.0.0.0', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : deps.port;
      log.info({ event: 'wa.webhook.listening', count: port });
      resolve({
        server,
        port,
        stop: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

/**
 * Split a webhook body by phone_number_id and hand each slice to the matching provider.
 * Returns the number of changes routed. Unregistered numbers are logged and skipped (a payload
 * for a number we don't host is not an error — e.g. another tenant on the same app).
 */
export async function dispatch(
  body: WaWebhookBody,
  resolveProvider: (phoneNumberId: string) => WhatsAppOfficialProvider | undefined,
): Promise<number> {
  const byNumber = new Map<string, WaWebhookBody>();
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const pnid = change.value?.metadata?.phone_number_id;
      if (!pnid) continue;
      let sub = byNumber.get(pnid);
      if (!sub) { sub = { object: body.object, entry: [{ id: entry.id, changes: [] }] }; byNumber.set(pnid, sub); }
      sub.entry![0]!.changes!.push(change);
    }
  }

  let routed = 0;
  for (const [pnid, sub] of byNumber) {
    const provider = resolveProvider(pnid);
    if (!provider) { log.warn({ event: 'wa.webhook.no_provider', channelUserId: pnid }); continue; }
    await provider.ingestWebhook(sub);
    routed += sub.entry?.[0]?.changes?.length ?? 0;
  }
  return routed;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}
