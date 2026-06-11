# WorkerChat

A privacy-first, channel-agnostic CRM and client-comms tool for independent service
providers. Workers connect a messaging channel (WhatsApp first, Telegram in parallel),
pull recent conversations into a CRM, and get faster, safer bookings — without changing
the client's experience of "just chatting on WhatsApp."

> **Framing matters and is load-bearing (legal + platform).** This is *neutral,
> general-purpose tooling*. It is not branded as, advertised as, or built to broker, any
> specific category of service. See `docs/SCOPE.md` §Legal posture.

---

## Start here (read in this order)

1. **`docs/SCOPE.md`** — the master scope. What we're building, the locked decisions, the
   reframe from the original brief, what's in/out for the prototype, success criteria.
2. **`docs/CONTRACTS.md`** — the frozen interfaces (messaging provider, DB schema, queues,
   encryption boundary, track ownership map). This is what lets three Claude instances build
   in parallel without colliding. **Do not change a contract without updating this file and
   pinging the other tracks.**
3. **`docs/research/00_synthesis.md`** — the full research brief (WhatsApp official vs
   unofficial, ban mechanics, scale, cost, legal). The evidence behind every decision.
4. **`tracks/`** — one playbook per parallel workstream (A chat layer, B CRM/data, C site).
5. **`SECURITY-ACTIONS.md`** — secret-rotation list from the prior build + day-one hygiene.

---

## The three parallel tracks

| Track | Owns | First deliverable |
|---|---|---|
| **A — Chat / Channel layer** (`tracks/A-chat-layer.md`) | `apps/worker/`, the messaging adapters | The 2-week WhatsApp **kill-test** + Telegram + official Coexistence connect |
| **B — CRM app + Data/Infra** (`tracks/B-crm-app.md`) | `apps/web/`, `packages/shared/`, `supabase/` | Channel-agnostic CRM: inbox, contacts, pipeline, tags, booking close-loop, attribution |
| **C — Investor scoping site** (`tracks/C-scoping-site.md`) | `docs/site/` | Static HTML (Cloudflare Pages): 3 layers + tech + scaling + costs |

Each track has a clean ownership boundary (see `docs/CONTRACTS.md` §Ownership) so the
instances never edit the same files. Track B publishes the schema + interface *definitions*;
Track A implements adapters against them; Track C only writes docs.

## How to run the parallel build

Open three terminals, one per track. In each, start Claude and point it at its brief, e.g.:

```
# Terminal A
claude  →  "Read docs/SCOPE.md, docs/CONTRACTS.md, and tracks/A-chat-layer.md. You own Track A."
# Terminal B
claude  →  "Read docs/SCOPE.md, docs/CONTRACTS.md, and tracks/B-crm-app.md. You own Track B."
# Terminal C
claude  →  "Read docs/SCOPE.md, docs/CONTRACTS.md, and tracks/C-scoping-site.md. You own Track C."
```

Keep this orchestrator instance for cross-track decisions, contract changes, and reviews.

---

## Secrets (Doppler)

Real secret values live **only** in Doppler (project `worker`, config `dev`) — never in git,
`.env`, or chat. This repo is pre-linked via `doppler.yaml`. One-time on each build machine:

```
brew install dopplerhq/cli/doppler   # install CLI
doppler login                        # authorize (opens browser)
```

Then run anything that needs secrets with `doppler run -- <command>` (e.g.
`doppler run -- pnpm dev`). `.env.example` lists the expected variable names. Rotation of the
*previous* build's leaked secrets is the prior builder's responsibility (their infra) — see
`SECURITY-ACTIONS.md`.

---

## Status

- [x] Research + verification (24-agent workflow) → `docs/research/`
- [x] Scope + contracts frozen (**v0.2** — 4-lens red-team fixes folded in; `docs/research/_redteam.json`)
- [x] Track briefs reviewed (collision / completeness / sequencing / legal-security)
- [x] Repo scaffolded: workspace + security guardrails (gitleaks, RLS guard, `.claude` deny rules, CI) + git remote
- [x] **Deliverable −1:** clean Supabase project + Doppler (`worker/dev`) provisioned — *remaining: `doppler login` once on the build machine*
- [ ] Secrets rotation — **reassigned to the previous builder** (old infra is on their accounts; see forwarded note)
- [ ] `packages/shared` `0a` stubs + schema `1a` — Track B (unblocks Track A)
- [ ] Kill-test run — Track A → `docs/killtest/`

GitHub: `git@github.com:willdayble/worker.git` · Operator entity: Victoria, AU · Keep all
work inside this folder.
