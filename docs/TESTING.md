# WorkerChat — Testing

The hub for hands-on testing: how to run experiments, what to buy, and a log of results.
Orchestrator-owned. The canonical *technical* run book for the kill-test lives in
`docs/killtest/harness/README.md` (Track A); this page is the plain-English operator view +
notes + results. Add new test plans and findings here as we go.

---

## ⚠️ Pre-flight status (read first)

| Check | Status (2026-06-11) | Action |
|---|---|---|
| WAHA Docker image pinned in `docs/killtest/harness/docker-compose.yml` | 🔴 **`devlikeapro/waha:2024.12.3` does not exist** — Docker Hub has zero `2024.12.*` tags. Would fail to pull. | **Track A must re-pin** to a real tag (see below) before anyone runs the bridge. |
| Docker installed on the test machine | 🔴 Not installed (`command not found: docker`) | Install **Docker Desktop** first. |
| Kill-test harness code | 🟢 Present; offline `--self-test` passes | — |
| Throwaway SIMs (Melbourne + Paris) | ⏳ To buy | See SIM guide below. |

**Re-pin recommendation (for Track A):** `devlikeapro/waha` is the legitimate official WAHA
image. Current stable = **2026.5.1** (2026-05-26). The harness is configured for the **WEBJS**
engine (browser-based, uses *whatsapp-web.js* — note this means the Baileys/`lotusbail`
supply-chain concern applies to the **NOWEB** engine, *not* this config). Re-pin to a real WEBJS
Core tag for 2026.5.1 and **pin by digest** for immutability, e.g.:
```
# verify + pin (run once Docker is installed):
docker buildx imagetools inspect devlikeapro/waha:latest-2026.5.1   # confirm it's WEBJS Core, copy the sha256
# then in docker-compose.yml:
image: devlikeapro/waha:latest-2026.5.1@sha256:<full-digest-from-inspect>
```
(If switching to the Baileys engine later, the equivalent is `noweb-2026.5.1` — and the
`lotusbail` audit becomes mandatory.)

---

## 🧪 Experiment 1 — WhatsApp survivability kill-test (UNOFFICIAL lane)

**Question:** if we connect a throwaway WhatsApp number to an off-the-shelf unofficial bridge and
chat at a human pace, how long until it gets banned — and how much history does it pull on first
connect? A **NO-GO just disables the unofficial fallback**; Telegram + official WhatsApp proceed
regardless. We're running it from **Melbourne** and **Paris** to see if geography changes the result.

> **Golden rule:** a throwaway number you don't care about. **Never the test user's real number** —
> this experiment is *designed* to risk a ban.

### Before you start
- **Docker Desktop** installed + running.
- **Node** (already present) — runs the monitor.
- **A throwaway SIM + a spare/old phone** (SIM guide below).
- **1–2 friendly contacts** (your own other number, a mate) to chat with.
- **The image re-pinned** (pre-flight above) — don't bring up the bridge until that's done.

### Steps
1. **Throwaway number:** SIM in the spare phone, register **WhatsApp Business** on it. Keep the
   phone powered on with the SIM for the whole test.
2. `cd docs/killtest/harness`
3. `cp .env.example .env`, then edit `.env`:
   - `WAHA_API_KEY` → any random string you make up
   - `WAHA_URL` → leave as `http://localhost:3000`
   - `KILLTEST_NUMBER_LABEL` → a nickname only (e.g. `mel-burner` / `paris-burner`) — **never the real number**
4. `docker compose up -d`, then `docker compose ps` → wait for **healthy**.
5. **Pair:** open `http://localhost:3000` → start a session → on the throwaway phone, WhatsApp →
   **Linked Devices → Link a Device** → scan the QR.
6. `node monitor.mjs` — leave running. Logs to `docs/killtest/log/events.jsonl`
   (ids/states/timestamps only — never message text).
7. **Chat naturally over days/weeks.** No bulk sends, no messaging strangers.
8. **If banned:** the monitor logs `state: banned`. File **one** appeal by hand; record below.

### GO / NO-GO
| | |
|---|---|
| 🟢 **GO** (unofficial usable as a fallback) | Survives **≥4 weeks** human-paced **and** pulls enough history on first connect. |
| 🔴 **NO-GO** | Banned within days, or the appeal fails (base rate ~1 success / 37). |

### Validate the harness offline first (no SIM, no network)
```
cd docs/killtest/harness && node monitor.mjs --self-test   # expect PASS, exit 0
```

---

## 📱 SIM buying guide

Get a **real local mobile SIM**, not a data-only travel eSIM (those often have no usable number
and can't receive the WhatsApp verification SMS). **Both countries require photo ID to activate** —
"throwaway" means cheap/disposable, not anonymous. Bring your passport/ID.

### 🇦🇺 Melbourne
| Option | Why | Where |
|---|---|---|
| **ALDI Mobile $2 PAYG starter** *(cheapest)* | $2 SIM on the **Telstra** network (great coverage) | Any **ALDI** supermarket / aldimobile.com.au |
| **Boost** (Telstra network) | Cheap, everywhere | **Woolworths**, **7-Eleven**, Australia Post |
| **Woolworths/Coles Mobile, Lycamobile, Lebara** | Cheap MVNO starters (~$2) | Woolworths / Coles / convenience stores |

### 🇫🇷 Paris
| Option | Why | Where |
|---|---|---|
| **Lycamobile / Lebara** *(easiest + cheap)* | Cheap, high-data, sold loose; popular with non-residents | **Tabacs** (everywhere in central Paris), some supermarkets |
| **Bouygues Telecom** prepaid | Reliable carrier-direct | Bouygues stores near metro stops |
| **Free Mobile** | Very cheap, but bought via an in-store machine (fiddly) | Free Mobile stores |

Typical Paris starter ~€10–30. Orange/SFR *stores* often won't sell tourist prepaid and redirect
you to a kiosk/tabac — so go straight to a **tabac** for a Lycamobile/Lebara SIM.

**Keep the two cities independent** (own machine, own number, own bridge each) so the geography
comparison is clean. Deliberately running both through one shared server is a *different* test
(ban correlation across shared infra) — parked for later (`docs/FUTURE-EXPLORATION.md`).

---

## 📒 Test log

| # | Location | Number label | Carrier | Engine/tag | Started | History depth on pair | Ban? (state + date) | Appeal | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Melbourne | `mel-burner` | _TBD_ | WEBJS / _re-pin_ | _TBD_ | _—_ | _—_ | _—_ | ⏳ |
| 2 | Paris | `paris-burner` | _TBD_ | WEBJS / _re-pin_ | _TBD_ | _—_ | _—_ | _—_ | ⏳ |

> The machine-readable record is `docs/killtest/results.md` + `docs/killtest/log/events.jsonl`.
> Summarise the human story here.

---

## ☁️ Running a bridge on a cloud VPS (always-on, in-country)

Run WAHA + the monitor on a small cloud server in the **target country** (London for the UK
burner, Paris for the FR burner, Sydney for the AU one) so it stays up without your laptop **and**
gives a country-matched IP. ~US$5/month each (Hetzner ~€4, DigitalOcean / Vultr ~$5–6). Repeat
per burner — one box each (separate boxes also avoid the shared-IP correlated-ban risk).

> ⚠️ Datacenter IPs are more ban-prone than home/4G for the unofficial bridge — a VPS test may
> ban *faster* than a real worker would. A residential proxy in-country is the gold standard; a
> regional VPS is the cheap, practical middle ground.

1. **Create the server.** Provider dashboard → new server → **Ubuntu 24.04**, smallest size, in
   the **London / Paris / Sydney** region. Add your SSH key. Note its IP.
2. **SSH in:** `ssh root@<server-ip>`
3. **Install Docker + Node 20 + git:**
   ```
   curl -fsSL https://get.docker.com | sh
   curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs git
   ```
4. **Get the harness onto the box** (whichever is easier):
   - `git clone <your repo> && cd <repo>/docs/killtest/harness`  *(if pushed)*, or
   - from your laptop: `scp -r docs/killtest/harness root@<server-ip>:~/harness` then `cd ~/harness`
5. **Configure + start** (same as local):
   ```
   cp .env.example .env        # set WAHA_API_KEY (random) + KILLTEST_NUMBER_LABEL (e.g. uk-burner)
   docker compose up -d && docker compose ps     # wait for "healthy"
   ```
6. **Pair the phone — secure, no public port.** WAHA binds to localhost on the server, so tunnel
   to it from your laptop instead of exposing it:
   ```
   ssh -L 3000:localhost:3000 root@<server-ip>
   ```
   Leave that open, then on your **laptop** browser open `http://localhost:3000` → start a session
   → scan the QR with the burner phone (WhatsApp → Linked Devices → Link a Device).
7. **Run the monitor so it survives logout:**
   ```
   nohup node monitor.mjs > monitor.out 2>&1 &
   ```
   (or a `tmux` / `systemd` service). Logs land in `log/events.jsonl` on the server.
8. **Check in later:** `ssh root@<server-ip> 'tail ~/harness/log/events.jsonl'`. Keep the burner
   phone powered on with its SIM (~14-day WhatsApp check-in).

**Two birds:** always-on (no laptop) + country-matched IP.

---

## Other things to test
See `docs/FUTURE-EXPLORATION.md` → *Things to test* (whatsmeow-vs-Baileys engine eval, Beeper's
at-scale ban behaviour, the multi-number correlation test, Coexistence regional availability).
