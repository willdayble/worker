# WorkerChat — Deploy Runbook (first live deploy)

Get the CRM + worker onto servers so you and Clare log in from anywhere and test the **full loop
via Telegram** (ban-free). Companion to `docs/DEPLOYMENT.md` (the *why*); this is the *how*, step
by step. Repo root for all paths below: `workerapp/app/`.

> **Reality check:** deploying a monorepo almost always needs a debug round or two (build commands,
> env). Work through it one phase at a time; **when a step errors, paste me the log and I'll fix
> it** — that's faster than a perfect-on-paper runbook.

---

## What's already done
- ✅ **Integration fix** — the worker now encrypts with the *same* crypto + `WORKER_MASTER_KEY` as
  the CRM, so the inbox can actually decrypt what it ingests. (Committed; typecheck clean.)
- ✅ **Secrets in Doppler** (`worker`/`dev`): `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
  `WORKER_MASTER_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- ✅ **Telegram bot** created (you have its token).

## The shape (no Redis, no domains yet)
| Piece | Host | How it deploys |
|---|---|---|
| CRM (`apps/web`) | **Vercel** | Connect the GitHub repo → deploys on push → free `*.vercel.app` URL |
| Worker (`apps/worker`) | **Railway** | Connect the GitHub repo → deploys on push → **one service per test user** |
| Database | **Supabase** | Apply the schema (below) |
| Secrets | **Doppler** | Sync into Vercel + Railway (or paste once) |

---

## Phase 1 — Apply the database schema (≈5 min)
The CRM has no tables until you do this.
1. Open each migration file and copy its contents (they're plain SQL):
   - `app/supabase/migrations/0001_channel_contract.sql`
   - `app/supabase/migrations/0002_crm_schema.sql`
   - `app/supabase/migrations/0003_contact_flag_events.sql`
   *(Tip: `open -a TextEdit app/supabase/migrations/0001_channel_contract.sql` to view+copy.)*
2. Supabase dashboard → your `worker` project → **SQL Editor → New query** → paste **0001** → **Run**.
3. Repeat for **0002**, then **0003** (in order). They're idempotent — safe to re-run.
4. If the `ALTER PUBLICATION supabase_realtime` line at the end of 0001 errors, ignore it (or paste
   me the error). Everything else must succeed.

## Phase 2 — Add the last two secrets to Doppler
In your terminal (any dir; Doppler is linked to `worker`/`dev`):
```
doppler secrets set TELEGRAM_BOT_TOKEN="<paste your BotFather token>"
```
*(`DEV_USER_ID` comes in Phase 4, after you've signed up and have a user id.)*

## Phase 3 — Deploy the CRM to Vercel
1. Create a free account at **vercel.com** and connect your GitHub.
2. **New Project → import `willdayble/worker`.**
3. **Root Directory:** set to `apps/web`. (Framework auto-detects as Next.js.)
4. **Build settings** — because `apps/web` depends on the workspace package `@workerchat/shared`,
   it must be built first. Set:
   - Install Command: `pnpm install --frozen-lockfile=false` (run at repo root)
   - Build Command: `pnpm --filter @workerchat/shared build && pnpm --filter @workerchat/web build`
   *(If Vercel complains it can't see files outside `apps/web`, enable "Include files outside the
   root directory" / use the repo root as Root Directory with the same build command. Paste me the
   error if it fights you.)*
5. **Environment variables** (Settings → Environment Variables) — copy these from Doppler
   (`doppler secrets` shows them; the `NEXT_PUBLIC_*` ones must be present at **build** time):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`
   - `WORKER_MASTER_KEY`
   *(Or use Doppler's Vercel integration to sync them automatically — Doppler dashboard → `worker`
   project → Integrations → Vercel.)*
6. **Deploy.** You get a `https://worker-xxxx.vercel.app` URL.
7. **Sign up** on that URL (email + password). Then get your **user id**: Supabase dashboard →
   **Authentication → Users** → copy your row's UUID. You'll need it next.

## Phase 4 — Deploy the worker to Railway (Will's instance first)
1. Create a free account at **railway.app** and connect GitHub.
2. **New Project → Deploy from GitHub repo → `willdayble/worker`.**
3. In the service **Settings**:
   - **Root Directory:** repo root (leave blank / `/`).
   - **Build Command:** `pnpm install && pnpm --filter @workerchat/shared build && pnpm --filter @workerchat/worker build`
   - **Start Command:** `node apps/worker/dist/index.js`
4. **Variables** (Settings → Variables) — set these (from Doppler, plus the two new ones):
   - `WORKER_MASTER_KEY`  ← **must be identical to the CRM's value** (it is, same Doppler value)
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY`
   - `TELEGRAM_BOT_TOKEN`  ← your bot token
   - `DEV_USER_ID`  ← **your Supabase user UUID from Phase 3 step 7**
   *(Or connect Doppler's Railway integration and add just `TELEGRAM_BOT_TOKEN` + `DEV_USER_ID`.)*
5. **Deploy.** Watch the logs — you want a line like `bootstrap.started … channel: telegram`.
   No public port/domain is needed (Telegram is long-poll outbound).

## Phase 5 — Connect + test (the acceptance test)
1. From any phone, open Telegram and **message your bot** something like `hello from telegram`.
   *(With a bot you must message it first / press Start — bots can't DM you first.)*
2. In Supabase → Table Editor → `messages`, you should see a new row with a `body_enc` starting
   `v1x.…` for your `user_id`.
3. In the **CRM** (your `*.vercel.app`), logged in as you: the **inbox** shows the conversation,
   and opening it shows **`hello from telegram` in plain text** (not `⚠︎ unable to decrypt`).
   ✅ That's the full loop working.
4. Reply from the CRM composer → it should arrive back in Telegram.

## Add Clare (second worker)
Repeat **Phase 4** as a *second Railway service* with **Clare's** `DEV_USER_ID` (her Supabase
UUID after she signs up) and **her own** `TELEGRAM_BOT_TOKEN`. The CRM is shared — RLS shows each
person only their own conversations.

---

## Gotchas / notes
- **One worker per user** is the stopgap until the in-CRM "connect a channel" screen is built
  (deferred). Two test users = two Railway services.
- **`WORKER_MASTER_KEY` must match** between the CRM and every worker, or decryption fails. (Same
  Doppler value everywhere = fine.)
- **Supabase free tier pauses after ~7 days idle** — fine for this testing phase; move `stable` to
  Supabase Pro before real daily use.
- **Monorepo build commands** (Phases 3–4) are the most likely thing to need a tweak on first run —
  if a deploy fails, the build log tells us exactly what; paste it and I'll adjust the commands.
- Free URLs (`*.vercel.app`, `*.up.railway.app`) are fine for now; real domains come later.
