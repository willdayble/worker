// Id-only structured logger (CONTRACTS §4 "No plaintext in logs or telemetry", red-team m4).
//
// Platform stdout (Railway/Fly) is an EXTERNAL sink. Message text, bodies, previews,
// caption, error strings from providers, and `raw` must NEVER reach it. This logger
// accepts only a typed bag of SAFE fields — ids, states, counts, timestamps, channel,
// boolean flags. There is deliberately no `text`/`body`/`preview`/`raw` field, so the
// CI grep for log calls referencing those finds nothing in Track A.
//
// When you must surface that *an* error happened, log a stable `errorCode`/`reason`
// token — never the provider's error message (it can echo message content).

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Only non-sensitive primitives. No free-text from messages/providers. */
export interface SafeFields {
  event: string;                 // stable event name, e.g. 'inbound.upserted'
  userId?: string;               // we log a short prefix only (see fmtUserId)
  channel?: string;
  channelUserId?: string;        // provider id (phone JID / tg id) — operational, not message content
  threadKey?: string;
  providerMessageId?: string;
  conversationId?: string;
  state?: string;
  prevState?: string;
  status?: string;
  reason?: string;               // a STABLE token (e.g. 'auth_expired'), never a provider message
  errorCode?: string;            // a STABLE token, never err.message
  count?: number;
  bytes?: number;
  attachments?: number;
  durationMs?: number;
  ok?: boolean;
  fromMe?: boolean;
  isHistorical?: boolean;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

/** User ids are uuids; log only an 8-char prefix to correlate without spraying full ids. */
export function fmtUserId(userId: string): string {
  return userId.length > 8 ? `${userId.slice(0, 8)}…` : userId;
}

function emit(level: LogLevel, fields: SafeFields): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN]) return;
  const line: Record<string, unknown> = { level, ...fields };
  if (fields.userId) line.userId = fmtUserId(fields.userId);
  // JSON line — structured logs carry ids/timestamps/counts only.
  // (No Date.now() reliance for content; ts added by the platform / can be added by caller.)
  process.stdout.write(JSON.stringify(line) + '\n');
}

export const log = {
  debug: (f: SafeFields) => emit('debug', f),
  info: (f: SafeFields) => emit('info', f),
  warn: (f: SafeFields) => emit('warn', f),
  error: (f: SafeFields) => emit('error', f),
};

/**
 * Map an arbitrary thrown value to a STABLE token safe to log. Never returns the
 * provider's message string (which can contain echoed content). Extend the map as
 * adapters surface real provider error shapes.
 */
export function errorToken(err: unknown): string {
  if (err && typeof err === 'object') {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    if (typeof code === 'number') return `code_${code}`;
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number') return `http_${status}`;
  }
  return 'unknown';
}
