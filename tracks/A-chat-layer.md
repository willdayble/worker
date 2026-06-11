# Track A — Chat / Channel Layer + Kill-Test

> Read `docs/SCOPE.md` and `docs/CONTRACTS.md` first. You own `apps/worker/**` (including
> `apps/worker/src/messaging/adapters/**`). You implement against interfaces Track B publishes
> in `@workerchat/shared` — you do not edit them, and provider SDKs go in `apps/worker` only.

## Mission
Prove the WhatsApp channel is *survivable*, then deliver a multi-channel messaging worker
that ingests inbound and sends human-approved outbound across WhatsApp (official +
unofficial) and Telegram — fully decoupled from the CRM (a ban must cost a *channel*, not
the worker's data).

## Deliverable 1 (START at t=0 as a BACKGROUND experiment): the 2-week kill-test

> This gates **only** the unofficial Baileys adapter (2.3). It needs no platform code, so run
> it concurrently while you build Telegram (your critical-path proof of the loop). Don't let
> the multi-week wall-clock wait block the rest of Track A.
Goal: falsify or validate unofficial WhatsApp survivability as cheaply as possible.
- **Setup:** ONE throwaway number you don't care about. Use an off-the-shelf bridge first
  (Whapi.cloud free Developer sandbox, or **WAHA self-host** for data-sovereignty, or
  GreenAPI free dev — note GreenAPI is community-flagged Russia-linked, avoid for real data).
- **Protocol:** human-paced, realistic two-way traffic (no bulk, no cold-messaging
  strangers). Log: time-to-ban, and the **actual pre-existing history depth** the bridge
  returns on pair (this is a key unknown).
- **In parallel, the official lane:** stand up ONE WhatsApp **Business app** number on the
  official **Cloud API + Coexistence**; verify (a) Coexistence availability for the real
  user geography, (b) real ~180d/14d sync behavior, (c) the 24h-window UX.
- **Go / No-Go:**
  - GO unofficial-as-fallback: survives ≥4 weeks human-paced + history depth meets need +
    numbers/IPs isolable.
  - NO-GO unofficial: banned in days, or bans cluster across shared-infra numbers, or
    appeals fail (expected ~1/37).
  - GO official: Coexistence available in region + product presents a compliant neutral brand.
- **Output:** a short results note in `docs/killtest/results.md` (Track-A-owned; keep
  `docs/research/**` untouched — Track C cites it). **Write no production *WhatsApp-unofficial
  (Baileys)* session code until this has a verdict** — Telegram and WA-official are independent
  and proceed now.

## Deliverable 2: the `MessagingProvider` adapters (`apps/worker/src/messaging/adapters/`)
Implement the `MessagingProvider` interface from `@workerchat/shared` (Track B publishes) — the
adapters live in **your** `apps/worker` tree, never in `packages/shared`; provider SDKs
(Baileys, grammY/telegraf, libsodium) go in `apps/worker/package.json` only.

> **Start against `shared-0a` stubs** (Track B publishes the interface + type stubs first;
> git-tag `shared-0a`). Scaffold all three adapter classes + a round-trip harness against the
> stubs immediately; integration-test against `0b`. **Telegram is your critical path** — it
> proves inbound→DB→outbound with zero ban risk and unblocks Track B's integration testing.

Three adapters:
1. **`TelegramProvider`** — start here; it's the *sanctioned*, low-risk, global path. Bot API
   (grammY/telegraf). Proves the whole inbound→DB→outbound loop with zero ban risk.
2. **`WhatsAppOfficialProvider`** — Cloud API + Coexistence. Webhooks for inbound (incl.
   `smb_message_echoes` for the worker's own-device messages), media download, 24h-window
   state + template send when closed.
3. **`WhatsAppUnofficialProvider`** — Baileys, **isolated**, fallback-only. Port the working
   parts of `first_attempt/whatsapp-bridge/server.js` (Supabase auth-state persistence is
   solid) but **fix what's broken/missing:** the `requestPairingCode()` hang (newer WA forces
   "link with phone" — research current Baileys pairing flow), **media download** (prior build
   stored `[image]` placeholders), and **history capture**.

## What to reuse from `first_attempt/whatsapp-bridge`
- ✅ Supabase Baileys auth-state *logic* (`makeSupabaseAuthState`), outbox polling, reconnect —
  but **re-point it** to the new `wa_auth_state` table (the old `wa_sessions`/`bridge_queue`
  names belong to the abandoned project; coordinate names with Track B).
- ✅ The thin HTTP connect/status/qr endpoint *shape* — but **replace the static
  `WORKER_API_SECRET` + `token !== API_SECRET`** with Supabase-JWT verification +
  `crypto.timingSafeEqual` + path-`userId` == JWT subject (CONTRACTS §4). Do **not** port the
  single-shared-secret model (it re-creates the prior leak). Write QR/pair/state into the
  `channels` row for the CRM to re-surface via Realtime.
- ❌ Don't keep: text-only ingestion, dropped `fromMe`, single-channel assumption, the
  hung pairing path, plaintext storage, and `console.log(... text.slice(0,60))` — **id-only logs.**

## Hard constraints (from research)
- **Session layer is always-on, NOT serverless** (Fly.io/Railway/VPS + PM2). Paid hosting.
- **Encrypt message bodies + identifiers before insert** (CONTRACTS §5); **never log
  plaintext** — `raw`/text/body/preview/error are redacted before logging (platform stdout is
  an external sink; CI greps for log calls referencing them); `raw` is never persisted.
- **Idempotent inbound** upsert by `(conversation_id, provider_message_id)`.
- **Outbound only from `bridge_outbound` rows** (already human-approved by the CRM).
- **Baileys supply-chain:** pin exact versions, audit the lockfile (the Dec 2025 `lotusbail`
  poisoned fork exfiltrated tokens). Never `^`/`latest` on `@whiskeysockets/baileys`.
- **One isolated session process per user** (roadmap target); load that user's key in memory
  only while connected.

## Definition of done
Telegram + WA-official adapters pass a round-trip test (inbound shows in CRM, human-approved
outbound delivers); unofficial adapter behind a feature flag with the kill-test verdict
attached; capabilities reported per channel; no CRM-owned tables written; no plaintext logs.
