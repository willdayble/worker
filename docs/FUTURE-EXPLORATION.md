# WorkerChat — Future Exploration, Lessons & Things to Test

A parking lot for ideas, alternatives, and experiments that are **out of the prototype scope**
(`docs/SCOPE.md` §4) but worth remembering. Nothing here is a commitment — it's the
"come back to this" list. Orchestrator-owned; anyone can propose additions via the orchestrator.

---

## 🧪 Things to test / evaluate (post-prototype, or when a track has slack)

### Chat layer — the unofficial WhatsApp engine
- **`whatsmeow` / `mautrix-whatsapp` (Beeper's bridge) vs Baileys.** If the kill-test returns
  **GO** on the unofficial-as-fallback path, evaluate whatsmeow as the engine instead of porting
  the old Baileys code. It's the most battle-tested open-source WhatsApp-Web implementation
  (Beeper runs it at scale, very actively maintained, self-hostable → data stays on our infra).
  **Trade-off:** it's **Go**, not Node — so it'd be a small separate service the worker talks to,
  vs. Baileys keeping us in one language. Weigh after the kill-test, not before.
- **Beeper's at-scale ban behaviour as a survivability data point.** Beeper bridges WhatsApp for a
  large user base — real-world evidence on how survivable the unofficial WhatsApp-Web approach is.
  Worth a focused research dive to set better priors for our own go/no-go. (Caution: Apple killed
  Beeper's iMessage bridge "Beeper Mini" in 2023 — a big polished player is **not** immune to a
  platform fighting back. Same could happen to its WhatsApp bridge.)
- **Multi-number fingerprint / correlation test** (from research §4): once we have >1 throwaway
  number, probe whether shared infra (same server/IP) accelerates *correlated* bans. Only
  meaningful at >1 tenant; do **before** ever building shared infra.

### Chat layer — other channels (only if multi-channel demand is real)
- **Signal, iMessage, Instagram/Messenger** via a self-hosted **Matrix homeserver + mautrix
  bridges** (the Beeper architecture). Gives many channels "for free" but is heavy operationally —
  a whole Matrix stack. Overkill for the prototype; a credible path if we ever need breadth.

### Verify-before-launch (carried from `docs/SCOPE.md` §7)
- **Coexistence regional availability** for the real user geography (commonly excluded: EU/UK/AU) —
  re-check live; gates whether the official path even works for our users.
- **Meta per-message rates** for the real destination-country mix (vary 10–60×; revised ~6-monthly).
- **Anthropic API pricing** before committing the cost model (research cache dated 2026-05-26).
- **Recycled-number takeover** mitigations (~66% of recycled numbers still resolve to a prior owner).

---

## 📚 Lessons & learnings (running log — add as we go)

- **The official-vs-unofficial WhatsApp tension is the core constraint.** You can't import full
  history *and* look like consumer WhatsApp *and* avoid bans on one path. We reframed to: history
  stays on the phone + ~6mo synced, official Coexistence as the durable path, Telegram parallel,
  unofficial as a kill-tested fallback only. Full reasoning: `docs/SCOPE.md` §1 + `docs/research/`.
- **Beeper ≠ a ban-proof shortcut.** Its WhatsApp bridge is the *same unofficial category* as ours —
  useful as a better *engine* and as *evidence*, not as a way around the ban risk. (2026-06-11)
- *(add new learnings here with a date)*

---

## 🧊 Deferred prototype features (already "out of scope" in `docs/SCOPE.md` §4)

Payments/deposits · cross-worker shared-tag/client federation · full autonomous negotiation ·
CRDT collaborative editing · enclave PIN recovery · true client-side zero-knowledge E2EE ·
voice notes/calls handling · group chats (unsupported on the WA API).
