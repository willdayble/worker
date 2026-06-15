# WhatsApp — status & roadmap

_Last updated: 2026-06-15. Audience: founders / investor conversations + engineering handoff._

## TL;DR

A user signs up, opens **Settings → Channels**, scans a **QR with their own WhatsApp**
(WhatsApp → Linked Devices → Link a Device), and from then on their WhatsApp messages flow **both
ways** into the CRM — inbound and outbound — **end-to-end encrypted at rest**, alongside Telegram.
This is a **proof of concept**: it proves the product's core claim (a channel-agnostic CRM that
bridges WhatsApp) works. It is **not yet hardened for production** — see _Known limits_.

## What works (proven end-to-end)

- **App-driven connection.** No operator setup, no env per user — the worker emits the pairing QR
  onto the `channels` row and the CRM renders it live (Realtime + poll). Exactly the real-user flow.
- **Inbound:** client → WhatsApp → worker → normalize → **encrypt** → Supabase → CRM inbox (live).
- **Outbound:** CRM composer → `bridge_outbound` (human-approved, never auto-send) → worker →
  WhatsApp.
- **Own-device sends mirrored:** messages the worker sends from their *own* phone/desktop WhatsApp
  appear in the CRM thread as outbound too — the CRM is the full record of the conversation.
- **Session survives restarts:** the Baileys session is stored **encrypted** in `wa_auth_state`, so
  redeploys don't force re-pairing.
- **Encryption:** messages are written with the same per-user scheme the CRM decrypts (`v1x`,
  libsodium, keyed by `WORKER_MASTER_KEY`) — the worker never logs message content.

## Architecture (how it bridges)

```
WhatsApp  ──Baileys (linked device)──▶  worker adapter  ──normalize──▶  SessionRuntime
(your number)                          whatsapp-unofficial.ts          │  encrypt-before-insert (sink)
     ▲                                                                  ▼
     └────────── send() ◀── claim bridge_outbound (human-approved) ── Supabase ──▶ CRM inbox
```

- **Connection:** unofficial **Baileys** (`@whiskeysockets/baileys` 6.7.18) — i.e. a "linked device"
  like WhatsApp Web, using the worker's own number. Gated behind `ENABLE_WHATSAPP_UNOFFICIAL=true`.
- **The worker is channel-agnostic:** WhatsApp plugs into the *same* `MessagingProvider` interface +
  `SessionRuntime` + sink as Telegram. Adding a channel doesn't touch the CRM.
- **Addressing:** WhatsApp now uses **LID** (`<id>@lid`, a privacy alias) for many 1:1 chats. We
  preserve the full inbound JID and reply to it verbatim, so messages always route back to the right
  person even when the phone number isn't exposed.

## Known limits (scoped, not blocking the PoC)

| Area | Status | Notes |
|---|---|---|
| **Ban survivability** | **Deferred (the kill-test)** | Unofficial WhatsApp can be banned. The project has a documented kill-test (`docs/killtest/`) to measure this on throwaway numbers; it's intentionally **separate** from proving the bridge. **Do not point a number you can't lose at this yet.** |
| **Media (both ways)** | ✅ images, video, audio/voice, documents | Inbound downloaded + stored; outbound attached/recorded in the composer (image/video + voice notes) and sent via the worker. Private buckets + signed URLs; NOT app-layer encrypted like message text yet (follow-up). |
| **History backfill** | ✅ on (re)link | WhatsApp pushes prior chats/messages on connect (fuller on a fresh link via syncFullHistory); ingested as historical. Media history is placeholder-only (not bulk-downloaded). |
| **Multi-user** | Not yet | Today: one worker per user. Production needs per-user worker sessions + a connect control-plane (the QR screen already models the UX). |
| **Official Cloud API** | Built, not chosen | A Meta WhatsApp Business API adapter exists, but Meta's Business policy likely prohibits the use case (risk of account shutdown) and AU Coexistence availability is unconfirmed — hence the unofficial route. |

## Roadmap (rough order)

1. **Run the kill-test** (ban survivability) on throwaway numbers → GO/NO-GO on unofficial as a real
   channel.
2. **App-layer encryption of media** (today: private buckets + RLS + signed URLs; message *text* is already app-layer encrypted) + downloading media history (currently placeholder-only).
3. **Multi-user**: per-user worker sessions + the in-CRM connect control-plane.
4. Harden: reconnect/observability, outbound `claim_outbound` RPC (atomic), rate/abuse handling.
