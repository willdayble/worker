# WorkerChat — Deployment

How the app gets online so Will + Clare (and other testers) use it from anywhere, with no
laptop tethered. Orchestrator-owned reference. Pairs with `docs/TESTING.md` (kill-test) and
`docs/SCOPE.md`/`docs/CONTRACTS.md` (architecture).

---

## 1. What runs where

| Piece | Host | Why | Deploy from laptop |
|---|---|---|---|
| **CRM** (`apps/web`, Next.js) | **Vercel** | Native home for Next.js; free `*.vercel.app` URLs; built-in dev-vs-prod | `vercel` / `vercel --prod` |
| **Bridge / worker** (`apps/worker`) | **Fly.io** or **Railway** | Holds live messaging sessions 24/7 — **cannot be serverless** | `fly deploy` / git push |
| **Database** | **Supabase** (pick an **EU region** for the GDPR-sensitive data) | Already cloud; RLS + Auth + Realtime | dashboard / `supabase db push` |
| **Queue** (Redis/BullMQ) | **Upstash Redis** (free tier) or Fly/Railway add-on | Outbound queue between CRM and worker | provider dashboard |
| **Investor site** (`docs/site`) | **Cloudflare Pages** | Static — CF Pages is right for *static*, NOT the dynamic CRM | Track C's pipeline |
| **WhatsApp kill-test bridges** | small **VPS per burner, in-country** | Always-on + country-matched IP (see `docs/TESTING.md`) | ssh + docker compose |

The web app is globally reachable; you only pick a *region* for the **database** (EU) and the
**bridges** (per country, for the unofficial WhatsApp IP). Free `.vercel.app` / `.fly.dev` URLs
are fine until you want real domains.

---

## 2. Environments: dev vs stable (your "toggle")

Run **two deployments at two URLs**, each with its **own database** — not a code-swap inside one app:

- **`stable`** → the version real users (Clare) live in. Maps to Doppler **`prd`** config + the prod Supabase project.
- **`dev`** → sandbox for trying new features. Maps to Doppler **`dev`** config + the dev Supabase project.

The "**Dev / Stable** toggle" you want = a UI link that **navigates to the other URL** (clean,
standard). For switching individual experimental features on/off *per user within* a deployment,
use **feature flags** (the `first_attempt` "beta features" idea). **Dev and stable have separate
data** — Clare's real client chats live in `stable`; `dev` is a sandbox (no issue now while
there's no real data).

> ⚠️ The **Supabase free tier pauses after ~7 days idle** — fine for `dev`, **fatal for `stable`**
> (the live app would silently go down). Put `stable` on **Supabase Pro (~US$25/mo)** before
> Clare's real daily use.

---

## 3. Auth & multi-channel (already designed in)

- **Login = email/password + Google** (Supabase Auth; email/pw built, Google is a config add).
- **Login is NOT a WhatsApp number.** It's a stable identity; you then *connect* one or more
  WhatsApp/Telegram numbers as **channels** under that account. ("Sign in with WhatsApp" isn't a
  real provider; phone-SMS-OTP is possible later but needs a paid SMS service — skip for now.)
- **One profile → many channels → one inbox.** Clare connects her UK number *and* her FR number;
  a UK client and a French client appear as two threads in her single inbox, each reply routed to
  the right number. This is already in the schema (`channels` = one row per number per user;
  channel-agnostic `conversations`/inbox).

---

## 4. What's testable NOW vs NEXT (read this — there's a sequencing reality)

**✅ Now — full CRM UX via Telegram (ban-free, works today).**
Track A's Telegram channel is built. Deploy CRM + worker + DB and you + Clare can log in from
anywhere, connect a Telegram channel, have friends message it, and run the whole CRM (inbox,
contacts, pipeline, close-loop). This proves the *product* end-to-end with zero ban risk and **no
SIM needed**.

**🧪 In parallel — the WhatsApp kill-test (separate experiment).**
The throwaway SIMs + per-country VPS run the **WAHA harness** to measure WhatsApp ban-survival
(`docs/TESTING.md`). Important: the kill-test harness logs to a file — **it does NOT feed the
CRM**. It answers one question: *does an unofficial WhatsApp connection survive?*

**⏭️ Next — WhatsApp *inside* the CRM.** This needs the worker's WhatsApp adapter, which isn't
built yet:
- **Unofficial adapter** — gated on the kill-test returning **GO** (then Track A builds it).
- **Official Coexistence adapter** — currently a scaffold; needs building + a Meta Business setup.

So the burner SIMs you're buying **power the kill-test now**, and **become your WhatsApp
connections to the CRM once the adapter ships.** Not wasted — they're step one.

---

## 5. Deployment gotchas

1. **Don't burn a *real* daily-driver number on the unofficial bridge** — only throwaway burners,
   until the kill-test says it's survivable.
2. **`stable` needs paid Supabase** (free pauses after 7 days idle).
3. **The worker is a separate always-on service** from the Vercel web app (one Vercel deploy does
   NOT cover the bridge).
4. **Each connected WhatsApp number needs its burner phone alive** (~14-day check-in).
5. **Shared-IP correlation:** running many unofficial sessions from one server/IP risks
   *correlated* bans — another reason to keep the kill-test bridges on separate per-country boxes.
6. **Migrations + secrets are per-environment** — apply the schema and populate the Doppler config
   for *each* of dev/stable.

---

## 6. Deploy steps (high level — blocked items noted)

Prerequisites still open: **git consolidated to `main`** (waiting on Track A to commit
`apps/worker`), **migrations applied** to the target DB, **Doppler config populated** per env.

1. **CRM:** `cd apps/web && vercel` (links project) → set env from Doppler → `vercel --prod`.
2. **Worker:** `cd apps/worker && fly launch` (or Railway) → set secrets → deploy. Add Redis.
3. **DB:** apply `supabase/migrations/*` to each environment's project (dashboard SQL editor or
   `supabase db push`).
4. **Kill-test bridges:** provision per-country VPS → install Docker → run the harness
   (`docs/TESTING.md`).

---

## 7. Shopping list — what to buy

### Accounts to create (free)
- **Vercel** (Hobby, free) — CRM hosting.
- **Fly.io** *or* **Railway** — worker hosting (Railway gives starter credit; Fly needs a card).
- **Upstash** (free) — Redis, if not using a Fly/Railway add-on.
- *(Already have: Supabase, Doppler. Cloudflare for the static site + later DNS — free.)*

### Paid services (monthly)
| Item | When | Cost (approx) |
|---|---|---|
| **Worker host** (Fly/Railway, 1 small always-on instance) | now, to deploy | **~US$5/mo** |
| **Kill-test VPS** — one per burner, in-country (London, Paris[, Sydney]) | for the WhatsApp kill-test | **~US$5/mo each** (Hetzner ~€4 / DigitalOcean / Vultr ~$5–6) |
| **Supabase Pro** for `stable` | only when Clare goes to real daily use | **~US$25/mo** |
| Redis (if not free Upstash) | optional | $0–5/mo |
| Domain name | later | ~$10–15/yr |

### Hardware / SIMs (you're already getting these)
- **3 burner SIMs:** Clare **UK**, Clare **France**, Will **Australia** — normal local prepaid,
  **not** a data-only travel eSIM (need a real number for WhatsApp's SMS verify). ~$2–20 each.
  *(SIM guide per city in `docs/TESTING.md`.)*
- **A phone per burner number** to register WhatsApp on — reuse spare/old iPhones or Androids
  ($0 if you have them), or cheap Androids (~$30–80). A dual-SIM phone (or WhatsApp's two-accounts
  feature) can cover Clare's two numbers on one device; the SIM just needs to stay active for the
  ~14-day check-in. (A French SIM roaming in the UK can still register/receive its SMS — fine.)

### Rough total to get online + run the kill-test
~**US$15–25/month** during testing (Vercel/Supabase-dev/Upstash free; worker ~$5; 2–3 kill-test
VPS ~$10–15) + one-off SIM/phone costs. `stable` adds ~$25/mo when Clare goes live.
