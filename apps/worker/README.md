# apps/worker — messaging worker (Track A)

Always-on Node service that holds channel sessions, ingests inbound messages, and sends
human-approved outbound across WhatsApp (official + unofficial) and Telegram — fully
decoupled from the CRM. A platform ban costs a *channel*, never the worker's data.

> Owns `apps/worker/**` (CONTRACTS §1). Implements the `MessagingProvider` interface from
> `@workerchat/shared` (Track B owns the interface; A implements adapters here). Provider SDKs
> (grammY, later Baileys) live **only** in this package's `package.json`, never in
> `packages/shared`.

## Status (this slice)

- ✅ **TelegramProvider** — the critical path; real grammY transport, full round-trip proven
  offline (`pnpm test`, 12/12). Inbound → normalize → encrypt → persist (idempotent,
  ciphertext-at-rest); human-approved outbound claim → decrypt-in-memory → send → mirror.
- ✅ **Kill-test** harness + protocol — `docs/killtest/` (separate workstream).
- ✅ **WhatsAppOfficialProvider** — Cloud API + Coexistence, built + tested (22 tests). Adapter:
  webhook ingest (text/media/status + Coexistence `smb_message_echoes` → `fromMe=true`), send
  (text/template/media), 24h-window handling (Meta 131047 → `windowState:'closed'`),
  `X-Hub-Signature-256` verification, real `fetch` transport. **Webhook receiver**
  (`runtime/whatsapp-webhook-server.ts`) — GET subscribe challenge, POST signature-verify-before-parse,
  routes by `phone_number_id` to the right user's provider; **wired into `index.ts`** (runs when
  `WHATSAPP_*` env is set). Pending: Coexistence onboarding/QR, ~180d history backfill, inbound
  media download→storage. Env (dev): `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` /
  `WHATSAPP_APP_SECRET` / `WHATSAPP_VERIFY_TOKEN` (+ optional `WHATSAPP_WEBHOOK_PORT`, default 3001).
- ⛔ **WhatsAppUnofficialProvider** — class shell only, **gated** behind `ENABLE_WHATSAPP_UNOFFICIAL`
  *and* a GO verdict in `docs/killtest/results.md`. No Baileys code until the verdict (per brief).

## Architecture

```
provider (grammY/WA)  ──onInbound──▶  SessionRuntime  ──▶  MessageSink ──▶  DB
   adapters/*.ts        (normalize)      runtime/         (encrypt-before-insert)
        ▲                                   │
        └────────────── send() ◀── claim bridge_outbound (human-approved) ── drain loop
```

- **`messaging/adapters/`** — one class per channel; provider I/O + normalization only.
  `telegram.ts` depends on a tiny `TelegramTransport` seam (testable); `telegram-grammy.ts` is
  the only file importing grammY.
- **`runtime/session-runtime.ts`** — one runtime **per connected user** (isolated-session
  model: the frozen `onInbound(handler)` carries no userId; the key lives in memory only while
  connected). Wires inbound + drives the outbound claim-then-send loop (idempotent, M16).
- **`core/sink.ts`** — the only place Track A writes the DB; scoped to the tables A may touch
  (CONTRACTS §3). Owns the `Encryptor`, so encrypt-before-insert is structural. `InMemorySink`
  drives the offline tests; **`persistence/supabase-sink.ts`** is the production sink against
  migration 0001 (service_role, M7 identity, optimistic claim-then-send, in-thread outbound
  mirror) — code-complete, **not yet integration-tested** (schema 1a not applied to the live DB).
- **`core/crypto.ts`** — the `Encryptor` port. `SharedEncryptor` delegates to
  `@workerchat/shared` (KMS/libsodium, **throws until Deliverable 0b** — correct). `NodeCryptoEncryptor`
  is a working dev/test stand-in (node:crypto `chacha20-poly1305`), **never production**.
- **`core/logger.ts`** — id-only structured logger. No `text`/`body`/`preview`/`raw` field
  exists, so no plaintext can reach stdout (CONTRACTS §4 m4).

## Run

```bash
pnpm --filter @workerchat/worker test        # offline round-trip harness (no token/network)
pnpm --filter @workerchat/worker typecheck
TELEGRAM_BOT_TOKEN=… pnpm --filter @workerchat/worker dev   # live Telegram smoke test
```

Copy `.env.example` → `.env` (gitignored; real secrets via Doppler, project `worker`).

## Pending dependencies (other tracks)

- **Track B / Deliverable 0b** — real crypto. `SharedEncryptor` already points at it; no worker
  change when it lands. Until then production startup throws by design.
- **Track B / Deliverable 1a (applied)** — `supabase/migrations/0001_channel_contract.sql` is
  in place but **not applied to the live DB** (Supabase pooler/IPv6 blocker; ref `hyqcorryqiolevhmchbl`).
  `SupabaseSink` is wired in `index.ts` (used when `SUPABASE_URL`+`SUPABASE_SERVICE_ROLE_KEY` are set);
  it needs a human to apply 1a via the dashboard, then a live round-trip to verify. Production
  hardening: ask Track B for a `claim_outbound(user_id)` `FOR UPDATE SKIP LOCKED` RPC (atomic claim).
- **Hosting** — always-on, never serverless (Fly.io/Railway/VPS + PM2); paid Redis for the
  outbound queue when BullMQ replaces the in-process drain loop.
