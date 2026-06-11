# WorkerApp — Investor Scoping Site (Track C)

A small set of **static, linked HTML pages** that explain the WorkerApp plan to a non-technical
investor, with deeper technical detail tucked into collapsible "Tech info" boxes for technical
readers. No framework, no build step — open any `.html` file directly, or serve the folder.

> **Owner:** Track C (`docs/site/**`). Pure documentation — no code paths, no collision with
> Track A/B. Every figure is traceable to `docs/research/` (the kill-test verdict on `chat.html`
> traces to `docs/killtest/results.md` once Track A produces it).

## Pages

| File | Page | What it covers |
|---|---|---|
| `index.html` | Overview | What it is, the win condition, the reframe, the 3-layer mental model |
| `chat.html` | **Chat Layer** (centerpiece) | Official vs unofficial honestly, the 24h window, Telegram, ban mechanics, the kill-test |
| `infrastructure.html` | Infrastructure | Data sovereignty, on-device history, **at-rest vs zero-knowledge** (distinct), the E2EE roadmap, multi-tenancy, future shared safety tags |
| `app.html` | The App | Onboarding, inbox→booking flow, tagging, close-loop, attribution, the disclosed AI assistant |
| `technical.html` | Technical | Stack, the `MessagingProvider` abstraction, hard constraints, day-one security |
| `scaling.html` | Scaling | The two paths at 10 / 100 / 10k / 100k, the per-worker-number ceiling, the portfolio SPOF |
| `costs.html` | Costs | Per-worker cost by scale, AI-as-the-real-driver, candidate $19–25 → $9–15 pricing |
| `styles.css` | — | One shared stylesheet for all pages |

## Design notes

- **Plain language** in the body; **`<details>` "Tech info" boxes** hold the depth, each ending in
  further-reading links pulled from the research `sources`.
- **Flowcharts** use [Mermaid](https://mermaid.js.org/) via CDN (`cdn.jsdelivr.net/npm/mermaid@11`).
  The pages render fine without it — the diagrams simply show their text source if the CDN is
  unreachable. For a fully offline copy, download `mermaid.min.js` locally and repoint the
  `<script src>` in each page.
- **Legal/brand care (enforced):** presented as neutral service-worker tooling; no industry-specific
  schema terms on any public page; **encryption-at-rest (today)** and **zero-knowledge E2EE
  (roadmap)** are labelled as DISTINCT everywhere they appear (per `docs/SCOPE.md` §6).

## Preview locally

No build step. Either open `index.html` in a browser, or serve the folder for clean relative links:

```sh
cd docs/site
python3 -m http.server 8080
# → open http://localhost:8080
```

## Deploy to Cloudflare Pages (git-connected)

This folder is the deployable artifact — there is **no build command** and **no output
subdirectory**; the static files *are* the site. The chosen setup is **git-connected**, so every
push to the production branch (including the later kill-test verdict) auto-deploys.

The site files live on the branch **`track-c/deploy-site`** (pushed to `origin`,
`github.com/willdayble/worker`). Dashboard steps:

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Authorize GitHub and select the **`willdayble/worker`** repo.
3. Set:
   - **Production branch:** `track-c/deploy-site` (live immediately) — or merge the branch to
     `main` first and use `main` as production.
   - **Framework preset:** *None*
   - **Build command:** *(leave empty)*
   - **Build output directory:** `docs/site`
4. **Save and Deploy.** Cloudflare serves the folder as-is and redeploys on every push to that
   branch. You'll get a `https://<project>.pages.dev` URL to share.

### Visibility — intentionally unlisted

This is investor material, so it ships **public-but-unlisted**:
- `robots.txt` disallows all crawlers, and every page carries
  `<meta name="robots" content="noindex, nofollow">`. Search engines won't list it; anyone with
  the link can still open it.
- To lock it down harder later, add **Cloudflare Access** (Pages project → **Settings** →
  **Access policy**) with an email allowlist or one-time PIN.

### Notes

- Fully static; works offline aside from the Mermaid CDN (see Design notes to vendor it locally).
- Custom domain: add it under the Pages project → **Custom domains**.
- Nothing here reads secrets, calls an API, or touches the app's data. It deliberately contains
  **no** industry-specific or sensitive framing — safe to host.
- One-off alternative (no git): `npm i -g wrangler && cd docs/site && wrangler pages deploy .`
  after `wrangler login`. Git-connected is preferred here for auto-deploy.

## Updating figures

All numbers come from `docs/research/00_synthesis.md`, `docs/SCOPE.md`, and `docs/CONTRACTS.md`.
The kill-test verdict box on `chat.html` is intentionally marked **pending** until Track A writes
`docs/killtest/results.md`; when it does, fill the verdict from that file (not from the research).
Figures flagged "re-verify before launch" on the pages — platform pricing, regional availability,
AI pricing — should be refreshed at their source links before any external commitment.
