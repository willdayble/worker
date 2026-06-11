# SECURITY — Immediate Actions & Going-Forward Rules

> Created 2026-06-10 during scoping. The "Rotate now" section is time-sensitive:
> live credentials from `/first_attempt/` are exposed in plaintext and should be
> treated as compromised until rotated.

---

## 1. Rotate now (exposed credentials in `/first_attempt/`)

These were found in plaintext while reviewing the prior build. Their **values are
deliberately not reproduced here** — find them in the files named, rotate them, then
scrub the files. Do these in roughly this order:

| # | Secret | Where it's exposed | How to rotate | Blast radius if leaked |
|---|--------|--------------------|---------------|------------------------|
| 1 | **Supabase Personal Access Token** (`sbp_…`) | `wacrm/ONBOARDING.md` (~line 203), hardcoded in a **non-gitignored** markdown file | Supabase dashboard → Account → Access Tokens → revoke + regenerate | **Account-wide.** Full Management API: run any SQL, read/export/drop every project's data |
| 2 | **Supabase service-role key** | `wacrm/.env.local.production-backup` (+ other `.env*`) and on Railway/Vercel | Supabase → Project `zipruaqabvuwoxrnyqox` → Settings → API → roll `service_role` | Bypasses **all** Row-Level Security on that project — full read/write to client + chat data |
| 3 | **Bridge API secret** (`BRIDGE_API_SECRET`) | `whatsapp-bridge` env + Vercel env | Generate a new random secret; update Railway **and** Vercel together | Anyone can drive the WhatsApp bridge (connect/disconnect/send as the worker) |
| 4 | **`ENCRYPTION_KEY`** (64-char hex, encrypts stored WA tokens) | `.env.local.production-backup` | Generate new key; **note:** anything already encrypted with the old key must be re-encrypted or invalidated | Decrypts stored WhatsApp session/token material |
| 5 | Supabase **anon key** | env files | Lower urgency (designed to be public-ish behind RLS), but roll it alongside #2 since RLS is the only thing protecting it | Limited *if* RLS is correct — but see #2 |

**Also:**
- Treat the Supabase project `zipruaqabvuwoxrnyqox` as **breach-exposed**. Decide whether it ever held real client/chat data; if so, that's a data-exposure event worth documenting (relevant later under GDPR/sensitive-data duties).
- The `sbp_…` PAT can read every project on the account, so #1 is the highest priority — do it first.
- After rotating, **delete** `ONBOARDING.md`'s hardcoded token and the `.env.local.production-backup` file (keep only `*.example` templates).

---

## 2. Going-forward rules (secure-by-default from day one)

1. **Secrets never touch git, markdown, or model memory.** Only `.env*` (gitignored) + a secrets manager hold them. `*.example` files carry empty placeholders only.
2. **Secret-scanning pre-commit hook** (`gitleaks`) on every repo, plus GitHub push protection / secret scanning enabled. This would have caught the `sbp_…` token.
3. **Service-role / management keys live only server-side** (the bridge + server-side API routes), never in client bundles or `NEXT_PUBLIC_*`.
4. **Least privilege:** prefer scoped keys over account-wide PATs. Use per-environment projects (dev vs prod) with separate keys.
5. **RLS is the backstop, not the lock.** Assume the anon key is public; every table must have correct Row-Level Security so a leaked anon key exposes nothing cross-tenant.
6. **Rotation is routine, not an emergency.** Document how to rotate each secret (above table is the template) so it's a 5-minute job, not a research project.
7. **Handoff hygiene:** never ship secrets in a zip. A new collaborator gets `*.example` files + an invite to the secrets manager, nothing more.

---

## 3. Decisions still open (will firm up in scoping)

- Which secrets manager (Doppler / Infisical / 1Password / SOPS / platform-native env) — pick during stack selection.
- **RESOLVED = clean.** Start a fresh Supabase project (Deliverable −1) and decommission `zipruaqabvuwoxrnyqox` for new work, given the exposure.
- Hosting-jurisdiction choices for sensitive data (covered in the legal/risk doc once research lands).
