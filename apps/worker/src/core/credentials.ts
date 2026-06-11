// Per-user credential loading. Production reads the user's bot token from the encrypted
// auth-state row (wa_auth_state-equivalent, decrypted via the KMS-backed Encryptor that
// @workerchat/shared will publish). Until that schema/crypto lands (Track B), dev uses a single
// env token; tests inject an in-memory map. Tokens are secrets — never logged.

import type { CredentialStore } from '../messaging/adapters/telegram.js';
import type { WhatsAppConfig, WhatsAppCredentialStore } from '../messaging/adapters/whatsapp-official.js';

/** Single-user dev store: one TELEGRAM_BOT_TOKEN for the connected user. */
export class EnvCredentialStore implements CredentialStore {
  async getTelegramBotToken(_userId: string): Promise<string | null> {
    return process.env.TELEGRAM_BOT_TOKEN ?? null;
  }
}

/** Test/multi-tenant store backed by an in-memory map keyed by userId. */
export class InMemoryCredentialStore implements CredentialStore {
  constructor(private readonly tokens: Map<string, string> = new Map()) {}
  set(userId: string, token: string): void { this.tokens.set(userId, token); }
  async getTelegramBotToken(userId: string): Promise<string | null> {
    return this.tokens.get(userId) ?? null;
  }
}

/**
 * Single-user dev WhatsApp config from env (WHATSAPP_PHONE_NUMBER_ID / _ACCESS_TOKEN / _APP_SECRET).
 * Production reads the per-user encrypted config row instead. Secrets — never logged.
 */
export class EnvWhatsAppCredentialStore implements WhatsAppCredentialStore {
  async getWhatsAppConfig(_userId: string): Promise<WhatsAppConfig | null> {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (!phoneNumberId || !accessToken || !appSecret) return null;
    return { phoneNumberId, accessToken, appSecret };
  }
}
