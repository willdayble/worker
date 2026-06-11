// ============================================================================
// Crypto — Deliverable 0b: real libsodium implementations (CONTRACTS §5; SCOPE §6).
//
// Algorithm: XChaCha20-Poly1305 (IETF) AEAD via libsodium. Per-user subkeys are
// derived from a master KEK with keyed BLAKE2b (domain-separated by purpose+user),
// so each user's data is encrypted under a distinct key. The master KEK is loaded
// from the secrets manager (Doppler `WORKER_MASTER_KEY`) into the worker process —
// "keys in a KMS, loaded into the isolated worker only while a session is live"
// (CONTRACTS §6). The ciphertext AAD binds each value to its `userId`.
//
// HONEST THREAT MODEL (CONTRACTS §5 / M11): at-rest encryption defeats cold
// DB/disk/backup theft. It does NOT defend a live-server or master-key compromise:
// whoever holds `WORKER_MASTER_KEY` can derive every user's subkey and decrypt.
// Not zero-knowledge — that is roadmap.
//
// ROADMAP (not now): the master-KDF model is the prototype point on the spectrum.
// Moving to per-user *stored* DEKs (wrapDEK/unwrapDEK below are the envelope
// primitives for that) and then client-held keys gives per-user rotation and true
// sovereignty without changing this call surface. Today: one KEK, KDF per user.
//
// API is STABLE vs 0a (apps/worker integrates against these free functions). The
// only change: hmacIdentifier/wrapDEK/unwrapDEK are now async (libsodium inits
// asynchronously) — backward-compatible, callers already await them.
//
// CONTRACTS §1: libsodium is allowed here (crypto, not a provider chat SDK).
// ============================================================================

import * as sodiumModule from 'libsodium-wrappers';
import type { Ciphertext, EncryptedEnvelope, Json } from '../db/types.js';

// libsodium-wrappers' ESM build exposes its API on the DEFAULT export — a single
// mutable object whose methods are populated only after `ready` resolves. The named
// namespace bindings are sealed and stay `undefined`, so we resolve the default and
// type it as the namespace to keep full call-site typings.
const sodium = ((sodiumModule as unknown as { default?: typeof sodiumModule }).default
  ?? sodiumModule) as typeof sodiumModule;

/** Raw key/DEK material. 32 bytes for XChaCha20-Poly1305 / secretbox. */
export type KeyBytes = Uint8Array;

const TEXT_VERSION = 'v1x';      // XChaCha20-Poly1305 text ciphertext
const ENVELOPE_VERSION = 'v1x';  // secretbox-wrapped DEK / json envelope

// --- one-time libsodium init + master key (cached) --------------------------

let readyPromise: Promise<void> | null = null;
async function ready(): Promise<void> {
  readyPromise ??= sodium.ready;
  await readyPromise;
}

let cachedMasterKey: Uint8Array | null = null;
function masterKey(): Uint8Array {
  if (cachedMasterKey) return cachedMasterKey;
  const raw = process.env.WORKER_MASTER_KEY;
  if (!raw) {
    throw new Error(
      '@workerapp/shared/crypto: WORKER_MASTER_KEY is not set. Provide a 32-byte key ' +
        '(64 hex chars or base64) via Doppler (project worker). It is the master KEK; ' +
        'losing it makes all ciphertext unrecoverable, leaking it defeats encryption.',
    );
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? sodium.from_hex(raw)
    : sodium.from_base64(raw, sodium.base64_variants.ORIGINAL);
  if (key.length !== sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES) {
    throw new Error(
      `@workerapp/shared/crypto: WORKER_MASTER_KEY must decode to ${sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES} bytes (got ${key.length}).`,
    );
  }
  cachedMasterKey = key;
  return key;
}

/** Per-user, per-purpose 32-byte subkey via keyed BLAKE2b over the master KEK. */
function subkey(userId: string, purpose: 'enc' | 'mac' | 'wrap'): Uint8Array {
  return sodium.crypto_generichash(
    sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
    sodium.from_string(`${purpose}:${userId}`),
    masterKey(),
  );
}

const b64 = (b: Uint8Array): string => sodium.to_base64(b, sodium.base64_variants.URLSAFE_NO_PADDING);
const unb64 = (s: string): Uint8Array => sodium.from_base64(s, sodium.base64_variants.URLSAFE_NO_PADDING);

// --- High-level, per-user ---------------------------------------------------

/**
 * Encrypt plaintext for a user → ciphertext string for a TEXT `*_enc` column
 * (e.g. `messages.body_enc`, `bridge_outbound.body_enc`). Format:
 * `v1x.<nonce>.<ct>` (base64url); AAD binds the value to `userId`.
 */
export async function encryptForUser(
  userId: string,
  plaintext: string | Uint8Array,
): Promise<Ciphertext> {
  await ready();
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext, sodium.from_string(userId), null, nonce, subkey(userId, 'enc'),
  );
  return `${TEXT_VERSION}.${b64(nonce)}.${b64(ct)}`;
}

/** Decrypt a TEXT `*_enc` value produced by {@link encryptForUser}. */
export async function decryptForUser(userId: string, ciphertext: Ciphertext): Promise<string> {
  await ready();
  const parts = ciphertext.split('.');
  if (parts.length !== 3 || parts[0] !== TEXT_VERSION) {
    throw new Error(`@workerapp/shared/crypto: malformed/unsupported ciphertext`);
  }
  const nonce = unb64(parts[1] as string);
  const ct = unb64(parts[2] as string);
  const msg = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null, ct, sodium.from_string(userId), nonce, subkey(userId, 'enc'),
  );
  return sodium.to_string(msg);
}

/**
 * Encrypt a JSON value for a user → object envelope for a JSONB `*_enc` column
 * (`bridge_outbound.attachment_enc` / `template_enc`). Shape: `{ v, enc }`.
 */
export async function encryptJsonForUser(userId: string, value: Json): Promise<EncryptedEnvelope> {
  return { v: TEXT_VERSION, enc: await encryptForUser(userId, JSON.stringify(value)) };
}

/** Decrypt a JSONB `*_enc` envelope produced by {@link encryptJsonForUser}. */
export async function decryptJsonForUser(userId: string, envelope: EncryptedEnvelope): Promise<Json> {
  const enc = (envelope as { enc?: unknown }).enc;
  if (typeof enc !== 'string') {
    throw new Error('@workerapp/shared/crypto: malformed json envelope (missing enc)');
  }
  return JSON.parse(await decryptForUser(userId, enc)) as Json;
}

/**
 * Salted, deterministic per-user HMAC of an identifier — the routing index stored
 * in `bridge_outbound.to_channel_user_id_hmac`. Lets the worker match a destination
 * WITHOUT storing a raw E164/JID (CONTRACTS §5). Stable per (user, value).
 */
export async function hmacIdentifier(userId: string, value: string): Promise<string> {
  await ready();
  return b64(sodium.crypto_auth(sodium.from_string(value), macSubkey(userId)));
}

/** crypto_auth needs a 32-byte key; reuse the per-user 'mac' subkey (already 32B). */
function macSubkey(userId: string): Uint8Array {
  return subkey(userId, 'mac');
}

// --- Low-level envelope primitives (DEK wrapped by a KEK) — roadmap support --

/**
 * Wrap a per-user DEK with a key-encryption-key (secretbox). The envelope primitive
 * the stored-DEK roadmap will use; not on the prototype hot path (high-level fns
 * derive subkeys directly). Returns `{ v, n, ct }`.
 */
export async function wrapDEK(dek: KeyBytes, kek: KeyBytes): Promise<EncryptedEnvelope> {
  await ready();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ct = sodium.crypto_secretbox_easy(dek, nonce, kek);
  return { v: ENVELOPE_VERSION, n: b64(nonce), ct: b64(ct) };
}

/** Unwrap a DEK previously sealed by {@link wrapDEK}. */
export async function unwrapDEK(wrapped: EncryptedEnvelope, kek: KeyBytes): Promise<KeyBytes> {
  await ready();
  const w = wrapped as { v?: unknown; n?: unknown; ct?: unknown };
  if (w.v !== ENVELOPE_VERSION || typeof w.n !== 'string' || typeof w.ct !== 'string') {
    throw new Error('@workerapp/shared/crypto: malformed DEK envelope');
  }
  return sodium.crypto_secretbox_open_easy(unb64(w.ct), unb64(w.n), kek);
}
