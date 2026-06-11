# WorkerApp — Master Scope (v0.1)

*Date: 2026-06-10. Source of truth for what we are building and why. Evidence: `docs/research/00_synthesis.md`. Interfaces: `docs/CONTRACTS.md`.*

---

## 0. The one-paragraph product

A **neutral, privacy-first CRM + multi-channel client-comms tool for independent service providers.** A worker connects a messaging channel (WhatsApp first, Telegram in parallel), the app pulls their recent conversations into a CRM, and they manage leads → bookings faster and more safely — pruning time-wasters, flagging dangerous clients, tracking where each client came from, and (with a clearly-disclosed AI assistant) drafting replies and spotting bookings. The client keeps chatting exactly as before. The worker's full history stays on their own device; only a recent window syncs into the CRM. **No payments. Sensitive data is encrypted at rest** (the operator *can* technically decrypt while a session is live — true zero-knowledge is roadmap, and test users are told this plainly). **A platform ban never destroys the worker's CRM data.**

---

## 1. Why this is a reframe of the original brief

The research falsified three load-bearing assumptions in the original brief. The reframe keeps the *goals* (faster/safer bookings, less time wasted, data sovereignty) while dropping the parts that can't survive contact with the platform.

| Original assumption | Finding | Reframe (locked) |
|---|---|---|
| Import the worker's **entire** WhatsApp history into the CRM | Impossible on the official path (Coexistence caps ~180d text / ~14d media, no groups); only the ban-prone unofficial path can read lifetime history | **History stays on-device with the worker; CRM syncs ~6 months (or new-onward).** User confirmed this is acceptable → unlocks the official path |
| Appear as **normal consumer** WhatsApp | Official = a *Business* account; consumer app can't share the number. Only unofficial approximates "native," and it forfeits ban-avoidance | Accept "WhatsApp **Business**, same number, same thread" as native-enough; lean on Coexistence so the worker keeps using their phone |
| **Avoid bans** while doing the above | Mutually exclusive with the first two on a single path; **and Meta bans the vertical outright** (Commerce + Messaging policy, verbatim, verified) | **Neutral tooling** (never sex-work-branded) + official path where available + **Telegram as a sanctioned parallel channel** so a WA ban isn't fatal |
| Build shared 3-layer infrastructure first | Maximizes the cascade-ban / breach blast radius with zero users; answers none of the kill questions | **Invert build order:** chat survivability → CRM → shared infra last/never. Keep the 3-layer split as an *interface* boundary, not a build order |

**Honest viability:** premise *exactly as written* ≈ 5–15% durable. The reframe is genuinely viable — and is a stronger investor story (compliance + safety + data-sovereignty as a moat).

---

## 2. Locked decisions

| Area | Decision | Why |
|---|---|---|
| **Product framing** | Neutral, general-purpose, privacy-first CRM. Never advertise specific services, broker transactions, or take a per-booking cut. | "Knowing facilitation" is the legal hinge (FOSTA-SESTA; Nordic-model facilitation laws). Neutral tooling = safe side of *Woodhull v. US*. |
| **Operating entity** | Victoria, Australia | Sex work **decriminalized** (Sex Work Decriminalisation Act 2022, full effect Dec 2023) — most favorable operator footing. |
| **Channels** | WhatsApp (primary) + Telegram (first-class parallel/fallback); Signal later. All behind a `MessagingProvider` interface. | Telegram is a *sanctioned* bot API, no adult-content ban, global. Removes single-channel ban risk. |
| **WhatsApp integration** | **Official Cloud API + Coexistence = durable primary.** Unofficial (Baileys) = *scoped fallback / kill-test only*, never a sole dependency. | Official is ban-safe; history requirement relaxed so it now fits. Unofficial reserved for regions where Coexistence is unavailable, validated by the kill-test. |
| **History** | On-device stays with worker; CRM syncs ~6mo (Coexistence) or new-onward. No lifetime import. | User-confirmed. Unlocks official path. |
| **Payments** | **None, ever.** | Removes Stripe/Visa/Mastercard deplatforming exposure in one decision. User handles payment separately. |
| **Data & privacy** | Encryption-at-rest with per-user keys; **roadmap to client-side E2EE**; operator can technically decrypt while a session is live (disclosed; **not** zero-knowledge); **CRM data fully decoupled from the chat session.** RLS as defence-in-depth. | GDPR Art. 9 (sex life) + Art. 10 (criminal-flagged clients). A ban must never destroy safety tags/bookings. **See §6 for the honest E2EE-vs-server-bridge tension.** |
| **AI** | **Disclosed assistant.** Collaborative drafting (human approves every reply), advisory flagging. Never auto-send, never auto-block. Confidence routing in deterministic code. **Disclosure covers BOTH outbound drafts AND inbound AI analysis of client messages.** | California SB 243 + EU AI Act Art. 50 (mid-2026) require disclosure. Inbound red-flagging is automated processing of third-party special-category data → advisory only. False "time-waster" flag denies income → human-in-loop. |
| **Build order** | (1) chat survivability → (2) CRM + decoupled data → (3) shared infra last/never. | Inverts the brief; de-risks the fragile thing first. |
| **Stack** | Monorepo (pnpm): `apps/web` (Next.js+TS, Vercel), `apps/worker` (always-on Node + BullMQ/Redis, Fly.io/Railway), `packages/shared`. Supabase Postgres + RLS + Auth. | Session layer **cannot** be serverless (no 24/7 WebSocket on Vercel). See `docs/CONTRACTS.md`. |
| **Secrets** | Gitignored `.env` + secrets manager (Infisical/Doppler) + `gitleaks` pre-commit & CI + `.claude/settings.json` deny rules for `.env*`. | A `.gitignore` alone does **not** stop Claude reading `.env`; only the deny rule does. See `SECURITY-ACTIONS.md`. |
| **Subscription (working target)** | Launch $19–25/worker/mo; step to $9–15 at scale. | Covers infra floor + ban-recovery reserve + ~70%+ margin. See research §8. |
| **Build prerequisite** | **Deliverable −1 (human/orchestrator):** provision a clean Supabase project + secrets manager before any track starts; old project `zipruaqabvuwoxrnyqox` decommissioned. | Avoids reusing compromised creds; unblocks the critical path (red-team). |

---

## 3. Architecture (decoupled, channel-agnostic)

```
   Client on WhatsApp / Telegram
              │  (their experience is unchanged)
              ▼
 ┌─────────────────────────────┐        ┌──────────────────────────────┐
 │  apps/worker  (Track A)      │        │  apps/web  (Track B)         │
 │  always-on Node service      │ inbound│  Next.js CRM (Vercel)        │
 │  ── MessagingProvider ──     │ events │  inbox · contacts · pipeline │
 │   • WhatsAppOfficial (CoEx)  │───────▶│  tags · bookings · attrib.   │
 │   • WhatsAppUnofficial (Bail)│        │  AI-assist (disclosed)       │
 │   • Telegram                 │◀───────│  outbound (human-approved)   │
 │  holds sessions, BullMQ/Redis│outbound│                              │
 └──────────────┬──────────────┘ queue  └───────────────┬──────────────┘
                │                                        │
                └──────────────┬─────────────────────────┘
                               ▼
                 ┌──────────────────────────────┐
                 │  Supabase Postgres + RLS      │  ← packages/shared owns schema + types
                 │  contacts · conversations ·   │     (Track B publishes; A reads/writes
                 │  messages · deals · tags ·    │      to the contract, never imports a
                 │  acquisition_source · wa/tg   │      chat SDK)
                 │  sensitive cols = ciphertext  │
                 └──────────────────────────────┘
```

**Key property:** the CRM (data + tags + bookings) is **independent of any messaging session.** If a WhatsApp number is banned, the worker loses a *channel*, not their client records, dangerous-client flags, or booking history. The channel is swappable (WA → Telegram → Signal) behind one interface. Dangerous-client flags are **append-only** and never silently re-bound to a new identity — a recycled/reassigned number creates a new contact + a human-review task (CONTRACTS §3).

---

## 4. Prototype scope

**In scope (prototype):**
- Connect a channel and send/receive **text + images** via the web CRM:
  - WhatsApp **Official + Coexistence** (durable path) — where region-available.
  - **Telegram** bot channel (parallel, sanctioned).
  - WhatsApp **Unofficial (Baileys)** — only as the kill-test + fallback, isolated.
- CRM: contacts, conversation inbox, tags/"practices" menu, pipeline (Enquiry → Screening → Confirmed → Completed/Lost), **booking close-loop** (won / lost / time-waster / dangerous-client, with service/fee/date logged).
- **Acquisition-source attribution** per contact (which entry point/web page the client came from) — write-once first-touch.
- **Dangerous-client flag** (advisory) + optional external screening hook (NUM / NUMChecker).
- **Multi-user** (the test user + a handful more) with per-user data isolation.
- **Data dump + a few insight dashboards** across users (dev/test phase, with explicit consent).
- **Disclosed AI assist:** booking extraction, intent/service tagging, draft replies (human-approved), confidence-gated.

**Out of scope (now; keep the data model ready for it):**
- Payments / deposits.
- Cross-worker shared-tag / client federation / hand-off fees (model for it, don't build it).
- Full autonomous negotiation (assistive only).
- Advanced infra: CRDT collab editing, enclave PIN recovery, true client-side E2EE (roadmap).
- Voice notes / calls handling beyond capture; group chats (unsupported on WA API).

---

## 5. Success criteria

1. The test worker connects a channel and chats with **real clients** through the web CRM, books them, and closes the loop (won / lost / time-waster / dangerous) with service, fee, date logged.
2. A handful of other test users do the same and give feedback.
3. A cross-user data dump + a few dashboards surface insight (sources, conversion, time-to-book).
4. **De-risk proven:** the WhatsApp kill-test has a clear go/no-go result, and a ban of one channel leaves CRM data intact (decoupling verified).

---

## 6. Key open design tension — be honest about this

**A 24/7 server-hosted messaging session inevitably processes plaintext.** True "operator-can-never-read" zero-knowledge encryption conflicts with hosting the WhatsApp/Telegram session on our server (the bridge necessarily sees message plaintext to ingest it). The fully-sovereign client-side-E2EE design from the research assumes the *client device* does ingestion — which defeats the "works while the worker's phone is off" goal.

**Prototype answer (pragmatic, documented):** per-user **encryption-at-rest** with keys in a KMS, loaded into the isolated worker process only while that user's session is connected; ciphertext at rest; strict no-logging-of-plaintext; data minimization. **Operator can technically decrypt during the prototype — say so plainly to test users.**

**Roadmap toward true sovereignty:** per-user isolated session processes → keys held in memory only → move toward client-held keys / on-device ingestion for users who accept the "phone must be online" trade-off. This is a *spectrum*, not a binary; pick the point per user. **Do not claim zero-knowledge we don't have.** (Owner: orchestrator + Track B; flagged for the scope red-team.)

---

## 7. Risks to re-verify before any launch

- **Coexistence regional availability** for each real user country (commonly excluded: EU/EEA, UK, AU, JP, KR — *verify live*). If unavailable → Telegram or scoped unofficial for those users.
- **Meta per-message rates** for the actual destination-country mix (vary 10–60×; Meta revises ~6-monthly).
- **Anthropic pricing** (research cache dated 2026-05-26) before committing the cost model.
- **Worker-jurisdiction facilitation law** (France = Nordic model; UK = "controlling for gain") — neutral framing + no transaction brokering is the mitigation; **get qualified local counsel before building on WhatsApp for a given market.**
- **Baileys supply-chain** (the Dec 2025 `lotusbail` poisoned fork) — pin deps, audit lockfiles.
- **Recycled-number takeover** (~66% of recycled numbers still resolve to a prior owner) — physical-safety design consideration.
- **Lawful basis + transparency for AI processing of *client* (third-party) data** — inbound red-flagging is automated processing of special-category data; DPIA + counsel before launch (research §10).

---

## 8. Cost & subscription (summary; full model in research §8)

Dominant cost is **AI inference, not messaging** (if free WhatsApp windows are exploited). Blended ~$1.30–3.10/worker/mo depending on scale/path; AI ~$0.15–0.50/worker with Haiku + prompt caching + Batch API. Working price: **$19–25/worker launch → $9–15 at scale** (~85% gross margin at 100k). Model both a window-heavy (~$0.50 msg) and marketing-heavy (~$5–15 msg) scenario; price against the worse case.
