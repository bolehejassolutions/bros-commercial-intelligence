# BROS Portfolio — Two Products, One Intelligence Core

**Status:** Approved product direction; **implementation and external access are not activated**  
**Effective:** 2026-10-25 (MYT)  
**Canonical decision:** [Primary Google Drive company decision](https://docs.google.com/document/d/1AmnN8agBGkMNCVMzQ6esJ1neWtKVuvqBa-F_j3U7rGM/edit)  
**Product specs:** [BROS CONTENT](https://docs.google.com/document/d/1_9-rYsiWaTeDzi4PR9Gkrs4glKddbi8SxzXeDDSRgl8/edit) · [BROS DEMAND](https://docs.google.com/document/d/1jux469eMEGdwHh_0Wlf9lUnEH64QzwJ5pbj1mGog0BQ/edit)

> This repository implements **internal BROS Commercial Intelligence (BCI)**. It must not expose its internal UI, admin APIs, tables, operator roles or provider tokens directly to external tenants. Customer-facing shared intelligence is a **future extraction** with independent security and deployment gates. The Primary Drive decision controls business scope; this file is an implementation companion.

## Product responsibilities

| Dimension | BROS CONTENT™ | BROS DEMAND™ | Shared BCI services |
| --- | --- | --- | --- |
| Independent customer job | Plan, create, QA, distribute, learn from content | Discover/activate demand, diagnose funnel, experiment, verify acquisition | Evidence provenance, signals, hypothesis/diagnosis, decision rationale, actions, outcomes, learning |
| Core input | Customer config, verified brand/offer, content history, platform observations | Audience/offer, Meta/GA4/checkout/qualified-lead observations, campaign consent | Typed evidence references with source, timestamp, semantics, tenant |
| Core output | Content briefs, assets, approval state, publishing proof, next-content hypotheses | Demand cases, next-best action, bounded campaign experiments, conversion/CPA analysis | Source-linked findings with uncertainty and audit trail |
| Not included | Mandatory paid ads, media spend authorisation, sales CRM | Mandatory content generator/publisher or BROS SELL purchase | Customer-facing direct access to existing BCI internals |

BROS SELL remains independent; internal BROS SELL acquisition is the first BROS DEMAND validation use case. No BROS SELL-specific prompt, pricing, offer, visual identity or publisher policy becomes a universal default.

## Proposed intelligence interface (design contract, **not implemented**)

All inputs/outputs MUST be server-validated, typed, versioned and tenant-authorised. Never trust `org_id` or `user_id` supplied by a client without checking the authenticated principal and membership.

```ts
type Provenance = {
  provider: "meta_ads" | "buffer" | "ga4" | "hitpay" | "manual";
  providerObjectId: string | null;
  collectedAt: string;     // ISO 8601
  observedAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  sourceReference: string;
  completeness: "complete" | "partial" | "unverified";
};

type IntelligenceEvidence = {
  schemaVersion: 1;
  tenantId: string;        // derived and enforced server-side
  product: "content" | "demand";
  evidenceId: string;
  category: string;
  provenance: Provenance;
  metrics: Record<string, number | null>;
  observedFacts: string[];
  unknowns: string[];
};

type IntelligenceRecommendation = {
  schemaVersion: 1;
  tenantId: string;
  product: "content" | "demand";
  evidenceIds: string[];
  finding: string;
  alternativeExplanations: string[];
  hypothesis: string;
  recommendedAction: string;
  proposedSuccessMetric: string;
  confidence: "low" | "medium" | "high"; // rule-based or qualified; never implied certainty
  status: "PROPOSED";      // not approved or executed by AI
};
```

**Semantic rules:** `null` ≠ `0`; ad-platform attributed Purchase ≠ settled HitPay purchase; views ≠ unique reach; scheduled ≠ published; clicks ≠ qualified demand; revenue ≠ profit. Never compute verified CAC/ROAS from test/unknown purchases. Maintain exact timezone and reporting window.

## Isolation, consent and permissions gates

1. BCI internal access remains protected by its current Supabase + Vercel controls. No customer-facing endpoints or direct BCI table grants until explicit extraction and security review.
2. Isolate customer data by `tenant_id` and provider account. Test cross-tenant reads/writes (including search, suggestions, async jobs, caches and exports). RLS is mandatory for exposed Supabase schemas; service-role never ships to browser.
3. Provider credentials must be server-side, scoped minimally and revocable; do not repurpose ChatGPT connector credentials for deployed applications.
4. Customer-specific performance memory and creative/business secrets cannot be learned from or exposed to another tenant without separately documented owner/legal authorisation.
5. Distinguish recommendation, simulation, editorial approval, scheduled/published state and budget-spending approval. An LLM output is never authority to spend or publish.
6. Review data retention, erasure, customer export, consent, abuse prevention and audit logging before multi-tenant pilots.

## Integration boundaries

- **CONTENT adapters:** customer config → brief → media QA → approval → publisher → platform proof → content metrics → next content.
- **DEMAND adapters:** product/offer truth → source-tagged funnel → demand diagnosis → experiment plan → approved campaign action → independently verified acquisition outcome → learning.
- **Shared contract:** DEMAND may request a content job with a source-scoped brief; CONTENT returns asset/approval/publishing evidence; DEMAND links that evidence to conversion data when available. Each integration requires explicit authorisation and no hidden cross-tenant join.
- **Separation requirement:** each product must deliver its customer job alone. An integration failure degrades gracefully and does not silently block the standalone product.

## Status and no-change boundary (2026-10-25 snapshot)

- `bros-commercial-intelligence` Next/Vercel app and Campaign Studio code exist. Dedicated BCI Supabase `guviwsclpiiqepctedsq` was INACTIVE at last verification. [Campaign Studio release notes](./CAMPAIGN_STUDIO_RELEASE.md) state external activation dependencies. No verified production Meta write authority.
- BROS CONTENT Supabase `frdzdmpeokwubqwdzitn` was INACTIVE. Existing BROS SELL Full Publisher is already a live internal Buffer workflow, not a tested reusable SaaS publishing adapter.
- No existing campaigns, spend, Buffer tasks/schedules, payment entitlement, customer databases, BROS SELL price, logos or deployment config are modified by this documentation change.
- Brand label BROS CONTENT™ is a product working name; the approved BROS CONTENT OS brand board is preserved. New trademark/logo/public marketing changes require separate review.

## Phased deliverables with acceptance criteria

### P0 — Confirm source truth and minimise duplication
- Keep the portfolio decision in Primary Drive. Inventory CONTENT engine, Full Publisher, BCI cases/Campaign Studio, marketing data connectors and current deployment state.
- Produce a dependency/ownership matrix for shared vs CONTENT vs DEMAND code before moving or copying functionality.
- **Pass:** one source of truth per product and no duplicate core/data source created.

### P1 — Demand internal proof (read-only)
- Instrument/reconcile Meta, Buffer, GA4 and **settled** HitPay evidence in a traceable workflow, with manual import where a server integration lacks approval.
- Complete one BROS SELL evidence → diagnosis → agreed experiment → measured outcome → learning case.
- **Pass:** every KPI has source IDs and freshness; test Purchase is excluded; alternative explanations and unknowns are visible. Provider updates require independent authorization.

### P2 — Content operational proof
- Validate independently generated media bytes and approved brand handling; confirm publisher `scheduled` and later `sent`/native URL separately.
- Preserve universal customer config semantics and per-platform rate limits.
- **Pass:** customer-like configuration without editing universal core; real QA-passed platform assets and traceable content learning.

### P3 — Extract shared engine behind narrow APIs
- Move reusable evidence/diagnosis/learning rules into versioned private modules or service behind authenticated product adapters.
- Add tenant-isolation, provider-permission, privacy, and data-contract tests; internal BCI routes remain private.
- **Pass:** negative cross-tenant tests and status/approval boundary tests pass; no customer session can read internal BCI.

### P4 — External pilots and commercialization gate
- Pilot each product separately with consenting customers; measure time-to-value, support effort, willingness to pay and net operational cost; test bundle only after stand-alone value exists.
- **Pass:** documented evidence of value and explicit business approval prior to pricing, subscriptions, public onboarding and migration.

## Review checklist for future PRs

- Does this change duplicate an existing module or introduce an unnecessary tool/provider?
- Does it change external spend, production, API permissions or customer visibility? If yes, separate explicit approval.
- Does it preserve source/freshness, source-specific KPI semantics and honest unknowns?
- Are CONTENT and DEMAND standalone workflows and data scopes preserved?
- Are cross-tenant denial, rollback, partial-provider failures and audit logging tested?
- Is the current Primary Drive decision unchanged unless the owner approves a new superseding decision?
