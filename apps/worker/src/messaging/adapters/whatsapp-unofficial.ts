// WhatsAppUnofficialProvider — Baileys, ISOLATED, fallback-only (Deliverable 2.3).
//
// ⛔ GATED: per tracks/A-chat-layer.md, "Write NO production WhatsApp-unofficial (Baileys)
// session code until the kill-test has a verdict." This file therefore contains NO Baileys
// import and NO session logic — only the class shell + the feature flag that keeps it off.
// When docs/killtest/results.md returns GO-unofficial-as-fallback, this is implemented by
// porting the SOLID parts of first_attempt/whatsapp-bridge/server.js (Supabase auth-state,
// outbox polling, reconnect) onto the new wa_auth_state table — and FIXING the broken parts:
//   • the requestPairingCode() hang (newer WA forces "link with phone" — research current flow)
//   • media download (prior build stored "[image]" placeholders)
//   • history capture
//   • JWT + timingSafeEqual endpoint auth (NOT the leaked static WORKER_API_SECRET)
//   • encrypt-before-insert + id-only logs (NOT console.log(text.slice(...)))
//   • pin @whiskeysockets/baileys to an EXACT version, audit the lockfile (lotusbail fork).

import type {
  Channel, ConnState, MessagingProvider, OutboundMessage, ProviderCapabilities, SendResult, InboundMessage,
} from '@workerchat/shared';
import { isUnofficialWhatsAppEnabled } from '../../core/flags.js';

const GATED = 'whatsapp_unofficial_gated_on_killtest_verdict';

export class WhatsAppUnofficialProvider implements MessagingProvider {
  readonly channel: Channel = 'whatsapp_unofficial';

  // Baileys (multi-device web) sees lifetime history on pair, echoes own-device sends, no 24h window.
  // Receipts depend on settings. These are provisional until the kill-test confirms behavior.
  readonly capabilities: ProviderCapabilities = {
    historySyncDays: 0,            // actual depth is a KEY kill-test unknown; 0 = unconfirmed
    historySyncMode: 'bulk',
    mediaSync: true,
    requires24hWindow: false,
    groups: false,                 // groups unsupported by product scope (SCOPE §4)
    echoesOwnDeviceMessages: true,
    deliveryReceipts: true,
    readReceipts: false,
    connectMethod: 'pair_code',    // newer WA forces link-with-phone; pairing flow to be fixed
  };

  constructor() {
    if (!isUnofficialWhatsAppEnabled()) {
      // Loud, deterministic refusal so this can never be wired live before the verdict.
      throw new Error(GATED);
    }
  }

  onInbound(_handler: (m: InboundMessage) => Promise<void>): void { throw new Error(GATED); }
  async connect(_userId: string): Promise<{ state: ConnState }> { throw new Error(GATED); }
  async getStatus(_userId: string): Promise<{ state: ConnState; channelUserId?: string }> { throw new Error(GATED); }
  async send(_userId: string, _msg: OutboundMessage): Promise<SendResult> { throw new Error(GATED); }
  async syncHistory(): Promise<{ done: boolean; cursor?: string; imported: number }> { throw new Error(GATED); }
  async disconnect(_userId: string): Promise<void> { throw new Error(GATED); }
}
