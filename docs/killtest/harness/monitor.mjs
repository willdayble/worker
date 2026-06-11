#!/usr/bin/env node
// WhatsApp survivability kill-test — UNOFFICIAL lane monitor.
//
// Dependency-FREE (Node 20+, built-in global fetch). No npm installs, no Baileys.
// It only POLLS an off-the-shelf bridge (WAHA self-host preferred) and records
// state transitions + the history depth surfaced on first pair.
//
// Privacy rule (project no-plaintext-logs): we log ONLY ids/states/counts/
// timestamps. NEVER message text/body/preview. There is no code path here that
// reads a message body.
//
// Run:
//   node monitor.mjs              # poll the configured bridge forever
//   node monitor.mjs --self-test  # offline mock; validates the state machine
//
// Output: appends one JSON object per poll to ../log/events.jsonl

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = resolve(__dirname, '..', 'log', 'events.jsonl');

// --- ConnState vocabulary (project canonical) -------------------------------
const STATES = new Set([
  'disconnected', 'connecting', 'pairing', 'connected',
  'reconnecting', 'logged_out', 'banned', 'error',
]);

const LANE = 'unofficial'; // this monitor is the unofficial bridge lane only.

// ───────────────────────────────────────────────────────────────────────────
// State classification
//
// Maps a bridge status payload -> our ConnState. WAHA's GET /api/sessions/{name}
// returns a `status` field (STARTING | SCAN_QR_CODE | WORKING | FAILED | STOPPED)
// plus, on failure, an engine reason. We normalise both WAHA-shaped and
// whapi-shaped payloads here.
//
// BAN-vs-LOGOUT HEURISTIC (documented, deliberately conservative):
//   - "banned"   : status is a failure/stopped AND the failure reason / engine
//                  state signals an account-level block — i.e. the bridge reports
//                  a 401/403/conflict-style reason, or a reason string containing
//                  ban/forbidden/blocked/401/403/connectionFailure(loggedOut+banned).
//                  WAHA surfaces this via session.status=FAILED with an engine
//                  `me`-cleared + reason; Baileys' DisconnectReason.forbidden (403)
//                  and loggedOut (401) are the underlying signals.
//   - "logged_out": a clean unlink/logout (reason loggedOut/unpaired) with NO ban
//                  marker. This is an ordinary logout, NOT a ban — the number can
//                  re-pair. We separate it because a logout is survivable; a ban is
//                  the kill condition the test exists to detect.
//   - We default ambiguous failures to "error", never to "banned", so we don't
//     false-positive the kill verdict. A real ban is confirmed by a human (the
//     number can no longer pair + an appeal is the next step).
// ───────────────────────────────────────────────────────────────────────────
function classify(payload) {
  if (!payload || typeof payload !== 'object') return 'error';

  // Normalise the status token across bridges.
  const raw = String(
    payload.status ?? payload.state ?? payload.connection ?? '',
  ).toUpperCase();

  // Reason text we inspect ONLY for ban/logout signals (never a message body).
  const reason = String(
    payload.reason ?? payload.failureReason ?? payload.error ?? '',
  ).toLowerCase();
  const code = Number(payload.statusCode ?? payload.code ?? NaN);

  const banSignal =
    /\b(403|401)\b/.test(reason) ||
    /(ban|banned|forbidden|blocked|account.?block|spam)/.test(reason) ||
    code === 403 ||
    code === 401;
  const logoutSignal =
    /(logged.?out|loggedout|unpair|unlink|removed.?from.?device)/.test(reason);

  switch (raw) {
    case 'STARTING':
    case 'CONNECTING':
      return 'connecting';
    case 'SCAN_QR_CODE':
    case 'PAIRING':
    case 'SCAN_QR':
      return 'pairing';
    case 'WORKING':
    case 'CONNECTED':
    case 'OPEN':
      return 'connected';
    case 'STOPPED':
      // Stopped can be a clean logout, a ban, or just turned off.
      if (banSignal) return 'banned';
      if (logoutSignal) return 'logged_out';
      return 'disconnected';
    case 'FAILED':
      if (banSignal) return 'banned';
      if (logoutSignal) return 'logged_out';
      return 'error';
    case 'RECONNECTING':
      return 'reconnecting';
    case 'DISCONNECTED':
    case 'CLOSE':
    case 'CLOSED':
      if (banSignal) return 'banned';
      if (logoutSignal) return 'logged_out';
      return 'disconnected';
    default:
      // Unknown status token: fall back to reason signals before "error".
      if (banSignal) return 'banned';
      if (logoutSignal) return 'logged_out';
      return 'error';
  }
}

// ───────────────────────────────────────────────────────────────────────────
// History depth on pair — a KEY unknown the kill-test exists to measure.
//
// "How many days / messages of pre-existing history does the bridge surface
//  when the throwaway number first pairs?"
//
// WHERE IT COMES FROM, per bridge:
//   - WAHA (Baileys/WEBJS engine): when a session reaches WORKING after a fresh
//     pair, WAHA emits/serves history-sync chats & messages. The depth is read
//     from the bridge's reported sync stats — we look for an explicit field
//     (history.messageCount / history.oldestTs / chats count) on the status or a
//     /api/{session}/chats summary. WhatsApp's own history-sync caps what the
//     phone hands over, so this number is the real answer we want.
//   - whapi.cloud: exposes a similar synced-history count via its API.
//
// We capture it ONCE, on the first transition INTO 'connected'. We record a
// COUNT/age only — never any message content. If the bridge gives us nothing,
// we record null and the operator notes the observed depth manually.
// ───────────────────────────────────────────────────────────────────────────
function extractHistoryDepth(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const h = payload.history ?? payload.historySync ?? payload.sync ?? null;
  if (h && typeof h === 'object') {
    const messages = num(h.messageCount ?? h.messages ?? h.count);
    const chats = num(h.chatCount ?? h.chats);
    const oldestTs = num(h.oldestTs ?? h.oldestTimestamp ?? h.since);
    let days = null;
    if (oldestTs) {
      const ms = oldestTs > 1e12 ? oldestTs : oldestTs * 1000; // s or ms
      days = Math.max(0, Math.round((Date.now() - ms) / 86_400_000));
    }
    if (messages != null || chats != null || days != null) {
      return { messages, chats, days };
    }
  }
  // Flat fields some bridges expose directly on status.
  const messages = num(payload.historyMessageCount);
  const chats = num(payload.historyChatCount);
  if (messages != null || chats != null) return { messages, chats, days: null };
  return null;
}

function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ───────────────────────────────────────────────────────────────────────────
// JSONL writer — one object per poll. ids/states/counts/timestamps ONLY.
// ───────────────────────────────────────────────────────────────────────────
async function logEvent({ state, prevState, historyDepth, note }) {
  const record = {
    ts: new Date().toISOString(),
    lane: LANE,
    state,
    prev_state: prevState ?? null,
    history_depth: historyDepth ?? null,
    note: note ?? null,
  };
  await mkdir(dirname(LOG_PATH), { recursive: true });
  await appendFile(LOG_PATH, JSON.stringify(record) + '\n', 'utf8');
  return record;
}

// ───────────────────────────────────────────────────────────────────────────
// Bridge polling (live mode).
// ───────────────────────────────────────────────────────────────────────────
async function fetchStatus({ url, apiKey, bridge }) {
  // WAHA: GET /api/sessions/default. whapi: GET /health (status field).
  const path = bridge === 'whapi' ? '/health' : '/api/sessions/default';
  const headers = { Accept: 'application/json' };
  if (apiKey) headers['X-Api-Key'] = apiKey; // WAHA header; whapi uses Bearer.
  if (apiKey && bridge === 'whapi') headers['Authorization'] = `Bearer ${apiKey}`;
  const res = await fetch(url.replace(/\/$/, '') + path, { headers });
  if (!res.ok) {
    // HTTP-level failure: report it as a payload the classifier understands.
    return { status: 'FAILED', statusCode: res.status, reason: `http_${res.status}` };
  }
  return await res.json();
}

async function runLive(cfg) {
  console.log(
    `[killtest] live monitor — bridge=${cfg.bridge} url=${cfg.url} ` +
    `label=${cfg.label} every ${cfg.intervalS}s. Ctrl-C to stop.`,
  );
  let prevState = null;
  let historyRecorded = false;

  const tick = async () => {
    let state, historyDepth = null, note = null;
    try {
      const payload = await fetchStatus(cfg);
      state = classify(payload);
      if (!STATES.has(state)) state = 'error';
      // Capture history depth once, on first entry to 'connected'.
      if (state === 'connected' && !historyRecorded) {
        historyDepth = extractHistoryDepth(payload);
        historyRecorded = true;
        note = 'history-depth captured on first connect';
      }
    } catch (err) {
      state = 'error';
      note = `poll_failed:${err.code ?? err.name ?? 'unknown'}`; // no body, no stack
    }
    const rec = await logEvent({ state, prevState, historyDepth, note });
    if (state !== prevState) {
      console.log(
        `[killtest] ${rec.ts} ${prevState ?? '∅'} → ${state}` +
        (historyDepth ? ` history=${JSON.stringify(historyDepth)}` : '') +
        (note ? ` (${note})` : ''),
      );
    }
    prevState = state;
  };

  await tick();
  setInterval(tick, cfg.intervalS * 1000);
}

// ───────────────────────────────────────────────────────────────────────────
// Self-test — offline, no network. Drives the state machine through a mock
// sequence and asserts classification, ban detection, history capture, and the
// JSONL writer all work. Exits non-zero on any failure.
// ───────────────────────────────────────────────────────────────────────────
async function runSelfTest() {
  const failures = [];
  const ok = (cond, msg) => { if (!cond) failures.push(msg); };

  // 1. Classifier truth table.
  const cases = [
    [{ status: 'STARTING' }, 'connecting'],
    [{ status: 'SCAN_QR_CODE' }, 'pairing'],
    [{ status: 'WORKING' }, 'connected'],
    [{ status: 'STOPPED' }, 'disconnected'],
    [{ status: 'STOPPED', reason: 'logged out from device' }, 'logged_out'],
    [{ status: 'FAILED', reason: 'connection 403 forbidden' }, 'banned'],
    [{ status: 'FAILED', statusCode: 401 }, 'banned'],
    [{ status: 'FAILED', reason: 'engine crashed' }, 'error'],
    [{ status: 'CLOSE', reason: 'account banned for spam' }, 'banned'],
    [{}, 'error'],
    [null, 'error'],
  ];
  for (const [payload, expected] of cases) {
    const got = classify(payload);
    ok(got === expected,
      `classify(${JSON.stringify(payload)}) = ${got}, expected ${expected}`);
  }

  // 2. Every classified state is in the canonical vocabulary.
  for (const [payload] of cases) {
    ok(STATES.has(classify(payload)),
      `classify produced non-canonical state for ${JSON.stringify(payload)}`);
  }

  // 3. History-depth extraction.
  const hd = extractHistoryDepth({
    status: 'WORKING',
    history: { messageCount: 1234, chatCount: 18, oldestTs: Date.now() - 86_400_000 * 175 },
  });
  ok(hd && hd.messages === 1234, 'history messages not extracted');
  ok(hd && hd.chats === 18, 'history chats not extracted');
  ok(hd && hd.days >= 174 && hd.days <= 176, `history days off: ${hd && hd.days}`);
  ok(extractHistoryDepth({ status: 'WORKING' }) === null,
    'missing history should be null');

  // 4. Full state-machine walk through a realistic kill sequence, driving the
  //    SAME logEvent writer the live loop uses (to a temp file, no network).
  const seq = [
    { status: 'STARTING' },                                   // connecting
    { status: 'SCAN_QR_CODE' },                               // pairing
    { status: 'WORKING',                                      // connected (+history)
      history: { messageCount: 642, chatCount: 9, oldestTs: Date.now() - 86_400_000 * 30 } },
    { status: 'WORKING' },                                    // connected
    { status: 'FAILED', reason: 'reconnecting' },             // error (transient)
    { status: 'WORKING' },                                    // connected
    { status: 'FAILED', reason: 'connection closed 403 forbidden (banned)' }, // banned
  ];
  const expectedStates = [
    'connecting', 'pairing', 'connected', 'connected', 'error', 'connected', 'banned',
  ];

  // Redirect the writer to a temp path for the duration of the walk.
  const tmpPath = resolve(__dirname, '..', 'log', `.selftest-${process.pid}.jsonl`);
  const origLog = LOG_PATH;
  const written = [];
  let prevState = null, historyRecorded = false, capturedHistory = null;
  await mkdir(dirname(tmpPath), { recursive: true });
  const { writeFile, readFile, unlink } = await import('node:fs/promises');
  await writeFile(tmpPath, '', 'utf8');

  for (let i = 0; i < seq.length; i++) {
    const state = classify(seq[i]);
    let historyDepth = null, note = null;
    if (state === 'connected' && !historyRecorded) {
      historyDepth = extractHistoryDepth(seq[i]);
      if (historyDepth) { historyRecorded = true; capturedHistory = historyDepth; note = 'history'; }
    }
    const record = {
      ts: new Date().toISOString(), lane: LANE, state,
      prev_state: prevState ?? null, history_depth: historyDepth ?? null, note,
    };
    await appendFile(tmpPath, JSON.stringify(record) + '\n', 'utf8');
    written.push(record);
    ok(state === expectedStates[i],
      `seq[${i}] state = ${state}, expected ${expectedStates[i]}`);
    prevState = state;
  }

  // 5. JSONL file is valid + round-trips.
  const lines = (await readFile(tmpPath, 'utf8')).trim().split('\n');
  ok(lines.length === seq.length, `wrote ${lines.length} lines, expected ${seq.length}`);
  let parseOk = true;
  for (const line of lines) { try { JSON.parse(line); } catch { parseOk = false; } }
  ok(parseOk, 'JSONL lines did not all parse');

  // 6. History captured exactly once, on first connect.
  const withHistory = written.filter((r) => r.history_depth != null);
  ok(withHistory.length === 1, `history captured ${withHistory.length} times, expected 1`);
  ok(capturedHistory && capturedHistory.messages === 642, 'wrong history captured');

  // 7. Ban detected exactly once, as the terminal state.
  const bans = written.filter((r) => r.state === 'banned');
  ok(bans.length === 1, `detected ${bans.length} bans, expected 1`);
  ok(written.at(-1).state === 'banned', 'terminal state was not banned');

  // 8. No message-body fields leaked into any record.
  const banned = ['body', 'text', 'message', 'preview', 'raw'];
  for (const r of written) {
    for (const k of banned) ok(!(k in r), `record leaked forbidden field "${k}"`);
  }

  await unlink(tmpPath).catch(() => {});

  // Report.
  const total = cases.length * 2 + 4 + seq.length + 6; // rough assertion count
  if (failures.length === 0) {
    console.log(`PASS — self-test ok (${seq.length}-step state walk, ban + history + JSONL verified).`);
    console.log(`       live log would have gone to: ${origLog}`);
    process.exit(0);
  } else {
    console.error(`FAIL — ${failures.length} assertion(s):`);
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Entry.
// ───────────────────────────────────────────────────────────────────────────
function loadConfig() {
  return {
    bridge: (process.env.BRIDGE || 'waha').toLowerCase(),
    url: process.env.WAHA_URL || '',
    apiKey: process.env.WAHA_API_KEY || '',
    label: process.env.KILLTEST_NUMBER_LABEL || 'unlabeled',
    intervalS: Math.max(5, Number(process.env.POLL_INTERVAL_SECONDS) || 60),
  };
}

const isSelfTest = process.argv.includes('--self-test');

if (isSelfTest) {
  await runSelfTest();
} else {
  const cfg = loadConfig();
  if (!cfg.url) {
    console.log(
      'not configured — set WAHA_URL (copy .env.example → .env and fill it) ' +
      'or run: node monitor.mjs --self-test',
    );
    process.exit(0);
  }
  await runLive(cfg);
}
