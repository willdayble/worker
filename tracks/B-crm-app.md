# Track B — CRM App + Data / Infra (the platform track)

> Read `docs/SCOPE.md` and `docs/CONTRACTS.md` first. You own `apps/web/**`,
> `packages/shared/**` (interfaces, schema, types, crypto), `supabase/migrations/**`, and
> you bootstrap the monorepo. **You are the platform:** publish the schema + `MessagingProvider`
> interface early so Track A can implement against them.

## Mission
A channel-agnostic CRM that turns conversations into bookings, fully decoupled from any
messaging session. The CRM imports **no** chat SDK — it reads/writes the DB and enqueues
human-approved outbound (CONTRACTS §3–4).

## Deliverable 0 (unblocks Track A — do first)
- **Prerequisite (Deliverable −1, human):** confirm the orchestrator has provisioned a clean
  Supabase project + secrets manager. **If absent, STOP and request it — do NOT reuse
  `zipruaqabvuwoxrnyqox`** (compromised; `SECURITY-ACTIONS.md`). Secrets via Infisical/Doppler,
  never committed.
- Bootstrap monorepo: pnpm workspaces with `apps/web` + `packages/shared`; add `apps/*` to
  `pnpm-workspace.yaml` but **do not scaffold `apps/worker`** — Track A runs `pnpm init` there
  and owns its `package.json` (CONTRACTS §1). Add `lefthook.yml` (root) running `gitleaks`
  pre-commit; CI = eslint + `tsc --noEmit` + tests + gitleaks + a `grep` that **fails on
  `CHECK (true)` / `USING (true)`** in migrations. Create `.claude/settings.json` (committed)
  with **deny rules only** for `.env*` / `secrets/**`; **do not touch
  `.claude/settings.local.json`** (per-user, gitignored).
- **Publish `packages/shared` in two steps:** **0a (FIRST, hours)** = the `MessagingProvider`
  interface (verbatim from CONTRACTS §2) + exported TS types for every §3 table + zod validator
  signatures + crypto helper *signatures* with throwing stubs (`encryptForUser` /
  `decryptForUser` / `wrapDEK`); **git-tag `shared-0a` and ping the orchestrator** so Track A
  can build. **0b** = real libsodium crypto impls (envelope encryption, per-user DEK). **No
  provider SDKs in `packages/shared/package.json`.**

## Deliverable 1: schema + RLS (mine `first_attempt/wacrm/supabase/migrations`)

**Split for parallelism:** **1a** = the minimum channel contract (`channels`, `contacts`,
`contact_channels`, `conversations`, `messages`, `bridge_outbound`, `acquisition_sources`,
`wa_auth_state`, `wa_templates`) — apply IMMEDIATELY so Track A can integrate. **1b** (parallel)
= the rich CRM schema below.

The prior CRM schema is genuinely good — port it, don't reinvent. It already models your
test user's asks:
- `acquisition_channel` (017) = **client entry-point attribution** → make it write-once
  first-touch, capture UTM into hidden form fields + cookie.
- `contact_screening` (022) = deposit/ID/refs safety badges.
- `practices`/`service_practices` (015/023) = the shared-**tag** ("ice cream") concept,
  Yes/Maybe/No. Keep `user_id`-scoped now; design so it can become cross-worker later.
- pipelines/deals (001/018–022) = Enquiry→Screening→Confirmed→Completed/Lost, fee/tip/
  discount/location/date — the **booking close-loop**.
Add per CONTRACTS §3: `channels` (+ qr/pair/state/history cols), `contact_channels`
(cross-channel identity), channel-agnostic `conversations.thread_key` + `window_expires_at`,
`messages` (`direction`/`status`/`sent_at`/`is_historical`), encrypted `bridge_outbound`
(+ `idempotency_key`), `wa_templates`, `wa_auth_state`, and **`*_enc` ciphertext columns**.
**RLS on every table, deny-by-default, keyed by `user_id` — and when porting `001`, REPLACE the
`messages` INSERT policy `WITH CHECK (true)` (line 185) with a conversation-ownership check, and
fix `015` line 45 `USING (true)`; audit every ported policy.** No `CHECK (true)` / `USING (true)`
anywhere (CI-enforced). `service_role` only in the worker/server jobs, never the browser. Index
every `user_id`. Test policies from the client SDK (the SQL editor bypasses RLS).

## Deliverable 2: the CRM UX (steal, don't invent — SCOPE §6 of research)
- **Inbox** (conversation list + thread + composer) — but the composer **stages a draft for
  human approval**, then inserts a `bridge_outbound` row. Realtime via Supabase on `messages`.
- **Contacts** (profiles, tags, star rating, screening badges, acquisition source, "due for
  rebook", flag-as-dangerous → advisory, with audit log + false-positive recovery).
- **Pipeline** (kanban) + **booking close-loop** (won/lost/time-waster/dangerous + service/
  fee/date). **Calendar**, **services/practices menu**.
- **Capability-driven UI:** read `channels.capabilities` to show the WA "24h window closing —
  template only" banner, hide groups, etc. No channel-specific branching beyond capabilities.
- **Dashboards/data-dump** across test users (with explicit consent): sources, conversion,
  time-to-book.

## Deliverable 3: AI-assist (CONTRACTS §6)
Schema-constrained call per inbound → `InboundAnalysis`. Confidence routing in **deterministic
code**: high → auto-tag + draft; low → escalate with full thread. **Never auto-send, never
auto-block.** Disclosed assistant. Haiku for per-message; Sonnet/Opus for drafting; cached
system prompt; Batch API for backfill.

## Constraints / gotchas
- **Next.js 16** (App Router, Turbopack) — `first_attempt/wacrm/AGENTS.md` warns it differs
  from training data; check `node_modules/next/dist/docs/` before writing.
- CRM imports **no** provider SDK; talks to channels only through the DB/queue contract.
- Encryption boundary per CONTRACTS §5 — sensitive free-text + bodies are `*_enc`.
- Don't build payments, cross-worker federation, or autonomous negotiation (SCOPE §4 out-of-scope).

## Definition of done
Monorepo + clean Supabase + published `packages/shared` (Track A unblocked); RLS-tested
schema; inbox/contacts/pipeline/close-loop/attribution working against seeded data;
AI-assist drafting with human approval; capability-driven channel UI.
