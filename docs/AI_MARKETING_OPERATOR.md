# BROS AI Marketing Operator — Malaysia

Status: **DRY-RUN IMPLEMENTATION** (not a live advertising operator)  
Scope: BROS SELL™ — Closing OS / MYR / Malaysia  
Owner: BROS internal operations; never customer-facing.

## Design boundary

- BROS Commercial Intelligence (BCI) remains the *evidence, diagnosis, decision and learning* system.
- Marketing Operator is an internal execution orchestration module, not a new BCI decision authority.
- Customer-facing `bros-sell-web-os` is not changed.
- Current console is behind existing Supabase authentication at `/operator`; it adds **no new Supabase migrations, secrets or provider permissions**.
- This branch must be reviewed and merged intentionally. No advertising settings are changed as a result of a GitHub merge.

## Immutable phase-zero guardrails

1. `mode = DRY_RUN` is a compiled constant, not an environment toggle, UI button, request input or database field.
2. `maxAuthorizedSpendMYR = 0`; publishing, ad editing, pausing and budget changes are explicitly disabled.
3. The repository has **no Meta Ads write adapter** in this phase. `rejectExternalMutation` is an additional fail-closed sentinel; the strongest protection is that no executable write path exists.
4. The console accepts only sourced Malaysia/MYR campaign snapshots and generates proposals. It has no outbound reporting API and does not save commercial metrics server-side.
5. Proposed actions are not approvals. The console is not an approval system.
6. No Meta access token, private API key, customer data or paid-account snapshot should be committed to GitHub.
7. Never treat `null` purchase/revenue as zero; never claim profit or conversion performance from click data alone.

## Current working capability

Authenticated operator opens `/operator`, enters a dated, traceable **manual transcription** or **read-only Meta export** and runs deterministic checks. The output includes calculated CTR, click-to-page-view ratio, cost per landing-page view and reported ROAS where sufficient fields exist, with evidence, uncertainty and review-only proposals. It can be copied as JSON for audit and future BCI case evidence.

**Not built in phase zero:** automatic Meta data ingestion, scheduled runs, LLM creative generation, persistent run history, purchase reconciliation, campaign publication, Meta Marketing API write integration, or optimization loops. They must not be implied by the prototype UI.

## Target full-autonomy architecture — future, not activated

```text
Approved product + offer sources ────┐
Read-only Meta insights ─────────────┤
Verified web / checkout conversion ──┼→ Evidence intake (provenance + freshness)
Approved creative/logo assets ───────┘                ↓
                                             BCI case + diagnosis
                                                       ↓
                                       Marketing Operator experiment plan
                                                       ↓
                                        AI copy/creative draft + claim QA
                                                       ↓
                                     Policy, copyright and branding review
                                                       ↓
                                    Budget guard + human approval ledger
                                                       ↓
                              [ISOLATED WRITE SERVICE — NOT IMPLEMENTED]
                                                       ↓
                         Meta delivery → metrics → sales reconciliation → BCI
```

Architecture segments:

- **Read plane:** least-privilege account insights and inventory, rate-limit handling, bounded polling and provider-specific error reporting.
- **Planning plane:** hypothesis, target audience, experiment, creative draft and expected evidence. AI output is always marked as hypothesis until measured. Brand-approved BROS logos are asset references, never regenerated.
- **Review plane:** product claims validated against authoritative Project Sources; Meta policy and Islamic-value compliance checks; proof-of-ownership for all reused creatives.
- **Control plane (future):** narrow scopes, named human approver, campaign allowlist, budget per day/lifetime, aggregate spend cap, preflight preview, kill switch, rate-limit-aware queue, idempotency, expiry window, immutable audit log and rollback plan. No LLM may directly acquire authorization, adjust its limits or approve itself.
- **Write plane (future):** independently deployed Meta Marketing API adapter with `ads_management`, under human activation; missing/invalid approvals or stale data block all writes.
- **Measurement plane:** reconcile HitPay/actual paid orders and Meta attributed conversions; use money in MYR and distinguish spend, revenue, profit and uncertain attribution.

### Operating state machine (future)

`OBSERVE → DIAGNOSE → DRAFT → QA → SIMULATE → AWAIT_APPROVAL → APPROVED → QUEUED → PUBLISHED → MONITOR → REVIEW`

Default in phase zero is `SIMULATE` only. `APPROVED`, `QUEUED`, and `PUBLISHED` are **not executable states**.

Future approval records should require actor identity, campaign/ad account IDs, exact creative version hash, objective, permitted spend, expiry, action payload digest and explicit revoke ability. No one-time approval silently authorizes new creatives or higher budgets.

## Required activation gates

**Gate A — read-only integration (separate change):**
- Confirm Meta provider, account ID, supported read scopes and rate limits.
- Establish token/secret custody in server-only environment variables; never reuse ChatGPT connector credentials in app code.
- Add scheduled read-only connector, provenance storage, dedupe and alerting.
- Verify event freshness and missing-permission behavior.

**Gate B — sales measurement (separate change):**
- Verify pixel/CAPI purchase mapping and live HitPay order reconciliation.
- Define ROI/ROAS data contract, refunds, duplicates and attribution windows.
- Confirm the current approved Malaysia offer, price, checkout and official assets from Project Sources.

**Gate C — live activation (explicit business approval REQUIRED):**
- Obtain explicit written permission for Meta write scopes and live activity.
- Approve account/campaign allowlist, exact daily and lifetime spend limits, approver identity, access expiry, pause/kill-switch controls and incident contact.
- Review source diff, staging/preview checks, sandbox tests and security audit.
- Enable a separate write deployment only after a bounded live pilot and observed results.

Until Gate C, stay read-only with **RM0 authority**. A request to “build for autonomy” is not an authorization to launch ads or spend.

## Limitations / accepted risks

- Manual figures may be transcription errors. The source reference allows retrospective verification but is not a verification signature.
- Meta-reported purchase figures may not equal settled HitPay sales; reported ROAS is a mathematical ratio, not confirmed profit.
- Thresholds of 1,000 impressions and 20 clicks are conservative *review heuristics*, not industry benchmarks.
- Low click-to-landing-page-view ratio identifies a question to investigate, not a proven cause.
- The existing BCI Supabase login protects the page. Review the internal user provisioning policy before handling more sensitive financial or identity data.
- Existing Vercel deployment is a smoke-test project, **not** authorization for production rollout.

## Verification

Run `node --experimental-strip-types --test tests/marketing-operator.test.mjs`.  
PR CI also runs TypeScript checking and `next build`.  
Verify that the code contains no Meta ad write endpoint or secret, that dry-run reporting leaves all external state unchanged, and that no preview build can publish an ad.

## Next delivery

Build authenticated, durable, read-only Meta ingestion with bounded scheduling, backoff, immutable observation references and a provider permission audit. Keep the next change scoped to Gate A; do not blend in the future write adapter.
