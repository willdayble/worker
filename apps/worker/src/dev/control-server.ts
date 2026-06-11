// ⚠️ DEV-ONLY local control plane to drive the live Telegram smoke test without a CRM.
//
// Binds 127.0.0.1 ONLY. It exists so a human (or the assistant running the demo) can:
//   • GET  /dev/messages        — see the message log, DECRYPTED, to witness inbound arriving
//   • POST /dev/reply {chatId,text} — stage a human-approved outbound (what the CRM normally
//                                     inserts into bridge_outbound after approval); the runtime's
//                                     drain loop then sends it within ~1.5s.
//   • GET  /health
//
// It decrypts plaintext and serves it over loopback — fine for a dev demo, NEVER production.
// Only ever started for the InMemorySink path (see index.ts); the real CRM owns approvals.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Channel } from '@workerchat/shared';
import type { InMemorySink } from '../core/sink.js';
import type { Encryptor } from '../core/crypto.js';

export interface DevControlDeps {
  userId: string;
  channel: Channel;
  sink: InMemorySink;
  encryptor: Encryptor;
  port: number;
}

/** Start the dev control server. Returns a stop() function. */
export function startDevControlServer(deps: DevControlDeps): () => void {
  const { userId, channel, sink, encryptor, port } = deps;

  const server = createServer((req, res) => {
    handle(req, res).catch(() => { res.statusCode = 500; res.end('{"error":"dev_control"}'); });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '';
    res.setHeader('content-type', 'application/json');

    if (req.method === 'GET' && url.startsWith('/dev/messages')) {
      const messages = [];
      for (const m of sink.messages) {
        messages.push({
          direction: m.direction,
          conversationId: m.conversationId,
          providerMessageId: m.providerMessageId,
          contentType: m.contentType,
          // DEV decrypt — proves the body was stored as ciphertext and round-trips.
          text: m.bodyEnc ? await encryptor.decrypt(userId, m.bodyEnc) : null,
          sentAt: m.sentAt,
        });
      }
      res.end(JSON.stringify({ count: messages.length, messages }, null, 2));
      return;
    }

    if (req.method === 'POST' && url.startsWith('/dev/reply')) {
      const parsed = JSON.parse((await readBody(req)) || '{}') as { chatId?: unknown; text?: unknown };
      const chatId = parsed.chatId == null ? '' : String(parsed.chatId);
      const text = parsed.text == null ? '' : String(parsed.text);
      if (!chatId || !text) { res.statusCode = 400; res.end('{"error":"chatId+text required"}'); return; }

      // Mimic the CRM inserting a human-approved bridge_outbound row (ciphertext at rest).
      sink.outbox.push({
        id: randomUUID(), userId, channel,
        toChannelUserIdEnc: await encryptor.encrypt(userId, chatId),
        bodyEnc: await encryptor.encrypt(userId, text),
        idempotencyKey: randomUUID(),
      });
      res.end('{"queued":true}');
      return;
    }

    if (url.startsWith('/health')) { res.end('{"ok":true}'); return; }
    res.statusCode = 404;
    res.end('{"error":"not_found"}');
  }

  server.listen(port, '127.0.0.1', () => {
    process.stderr.write(
      `[dev] control plane → http://127.0.0.1:${port}  (GET /dev/messages · POST /dev/reply {chatId,text})\n`,
    );
  });
  return () => server.close();
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}
