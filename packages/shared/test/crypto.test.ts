// Crypto 0b — round-trip, tamper-detection, per-user isolation, determinism.
// Tests the BUILT artifact (dist) so we exercise exactly what consumers import.
// A dev master key is set before importing the module (it reads the env lazily).
import { describe, it, expect } from 'vitest';

process.env.WORKER_MASTER_KEY ??=
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'; // 32 bytes, test-only

const {
  encryptForUser, decryptForUser,
  encryptJsonForUser, decryptJsonForUser,
  hmacIdentifier, wrapDEK, unwrapDEK,
} = await import('../dist/index.js');

const U1 = 'user-1111-1111-1111';
const U2 = 'user-2222-2222-2222';

describe('encryptForUser / decryptForUser (text)', () => {
  it('round-trips and emits a v1x envelope distinct from plaintext', async () => {
    const pt = 'client said: 7pm Friday, deposit ok';
    const ct = await encryptForUser(U1, pt);
    expect(ct.startsWith('v1x.')).toBe(true);
    expect(ct).not.toContain(pt);
    expect(await decryptForUser(U1, ct)).toBe(pt);
  });

  it('uses a fresh nonce each call (ciphertexts differ, both decrypt)', async () => {
    const a = await encryptForUser(U1, 'same');
    const b = await encryptForUser(U1, 'same');
    expect(a).not.toBe(b);
    expect(await decryptForUser(U1, a)).toBe('same');
    expect(await decryptForUser(U1, b)).toBe('same');
  });

  it('detects tampering (auth tag) and rejects', async () => {
    const ct = await encryptForUser(U1, 'integrity');
    const parts = ct.split('.');
    const flipped = `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, -2)}AA`;
    await expect(decryptForUser(U1, flipped)).rejects.toThrow();
  });

  it('isolates users: U2 cannot decrypt U1 ciphertext', async () => {
    const ct = await encryptForUser(U1, 'private to U1');
    await expect(decryptForUser(U2, ct)).rejects.toThrow();
  });

  it('rejects malformed ciphertext', async () => {
    await expect(decryptForUser(U1, 'not-a-ciphertext')).rejects.toThrow(/malformed|unsupported/);
  });
});

describe('encryptJsonForUser / decryptJsonForUser (jsonb envelope)', () => {
  it('round-trips structured data', async () => {
    const value = { kind: 'image', storagePath: 'outbound/u1/abc.jpg', bytes: 1234 };
    const env = await encryptJsonForUser(U1, value);
    expect(env).toHaveProperty('v', 'v1x');
    expect(env).toHaveProperty('enc');
    expect(await decryptJsonForUser(U1, env)).toEqual(value);
  });
});

describe('hmacIdentifier (routing index)', () => {
  it('is deterministic per (user, value) and url-safe', async () => {
    const a = await hmacIdentifier(U1, '+61400000000');
    const b = await hmacIdentifier(U1, '+61400000000');
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).not.toContain('+61400000000');
  });

  it('differs across users and across values', async () => {
    expect(await hmacIdentifier(U1, '+61400000000')).not.toBe(await hmacIdentifier(U2, '+61400000000'));
    expect(await hmacIdentifier(U1, '+61400000000')).not.toBe(await hmacIdentifier(U1, '+61400000001'));
  });
});

describe('wrapDEK / unwrapDEK (envelope primitives)', () => {
  it('round-trips a 32-byte DEK under a KEK', async () => {
    const dek = new Uint8Array(32).map((_, i) => (i * 7 + 1) & 0xff);
    const kek = new Uint8Array(32).fill(9);
    const wrapped = await wrapDEK(dek, kek);
    expect(wrapped).toHaveProperty('v', 'v1x');
    expect(new Uint8Array(await unwrapDEK(wrapped, kek))).toEqual(dek);
  });
});
