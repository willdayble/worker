import 'server-only';

// Server-only re-export of the shared crypto seam. Importing this from a client
// component is a build error — sensitive decryption happens ONLY on the server
// (CONTRACTS §5). Reads WORKER_MASTER_KEY from the environment.
export {
  encryptForUser,
  decryptForUser,
  encryptJsonForUser,
  decryptJsonForUser,
  hmacIdentifier,
} from '@workerchat/shared';

/** Decrypt, swallowing failures to a fallback so one bad row can't blank the inbox. */
export async function safeDecrypt(
  decryptFn: (userId: string, ct: string) => Promise<string>,
  userId: string,
  ciphertext: string | null | undefined,
  fallback = '',
): Promise<string> {
  if (!ciphertext) return fallback;
  try {
    return await decryptFn(userId, ciphertext);
  } catch {
    return '⚠︎ (unable to decrypt)';
  }
}
