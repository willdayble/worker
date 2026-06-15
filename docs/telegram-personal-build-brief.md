# Build brief — Personal Telegram channel (MTProto / gramjs)

_For a separate engineer/agent building this in parallel with the WhatsApp work._

## Goal & the key distinction

Today's Telegram support is a **bot** (BotFather token): clients message *your bot*. That is **not**
"connect your personal Telegram." This brief is for bridging a user's **personal Telegram account** —
all their existing 1:1 chats — the way WhatsApp/Baileys does. That requires Telegram's **MTProto
client API** via **`gramjs`** (`npm: telegram`), with **phone-number login** (phone → login code →
optional 2FA password), holding a per-user **session string**.

This is a **full new provider**, comparable in size to the WhatsApp/Baileys build — not a toggle.

## The one wrinkle that makes it harder than WhatsApp

WhatsApp connect is **one-way**: the worker emits a QR → `channels.qr` → the CRM renders it → the
user scans on their phone. No CRM→worker data needed.

Telegram login is **interactive and two-way**: the worker must send the user's **phone**, then the
**login code** the user receives in Telegram, then maybe a **2FA password** — all at login time. So
you need a small **CRM→worker control channel** to pass phone/code/password to the worker. Design it
as: the CRM writes those values (encrypted) to a row the worker **subscribes to via Realtime** (or
polls); the worker drives the gramjs login state machine and writes status back onto `channels`
(`state`: connecting → pairing(awaiting_code) → connected; plus a field telling the CRM what input it
needs next). This control plane is the bulk of the new work.

## Implement against the existing seams (do NOT reinvent)

- Implement `MessagingProvider` from `@workerchat/shared` (see `packages/shared/src/messaging/interface.ts`)
  in a NEW file `apps/worker/src/messaging/adapters/telegram-personal.ts`. Channel id:
  add `'telegram_personal'` to the `Channel` union? — NO, you can't edit shared casually (Track B
  owns it). Simplest: reuse channel `'telegram'`… but that clashes with the bot. **Recommendation:**
  request a `'telegram_personal'` channel value be added to `@workerchat/shared` (one-line union +
  the DB CHECK constraints in `supabase/migrations`), then a migration to allow it. Coordinate this
  shared change.
- Inbound: normalize gramjs messages → `InboundMessage` → call the `onInbound` handler. The
  `SessionRuntime` + `SupabaseSink` then encrypt + persist exactly as for WhatsApp/Telegram-bot. Set
  `fromMe` for the user's own sends (gramjs `message.out`). Mirror the WhatsApp adapter's structure.
- Outbound: `send()` → gramjs `client.sendMessage(peer, {message, file})`. Media: read the blob from
  `outbound-media` (service_role) like the WhatsApp adapter's `buildMediaContent`.
- History: gramjs `client.getDialogs()` + `client.getMessages(peer, {limit})` → ingest as historical
  (`isHistorical: true`), same as WhatsApp's `messaging-history.set` path.
- Session storage: store the gramjs **session string** ENCRYPTED. Reuse `wa_auth_state` (it's just an
  encrypted per-channel blob): `creds_enc` = encrypted session string, `keys_enc` = null, keyed by the
  telegram_personal `channel_id`. Use the worker's `Encryptor` (`core/crypto.ts`).
- Wire it in `apps/worker/src/index.ts` behind an `ENABLE_TELEGRAM_PERSONAL` flag, constructing it
  with the same `sb` + `encryptor` + `writeChannelState` deps the WhatsApp provider uses.

## CRM connect UI

Add a Telegram card to **Settings → Channels** (`apps/web/src/components/settings/channels-connect.tsx`):
phone input → submit (writes phone) → code input (shown when state=awaiting_code) → submit code →
optional 2FA password → connected. Drive it via Realtime on the `channels` row (the page already
subscribes). The server actions write the (encrypted) phone/code to the control row.

## Telegram API credentials

gramjs needs an **`api_id` + `api_hash`** (from https://my.telegram.org, one per app — operator-level,
put in env/Doppler, NOT per-user). The per-user secret is the **session string** (after login).

## ⚠️ Coordination (two agents, one repo)

**Work on a separate git worktree or branch** to avoid clobbering the WhatsApp work's uncommitted
changes (`git worktree add ../wc-telegram -b feat/telegram-personal`). Do NOT edit these files we're
actively changing: `whatsapp-unofficial.ts`, `composer.tsx`, `(dashboard)/layout.tsx`,
`conversation-list.tsx`, `inbox/[conversationId]/page.tsx`, `inbox/actions.ts`,
`channels-connect.tsx`. Shared touch-points to coordinate (rebase carefully): `index.ts`,
`apps/worker/package.json` (+ lockfile), `@workerchat/shared` (channel union), a new migration
(use the next free number — currently up to `0006`).

## Gotchas

- gramjs is ESM/CJS-quirky under NodeNext (same class of issue as Baileys default-export); expect to
  coerce imports.
- 2FA accounts need the cloud password step.
- MTProto userbots carry **ban/ToS risk** (similar spirit to the WhatsApp kill-test) — flag, don't
  ignore.
- Rate limits on history fetch (`getMessages`) — page it.
