# Claude Setup — How We Develop WorkerChat (a transferable playbook)

> **For Clare and her Claude orchestrator.** This explains the *development harness* — how we use
> Claude Code with multiple terminal instances + an orchestrator — so you can run a similar setup
> for your own project. The WorkerChat **domain** (WhatsApp, sex-work-adjacent tooling, etc.) is
> ours; the **patterns** below are what transfer. Adapt them to your project — you're building CRM
> features, so your tracks/roles will differ. Researching the *specific* skills/hooks for your
> stack is your job (see §6); this doc gets you operating the same *way* we do.

---

## 0. If you're migrating from the Claude desktop app → terminal

- **Claude Code** is Claude running in your **terminal**, inside a project folder. Unlike the
  desktop chat, it can **read/write files, run commands, use skills/hooks/subagents, and remember
  across sessions.** Start it by running `claude` in your project folder.
- Instead of *one* conversation, you run **several terminal windows at once** — each is an
  independent Claude **instance** — plus one you keep as the **orchestrator**.
- **First move:** open one Claude in your project and ask it the questions in §6. Then read this
  whole file with it and say "set us up to work like this, adapted to my project."

---

## 1. The core pattern: one Orchestrator + N parallel Tracks

- **Tracks**: each is a Claude instance in its own terminal that **owns one workstream** and builds
  it. Ours were: **A** (chat/messaging layer), **B** (data + CRM web app), **C** (investor site).
  Yours might be **frontend / backend / infra**, etc.
- **Orchestrator**: a separate Claude instance that **does not write feature code**. It holds the
  contracts, coordinates across tracks, resolves conflicts, runs reviews and multi-agent
  workflows, and is where *you* (the human) ask "what's the status / what do I do next."
- They build **in parallel without colliding** because of a frozen **ownership map** (§2) that says
  exactly which files each track may edit.

```
            you ⇄ ORCHESTRATOR  (coordination, contracts, reviews, workflows — no feature code)
                      │
        ┌─────────────┼─────────────┐
     Track A       Track B       Track C     ← each owns a disjoint set of files
   (own terminal) (own terminal) (own terminal)
```

---

## 2. The document spine (what makes parallelism safe)

Look at these real files in this folder as worked examples — copy the *shape*, not the content:

| File | Role |
|---|---|
| `docs/SCOPE.md` | **Frozen** decisions: what we're building, what's in/out, why. The single source of truth. |
| `docs/CONTRACTS.md` | **Frozen interfaces + DB schema + an OWNERSHIP MAP** (who edits which paths). **This is the keystone** — parallel instances build against frozen contracts and never touch each other's files. |
| `tracks/*.md` | One **playbook per track** — the brief you hand each instance at launch. |
| `docs/research/` | The **evidence** behind the decisions (we did deep research first — see §3). |
| `docs/TESTING.md`, `docs/DEPLOYMENT.md`, `docs/FUTURE-EXPLORATION.md` | Living reference docs (test run-books, deploy plan, a parking-lot of ideas/lessons). |
| `README.md` | Orientation + how to launch the parallel build. |

**The rule that makes it work:** a track *implements against* the contracts; if it needs a contract
changed, it **asks the orchestrator** rather than editing a shared file. The orchestrator makes the
change in one place and notifies the others.

---

## 3. The process we followed (the phases)

1. **Research first (multi-agent).** The orchestrator fanned out a research workflow, then
   **adversarially verified** the load-bearing claims. → `docs/research/00_synthesis.md`.
2. **Red-team the plan before building.** A second workflow attacked the scope/contracts for
   collisions, missing interfaces, and security holes — *before* any code, because a contract bug
   propagates into every track. → `docs/research/_redteam.json`.
3. **Freeze `SCOPE.md` + `CONTRACTS.md`** (with the ownership map) and write the per-track briefs.
4. **Launch the parallel instances** (§8).
5. **Periodic verification sweeps.** The orchestrator runs read-only audit workflows that check
   what each track *actually* built against the contracts, and produces a status + punch-list.

---

## 4. Memory (persistent context across sessions)

Claude Code has a **file-based memory**: a `MEMORY.md` index + one fact per file. Each instance
writes durable facts (project decisions, your preferences, gotchas); the orchestrator and tracks
build a shared picture over time.

> ⚠️ **Memory lives in `~/.claude/projects/<your-project>/memory/`, OUTSIDE this folder** — so it
> does **not** travel in the zip, and it's keyed to the folder path on the original machine. When
> you unzip on your machine, your Claude starts a **fresh** memory. That's fine: **the in-folder
> docs (`docs/`, `tracks/`, `README.md`) are the real source of truth** that carries forward; your
> instance will grow its own memory as you work.

---

## 5. Security-first harness (reuse these directly)

- **Secrets live in a secrets manager (we use Doppler), never in git, memory, or chat.** Commands
  that need secrets run via `doppler run -- <cmd>`, which injects them at runtime so the values
  never appear anywhere. See `doppler.yaml` + `docs/DEPLOYMENT.md`.
- **`.claude/settings.json` deny rules** block Claude from reading `.env*`/`secrets/**` (a
  `.gitignore` alone does NOT stop Claude reading them — only the deny rule does).
- **`gitleaks`** pre-commit hook (`lefthook.yml`) + CI catch any staged secret; a **policy guard**
  (`scripts/check-rls.sh`) fails the build on insecure DB policies.
- **Never print a secret value.** Generate-and-store in one step (e.g.
  `doppler secrets set KEY="$(openssl rand -hex 32)" >/dev/null`); mirror with command
  substitution; verify by name only (`doppler secrets --only-names`).

> ⚠️ **Re-point `doppler.yaml` to YOUR Doppler project** before using it — as shipped it points at
> *our* project (`worker`). Review `.claude/settings.json` and adapt the deny/allow rules.

---

## 6. Skills, hooks & consulting subagents — **ask your orchestrator**

Best practice here shifts, and your stack differs from ours, so **this is yours to research** — but
your orchestrator can do most of it for you. Open your orchestrator and ask, in order:

1. *"What `/skills` are available to me, and which help a web-app project like this?"*
2. *"What hooks could automate our workflow (run tests on save, block commits with secrets, format
   on write)? Set them up in `.claude/settings.json`."*
3. *"What safeguards/guardrails should we put in from day one?"* (point it at §5 above).
4. *"Help me design a set of consulting subagents for my tracks."*

The **kinds of roles** you mentioned wanting are a sensible starting set — have your orchestrator
research the specific implementation (skill vs subagent vs hook) for each:
- **frontend** builder · **backend** builder · **security-audit** reviewer · **documentation** bot
  (regenerates API docs from richly-commented code — we use a "comments-as-docs" style for this) ·
  a **headless test runner** (e.g. a CI/preview environment that runs your test suite per change).

Built-ins worth knowing about (ask your orchestrator to confirm what's installed): **`/code-review`**
and **`/security-review`** skills, the **Agent tool** (spawn specialized subagents), **hooks** in
`settings.json` (automate behaviours), and the **Workflow tool** for multi-agent orchestration (§7).

---

## 7. Multi-agent workflows (the heavy lifting)

For big tasks (research, red-teams, codebase audits), the orchestrator **fans out many subagents in
parallel** rather than doing it solo — decompose-and-cover, **adversarially verify** findings, and a
**completeness critic** at the end. We turn this up with `/effort ultracode` for heavy
research/scoping phases (it's token-hungry — use it for the phases that deserve it, not every turn).
Ask your orchestrator: *"Use a workflow to research/red-team/audit X."*

---

## 8. Launching the parallel build (mechanics)

Open one terminal per track + one orchestrator, each `cd`'d into the project, run `claude`, and
hand each its brief. Example (adapt names to your tracks):

```
Orchestrator → "You're the orchestrator. Read README.md, docs/SCOPE.md, docs/CONTRACTS.md.
                Coordinate the tracks, hold the contracts, don't write feature code."
Track A      → "Read docs/SCOPE.md, docs/CONTRACTS.md, tracks/A-*.md. You own Track A."
Track B      → "Read docs/SCOPE.md, docs/CONTRACTS.md, tracks/B-*.md. You own Track B."
```

Bring cross-track decisions, conflicts, and "is this right?" back to the orchestrator.

---

## 9. Lessons we learned (so you skip our mistakes)

- **Freeze + red-team the contracts BEFORE parallelizing.** A contract bug propagates into every
  track. Our red-team caught ownership collisions and a security hole before any code was written.
- **The shared working tree bites.** We ran all instances in one folder/one git tree, which caused
  collisions: work sitting **uncommitted** (and at risk), and a **tangled branch** where one
  track's work landed on another's branch. Mitigations: **each track commits its own paths
  frequently**; consider a **`git worktree` per track** for true isolation; the orchestrator owns
  consolidation to `main`.
- **Verify external facts — don't trust a remembered version/tag/price.** We had a pinned Docker
  image tag that didn't actually exist; a quick registry check caught it. Have the orchestrator
  verify before relying.
- **Be honest in user-facing claims** (e.g. we say "encrypted at rest," *not* "we can't read your
  data," because the latter isn't true yet). Over-claiming is a trust and legal risk.

---

## 10. What transfers in the zip — and a ⚠️ before you send it on

**Transfers (in this folder):** all `docs/`, `tracks/`, the code, `.claude/settings.json`,
`lefthook.yml`, CI, `doppler.yaml` (re-point it), `scripts/`, `README.md`, this file.

**Does NOT transfer:** the `~/.claude` **memory** (you build your own — §4) and the Doppler
**secret values** (they live in the Doppler cloud, not the folder — you get the *structure*, not
the secrets).

> ✅ **The zip is secret-clean by structure.** This repo is the `app/` folder of a larger parent
> (`workerapp/app/`). The previous builder's old prototype — which holds leaked secrets (`.env.*`
> backups + a Supabase Personal Access Token in `wacrm/ONBOARDING.md`) — lives in a **sibling**
> folder, `../first_attempt/`, **outside this repo**. So a zip of *this* folder does **not**
> include it, and contains no live secrets (ours all live in Doppler, never in the folder). *(For
> the maintainer: those old credentials should still be rotated by the previous builder — see
> `SECURITY-ACTIONS.md` — but they are not in this zip and not Clare's concern.)*
