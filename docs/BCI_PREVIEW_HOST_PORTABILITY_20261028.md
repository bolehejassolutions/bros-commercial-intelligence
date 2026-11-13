# BCI_PREVIEW_HOST_PORTABILITY_FAIL_CLOSED_AUDIT_20261028_V1

Date: 2026-10-28 (MYT). Scope: existing BCI Draft PR #10 only. Static source review; no alternative-host deployment, live authenticated request, or runtime compatibility build.

## Reconciled source of truth
- Primary Drive owner decision Doc 1AmnN8agBGkMNCVMzQ6esJ1neWtKVuvqBa-F_j3U7rGM, including 25 Oct addendum and latest BCI/CONTENT/DEMAND checkpoints.
- GitHub Issue #11 / Draft PR #10, branch feat/neon-bci-dev-ledger-20261025, and actual Neon Free DEV project empty-tooth-43040036 / br-broad-math-b3f4d2r4 / bros_intelligence_dev.
- Existing Vercel Hobby build-rate-limit is a Preview deployment blocker, NOT a Next.js application-build failure. Current BCI HEAD has no verified exact-head READY Preview.

## Static portability checks (readback from actual PR branch)
| Check | Source | Result |
|---|---|---|
| Next.js 16 / React 19 app | package.json | OBSERVED; adapter support NOT TESTED |
| Protected BCI API Node runtime | app/api/internal/neon-evidence/route.ts exports runtime = "nodejs" | OBSERVED; not portable to a non-Node runtime by assumption |
| Direct restricted PostgreSQL connections | lib/bci/neon-preview-runtime.ts imports pg Pool; two separate server-only restricted credential pools | OBSERVED; Cloudflare Workers Node compatibility, TCP sockets and connection lifetime require real test |
| Server-side JWT verification | lib/bci/neon-auth-principal.ts uses node:crypto and pinned JWKS/issuer/audience | OBSERVED; alternate runtime compatibility unverified |
| Existing Vercel-specific fail-closed gate | lib/bci/neon-preview-handler.ts requires VERCEL_ENV === "preview", VERCEL_GIT_COMMIT_REF === approved feature branch, BCI_NEON_DEV_PRIVATE_READS === "enabled" | STATIC NEGATIVE: a normal Cloudflare/Netlify environment without these exact trusted variables returns 404 before authentication; setting fake VERCEL_* flags is NOT an acceptable workaround |
| Existing Preview protection and provider origin | app/internal/neon-preview/sign-in-client.tsx, PR #10 and Issue #11 | Existing protection and Neon Auth trusted origin must be re-established and verified independently for any new host |
| Current build proof | Canonical BCI checkpoint: GitHub Actions #40645136211 SUCCESS, Vercel current-head build-rate-limit | CI-only; NOT alternative-host build or authenticated end-to-end |

## Decision / safe next step
**NO-GO for an immediate hosting switch.** Keep Vercel + Neon as authoritative, do not fork the BCI backend. Prefer a *Node-capable Netlify Preview compatibility spike* first because the current API explicitly depends on Node runtime and pg. Cloudflare Workers remains a candidate only after verifying adapter support, nodejs_compat, native TCP/pg behavior, TLS, and all security invariants. This is a technical prioritization, NOT an assertion that Netlify is compatible or free-tier-sufficient.

Before enabling any alternate-host authenticated Preview:
1. Introduce a **separate, explicit, platform-neutral trusted Preview attestation** in a reviewed draft change. Never spoof VERCEL_ENV/VERCEL_GIT_COMMIT_REF. Keep default deny for unknown hosts/branches and production.
2. Recreate host-level protection and trusted Neon Auth origin only with owner approval for account/configuration changes. Do not copy secrets into logs, GitHub, or a public/client bundle.
3. Verify exact-commit deployment, server-only restricted LOGIN credentials, certificate-verified DB sessions, fresh authoritative membership and signed owner JWT; execute authenticated cross-tenant/product/admin impersonation and revocation negatives.
4. Prove durable eight-stage audit and real CONTENT/DEMAND reuse/integration separately. CI and an empty-scope 200 cannot close these gates.

## Test classification and safety
STATIC source review PASS for identifying a real **fail-closed host portability blocker**; no hosted compatibility test performed. No code/security gate relaxed, Neon grants/migrations, provider changes, paid upgrades, production deployment, risky merge, BROS SELL Full Publisher/other automation changes or BROS LABS. All four INTERNAL V1 release gates remain OPEN.
