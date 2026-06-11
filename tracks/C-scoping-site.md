# Track C — Investor Scoping Site (static HTML → Cloudflare Pages)

> Read `docs/SCOPE.md` and `docs/research/00_synthesis.md` first. You own `docs/site/**`.
> Pure docs — no code paths, no collision with A/B. Source all numbers from
> `docs/research/` (don't invent figures).

## Mission
A series of linked static HTML pages that make the plan understandable to a **non-technical
investor**, with deeper technical detail tucked into collapsible boxes for technical readers.
Honest about the reframe, but framed as a *moat* (compliance + safety + data-sovereignty),
not a list of problems.

## Pages (each a standalone `.html`, shared nav + CSS)
1. **`index.html` — Overview.** What it is, the win condition (faster/safer bookings, prune
   time-wasters), the reframe in one diagram, the 3-layer mental model.
2. **`infrastructure.html` — Shared infrastructure layer.** Data sovereignty, on-device
   history, client-side-encryption roadmap, multi-tenant, future cross-worker shared tags.
3. **`app.html` — The CRM app layer.** Onboarding, inbox→booking flow, tagging, close-loop,
   acquisition attribution, the disclosed AI assistant.
4. **`chat.html` — The WhatsApp / chat layer** (the centerpiece — ~60% of the depth).
   Official vs unofficial honestly (the 3-way collision table), Telegram as the sanctioned
   parallel, the kill-test (source its verdict from `docs/killtest/results.md`, not
   `docs/research/`), ban mechanics, what "appear as native" really means.
5. **`technical.html` — Tech, APIs & constraints.** Stack, the `MessagingProvider` abstraction,
   24h window, Coexistence caps, security-first practices, links to API docs.
6. **`scaling.html` — Scaling (10 / 100 / 10k / 100k users).** The two paths break in
   different dimensions; the per-worker-number ceiling; portfolio-pooling SPOF.
7. **`costs.html` — Costs & subscription.** Per-worker cost at each tier, AI-inference as the
   real driver, candidate $19–25 → $9–15 pricing, margin story.

## Style requirements (from the brief)
- **Plain, non-technical language** in the body. Short sentences. Concrete analogies.
- **Visual flowcharts** for how systems connect — use Mermaid (CDN) or hand-rolled SVG.
- **Collapsible "Tech info" boxes:** native `<details><summary>Tech info</summary>…</details>`
  holding the technical depth, each ending with **links to further reading** (Meta Cloud API
  docs, Baileys repo, Telegram Bot API, GDPR Art. 9, libsodium, etc. — pull from research
  `sources`).
- One clean CSS file; readable typography; works offline; no build step required (static).
- **Legal/brand care:** present as neutral service-worker tooling; do not put sensitive
  service framing on the public investor pages. Label **at-rest encryption** and
  **zero-knowledge E2EE** as DISTINCT — operator-can't-read is *roadmap*, not current (SCOPE §6).
  Never display industry-specific schema terms (e.g. no `incall`/`outcall`) on public pages.

## Build & deploy
- Plain HTML/CSS (+ Mermaid via CDN). No framework needed. Optionally a tiny static-site
  generator if it helps, but static output must land in `docs/site/`.
- Deploy to **Cloudflare Pages** (static). Document the deploy step in `docs/site/README.md`.

## Definition of done
Seven linked pages, non-technical narrative + flowcharts + collapsible tech boxes with
further-reading links, deployable to Cloudflare Pages, all figures traceable to
`docs/research/`. A non-technical reader gets it; a technical reader can drill down.
