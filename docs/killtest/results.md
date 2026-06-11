# WhatsApp survivability kill-test — results (Track A owned)

> Living results doc. The orchestrator gate and Track C's `chat.html` cite this file.
> `docs/research/**` stays immutable. Spec: `tracks/A-chat-layer.md` Deliverable 1.

---

## VERDICT: PENDING  _(dated 2026-06-11)_

| Sub-verdict | Status | Gates |
|---|---|---|
| **unofficial-fallback** (keep Baileys path as scoped fallback?) | **PENDING** | Survives ≥4 weeks human-paced + history depth meets need + numbers/IPs isolable |
| **official-primary** (Coexistence durable primary in real geography?) | **PENDING** | Coexistence available in region + compliant neutral brand |
| **history-depth** (does surfaced pre-existing history meet the ~6mo need?) | **PENDING** | Actual days/messages returned on pair ≥ product need |

> No sub-verdict may flip to GO/NO-GO until the running log below contains the
> supporting events. The unofficial verdict gates **only** the unofficial adapter;
> Telegram and WA-official proceed independently regardless of the outcome here.

---

## Purpose

Cheaply **falsify or validate** whether the UNOFFICIAL WhatsApp path (Baileys-style,
via an off-the-shelf bridge) is survivable enough to keep as a **scoped fallback**
for regions where official Coexistence is unavailable. In parallel, confirm the
OFFICIAL path (Cloud API + Coexistence) is a durable primary for the real user's
geography. A ban must cost a *channel*, never the CRM's data.

## Method (one paragraph)

Provision ONE throwaway number (lane A) on an off-the-shelf bridge — **WAHA
self-host** preferred for data sovereignty (Whapi.cloud free sandbox as alt;
**GreenAPI avoided** for real data, community-flagged Russia-linked) — and drive
**realistic, human-paced, two-way** traffic for ≥4 weeks (no bulk, no
cold-messaging strangers). A dependency-free monitor (`harness/monitor.mjs`) polls
the bridge, classifies session state into the project ConnState vocabulary, records
the **history depth surfaced on first pair** (a key unknown), and appends id/state/
count/timestamp-only events to `log/events.jsonl` (never message text). In parallel
(lane B) stand up ONE WhatsApp **Business** number on the **official Cloud API +
Coexistence** and verify regional availability, the ~180d-text/~14d-media sync
behaviour, and the 24h-window UX. We then resolve the three sub-verdicts above
against the GO/NO-GO matrix.

---

## GO / NO-GO decision matrix

_(Faithful to `tracks/A-chat-layer.md` Deliverable 1.)_

- **GO — unofficial-as-fallback:** survives **≥4 weeks** human-paced **AND**
  history depth meets need **AND** numbers / IPs are isolable (one ban can't
  cascade across shared infra).
- **NO-GO — unofficial:** banned in **days**, **OR** bans **cluster across
  shared-infra numbers**, **OR** appeals **fail** (expected base rate ~**1 success
  in 37**).
- **GO — official:** **Coexistence available in region** **AND** the product
  presents a **compliant neutral brand**.

---

## Two parallel lanes

### Lane A — unofficial bridge survivability
- Bridge: WAHA self-host (`harness/docker-compose.yml`, pinned tag, supply-chain
  reviewed). One throwaway number. Monitor: `harness/monitor.mjs`.
- Watching for: **time-to-ban**, **history depth on pair**, reconnect stability,
  and whether a ban is isolable (number/IP) vs clusters across shared infra.
- Kill conditions: banned in days / shared-infra ban clustering / failed appeal.

### Lane B — official Cloud API + Coexistence
- Stand up ONE WhatsApp **Business** number on the official Cloud API with
  Coexistence. **No bridge container needed** (this lane is API + webhooks).
- Verify, for the **real user geography** (AU operating entity; commonly-excluded
  regions per SCOPE §7: EU/EEA, UK, AU, JP, KR — **check live**):
  - **(a) Coexistence availability** in region.
  - **(b)** real **~180d text / ~14d media** sync behaviour on connect.
  - **(c)** the **24h customer-service-window UX** (free-form inside the window;
    template-gated outside it).
- This lane carries **zero ban risk** and decides the *primary* path; lane A only
  decides the *fallback*.

---

## Running log

> Transcribe bridge/monitor events here. `history_depth_returned_on_pair` is the
> KEY unknown — fill it the moment the number first connects. Keep it to
> ids/states/counts — never message content.

| date | lane | event | conn_state | history_depth_returned_on_pair | notes |
|------|------|-------|------------|--------------------------------|-------|
|      |      |       |            |                                |       |

_event ∈ { pair, message-in, message-out, reconnect, ban, appeal }_
_conn_state ∈ { disconnected, connecting, pairing, connected, reconnecting, logged_out, banned, error }_

---

## What only a human can do

The harness is automation-only; these steps **require a person** and must not be
faked or automated:

1. **Provision ONE throwaway number** nobody cares about (a burner SIM/number).
   The number lives on the physical device — **never** committed to the repo
   (only the `KILLTEST_NUMBER_LABEL` label is recorded).
2. **Review the WAHA image tag** before bring-up (supply-chain gate; SCOPE §7).
3. **Pair** the number (scan QR / link-with-phone).
4. **Send realistic, human-paced, two-way traffic** — normal back-and-forth over
   days/weeks. **NO bulk. NO cold-messaging strangers.** (Bulk/cold patterns would
   invalidate the test and trigger an artificial ban.)
5. **File ONE appeal if banned**, and record the outcome here (expected base rate
   ~1 success in 37).
6. **Lane B:** create the WhatsApp Business number, enable Coexistence, and
   eyeball the sync depth + 24h-window behaviour in-region.

---

## How to run

See `harness/README.md` for the full operator run book. Offline harness check:
`node harness/monitor.mjs --self-test` → expect `PASS`, exit 0.
