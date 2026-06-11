I'll write the integrated scoping brief directly from the research findings and verification verdicts. The verification corrections are material (especially on Coexistence framing and portfolio-level enforcement), so I'll fold those in throughout.

# WhatsApp-Native CRM for Service Workers — Integrated Scoping Brief

*Prepared for the solo builder. Date: 2026-06-10. This is a planning document; every "verify before launch" flag is load-bearing.*

---

## 1. Executive Summary — the 5 things that matter most

1. **The core premise does not survive contact with the platform.** You cannot (a) import a worker's full lifetime WhatsApp history, (b) make the CRM-driven number look like ordinary consumer WhatsApp, AND (c) avoid bans, all on one sanctioned path. The official API gives you (c) but not (a) or (b). The unofficial path gives you (a)/(b) but structurally forfeits (c). Realistic odds of the premise-as-stated being durably achievable: **5–15%.**

2. **The vertical itself is prohibited, not gray-area.** Meta's Commerce Policy bans "human trafficking, prostitution, escort or sexual services" *verbatim* (verified), and the Business Messaging Policy *independently* names "Adult products and services" and "Dating services" as flatly prohibited verticals (verified — stronger than originally claimed). This is not solved by verification, quality scores, or templates. The product must be **neutral, general-purpose tooling**, never a sex-work-branded brokering platform.

3. **History import is real but small and not destructive.** Meta Coexistence syncs ~6 months of 1:1 text + 2 weeks of media + all contacts into the API — **no groups, no older data.** But (verified correction) the worker's *full* history is **not destroyed**: it stays on-device in the WhatsApp Business app and can be exported. "Lifetime import into the platform" is impossible; "lifetime preservation" is not. Frame this honestly to users.

4. **Build the kill-test before the platform.** The single highest-value action is a 2-week throwaway-number ban test, not a 3-layer architecture. The devil's-advocate finding is correct: building shared multi-tenant infrastructure *first* maximizes the cascade-ban outcome you most fear and answers none of the kill questions.

5. **The data is the gravest liability, and it's solvable.** Worker + client real identities + chat logs = GDPR Article 9 special-category data (sex life) plus Article 10 criminal-flagged clients; breach exposure runs to €20M/4% turnover and, more importantly, real physical-safety harm. The defensible answer exists today: **client-side E2E encryption over a central Postgres, operator stores only ciphertext, keys never reach the operator.**

---

## 2. THE CENTRAL FINDING: Official vs Unofficial WhatsApp

**State plainly: the premise as written is not achievable on any single path. Here is the honest decomposition.**

The premise bundles three goals that are mutually exclusive in pairs:

| Goal | Official Cloud API | Unofficial (Baileys / WhatsApp-Web wrappers) |
|---|---|---|
| Import full history | ❌ capped at ~6mo text / 2wk media, no groups (Coexistence) | ✅ can read on-device history after QR pairing |
| Appear as native/consumer WhatsApp | ❌ becomes a *Business* account; consumer app can't share the number | ⚠️ closest to "normal" but the number is automation-driven |
| Avoid bans | ✅ sanctioned channel | ❌ fingerprint-based detection, 2–8 week typical lifespan |

**There is no path that delivers all three.** The On-Premises API (which might once have offered an escape) is **dead — fully sunset 23 Oct 2025**, so Cloud API is the only sanctioned option and its 24-hour-window / template constraints are unavoidable.

**By which path, at what risk:**

- **Official + Coexistence** is the only durable, legally-defensible path. Risk profile: *low ban risk, high friction* (24h window, template approval, ~20-number portfolio cap, slow tier ramp). But it **cannot deliver the "full history" or "looks like consumer WhatsApp" goals**, and the adult-services vertical violates policy regardless — so even this path requires reframing the product to neutral transactional/operational use.
- **Unofficial** delivers history + presence but has *existential* ban risk: cold numbers banned within ~2 hours, typical account lifespan 2–8 weeks, ban waves every ~2–3 months tied to Meta detection updates. Appeals succeed ~1 in 37. For a population that relies on one number for their entire client base, **a ban severs the client relationship permanently** — a duty-of-care failure, not just downtime.

**Probabilities (honest):**
- Premise exactly as stated, durable >12 months: **5–15%.**
- A *reframed* product (neutral tooling, official API, history-on-device + capped sync, ban-resilient architecture, no payment flow): **viable** — but it is a different product than the one described.

**The cascade-ban nuance (verified):** Cross-account "chain bans" via shared IP/server for *unofficial* accounts are **vendor speculation**, not documented by Meta. What IS documented and real: (1) Meta detects the shared *client fingerprint* and batch-bans everyone running the same library in a wave — which *looks* like a cascade; and (2) for the *official* platform, Meta correlates and enforces at the **Business Portfolio level since Oct 7, 2025** — numbers grouped in one Business Manager share quality and limits, so one bad number blocks the whole portfolio from scaling and can trigger account-level blocks. Both produce cascade-like outcomes by different mechanisms.

---

## 3. WhatsApp Layer Deep-Dive

### 3a. Official Cloud API — capabilities, limits, pricing, policy

**Capabilities:** Real-time inbound via `messages` webhook (text, media, location, contacts, reactions, interactive). Media in/out: images ~5MB, video/audio ~16MB, documents up to ~100MB (sizes are medium-confidence; re-verify). Multi-tenant feasible. With Coexistence, messages sent from the worker's own phone Business app mirror to the API via `smb_message_echoes` webhooks — giving one unified thread.

**Coexistence (the only history path) — corrected per verification:**
- Syncs into the API: ~**180 days** of 1:1 text, ~**14 days** of media, **all contacts.** Excludes groups, calls, disappearing/view-once, broadcast lists.
- Requires the **WhatsApp Business app (green) v2.24.17+**, not consumer WhatsApp. A consumer-only worker must first *switch* to the Business app — **and that switch is NOT history-destroying** (backup-and-restore preserves history; loss only occurs with no backup / different number / unreliable cross-OS move). This corrects the original "would lose all history if they migrate" claim.
- The worker's **full lifetime history survives on-device** and via export — only the API sync is capped.
- Operational fragility: must open the Business app **every 13 days**; uninstalling disconnects the integration. Disables disappearing messages, view-once, live location, edit/revoke, and new broadcast lists.
- **Unavailable in many regions** (commonly cited: EU/EEA, UK, Australia +61, Japan, South Korea, others) — **verify per the worker's country**, as this list shifts. This is a serious constraint if your users are UK/EU/AU.

**The 24-hour window (the other hard wall):** Free-form text/media to a client is only allowed inside a 24-hour customer-service window opened by an inbound client message (resets on each inbound). Outside it, **only pre-approved template messages** (Marketing / Utility / Authentication). You cannot cold-message or re-engage a quiet client with free text. This breaks any "just text my clients naturally" expectation.

**Limits & tiers:** 250 → 1K → 10K → 100K → unlimited unique business-initiated conversations per rolling 24h, **pooled per Business Portfolio since Oct 7, 2025** (new numbers inherit the portfolio's highest tier; no per-number warm-up). Throughput 80 msg/sec per number (20 in Coexistence mode), rising to 1,000 MPS only at the unlimited tier with 100K+ uniques/24h and ≥yellow quality. Graph API call-rate ~200 req/hr/app per WABA default, ~5,000 for active WABAs. **Phone-number cap: 2 initially, ~20 by default per portfolio** — this is the structural ceiling for any one-number-per-worker design.

**Pricing (per-message since July 1, 2025 — verified):**
- Marketing: **always paid**, no volume discount.
- Authentication: **always paid** (volume-discounted).
- Utility: **free inside an open 24h window**, paid outside it.
- Service (non-template replies inside an open window): **free and unlimited since Nov 1, 2024.**
- Free entry-point (Click-to-WhatsApp ad / Page CTA): all messages free for 72h.
- Representative US base rates (~early-2026 card): marketing $0.025, utility/auth $0.0034. UK marketing ~$0.05, util/auth ~$0.02. India util/auth ~$0.0014 (note India-international auth ~$0.03). Brazil marketing $0.0625. **All rates are medium-confidence; Meta revises the card ~every 6 months — re-verify the destination-country line.**

### 3b. Unofficial libraries & hosted providers

**Libraries (self-host):**
- **Baileys** — pure WebSocket multi-device, no browser; most active (~469k weekly downloads, MIT). ~60–80MB RAM/session, ~500 sessions/server. The cost floor and most flexible, but **you own all ban-handling, reconnection, and a real supply-chain risk** — the Dec 2025 `lotusbail` poisoned fork (56k downloads) exfiltrated tokens, messages, contacts, media. Pin dependencies and audit lockfiles or this is a breach vector.
- **whatsapp-web.js** — Puppeteer/Chromium (~106k weekly, Apache-2.0). ~250–400MB RAM/session, ~50 sessions/server, needs browser restarts every 1–2h. Heavier and bans reported "almost immediately after connecting."
- **WPPConnect** (LGPL), **venom-bot** (discontinued as OSS).

**Hosted gray-market wrappers (QR-paired, flat per-number, no per-message fees):**
- **Whapi.cloud** — ~$29–35/number/mo, free Developer sandbox, exposes history/media via REST + webhooks. Strong "test rack" pick.
- **GreenAPI** — $12/mo Business per instance, free Developer plan (3 chats). *Note: community-flagged as Russia-linked — a data-sovereignty concern for sensitive users.*
- **WAHA (self-host)** — Docker; Core free (text-only, single session), Plus $19/mo donation (media, unlimited sessions, Postgres storage, no phone-home). **Best data-sovereignty option** — message data stays on your infra.
- Periskope / 2Chat / TimelinesAI — team-inbox/CRM products per-seat; TimelinesAI explicitly supports chat-history upload/import.
- **Wassenger is NOT a gray-market peer anymore** — it migrated to the *official* Meta Cloud API (requires a WABA, no QR). Do not budget it as a flat per-number option.

All QR options violate Meta ToS; none can prevent or reverse a ban. For sensitive users, routing chats through a third-party hosted provider means **that provider can read all content** — a hard objection for Whapi/GreenAPI/Periskope/2Chat/TimelinesAI. Self-hosting (WAHA/Baileys) keeps data on your infra but shifts the security burden to you.

### 3c. Ban mechanics & cascade risk

Two signal families: **protocol/client fingerprinting** (detects unofficial clients regardless of volume) and **behavioral/abuse signals** (high velocity, low reply ratio, messaging strangers, recipient blocks/reports, bulk-identical content). Recipient **blocks and reports are the single fastest path** to a quality drop and ban. Enforcement scale is enormous and proactive: ~92M India-linked accounts banned in 2024.

Unofficial-client bans hit accounts **regardless of volume, age, or "safe" behavior** — established 3+ year Baileys bots were killed in Oct 2025 waves. So warming, slow ramp, and reply-ratio tactics *reduce but cannot eliminate* exposure. Bulk number-validation (checking which numbers are on WhatsApp) is an *independent* ban trigger.

**The honest cascade picture:** intentional cross-account correlation by shared infra for *unofficial* accounts is unproven vendor claim. But if your fleet runs the *same* library from shared infrastructure, a single Meta detection wave bans a large fraction at once — a real cascade by monoculture, not by tracing. On the *official* side, portfolio-pooling is a documented, real single-point-of-failure.

---

## 4. WhatsApp Test-Rack

### Candidate experiments

| Approach | Proves | Build-days | $/mo | Ban-risk | Biggest failure mode |
|---|---|---|---|---|---|
| **Off-the-shelf bridge, 1 throwaway number** (Whapi/GreenAPI), human-paced traffic | Baseline time-to-ban for QR automation; history-depth actually returned | 1–2 | $12–35 | High | Banned in hours → premise falsified cheaply (good outcome) |
| **WAHA self-host, 1 number** | Data-sovereignty wrapper works; you hold the data; history/media fidelity | 3–5 | $19 + VPS ~$5 | High | Session loss on Meta protocol change (every 3–6mo) |
| **Baileys self-host, 1 number** | Cost floor, full control, full-history read | 5–8 | VPS ~$5 + proxy | High | Supply-chain (`lotusbail`-class) + you own all reconnection |
| **Official Cloud API + Coexistence, 1 Business-app number** | Sanctioned path; real history-sync depth (180d/14d/no-groups); region availability | 5–10 | Meta per-msg + BSP | Low (but policy-ban risk for vertical) | Coexistence unavailable in user's region; vertical violates policy |
| **Multi-number fingerprint test** (3–5 numbers, varied IPs vs shared IP) | Whether shared infra accelerates correlated bans | 5–8 | $60–175 | High | Burns numbers; only meaningful with >1 tenant |

### Recommended sequence

1. **Falsify first (Week 1–2):** Run ONE throwaway number through an off-the-shelf bridge with human-paced traffic. Measure time-to-ban and the *actual* pre-existing-history depth returned. **Write no platform code until this passes.** This is the cheapest way to kill or validate the premise.
2. **Official lane in parallel (Week 1–3):** Stand up a single Coexistence Business-app number on Cloud API. Verify (a) region availability for your real user geography, (b) real 180d/14d sync behavior, (c) the 24h-window UX. This tests the *durable* path.
3. **Only if Step 1 survives:** the multi-number fingerprint test to probe correlated-ban dynamics before you ever build shared infra.

### Go / No-Go signals

- **GO (unofficial as fallback only):** throwaway number survives ≥4 weeks of human-paced realistic traffic AND history depth meets need AND you can isolate numbers/IPs.
- **NO-GO (unofficial):** ban within days; or bans cluster across numbers sharing infra; or appeals fail (expected).
- **GO (official, reframed product):** Coexistence available in user region AND product can be made policy-compliant (neutral, no explicit content, logged opt-in).
- **NO-GO (official):** region unsupported, or you cannot present a compliant brand identity that survives Meta review.

---

## 5. Infrastructure Layer — data sovereignty

The tension (sovereignty + off-device + operator-can't-read + recoverable) is **solvable today** with client-side E2E encryption layered over central Postgres, where the server stores only ciphertext and per-user keys never reach the operator.

**Architecture A — Encrypted-rows over central DB (RECOMMENDED):** PowerSync + Supabase, app-layer E2EE with libsodium (XChaCha20-Poly1305), envelope encryption. Operator stores only ciphertext + wrapped keys. Trade-off: simplest model, great offline UX, but no server-side search/reporting and you own key lifecycle. Best fit for a structured CRM (clients, bookings, notes).

**Architecture B — E2EE CRDT (secsync + Yjs/Automerge):** only if real-time multi-writer collaborative editing is a hard requirement. secsync is **beta, not production-ready**, and leaks edit metadata. Overkill here — skip.

**Architecture C — Managed-enclave recovery (Signal SVR-style PIN escrow):** best UX for time-poor users (short PIN vs 24-word phrase), but high build/operational cost. Post-prototype only.

**Key management — envelope encryption from day one:** one random per-user **Data Encryption Key (DEK)** encrypts the data; the DEK is wrapped independently by (1) a **recovery phrase** [always, primary], (2) each **device/passkey** [fast unlock], (3) **optional, opt-in, off-by-default escrow/guardian**. Operator stores only wrapped DEKs + ciphertext.

**Critical guardrail:** a passkey/WebAuthn-PRF must **NEVER** be the sole key holder — credential deletion = permanent data loss (Tim Cappalli's warning), and Apple PRF support is still buggy in 2026. Passkey unlock is a convenience layer on top of the recovery-phrase-wrapped DEK.

### Simplest defensible PROTOTYPE choice

**Supabase Postgres + RLS** (org_id, indexed, JWT-claim policies) for tenancy **+ app-layer E2EE (libsodium XChaCha20-Poly1305)** + **one per-user DEK wrapped by a BIP39 recovery phrase (primary)** + **optional operator escrow disabled by default** + **PowerSync** for offline sync of encrypted rows (decrypt into local-only mirror tables for querying). One moving crypto part; delivers sovereignty, off-device storage, operator-unreadable data, and recovery. RLS is **defence-in-depth under** encryption, never the confidentiality boundary (service_role bypasses RLS). PowerSync free tier (2GB/mo) + Supabase free tier validates the prototype; budget PowerSync Pro ($49/mo) before real users.

---

## 6. CRM/App Layer — patterns to steal + AI surface

This layer is **genuinely solved** — steal, don't invent.

**UX shell to copy:** Don't build an inbox. **Missive** is the closest blueprint for the exact AI behavior (its "AI Rules" already ship plain-language LLM conditions → AI drafts/tasks/labels, gated by confidence). **Kommo** is the closest for messenger-native (WhatsApp/IG) kanban lead pipelines with AI appointment booking. **Front** gives the multi-channel inbox + rules engine + webhooks (drive automation off rule webhooks with "Send Full Event Data" to dodge its 50 req/60s read limit).

**AI automation surface — one structured call per inbound message:**
```
{ is_booking, booking_fields, intent_tags[], service_tags[],
  red_flags[], suggested_reply, confidence }
```
Use **schema-constrained decoding** (Anthropic structured outputs / OpenAI `strict:true`) so output is always valid JSON — this is what makes "looks like a booking" reliable enough to auto-act on. **Confidence-based routing in deterministic code, not the model:** above threshold auto-tag + stage a draft; below it, escalate to human with full thread. **Never auto-send, never auto-block on model output.** Collaborative drafting (human approves reply) and advisory flagging are the safe defaults — critical in a harm-reduction context where a false "time-waster" flag denies income.

**Dangerous-client flagging:** combine an **external screening source (National Ugly Mugs / NUMChecker** — screens by phone/email/handle/vehicle-reg) with an **LLM behavioral red-flag classifier** as a *separate, advisory* signal. Keep an audit log; design for false-positive recovery. Adopt the community-list legal posture wholesale: closed access to verified workers, anonymous reporting, explicit no-accuracy disclaimers, member-controlled data, separated from law enforcement by default.

**Source attribution (solved convention):** capture UTM params into hidden form fields, persist UTM in a cookie across pages, write first-touch into a **write-once** field at contact creation, store entry-point per contact.

**Model routing for cost:** Haiku 4.5 ($1/$5 per 1M) for per-message extraction/classification/flagging; reserve Sonnet 4.6 ($3/$15) or Opus 4.8 ($5/$25) for drafting/judgment. One large **cached** system prompt (~90% off cached reads) across every inbound message; **Batch API (−50%)** for backfill.

**HD NOTES** (escort-agency booking tool: per-client booking history, phone search, blacklist, role-based permissions, SMS confirmations) is the closest direct CRM analog — use as a feature-parity baseline.

---

## 7. Scale Ceilings (10 / 100 / 10k / 100k) for both paths

The two paths break in **completely different dimensions.**

| Workers | Official (breaks on number-provisioning + tier friction) | Unofficial (breaks on per-session compute + correlated bans) |
|---|---|---|
| **10** | Trivial: 1–2 shared numbers, 250–1K tier. Prefer official for stability. | Fits one small server (10 sessions ≈ 2.5GB WEBJS, <1GB NOWEB). |
| **100** | Clear winner. Within ~20-number cap if numbers are pooled/shared; 1K–10K tier. | 100 dedicated sessions already exceed safe ~50/server WEBJS ceiling (needs Baileys/NOWEB or 2nd server); 100 cold numbers raise ban-cascade odds. |
| **10k** | Do **NOT** attempt one number per worker (blows past ~20-cap by orders of magnitude). Pool shared numbers across multiple WABAs/BSPs; climb to 10K–100K tier; budget 80→1,000 MPS upgrade. | ~20+ NOWEB servers, sharded + sticky-routed; **guaranteed rolling ban waves.** Not recommended for production. |
| **100k** | Only realistic via multiple WABAs/BSP partners, unlimited tier, 1,000 MPS, async webhook queue (ack <5s, process downstream). | **Infeasible** — hundreds of servers, continuous re-registration of banned numbers, unbounded cascade. |

**Net:** Official is bureaucratic and slow but stable; the per-worker-number model is unworkable past low tens, forcing a shared/pooled-number architecture at scale. Unofficial is cheap to start but operationally fragile beyond a few hundred sessions on one box, and *existentially* fragile at any scale.

---

## 8. Cost Model + candidate per-worker subscription

**Dominant cost driver in both paths is AI inference, not messaging** — if you exploit free windows. The swing variable is model choice: same token assumptions, ~$0.15/worker on Haiku vs ~$2.50+/worker on Opus.

**Baseline assumptions (state explicitly — these set the answer):**
- ~600 template-eligible outbound msgs/worker/month, **majority inside the free 24h window** (so only marketing + out-of-window utility is billed).
- ~50 LLM turns/worker/month at ~3k in / ~0.5k out tokens, default model Sonnet 4.6.
- Country mix matters (per-message rates vary 10–60×); set price on a *blended* rate, not US-only.

**Blended cost/worker/month:**

| Workers | Approach A (Official via BSP) | Approach B (Unofficial self-host) |
|---|---|---|
| 10 | ~$3.10 | ~$8–12 (proxy minimums dominate) |
| 100 | ~$2.50 | ~$3–5 |
| 10k | ~$1.60 | ~$1.30 |
| 100k | ~$1.30 | ~$1.10 |

**Key cost levers:** keep utility replies *inside* the free window (collapses official messaging to marketing-only); Haiku for routine turns + prompt caching + Batch API keeps AI near $0.15–0.50/worker. BSP choice matters: 360dialog (~$49/mo + flat $0.005/msg) vs Twilio ($0.005 send AND receive) vs WATI (+20%).

**Hidden cost the headline numbers miss:** ban-recovery / number-warming reserve — budget a notional **$1–3/worker/month**; messaging numbers are not zero-churn.

**Candidate subscription:**
- **Launch (small scale): $19–25/worker/month** — covers the $50–100/mo infra floor, ops/support, ban-recovery reserve, ~70%+ margin.
- **At scale: step down to $9–15/worker.** At 100k a **$12 price on ~$1.30–2.00 cost ≈ 85% gross margin.**

**Two messaging-mix scenarios must be modeled:** window-heavy/service-led (~$0.50/worker messaging) vs marketing-heavy/out-of-window (~$5–15/worker). Set the price floor against the *worse* case. **Re-verify Anthropic pricing (cache dated 2026-05-26) and Meta's country rates before committing.**

---

## 9. Recommended Tech Stack + day-one security guardrails

**Stack (pragmatic for a solo builder driving Claude):**
- **Monorepo** (pnpm workspaces, optional Turborepo): `apps/web` (Next.js + TS on Vercel) + `apps/worker` (always-on Node service holding the messaging session + BullMQ on Redis) + `packages/shared` (types, schema, validation).
- **The messaging/session layer CANNOT live in serverless** — Vercel Functions cap at 300s (Hobby) / 800s (Pro) and explicitly do not support acting as a WebSocket server. WhatsApp sessions need a persistent 24/7 process on Fly.io / Railway / Render / VPS with PM2.
- **Data:** Supabase Postgres + RLS + Auth; transaction-mode pooling (`?pgbouncer=true&connection_limit=1`) for serverless web; direct/session connection for the worker.
- **Abstract the channel behind an internal `MessagingProvider` interface** so you can swap WhatsApp → SMS/Signal/Telegram without a rewrite. (Telegram has a *sanctioned* bot API with no adult-content ban; worth a serious look as primary or fallback.)

**Day-one security guardrails (non-negotiable):**
1. `.gitignore` `.env` and all AI-tool dirs.
2. **`.claude/settings.json` deny rules** — `Read(./.env)`, `Read(./.env.*)`, `Read(./secrets/**)`. (`.gitignore`/`.claudeignore` do **not** stop Claude Code reading `.env` — confirmed by The Register, Jan 2026, v2.1.12; only the deny rule does.)
3. **gitleaks** as a pre-commit hook **and** a CI job — final net.
4. One **secrets manager** from day one — Infisical free tier / Doppler free Developer tier, or SOPS + cloud KMS.
5. **RLS enabled on EVERY table** (deny by default); anon key + user JWT for user-facing queries; **service_role only for trusted worker jobs.** Index every org_id; test policies from the client SDK (SQL Editor bypasses RLS).
6. **App-layer E2EE for sensitive PII** (per Section 5) — the operator should not be able to read client/worker identities or notes.
7. Minimal CI on every PR: eslint, `tsc --noEmit`, tests, gitleaks, Node 20, concurrency cancel-in-progress.
8. Always-on **paid** hosting for the worker + Redis (Supabase free projects *pause* after 7 days idle — fatal for an always-needed session).

---

## 10. Legal / Platform Risk and the design choices that reduce it

Three overlapping regimes: **criminal facilitation**, **payment/platform deplatforming**, **data-protection liability.**

**Criminal facilitation (the legal hinge: neutral tooling vs knowing facilitation):**
- US **FOSTA-SESTA** (18 U.S.C. 2421A): up to 10 years (25 for aggravated), strips Section 230, low *reckless-disregard* standard, exposes the **operator personally**.
- **Woodhull v. US** (DC Cir., 7 Jul 2023) **narrowed** FOSTA: it does **not** reach general advocacy, education, or advice to sex workers *for their protection* — a real safe harbour for a **harm-reduction framing.**
- **Nordic-model + UK** jurisdictions criminalise third-party "profiting"/"facilitation"/"controlling for gain" *even where selling sex is legal* — so "legal where the worker is" is insufficient.

**Payment deplatforming:** Stripe/PayPal flatly prohibit adult/escort services; Visa/Mastercard act as de facto regulators (OnlyFans Aug 2021). **Touching payment flow is the single fastest route to a freeze.**

**Data:** worker + client identities + chat logs = GDPR/UK GDPR **Article 9** special-category (sex life) + **Article 10** criminal-offence data. Fines to €20M/4% (UK £17.5M/4%); Australia's 2024 Privacy Act added a statutory privacy tort. The real cost is **physical harm** — outing, stalking, extortion.

**Platform channel:** WhatsApp Business/Commerce Policy prohibits adult/sexual services (verified verbatim + independently in the Messaging Policy). Meta's Cloud API **decrypts content server-side** and never E2E-encrypts metadata — a poor channel *and* a poor data store for this use case.

**Bot-disclosure laws:** California **SB 243** (clear disclosure, private right of action) and **EU AI Act Art. 50** (mid-2026) conflict with an AI that negotiates while the client believes it's the human worker.

**Design choices that reduce risk:**
1. **Neutral, general-purpose framing** — a privacy-first CRM/scheduling tool any service worker can use; never advertise specific services, broker transactions, or take a per-booking cut (those facts establish "knowing facilitation").
2. **Handle no payments at all** — removes Stripe/Visa/Mastercard exposure in one decision.
3. **Ruthless data minimisation** — don't collect/centralise client real identities; prefer aliases, short retention, no server-side chat logs.
4. **Worker-held / zero-knowledge encryption** — you cannot hand over plaintext you cannot decrypt; shrinks breach blast radius and compelled-disclosure exposure.
5. **Jurisdiction-aware hosting + feature-gating** — gate/disable anything resembling facilitation in Nordic-model and criminalising states.
6. **Relabel the AI as a clearly-disclosed assistant**, not "secretly the worker" — SB 243 / EU AI Act compatibility.
7. **DPIA before launch** (special-category data mandates it); Art. 32 baselines (TLS 1.3, AES-256, key separation, MFA); breach-response under 72h GDPR / NDB regimes ready *before* go-live.
8. **Get qualified legal counsel per target jurisdiction before building on WhatsApp at all.**

---

## 11. Pressure-Tests of the User's Assumptions + edge cases not raised

**Assumptions challenged:**
- *"Import full history"* → impossible into the platform (180d/14d/no-groups cap); but full history survives on-device — the goal is partly a misunderstanding of where data lives.
- *"Appear as native WhatsApp"* → impossible on official (it's a Business account); only approximated on unofficial, which forfeits ban-avoidance.
- *"Avoid bans"* → incompatible with both prior goals; and the *vertical itself* triggers policy bans regardless of technique.
- *"Build the 3-layer architecture first"* → **wrong order.** It optimizes multi-tenancy and pluggability with zero users while answering none of the kill questions, and the shared central DB is the worst thing to build first (one breach exposes workers + clients). **Invert: de-risk WhatsApp survivability → CRM app → shared infra last or never.**
- *"Secretly automate negotiation as the worker"* → potentially unlawful (SB 243 / EU AI Act) and ethically fraught.
- *"One test worker is enough"* → hides multi-tenant detection dynamics that only emerge at >1 tenant.
- *"Build vs buy"* → moot on the legal axis: no compliant WhatsApp CRM can be *bought or resold* for this exact case (none knowingly serve adult services).

**Edge cases the user did not raise:**
- **Recycled/reassigned numbers:** 66% of recycled US numbers still link to a prior owner (~35M recycled/year, no warning) → identity-takeover hands a stranger the worker's inbound client messages — a *physical-safety* risk.
- **Client also messaging the worker's real personal WhatsApp** (parallel thread Meta doesn't mirror).
- **Phone + API simultaneous use** session conflicts (mitigated only by Coexistence's `smb_message_echoes`).
- **Groups unsupported** on the API entirely.
- **Voice notes and voice calls** — call recording triggers two-party-consent laws in some regions.
- **Presence signals** (read receipts, typing, online status) can reveal bot timing and unmask automation.
- **GDPR subject-access / deletion / worker-churn export** — unsolved by an "encrypted-DB-plus-key-pairs" hand-wave; needs an explicit plaintext-export portability path.
- **Coexistence region unavailability** (EU/UK/AU) could invalidate the official path for your actual user base.
- **On ban, dangerous-client tags vanish exactly when needed** unless CRM data + tags are fully decoupled from the WhatsApp session.

---

## 12. Ranked OPEN QUESTIONS for the user

1. **What is the real target jurisdiction(s) for users?** Decriminalised (NZ/NSW/VIC/QLD) vs Nordic-model (Sweden/France/Ireland/UK) vs US changes the *legal viability of the operator personally* and whether Coexistence is even available. **This gates everything.**
2. **Is "full lifetime history import" a true must-have, or is "full history stays on the worker's device + 6-month synced window in the CRM" acceptable?** If the latter, the official path opens up.
3. **Must the channel be WhatsApp specifically?** Telegram (sanctioned bot API, no adult-content ban) or Signal may meet the harm-reduction goals at far lower legal/ban risk. How much is "it must be WhatsApp" worth?
4. **Will the product ever touch payment flow?** If yes, accept Stripe/Visa deplatforming risk; strongly recommend a hard "never" here.
5. **Will the AI ever message a client *as if it were the worker*, or always as a disclosed assistant?** Determines SB 243 / EU AI Act compliance and reframes the flagship feature.
6. **Is the product branded for sex workers, or neutral general-purpose tooling that they happen to use?** Branding is a load-bearing legal fact (knowing facilitation).
7. **What is the acceptable answer to "a worker's number gets banned"?** If "never acceptable," the unofficial path is dead and you must architect CRM data fully decoupled from the session.
8. **Who is the operator, and can they accept personal criminal/regulatory exposure** in the target jurisdictions before writing platform code?
9. **What user geography drives the cost model** (country mix sets per-message rates 10–60× apart)?
10. **Is real-time collaborative editing actually needed** (drives Architecture A vs B), or is a structured single-writer CRM sufficient? (Almost certainly the latter.)

---

*Bottom line: the premise as written is ~5–15% durable. A reframed product — neutral tooling, official Cloud API + on-device history + capped sync, zero payment flow, client-side E2E encryption, ban-resilient decoupled architecture, disclosed AI — is viable, but it is a different product. Falsify the WhatsApp survivability premise in 2 weeks before building anything else.*

**Document file (this brief is the deliverable; no files were written per instructions).** Key reference paths if you stand up the prototype: `apps/worker` (session host), `.claude/settings.json` (secrets deny rules), `packages/shared` (DEK/envelope-encryption + DB schema).