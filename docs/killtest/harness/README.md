# Kill-test harness — operator run book (UNOFFICIAL lane)

This harness drives + monitors an **off-the-shelf WhatsApp bridge** for the
survivability kill-test. It contains **no Baileys code** — WAHA wraps the engine;
we only poll it over HTTP. This lane is **fallback-only and gated**: a NO-GO here
just disables the unofficial adapter; Telegram + WA-official proceed regardless.

> **AVOID GreenAPI for any real data** (community-flagged Russia-linked).
> **WAHA self-host is recommended** for data sovereignty. Whapi.cloud's free
> Developer sandbox is the hosted alternative if you can't self-host.

## What you measure
1. **Time-to-ban** for ONE throwaway number under realistic, human-paced traffic.
2. **History depth surfaced on pair** — the key unknown (days/messages of
   pre-existing history the bridge hands over on first connect).

## Steps

1. **Choose a bridge.** Default + recommended: WAHA self-host (`BRIDGE=waha`).
2. **Review the image tag (supply-chain).** Open `docker-compose.yml`; the WAHA
   tag is pinned, not `latest`. Confirm the digest against devlikeapro's releases
   and that the bundled Baileys is known-good (not a poisoned fork like Dec-2025
   `lotusbail`). This is a hard gate — do not bring it up on an unreviewed tag.
3. **Configure env.** `cp .env.example .env`, then set `WAHA_API_KEY` (random),
   `WAHA_URL` (default `http://localhost:3000`), `KILLTEST_NUMBER_LABEL` (a label
   only — NEVER the real number). `.env` is gitignored.
4. **Bring up the bridge.** `docker compose up -d` from this `harness/` dir. Wait
   for the healthcheck to go healthy (`docker compose ps`).
5. **Provision the throwaway number (HUMAN-ONLY).** A SIM/number nobody cares
   about. The number lives on the physical device, never in the repo.
6. **Pair.** Start a WAHA session and scan the QR / link-with-phone (WAHA dashboard
   at `http://localhost:3000` or its `/api/sessions` start endpoint). On a fresh
   pair, WhatsApp's history-sync determines what depth the bridge can surface.
7. **Run the monitor.** `node monitor.mjs`. It polls every `POLL_INTERVAL_SECONDS`,
   classifies the session state, and on first connect records the history depth.
8. **Send realistic human-paced two-way traffic.** NO bulk. NO cold-messaging
   strangers. Just normal back-and-forth, over days/weeks.
9. **If banned:** the monitor logs `state: banned`. File ONE appeal (human-only)
   and record the outcome in `../results.md` (expected base rate ~1 success / 37).

## Where logs land
`../log/events.jsonl` — one JSON object per poll:
`{ ts, lane, state, prev_state, history_depth, note }`.
**ids / states / counts / timestamps only — never message text** (project rule).

## Reading the verdict
Transcribe key events (pair / first-connect history depth / reconnects / ban /
appeal) into the running-log table in `../results.md`, then resolve the three
sub-verdicts at the top of that file against the GO/NO-GO matrix.

## Validate the harness offline (no number, no network)
```
node monitor.mjs --self-test
```
Expect `PASS` and exit 0. This exercises the state machine, ban detection,
history capture, and the JSONL writer without touching the network.
