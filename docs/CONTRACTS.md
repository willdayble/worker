# WorkerApp — Frozen Contracts (v0.2)

*These interfaces decouple the three tracks so they can build in parallel. **Changing any
contract requires editing this file and notifying the other tracks via the orchestrator.***
Pseudocode is TypeScript-flavored; Track B owns the canonical definitions in
`packages/shared`. v0.2 folds in the scope red-team fixes (`docs/research/_redteam.json`).

> **Deliverable −1 (human/orchestrator) blocks everything.** Before any track starts:
> (1) create the clean Supabase project, (2) provision the secrets manager (Infisical/Doppler),
> (3) load Track B service creds, (4) confirm the old project `zipruaqabvuwoxrnyqox` is
> decommissioned for new work. The clean-vs-reuse decision is **RESOLVED = clean**
> (`SECURITY-ACTIONS.md` §3).

---

## 1. Ownership map (who edits what — no file collisions)

| Path | Owner | Others may |
|---|---|---|
| `apps/worker/**` (incl. `apps/worker/src/messaging/adapters/**`) | **Track A** | read |
| `apps/web/**` | **Track B** | read |
| `packages/shared/**` (interface, types, schema, zod, crypto, **its `package.json`/`tsconfig.json`/`src/index.ts`**) | **Track B** | read; A imports via `@workerapp/shared` |
| `supabase/migrations/**` | **Track B** | read |
| `docs/killtest/**` | **Track A** | orchestrator + C read |
| `docs/site/**` | **Track C** | read |
| repo-root scaffold (`package.json`, `pnpm-workspace.yaml`, `lefthook.yml`, `.github/`, `.claude/settings.json`) | **Track B** bootstraps; orchestrator approves | read |
| `docs/SCOPE.md`, `docs/CONTRACTS.md`, `docs/research/**` | **orchestrator** | **read-only** |

**Structural rules that make the partition clean (red-team C1–C3):**
- **Messaging adapters live in `apps/worker/src/messaging/adapters/**` (Track A), NOT in
  `packages/shared`.** They import the interface from `@workerapp/shared`. This makes
  `packages/shared` wholly Track B and prevents a provider chat SDK from leaking into `apps/web`.
- **Provider SDKs (Baileys, grammY/telegraf, libsodium-for-adapters) are declared only in
  `apps/worker/package.json`** — never a dependency of `packages/shared`.
- **`apps/worker` bootstrap:** Track B adds `apps/*` to `pnpm-workspace.yaml` only. Track A
  runs `pnpm init` for the worker and owns `apps/worker/package.json` and all its runtime deps
  from the first commit. B never writes into `apps/worker/**`.
- **`.claude/settings.local.json` is out of scope** for the scaffold (per-user, gitignored,
  already exists). B creates `.claude/settings.json` (committed) with deny rules only.
- **Track B *defines* interfaces/schema; Track A *implements* adapters against them.** If an
  adapter reveals a missing field/column, A does **not** edit the interface or add a migration —
  it files an orchestrator request; B edits + version-bumps `packages/shared` (and adds the
  migration); A pins to the new version. See the change protocols in §2 and §3.

---

## 2. `MessagingProvider` interface (the channel abstraction)

One interface, three implementations (`WhatsAppOfficial`, `WhatsAppUnofficial`, `Telegram`),
all under `apps/worker/src/messaging/adapters/`. The CRM (Track B) **never** imports a provider;
it reads/writes the DB and enqueues outbound. The worker (Track A) is the only code touching a provider.

```ts
// packages/shared/src/messaging/interface.ts  (Track B owns; Track A implements in apps/worker)

type Channel = 'whatsapp_official' | 'whatsapp_unofficial' | 'telegram';

type ConnState =
  | 'disconnected' | 'connecting' | 'pairing' | 'connected'
  | 'reconnecting' | 'logged_out' | 'banned' | 'error';

type DisconnectReason =
  | 'network' | 'logged_out' | 'banned' | 'conflict' | 'auth_expired' | 'unknown';

type MessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

interface NormalizedContact {
  channel: Channel;
  channelUserId: string;       // provider-native id (phone JID, telegram user id)
  phoneE164?: string;          // when known
  displayName?: string;
}

interface InboundAttachment {                 // provider → us
  kind: 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location' | 'other';
  mimeType?: string;
  url?: string;                // our stored URL AFTER the worker downloads to storage
  caption?: string;
  bytes?: number;
}

interface OutboundAttachment {                // CRM → us → provider
  kind: 'image' | 'audio' | 'video' | 'document';
  storageBucket: string;       // e.g. 'outbound-media'
  storagePath: string;         // worker reads this blob (service_role) then uploads to provider
  mimeType: string;
  bytes: number;
  filename?: string;
  caption?: string;
}

interface InboundMessage {
  channel: Channel;
  providerMessageId: string;   // idempotency/dedup key
  from: NormalizedContact;
  threadKey: string;           // `${channel}:${channelUserId}`
  text?: string;
  attachments?: InboundAttachment[];
  timestamp: string;           // ISO 8601 — provider send time (authoritative ordering)
  fromMe: boolean;             // true if echoed from the worker's own device (WA CoEx echoes)
  isHistorical?: boolean;      // true if delivered by a history backfill, not live
  raw?: unknown;               // debug only — NEVER persisted, NEVER logged
}

interface OutboundMessage {
  channel: Channel;
  toChannelUserId: string;
  text?: string;
  attachments?: OutboundAttachment[];          // plural; symmetric with inbound
  template?: { name: string; language: string; variables: string[] };  // WA-official, window closed
  idempotencyKey: string;      // uuid; prevents duplicate sends across worker restarts
}

interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  status: MessageStatus;
  windowState?: 'open' | 'closed' | 'n/a';     // WA-official 24h window
  error?: string;
}

interface ProviderCapabilities {
  historySyncDays: number;       // 0 = new-onward; ~180 for WA CoEx
  historySyncMode: 'bulk' | 'paged' | 'none';
  mediaSync: boolean;
  requires24hWindow: boolean;    // true for WA official
  groups: boolean;               // false for WA official
  echoesOwnDeviceMessages: boolean; // true for WA CoEx (smb_message_echoes)
  deliveryReceipts: boolean;     // WA true, Telegram false
  readReceipts: boolean;         // WA true (settings-dependent), Telegram false, Baileys depends
  connectMethod: 'qr' | 'pair_code' | 'oauth' | 'bot_token';
  messagingTier?: number;        // WA-official only
  throughputMps?: number;        // WA-official only
}

interface MessagingProvider {
  channel: Channel;
  capabilities: ProviderCapabilities;
  connect(userId: string): Promise<{ state: ConnState }>;   // INITIATES only; see §4 re-surfacing
  getStatus(userId: string): Promise<{ state: ConnState; channelUserId?: string }>;
  send(userId: string, msg: OutboundMessage): Promise<SendResult>;
  syncHistory(userId: string, opts?: { sinceDays?: number; cursor?: string }):
    Promise<{ done: boolean; cursor?: string; imported: number }>;
  disconnect(userId: string): Promise<void>;
  onInbound(handler: (m: InboundMessage) => Promise<void>): void;  // worker wires → encrypt → DB
}
```

**Interface-change protocol (red-team M4):** an adapter that discovers a missing field files
an orchestrator request; **Track B** edits `interface.ts` and bumps the `@workerapp/shared`
version; Track A pins to the new version. Track A must not edit `interface.ts`, even transiently.

**Capability-driven UI:** Track B reads `capabilities` (surfaced via `channels.capabilities`)
to render the right connect UI (`connectMethod`), the WA "24h window closing — template only"
banner, hide groups, hide read-ticks when `readReceipts=false`, show "syncing history…", etc.
No channel-specific branching in CRM logic beyond capabilities.

---

## 3. Database schema contract (channel-agnostic)

Track B owns migrations. Track A conforms. Mine `first_attempt/wacrm/supabase/migrations/`
for the rich CRM columns — **but fix its RLS holes** (see §5). Split delivery:
- **Deliverable 1a (apply immediately, unblocks A):** the minimum channel contract below —
  `channels`, `contacts`, `contact_channels`, `conversations`, `messages`, `bridge_outbound`,
  `acquisition_sources`, and a channels-scoped Baileys auth-state table. **These columns are
  guaranteed-present-at-A-start.**
- **Deliverable 1b (parallel):** the rich CRM schema (practices/screening/pipeline/deals/tags).

```
users            (id, email, ...)                       -- Supabase auth

channels         (id, user_id, channel, channel_user_id, state, capabilities jsonb,
                  qr, pair_code, last_error, disconnect_reason, state_updated_at,
                  history_sync_state 'idle'|'syncing'|'complete'|'failed',
                  history_synced_through timestamptz, connected_at)

contacts         (id, user_id, display_name, acquisition_source_id,
                  is_flagged bool default false, flag_reason_enc, flag_set_by, flag_locked_at,
                  ...)                                   -- channel-agnostic PERSON; CRM-owned

contact_channels (id, contact_id, user_id, channel, channel_user_id, phone_e164, display_name,
                  UNIQUE(user_id, channel, channel_user_id))   -- a person's per-channel identities

conversations    (id, user_id, contact_id, channel, thread_key,
                  UNIQUE(user_id, thread_key), status, window_expires_at,
                  last_message_at, last_message_preview_enc)

messages         (id, conversation_id, direction 'in'|'out', provider_message_id,
                  content_type, body_enc, attachment_url, is_historical bool default false,
                  status MessageStatus, status_updated_at, error_code,
                  sent_at timestamptz NOT NULL, created_at timestamptz default now(),
                  UNIQUE(conversation_id, provider_message_id))
                  -- INDEX (conversation_id, sent_at)

bridge_outbound  (id, user_id, channel, to_channel_user_id_enc, to_channel_user_id_hmac,
                  body_enc, attachment_enc jsonb, template_enc jsonb,
                  idempotency_key uuid NOT NULL default gen_random_uuid(),
                  status 'pending'|'sending'|'sent'|'failed', claimed_at, provider_message_id,
                  error, created_at)

acquisition_sources (id, user_id, label, utm jsonb, created_at)   -- write-once first-touch
wa_templates     (id, user_id, channel_id, name, language,
                  category 'marketing'|'utility'|'authentication',
                  status 'pending'|'approved'|'rejected'|'paused'|'disabled',
                  body_text, variable_schema jsonb, provider_template_id, updated_at)
wa_auth_state    (id, user_id, channel_id, creds_enc, keys_enc, updated_at)  -- Baileys session
deals/bookings · tags/practices (...)                  -- CRM-owned (Deliverable 1b)
```

**Contract rules**
- **Idempotency:** every inbound write is upsert by `(conversation_id, provider_message_id)`.
- **`thread_key`** = `${channel}:${channel_user_id}` — stable, channel-namespaced.
- **Ordering by `sent_at`** (provider timestamp), never `created_at` (insert time). Backfill
  interleaves with live; order by `sent_at`. Optional `messages.seq` tiebreaker.
- **`*_enc` columns hold ciphertext** (§5). Plaintext bodies/identifiers are never stored.
- **Track A may** insert into `contact_channels`/`contacts`/`conversations`/`messages`, update
  channel state + outbound status. It **must NOT** touch CRM-owned tables (deals/tags/pipeline)
  and **must NOT modify** `is_flagged`/`flag_reason_enc` or re-bind a flagged contact (M14):
  a changed `channel_user_id` on a flagged contact creates a NEW contact + a human-review task —
  flags are append-only with human-driven false-positive recovery.
- **Contact identity (M7):** A upserts into `contact_channels` (deterministic by
  `user_id+channel+channel_user_id`), creating a `contacts` row only if no link exists.
  Auto-merge only on exact `phone_e164` match; the CRM owns merge/unmerge UI.
- **Schema-change protocol (M3):** if A needs a column/enum it lacks, it requests via the
  orchestrator; B adds the migration + bumps `packages/shared` types, then notifies A. A never
  writes a migration.

---

## 4. Queue & event contract (worker ⇄ CRM)

Decoupled via Postgres rows + Redis/BullMQ in `apps/worker`. The CRM never calls the worker's
process for sends; it enqueues.

- **Inbound:** provider → Track A normalizes → **encrypts body/identifiers** → upsert
  `messages`(`in`) + update `conversations` (incl. `window_expires_at = last_inbound + 24h` for
  WA-official). Realtime to CRM via Supabase Realtime on `messages`.
- **Outbound (claim-then-send, idempotent — M16):** CRM inserts `bridge_outbound`(`pending`)
  **only after human approval** → worker atomically claims (`pending→sending` + `claimed_at`),
  decrypts in memory, calls `provider.send()` with `idempotencyKey`, updates status +
  `provider_message_id`, mirrors into `messages`(`out`), then **tombstones/purges** the
  outbound plaintext. A `sending` row older than N minutes with no `provider_message_id` is
  surfaced for manual review — **never blindly re-sent.**
- **Media upload (C4):** CRM uploads the blob to Supabase Storage bucket `outbound-media`
  (RLS by `user_id`), writes the path into `bridge_outbound.attachment_enc` → worker reads via
  `service_role`, uploads to the provider (WA: `POST /media` → media_id; Telegram: multipart/
  file_id; Baileys: stream), then tombstones the blob.
- **Delivery/read status (C5):** provider status webhooks (WA `statuses`; Telegram none —
  synthesize on send) → Track A updates `messages.status`/`status_updated_at` by
  `provider_message_id` → surfaced to CRM via the existing Realtime subscription.
- **History backfill (M5):** `syncHistory()` pages provider history; each message is an
  idempotent upsert with `is_historical=true`, ordered by `sent_at`; A updates
  `channels.history_sync_state`/`history_synced_through`. CRM shows a "syncing history…" state
  and must not run AI-assist / unread badges on historical bulk.
- **Connect / QR / pair (C6):** CRM calls `POST /connect/:userId` (INITIATES only). Track A
  writes the current `qr`/`pair_code`/`state`/`last_error` into the `channels` row on every
  rotation/state change; the CRM **subscribes to that row via Realtime** and re-renders (WA QR
  rotates ~20s). The CRM renders the connect UI per `capabilities.connectMethod`.
- **Endpoint auth (M12 — do NOT repeat the first_attempt static-secret design):** bridge
  endpoints are authenticated by the caller's **Supabase user JWT** (verified server-side); the
  `:userId` in the path MUST equal the JWT subject. Any service-to-service secret is compared
  with `crypto.timingSafeEqual`, is per-environment, rotated, and never doubles as per-user
  authorization.
- **No plaintext in logs or telemetry (m4):** `raw` and any text/body/preview/error fields are
  redacted before logging; structured logs carry only ids/timestamps/counts. Platform stdout
  (Railway/Fly/Vercel) is an external sink. CI greps Track A for log calls referencing
  text/body/preview/raw.

---

## 5. Encryption boundary (prototype) + threat model

Per **SCOPE §6** (honest tension). For the prototype:
- **Encrypt at rest, per user:** `messages.body_enc`, `conversations.last_message_preview_enc`,
  `contacts.flag_reason_enc`, **`bridge_outbound.body_enc`/`attachment_enc`/`template_enc` and
  the destination identifier (`to_channel_user_id_enc`; store a salted **HMAC**
  `to_channel_user_id_hmac` if a routing index is needed — never raw E164)**, `wa_auth_state`
  creds/keys, and all client-identifying free-text. Algorithm: libsodium
  **XChaCha20-Poly1305**; per-user **DEK** via envelope encryption; DEK material in a KMS,
  loaded into the isolated worker process only while that user's session is connected.
- **Not encrypted (operational):** ids, timestamps, channel, status, `thread_key`,
  `provider_message_id`, counts. Enough for routing/queries; minimal PII.
- **Threat model (be honest — M11):** at-rest encryption defeats cold DB/disk/backup theft.
  It does **NOT** defend against a live-server compromise or KMS-credential theft while a
  session is active — the operator can technically decrypt then. Not zero-knowledge; that's roadmap.
- **RLS on every table, deny-by-default, keyed by `user_id`** as defence-in-depth *under*
  encryption. **No policy may use `WITH CHECK (true)` or `USING (true)`** (the first_attempt
  schema ships these at `001_initial_schema.sql:185` and `015_practices.sql:45` — fix on port).
  Every policy (incl. INSERT) constrains to the row's `user_id` via `auth.uid()`; for
  `service_role` worker writes the app sets/verifies `user_id` and the policy still asserts
  ownership (e.g. `messages` INSERT `WITH CHECK (EXISTS (SELECT 1 FROM conversations c WHERE
  c.id = conversation_id AND c.user_id = auth.uid()))`). `service_role` only in the worker +
  trusted server jobs, never the browser. **CI fails the build if a migration contains
  `CHECK (true)` or `USING (true)`.**
- **Roadmap (not prototype):** move DEKs to client-held keys for users who accept on-device
  ingestion; columns are designed to migrate to true E2EE without a rewrite.

---

## 6. AI-assist contract (CRM-side, Track B)

One **schema-constrained** model call per inbound message (structured output / strict JSON):

```ts
interface InboundAnalysis {
  is_booking: boolean;
  booking_fields?: { service_label?: string; date?: string; time?: string;
                     location_type?: 'at_provider' | 'at_client' | 'remote' | 'other';
                     amount?: number };          // NEUTRAL terms only (M13)
  intent_tags: string[];
  service_tags: string[];          // map to the practices/tags menu
  red_flags: string[];             // ADVISORY only — never an automated decision
  suggested_reply: string;         // draft — NEVER auto-sent
  confidence: number;              // 0..1
}
```

- **Neutral schema (M13):** field names/enums stay general-purpose — no industry-specific terms.
  The AI extracts generic appointment data; it does not broker a transaction.
- **Routing in deterministic code, not the model:** `confidence ≥ T` → auto-tag + stage a
  *draft*; `< T` → escalate to human with full thread. **Never auto-send. Never auto-block.**
- **Disclosure covers BOTH directions (M15):** (a) outbound — any AI-authored message reaching
  a client is sent by the worker after approval, or clearly labeled as an assistant (SB 243 /
  EU AI Act); (b) **inbound — client messages are AI-processed for tagging/red-flagging**, which
  is automated processing of third-party special-category data: `red_flags` are advisory only
  (no GDPR Art. 22 automated decision), retained minimally; onboarding/privacy notice must
  disclose inbound AI analysis. No special-category inference persisted beyond the advisory flag
  + audit log.
- **Model routing:** Haiku 4.5 for per-message extraction/classification; Sonnet 4.6 / Opus 4.8
  for drafting/judgment. One large **cached** system prompt; Batch API for backfill.

---

## 7. Stack & repo scaffold (Track B bootstraps, orchestrator approves)

```
workerapp/
  apps/
    web/         # Next.js + TS (Vercel). CRM UI + AI-assist + connect screens. NEVER imports a chat SDK.
    worker/      # Always-on Node (Fly.io/Railway) + BullMQ/Redis. Holds sessions. (Track A)
      src/messaging/adapters/   # Telegram / WhatsAppOfficial / WhatsAppUnofficial — import @workerapp/shared
  packages/
    shared/      # types, DB schema, zod, crypto (libsodium), MessagingProvider INTERFACE. No provider SDKs.
  supabase/migrations/   # RLS-first schema (no WITH CHECK (true))
  lefthook.yml           # root pre-commit (gitleaks etc.) — Track B owns; track checks added as commands
  .claude/settings.json  # deny Read(./.env), Read(./.env.*), Read(./secrets/**)  (do NOT touch settings.local.json)
  .github/workflows/     # eslint, tsc --noEmit, tests, gitleaks, "grep migrations for CHECK (true)"
```

- Session layer **cannot** be serverless (Vercel: no 24/7 WebSocket; 300s/800s caps).
- Supabase web access via transaction-pooled connection; worker via direct/session connection.
- Always-on **paid** hosting for worker + Redis (free Supabase projects pause after 7 days idle).

---

## 8. Definition of "contract-compliant" (each track self-checks)

- **Track A:** every inbound idempotent + encrypted before insert; outbound only consumes
  human-approved `bridge_outbound` rows, claim-then-send with `idempotencyKey`; QR/pair/state
  written to the `channels` row for Realtime re-surfacing; status webhooks update
  `messages.status`; `ConnState` maps ban vs transient correctly; exposes full `capabilities`;
  no writes to CRM-owned tables; never modifies a flag; **no plaintext in logs**; JWT+timing-safe
  endpoint auth; pinned provider deps.
- **Track B:** `packages/shared` published (0a stubs first, then 0b impls); schema 1a applied to
  unblock A; **RLS on every table, no `CHECK (true)`/`USING (true)`, CI-enforced**; AI never
  auto-sends/auto-blocks; CRM imports no provider SDK; capability-driven UI; honest encryption
  claims; provider SDKs absent from `packages/shared/package.json`.
- **Track C:** documents only; figures traceable to `docs/research/`; kill-test verdict sourced
  from `docs/killtest/`; at-rest vs zero-knowledge presented as DISTINCT; no industry-specific
  schema terms on public pages.
