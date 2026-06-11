// Bootstrap for the messaging worker. Starts whichever channels are configured by env — Telegram
// (long-poll, needs TELEGRAM_BOT_TOKEN) and/or WhatsApp-official (webhook, needs WHATSAPP_*). Both
// share one encryptor + sink. Each channel runs a SessionRuntime (connect + inbound wiring +
// outbound drain); WhatsApp additionally runs an HTTP webhook receiver that feeds ingestWebhook.
//
// Production note (SCOPE §7): this process is ALWAYS-ON, never serverless (Fly.io/Railway/VPS +
// PM2). One SessionRuntime per connected user (isolated-session model). Dev runs a single user.

// NodeCryptoEncryptor = dev stand-in; prod swaps to shared's `KmsEncryptor` once shared-0a's
// crypto dist is consistent (see core/crypto.ts header). Then: import from '@workerchat/shared/crypto'.
import { createClient } from '@supabase/supabase-js';
import { NodeCryptoEncryptor, SharedEncryptor, type Encryptor } from './core/crypto.js';
import { makeGrammyTransport } from './messaging/adapters/telegram-grammy.js';
import { TelegramProvider } from './messaging/adapters/telegram.js';
import { WhatsAppOfficialProvider } from './messaging/adapters/whatsapp-official.js';
import { makeCloudTransport } from './messaging/adapters/whatsapp-cloud-transport.js';
import { EnvCredentialStore, EnvWhatsAppCredentialStore } from './core/credentials.js';
import { InMemorySink, type MessageSink } from './core/sink.js';
import { SupabaseSink } from './persistence/supabase-sink.js';
import { SessionRuntime } from './runtime/session-runtime.js';
import { startWhatsAppWebhookServer } from './runtime/whatsapp-webhook-server.js';
import { startDevControlServer } from './dev/control-server.js';
import { log } from './core/logger.js';

type Stop = () => void | Promise<void>;

async function main(): Promise<void> {
  const userId = process.env.DEV_USER_ID ?? 'dev-user-0';
  // Prod (WORKER_MASTER_KEY set, e.g. via Doppler) → SharedEncryptor: SAME crypto + key as the CRM,
  // so the inbox can decrypt what we write. Offline / no key (smoke tests) → ephemeral dev stand-in.
  const encryptor: Encryptor = process.env.WORKER_MASTER_KEY
    ? new SharedEncryptor()
    : new NodeCryptoEncryptor();

  // SupabaseSink when creds are present (needs schema 1a applied to the live DB); else the
  // in-memory sink so a token-only smoke test still works.
  const supaUrl = process.env.SUPABASE_URL;
  // Accept either the legacy service-role name or Supabase's newer "secret key" name (in Doppler).
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  const sink: MessageSink = supaUrl && supaKey
    ? new SupabaseSink(createClient(supaUrl, supaKey, { auth: { persistSession: false } }), encryptor)
    : new InMemorySink(encryptor);
  log.info({ event: 'bootstrap.sink', reason: supaUrl && supaKey ? 'supabase' : 'in_memory' });

  const stops: Stop[] = [];
  let started = false;

  // ── Telegram (long-poll) ──────────────────────────────────────────────────────
  if (process.env.TELEGRAM_BOT_TOKEN) {
    const provider = new TelegramProvider({
      transportFactory: makeGrammyTransport,
      credentials: new EnvCredentialStore(),
      writeChannelState: (uid, channel, patch) => sink.writeChannelState(uid, channel, patch),
    });
    const runtime = new SessionRuntime({ userId, provider, sink, encryptor });
    await runtime.start();
    stops.push(() => runtime.stop());
    started = true;
    log.info({ event: 'bootstrap.started', userId, channel: 'telegram' });

    // DEV-ONLY control plane (loopback) — only for the in-memory smoke-test path.
    if (sink instanceof InMemorySink && process.env.ENABLE_DEV_CONTROL !== 'false') {
      stops.push(startDevControlServer({
        userId, channel: 'telegram', sink, encryptor,
        port: Number(process.env.DEV_CONTROL_PORT ?? 4799),
      }));
    }
  }

  // ── WhatsApp-official (webhook) ─────────────────────────────────────────────────
  const waPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const waSecret = process.env.WHATSAPP_APP_SECRET;
  const waVerify = process.env.WHATSAPP_VERIFY_TOKEN;
  if (waPhoneId && process.env.WHATSAPP_ACCESS_TOKEN && waSecret && waVerify) {
    const provider = new WhatsAppOfficialProvider({
      transportFactory: makeCloudTransport,
      credentials: new EnvWhatsAppCredentialStore(),
      writeChannelState: (uid, channel, patch) => sink.writeChannelState(uid, channel, patch),
    });
    const runtime = new SessionRuntime({ userId, provider, sink, encryptor });
    await runtime.start(); // connect (verify number) + wire onInbound→persist + outbound drain
    // Status webhooks (delivered/read) → message status. Wire before the receiver accepts traffic.
    provider.onStatus((s) => sink.updateMessageStatus(s.providerMessageId, s.status));

    const phoneNumberId = (await provider.getStatus(userId)).channelUserId ?? waPhoneId;
    const webhook = await startWhatsAppWebhookServer({
      appSecret: waSecret,
      verifyToken: waVerify,
      port: Number(process.env.WHATSAPP_WEBHOOK_PORT ?? 3001),
      resolveProvider: (pnid) => (pnid === phoneNumberId ? provider : undefined),
    });
    stops.push(() => webhook.stop());
    stops.push(() => runtime.stop());
    started = true;
    log.info({ event: 'bootstrap.started', userId, channel: 'whatsapp_official', channelUserId: phoneNumberId });
  }

  if (!started) {
    log.warn({ event: 'bootstrap.no_channel', reason: 'set TELEGRAM_BOT_TOKEN and/or WHATSAPP_* env to start a channel' });
    return;
  }

  const shutdown = async () => { for (const s of stops) await s(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error({ event: 'bootstrap.crashed', errorCode: 'fatal' });
  // Surface the stack to stderr for local debugging only (not the structured stdout sink).
  console.error(err);
  process.exit(1);
});
