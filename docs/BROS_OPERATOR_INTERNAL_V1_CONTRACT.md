# BROS Operator — Internal V1 UX + Orchestration Contract
**Status:** PROPOSED IMPLEMENTATION / INTERNAL-ONLY / NO LIVE INTEGRATION  
**Document version:** `operator-internal-contract/v0.1` · **Date:** 2026-10-26 MYT  
**Tracking:** [Operator workstream #12](https://github.com/bolehejassolutions/bros-commercial-intelligence/issues/12), [BCI negative security gate #11](https://github.com/bolehejassolutions/bros-commercial-intelligence/issues/11), [DEMAND proof #9](https://github.com/bolehejassolutions/bros-commercial-intelligence/issues/9).

## Authority and non-goals
The [owner-approved portfolio decision](https://docs.google.com/document/d/1AmnN8agBGkMNCVMzQ6esJ1neWtKVuvqBa-F_j3U7rGM/edit) governs. Use [existing shared intelligence contract](./PORTFOLIO_SHARED_INTELLIGENCE_CONTRACT.md), not a new evidence engine. BROS CONTENT and BROS DEMAND remain separately functional, independently marketable products; BROS SELL is a separate RM100 one-off offer, not a universal config; BROS LABS is deferred.

**Operator is an internal workspace/shell, not a new public SaaS, sales CRM, chatbot fleet, billing system, payment gateway, or authorization authority.** No storefront/vendor purchase, new database or credentials, Meta or Buffer mutations, Production deployment, customer access, automatic budget, pricing change or new automation is approved by this document. Nothing described here is a claim that a live endpoint exists.

## One internal workflow; four panels
1. **Setup:** create/edit an instance-bound *internal* configuration with legal brand reference, offer truth, goals, channels and consent. Avoid modifying CONTENT universal modules 00–12. A customer-like template is not a customer account.
2. **Today:** present exactly one primary **Next Best Action** and at most two secondary actions. Include reason, product owner, evidence references, observed/fetched times, uncertainty, explicit next gate and approval requirement. No fabricated countdowns or invented productivity scores.
3. **Work:** show CONTENT creative jobs and DEMAND experiments separately with authorised cross-product handoff references; track `DRAFT → QA_PENDING → QA_PASSED → REVIEWED → APPROVED → SUBMITTED → PROVIDER_SENT` only when corresponding evidence actually exists. Each provider may need its own state vocabulary; this is a display projection, not a command to publish.
4. **Evidence:** separate read-only provider claim, corroborated measurement and unknown; surface evidence age, source ID and provenance. `null` means unknown, not zero. Buffer queued/scheduled is **not** SENT. Meta attributed Purchase is **not** HitPay paid or settled. A payment success is **not** proof of payout, licence fulfilment or conversion attribution.
5. **Learn:** hypothesise → observe specified period → compare appropriate baseline → record alternative causes and confidence → next hypothesis. Missing or stale evidence always produces `INSUFFICIENT_EVIDENCE`, not a claimed result.

## Functional actors, not six separately deployed bots
| Function | Product / owner | V1 boundary |
| --- | --- | --- |
| Setup Guide | Operator instance shell | Configure internal BROS SELL instance; no customer signup |
| Audience Research | DEMAND | Source-backed diagnosis, unverified claims explicitly labelled |
| Content Planner | CONTENT | Platform briefs and brand/format constraints |
| Creative Producer | CONTENT | Draft, binary QA, approval; no autopublish inferred |
| Demand Analyst | DEMAND + BCI private services | Source-linked proposed experiment; never authorises spend |
| Sales & Learning Guide | SELL methodology + BCI outcome | Ethical next step and evidence-based feedback, not automated conversion |

## Proposed typed projection (not a public API)
```ts
type Product = "content" | "demand"; // SELL is the internal business instance, not a BCI tenant scope
type ActionState =
  | "PROPOSED" | "NEEDS_EVIDENCE" | "READY_FOR_REVIEW"
  | "APPROVED" | "EXECUTING" | "EXECUTED" | "FAILED" | "BLOCKED";
type EvidenceStatus = "VERIFIED" | "OBSERVED" | "UNVERIFIED" | "UNKNOWN";
type OperatorNextActionV1 = {
  schemaVersion: 1;
  actionId: string;              // stable, immutable ID
  tenantId: string;              // server derived from verified session; never trusted from UI
  product: Product;
  instanceId: string;
  actionType: string;            // allowlisted operation
  title: string;
  rationale: string;
  evidenceRefs: Array<{
    id: string;
    source: string;
    providerObjectId: string | null;
    observedAt: string | null;
    collectedAt: string;
    windowStart: string | null;
    windowEnd: string | null;
    status: EvidenceStatus;
    limitations: string[];
  }>;
  missingEvidence: string[];
  state: ActionState;
  approvalPolicy: "NONE_READ_ONLY" | "EDITORIAL" | "PROVIDER_WRITE" | "PAID_SPEND";
  approvalId: string | null;     // server-issued for approved, currently valid exact operation
  blockedBy: string[];
  idempotencyKey: string;        // server validated against tenant/product/action
  auditRef: string | null;
};
```

No `tenantId`, `approvalId`, `actionType`, role, provider account ID or idempotency key sent by the browser is sufficient authority for execution.

## Deterministic Next Best Action selector — initial policy
Given authenticated tenant + product membership and permitted internal instance:
1. Reject any candidate with mismatched tenant/product/instance scope; log the denial without revealing cross-scope details.
2. Evaluate source freshness per metric/connector policy; stale/unknown evidence may suggest **read-only verification**, not an unsupported outcome or paid/publishing action.
3. Reject unsupported `actionType` and duplicate already-executed idempotency keys; do not auto-repeat provider writes after timeout without a provider readback.
4. For a write action, a verified, scoped, unexpired approval and configured provider capability must be independently established server-side. Otherwise show `NEEDS_EVIDENCE` / `READY_FOR_REVIEW` with the required owner action, **never execute**.
5. Rank remaining actions by explicit canonical priority (P0 safety + evidence closure ahead of P1 UI polish), evidence utility and unmet dependency. Equal ranks use stable `actionId` sorting. Only select one primary and two secondary.
6. UI shows `UNKNOWN` rather than numerical zero where no genuine measurement exists. Ensure action label never promises ROI/sales.
7. Produce a trace from source evidence → proposed action → explicit approval → provider result → measured outcome or status unknown, with immutable audit ID.

## Read-only / write boundaries
- **Phase A:** standalone local HTML prototype, no auth, network, secret or live claim. All fixture records stamped `SYNTHETIC` and financial metrics null.
- **Phase B:** protected internal *read-only* projection only after #11 authenticated negative matrix: internal verified operator, per-product membership, server-side scoped query, no new BCI public route.
- **Phase C:** use existing authorised CONTENT/DEMAND adapters and distinct approval workflows only after independent production evidence and control tests. BROS Operator is not a bypass around budget/permission/creative approval.
- **External pilots:** separate later scope/billing/tenant security approval; not part of this PR.

## Dependency graph, owners and acceptance
| Stream | Owns | Independent proof required |
| --- | --- | --- |
| BCI + Neon P0 | signed user auth, tenant/product isolation, evidence/learning core | Hosted negative HTTP matrix, restricted grants, audit, #11 |
| CONTENT P0 | content configuration, job, real media bytes QA, Buffer SENT, metrics | Distinct provider SENT/native URL and **post-SENT** metrics freshness; asset identity binding |
| DEMAND P0 | acquisition hypotheses, source windows, conversion status and experiments | One actual controlled test with outcome/alternatives; #9 |
| SELL + HitPay P0 | current RM100 offer, verified payment and entitlement | Paid ≠ settled, independent delivery/entitlement and transaction linkage |
| Operator P1 | optional integrated UX/orchestration; isolated frontend | Offline fixture, secure read projection and controlled action flows |
| LABS deferred | future product creation | Only after internal v1 gates and owner scope approval |

### Test matrix (do not mark complete until verified)
- [ ] Fixed synthetic fixture: exactly one clear primary Next Best Action, max two secondary, correct deterministic ordering.
- [ ] Source `null` and stale observation do **not** produce `0`, ROI, CPA, attribution, learning outcome or publishing claim.
- [ ] No source evidence + proposed spend/write → disabled execution CTA, explicit approval prerequisite.
- [ ] Same idempotency key replay → no duplicate execution; uncertain timeout → reconciliation required.
- [ ] Wrong tenant or product across body, header, URL, caches, exports, joins and async job → denied.
- [ ] Revoked membership and invalid/expired approval → denied at execution time.
- [ ] Actual CONTENT approved asset QA + SENT + fresh measurement joins same source ID; no implicit post success from draft.
- [ ] One actual DEMAND experiment has equal/comparable observation windows and a traceable outcome; missing observations shown as unknown.
- [ ] HitPay paid, settled, entitlement and Meta attributed event statuses independently reconciled; no invented revenue.

### Current validated baseline (26 October 2026)
- Existing [Draft PR #10](https://github.com/bolehejassolutions/bros-commercial-intelligence/pull/10) has owner-confirmed authenticated Preview CONTENT/DEMAND empty-scope reads and session behaviour; **full hosted authenticated negative matrix remains open**.
- Neon Free internal dev project `empty-tooth-43040036` hosts `bci_dev` tables including evidence, cases, proposals and memberships; developer evidence is not production.
- Provider-led media/metrics and DEMAND experiment are **not a verified end-to-end live learning loop**.
- The BCI internal app stays protected; do not merge, publish or revive inactive legacy Supabase as a side effect.

## Implementation sequencing / smallest mergeable slices
0. Approve only *implementation* bounded by existing owner decision; record discovery/contract in this Draft PR.
1. Add isolated fixture-driven `Today/Work/Evidence/Learn` UI prototype in a static local HTML (never call it a deployed product).
2. Add deterministic selector tests and source freshness/unknown/approval rules in a **pure module**, independently from PR #10 auth changes.
3. Rebase only after #11 negative security checks; build private, read-only projection behind existing authenticated service.
4. Integrate actual CONTENT, DEMAND and HitPay adapters behind separate verified gates; measure BROS SELL internal usefulness.
5. Decide later whether an Operator public product exists; no commercial packaging assumed.
