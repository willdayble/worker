// Encryption seam for the worker (CONTRACTS §5).
//
// ⚠️ TEMPORARY LOCAL MIRROR of `@workerchat/shared/crypto`'s `Encryptor` seam.
// Track B has CONVERGED on the identical API — `interface Encryptor { encrypt; decrypt; hmac }`
// plus `NodeCryptoEncryptor` (dev) and `KmsEncryptor` (0b) — but shared-0a's published `dist`
// is currently INCONSISTENT: `dist/crypto/index.d.ts` ships the new class API while
// `dist/crypto/index.js` still ships the old free-function API (`encryptForUser`…), so the
// package can't be both typechecked and run against right now. Flagged to the orchestrator.
//
// Because the interface matches shared's exactly, the swap is IMPORT-ONLY once their dist is
// consistent: delete this file and change `'./crypto.js'` → `'@workerchat/shared/crypto'` at the
// (3) import sites (sink, session-runtime, index/test). No signature or call-site changes.
//
// This is interface-compatible with shared's seam: methods, names, and the dev `NodeCryptoEncryptor`
// behavior (chacha20-poly1305, HKDF per-user subkey, `v1c` ciphertext) are identical.

import {
  createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes,
} from 'node:crypto';

/**
 * The encryption boundary the worker depends on. Text/identifier values are encrypted before
 * they touch the DB; `hmac` is the salted routing index (`*_hmac`) so a destination can be
 * matched without storing raw E164. JSON columns (outbound attachment/template) store the
 * ciphertext of `JSON.stringify(meta)` — i.e. they also go through `encrypt` (shared's scheme).
 */
export interface Encryptor {
  encrypt(userId: string, plaintext: string): Promise<string>;
  decrypt(userId: string, ciphertext: string): Promise<string>;
  hmac(userId: string, value: string): Promise<string>;
}

// DEV STAND-IN — working, but NOT production crypto. node:crypto `chacha20-poly1305` (AEAD,
// same family as the production XChaCha20-Poly1305) with a per-user subkey via HKDF. Differs
// from prod: dev master key from env (not a KMS-held per-user DEK), 96-bit nonce (not XChaCha's
// 192-bit). Exercises the encrypt-before-insert boundary offline. Never ship it; prod = shared's KmsEncryptor.
const DEV_ENC_VERSION = 'v1c';

export class NodeCryptoEncryptor implements Encryptor {
  private readonly master: Buffer;

  constructor(masterKey?: Buffer) {
    this.master = masterKey ?? loadDevMasterKey();
  }

  private subkey(userId: string, purpose: 'enc' | 'mac'): Buffer {
    return Buffer.from(hkdfSync('sha256', this.master, Buffer.alloc(0), `${purpose}:${userId}`, 32));
  }

  async encrypt(userId: string, plaintext: string): Promise<string> {
    const key = this.subkey(userId, 'enc');
    const nonce = randomBytes(12);
    const cipher = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${DEV_ENC_VERSION}.${b64(nonce)}.${b64(ct)}.${b64(tag)}`;
  }

  async decrypt(userId: string, ciphertext: string): Promise<string> {
    const parts = ciphertext.split('.');
    if (parts.length !== 4) throw new Error('malformed ciphertext');
    const [v, n, c, t] = parts as [string, string, string, string];
    if (v !== DEV_ENC_VERSION) throw new Error(`unsupported ciphertext version: ${v}`);
    const key = this.subkey(userId, 'enc');
    const decipher = createDecipheriv('chacha20-poly1305', key, unb64(n), { authTagLength: 16 });
    decipher.setAuthTag(unb64(t));
    return Buffer.concat([decipher.update(unb64(c)), decipher.final()]).toString('utf8');
  }

  async hmac(userId: string, value: string): Promise<string> {
    return createHmac('sha256', this.subkey(userId, 'mac')).update(value).digest('base64url');
  }
}

function loadDevMasterKey(): Buffer {
  const raw = process.env.WORKER_DEV_MASTER_KEY;
  if (raw) {
    const buf = raw.length === 64 ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length !== 32) throw new Error('WORKER_DEV_MASTER_KEY must decode to 32 bytes');
    return buf;
  }
  // Ephemeral: ciphertext is per-process only. Fine for tests, never prod.
  return randomBytes(32);
}

const b64 = (b: Buffer): string => b.toString('base64url');
const unb64 = (s: string): Buffer => Buffer.from(s, 'base64url');
