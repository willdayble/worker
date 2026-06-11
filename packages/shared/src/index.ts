// ============================================================================
// @workerchat/shared — Track B platform contract (Deliverable 0a).
//
//   • messaging/  MessagingProvider interface + payload types (CONTRACTS §2)
//   • db/         DB row types — 1a channel contract + 1b rich CRM (CONTRACTS §3)
//   • validation/ zod validators for the A⇄B wire contract  (CONTRACTS §2)
//   • crypto/     encrypt/decrypt/json/HMAC free fns — libsodium impls, 0b (§5)
//
// apps/worker (Track A) imports the messaging interface/types + the crypto free
// functions (its own Encryptor PORT adapts over them). The CRM imports types,
// validators, and (in 0b) crypto. Neither imports a provider chat SDK.
//
// Subpath imports also work: `@workerchat/shared/messaging`, `/db`, `/validation`,
// `/crypto`.
// ============================================================================

export * from './messaging/interface.js';
export * from './db/types.js';
export * from './db/crm.js';
export * from './ai/analysis.js';
export * from './validation/schemas.js';
export * from './crypto/index.js';
