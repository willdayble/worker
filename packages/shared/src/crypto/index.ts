// ============================================================================
// Crypto helpers — SIGNATURES + THROWING STUBS (Deliverable 0a).
//
// Real implementations land in Deliverable 0b: libsodium XChaCha20-Poly1305,
// envelope encryption with a per-user DEK, DEK material held in a KMS and loaded
// into the isolated worker process only while that user's session is connected
// (CONTRACTS §5; SCOPE §6). Honest threat model: at-rest encryption defeats cold
// DB/disk/backup theft — NOT a live-server or KMS-credential compromise. Not
// zero-knowledge; that is roadmap.
//
// SURFACE = free functions (this is what apps/worker integrates against):
// Track A's worker owns its own `Encryptor` PORT (apps/worker/src/core/crypto.ts);
// its production `SharedEncryptor` is a thin adapter that delegates to these
// functions, and stays a LOUD failure until 0b lands. The text helpers feed TEXT
// `*_enc` columns; the JSON helpers feed JSONB `*_enc` columns (object envelope);
// `hmacIdentifier` is the salted routing index (`*_hmac`) — match a destination
// without storing raw E164.
//
// Every function throws — a loud failure is correct until 0b. No `libsodium`
// dependency is declared yet (added in 0b) so the 0a surface stays dependency-light.
// CONTRACTS §1: libsodium is allowed here (crypto, not a provider chat SDK).
// Provider SDKs (Baileys/grammY) must NEVER appear in packages/shared.
// ============================================================================

import type { Ciphertext, EncryptedEnvelope, Json } from '../db/types.js';

const STUB_REASON =
  'not implemented — Deliverable 0b (libsodium XChaCha20-Poly1305 envelope encryption)';

function notImplemented(fn: string): never {
  throw new Error(`@workerapp/shared/crypto: ${fn}() ${STUB_REASON}`);
}

/** Raw key/DEK material. 0b uses 32-byte keys for XChaCha20-Poly1305. */
export type KeyBytes = Uint8Array;

// --- High-level, per-user (resolves the user's DEK via the KMS) ------------

/**
 * Encrypt plaintext for a user → ciphertext for a TEXT `*_enc` column
 * (e.g. `messages.body_enc`, `conversations.last_message_preview_enc`,
 * `contacts.flag_reason_enc`, `bridge_outbound.body_enc`). Async: may touch KMS.
 */
export function encryptForUser(
  _userId: string,
  _plaintext: string | Uint8Array,
): Promise<Ciphertext> {
  return notImplemented('encryptForUser');
}

/** Decrypt a TEXT `*_enc` value produced by {@link encryptForUser}. */
export function decryptForUser(_userId: string, _ciphertext: Ciphertext): Promise<string> {
  return notImplemented('decryptForUser');
}

/**
 * Encrypt a JSON value for a user → object envelope for a JSONB `*_enc` column
 * (e.g. `bridge_outbound.attachment_enc` / `template_enc`).
 */
export function encryptJsonForUser(_userId: string, _value: Json): Promise<EncryptedEnvelope> {
  return notImplemented('encryptJsonForUser');
}

/** Decrypt a JSONB `*_enc` envelope produced by {@link encryptJsonForUser}. */
export function decryptJsonForUser(
  _userId: string,
  _envelope: EncryptedEnvelope,
): Promise<Json> {
  return notImplemented('decryptJsonForUser');
}

/**
 * Salted, per-user HMAC of an identifier — the routing index stored in
 * `bridge_outbound.to_channel_user_id_hmac`. Lets the worker match a destination
 * WITHOUT storing a raw E164/JID (CONTRACTS §5). Deterministic per (user, value).
 */
export function hmacIdentifier(_userId: string, _value: string): string {
  return notImplemented('hmacIdentifier');
}

// --- Low-level envelope primitives (per-user DEK wrapped by a KEK) ----------

/** Wrap a per-user DEK with a key-encryption-key for storage. */
export function wrapDEK(_dek: KeyBytes, _kek: KeyBytes): EncryptedEnvelope {
  return notImplemented('wrapDEK');
}

/** Unwrap a DEK previously sealed by {@link wrapDEK}. */
export function unwrapDEK(_wrapped: EncryptedEnvelope, _kek: KeyBytes): KeyBytes {
  return notImplemented('unwrapDEK');
}
