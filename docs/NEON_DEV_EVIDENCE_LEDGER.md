# Neon BCI development ledger — internal-only prototype

## BCI_NEON_RESTRICTED_DML_DRIFT_GUARD_20261026 — restricted reader DML privilege drift gate (26 Oct 2026)

**VERIFIED code + regression tests + exact-commit GitHub CI SUCCESS + read-only Neon catalog; NOT a new authenticated hosted negative matrix or direct restricted LOGIN test.** Both Preview server-only readers now reject privilege drift if either restricted role acquires UPDATE, DELETE or TRUNCATE on either `bci_dev.evidence` or `bci_dev.tenant_memberships`. Existing direct-login identity, RLS FORCE, read-only transaction and cross-table SELECT checks remain. The checks run before tenant/product/principal transaction scope is set and fail closed. No grants, credentials, database migration or production deploy.

Provider catalog read-only on `empty-tooth-43040036` / `br-broad-math-b3f4d2r4` / `bros_intelligence_dev`: both restricted LOGIN roles currently have all six mutation privileges FALSE; neither sensitive table has PUBLIC SELECT/INSERT; both tables have RLS enabled and forced. The separate `bci_dev_runtime` role is NOLOGIN and is not a Preview reader. Catalog checks do not constitute restricted direct-login or authenticated API evidence.

Code/tests: `lib/bci/neon-dev-read-rows.ts`, `lib/bci/neon-dev-membership-rows.ts`, corresponding unit tests and HTTP fixture updated, readback verified. Final code/test commit `5de36a5fddfd8589d03ee0dbb8abcec136ba9773`. Initial CI failures reflected stale HTTP fixture; corrected final GitHub Actions [40316793543](https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40316793543) **SUCCESS** (182 Node tests, TypeScript and Next.js build). This is drift prevention, not a new proof of least-privilege direct login or cross-tenant isolation.

OPEN: owner-session latest 2/2 authenticated controls + 7/7 negative probes; independent cross-tenant/product/revocation and admin-impersonation end-to-end; shared BCI provider audit reuse and remaining CONTENT/DEMAND/HitPay gates. Issue #11 OPEN, PR #10 DRAFT. No Production, Neon plan/paid costs, permissions, secrets, Meta spend, Buffer publishing, BROS SELL tasks or BROS LABS changes.


## BCI_HITPAY_TIMESTAMP_CALENDAR_GUARD_20261026

**26 Oct 2026 — VERIFIED DRAFT PR SOURCE + REGRESSION + CI SUCCESS; NOT LIVE HITPAY SETTLEMENT OR INTERNAL V1.** The read-only HitPay list-row paid-pair reconciler previously accepted calendar-invalid `closed_at` values because `Date.parse` can normalize impossible dates. It now validates leap years, month/day bounds, 24-hour clock, seconds/minutes and realistic signed timezone offsets before accepting the provider timestamp. The provider's actual observed timestamp format remains accepted. Rejected input cannot be promoted into even the provisional provider-reported paid pair.

Source commits `f5ed9875ad6713e0f750c074fa6b785c2938bc80`, corrected regex `1cd6eed46100fa3e944cc3e77d690cc0053953d2`; tests `1f6fb9d355c676c6d7ba80dfc22c6d21016c9dcc`. The initial CI run `40300238845` FAILED due to escaped regex; the defect was corrected and exact final [GitHub Actions 40300361453](https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40300361453) completed **SUCCESS** (Node tests, TypeScript and build). Readback confirmed final source/test contents.

Fresh read-only HitPay 1–26 Oct: one MYR50 store order completed/paid/fulfilled with matching succeeded charge, MYR1.70 fee, MYR48.30 net collected, zero refunds, and charge detail `payout:null`; product aggregate reports one BROS SELL unit at MYR50, but the individual order-to-product mapping, live/test attestation, charge-to-payout link, Web OS entitlement and acquisition attribution remain **UNVERIFIED**. This is historical provider observation, **not** a verified settled BROS SELL sale or current RM100 price change. No customer PII, raw charge IDs or card details are retained in this ledger.

Remaining gates: signed-in hosted HTTP negative matrix; trusted CONTENT approval/media→SENT→measurement→learning; DEMAND real controlled experiment/outcome; BCI shared provider-backed audit; HitPay environment, product/order, payout/settlement and entitlement linkage. No Production, Meta spend/writes, publishing, credentials, permissions, schedules, pricing or BROS LABS changes.



## BCI_PREVIEW_OWNER_NEGATIVE_PROBES_20261026

- **26 Oct 2026 — VERIFIED CODE + CI + EXACT-COMMIT PROTECTED PREVIEW READY; owner-run HTTP denial results NOT YET VERIFIED.**
- Added a safe, opt-in, signed-in Preview UI action **Run HTTP rejection checks**. Seven bounded probes exercise missing bearer (401), caller-supplied tenant/user scope (400), duplicate product (400), admin/product header impersonation (400), and unsupported POST (405). Results require expected status, private/no-store and Vary: Authorization, and no evidence payload. The transient bearer is never stored or returned by the runner. No real provider mutations, access grants or credentials are used.
- Source: `lib/bci/neon-preview-negative-checks.ts` commit `84b083a`; regression tests `tests/neon-preview-negative-checks.test.mjs` commit `0825ed2`; signed-in UI integration commit `6dd0bebaf4912d71bebec463053e7ad6167f1b5a`. [CI #40295215735](https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40295215735) SUCCESS. [Exact-commit Vercel Preview](https://vercel.com/bolehejassolutions-8492/bros-commercial-intelligence/GAykJ4JubSQzgsvNPX1vQNZrMG1D) READY, protected; not independently exercised with a real signed-in session.
- **Limitations:** These are request-validation denial probes, NOT proof of negative cross-tenant RLS, cross-product row isolation, revoked membership or admin SQL LOGIN impersonation on a hosted authenticated session. Issue #11 and Draft PR #10 remain OPEN. No security gate is marked complete.
- Provider read-only snapshot: Buffer Instagram post `6adca7ad0b5343d0708289d1` is provider-reported SENT at `2026-10-26T01:02:51.262Z`, two image assets; metrics=NULL and metricsUpdatedAt predates SENT, so no measured outcome. HitPay list_charges and list_orders for 26 Oct returned no records, which is not proof of zero historical revenue. Neon DEV admin read-only count: 3 manual evidence rows, 2 active product memberships, not live provider ingestion.
- No Production deployment/merge, Meta spend/writes, Buffer publishing, HitPay mutations, price, permissions, automation schedules, or BROS LABS changes.


**Current status (26 Oct 2026):** Development-only Neon ledger is connected to a **protected Vercel Preview**, not Production. Owner-confirmed authenticated CONTENT and DEMAND reads, reload session restoration and sign-out have passed on the corrected Preview (see Issue #11); these are owner-observed, not independently captured authenticated HTTP traces. Read-only Neon SQL on 26 Oct confirms **1 verified Auth user, 2 active product memberships, 3 manual development evidence records**. Both separate restricted LOGIN roles remain LOGIN=true, BYPASSRLS=false, SUPERUSER=false; current SQL privilege audit confirms membership-reader SELECT only memberships and evidence-reader SELECT only evidence, neither has INSERT or schema CREATE. **Full hosted authenticated negative matrix remains unverified**: this connector is pinned to the privileged BROS role, so the present privilege audit is not a fresh direct restricted-login test. Offline HTTP negative matrix and GitHub CI remain separate proof. The current branch also contains an untrusted-ingestion adapter that rejects caller-declared provider_verified; this is NOT a live provider ingestion route. No customer SaaS access, Meta spending/writes or publishing is enabled by this Preview. Older entries below are historical snapshots and must not be used as latest operational status.  
**Checkpoint:** `BCI_NEON_PRIVATE_PREVIEW_20261026` — [Issue #11](https://github.com/bolehejassolutions/bros-commercial-intelligence/issues/11) / [Draft PR #10](https://github.com/bolehejassolutions/bros-commercial-intelligence/pull/10) / [protected sign-in](https://bros-commercial-intelligence-fta0x4ma0-bolehejassolutions-8492.vercel.app/internal/neon-preview).  
**Initial schema date:** 2026-10-25 (MYT).  
**Authoritative product boundary:** [BROS shared intelligence contract](./PORTFOLIO_SHARED_INTELLIGENCE_CONTRACT.md) and [Primary Google Drive portfolio decision](https://docs.google.com/document/d/1AmnN8agBGkMNCVMzQ6esJ1neWtKVuvqBa-F_j3U7rGM/edit).

## BCI_NEON_ROLE_POSTURE_AND_UNTRUSTED_PROVENANCE_20261026

- 26 Oct 2026 read-only Neon admin inspection: `neon_auth.user` 1, email-verified 1; active `bci_dev.tenant_memberships` 2; `bci_dev.evidence` 3 manual development rows (CONTENT 1, DEMAND 2). These rows are not live provider evidence or business outcomes.
- Current restricted-role privilege matrix: `bci_dev_membership_reader` can SELECT memberships, not evidence; `bci_dev_private_reader` can SELECT evidence, not memberships. Both LOGIN, NOBYPASSRLS, non-superuser, no INSERT on either table, no CREATE on `bci_dev` schema. Verified via privileged catalog inspection only; direct restricted connection and hosted authenticated cross-tenant/product denial NOT retested in this checkpoint because the Neon connector is pinned to BROS.
- PR #10 untrusted provenance guard commits `ab9be96` and `bcffbb5` reject client-asserted `provider_verified`; [CI #40286688742](https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40286688742) SUCCESS. The guard is a standalone parser and is not evidence of live provider authentication or ingestion.
- Owner-confirmed Preview CONTENT/DEMAND happy path remains distinct from agent-observed negative HTTP proof. Issue #11 stays OPEN; PR #10 stays DRAFT. INTERNAL V1 gates remain OPEN. No Production, provider writes, spend, publishing, pricing, permissions, tasks or BROS LABS changes.

## Deployment inventory (no secrets)

| Field | Development value |
| --- | --- |
| Neon organization | `org-quiet-dew-14773035` (Free) |
| Neon project | `empty-tooth-43040036` — `bros-shared-intelligence-dev` |
| Neon region | `aws-ap-southeast-1` |
| Default branch | `br-broad-math-b3f4d2r4` — `main` |
| Database | `bros_intelligence_dev` |
| Schema | `bci_dev` |
| Admin/MCP role | `BROS` — **Neon-issued admin credentials, never use in apps** |
| Smoke-test-only role | `bci_dev_runtime` — `NOLOGIN, NOINHERIT, NOBYPASSRLS`; supports `SET LOCAL ROLE` to verify RLS |

Existing `bros-sell-web-os` Supabase production is untouched. Dedicated BCI and BROS CONTENT Supabase projects remain subject to their separate paused/inactive governance. The repo's `supabase/migrations/*` depend on Supabase Auth and are **not** applied to Neon.

## Schema design

Apply migrations in the order below **only to this development database**:

1. [0001 development ledger](../neon/migrations/0001_dev_evidence_ledger.sql): `evidence`, `cases`, `case_evidence`, `proposals`; tenant/product scoped foreign keys, source-idempotency, NULL vs zero semantics, `FORCE ROW LEVEL SECURITY`.
2. [0002 non-bypass runtime role](../neon/migrations/0002_dev_runtime_role.sql): temporary role for RLS tests, `SELECT` / `INSERT` only; no public schema/table grants.

All `proposals` are constrained to `PROPOSED`, and there is **no code path to execute an ad campaign or publish a post** in this schema.

Schema-level semantics:
- `tenant_id` and `product` are mandatory and carried through the relational joins; composite foreign keys reject cross-tenant and cross-product evidence links.
- `provider_record_key` is unique per tenant/product/provider. This gives idempotent `ON CONFLICT DO NOTHING` ingestion.
- `metrics` is JSON where `null` is unknown and numeric `0` is a real observed zero; do not conflate.
- All test records use synthetic tenant UUIDs and `synthetic://...` evidence refs. Do not import actual paid customer data, personal information, Meta tokens or private payment methods without a separate data/privacy review.
- Source IDs, reporting windows and completeness are independently required. A platform-attributed event is not the same thing as a verified customer order.

## Verified smoke tests — 25 Oct 2026

MCP SQL connected to the Neon development DB. Fresh application tables initially: zero. The four development tables were created; each has `relrowsecurity=true` and `relforcerowsecurity=true`.

**Important security discovery:** both the default owner and new `BROS` Neon roles reported `rolbypassrls=true`. Thus testing RLS as `BROS` produced misleading cross-tenant visibility (three evidence records and two cases visible regardless of tenant setting). `FORCE RLS` does not override a role with `BYPASSRLS`. Never treat admin-role queries as tenant-isolation evidence.

After `SET LOCAL ROLE bci_dev_runtime`:
- No tenant context: 0 evidence visible.
- Synthetic tenant A: 2 evidence, 1 case, 1 proposal.
- Synthetic tenant B: 1 evidence, 1 case, 0 proposals.
- Tenant A attempted to insert tenant B record: **rejected by RLS**.
- Attempt to attach tenant A `content` evidence to tenant A `demand` case: **rejected by composite foreign key**.
- Attempt `APPROVED` proposal: **rejected by check constraint**.
- Attempt `UPDATE` evidence as runtime: **permission denied**.
- Re-ingestion of identical source key: 0 added rows, original value retained. 

**Security boundary limitation — MUST NOT IGNORE:** `bci.tenant_id` is an ordinary session setting and can be modified by a connected SQL client. This test shows that RLS policies honor a requested scope, **not** that the scope was authenticated. The NOLOGIN role is only a test harness. BROS admin credentials bypass RLS and must never be shipped to browser/customer backends. A public SaaS requires independently authenticated identity, verified per-tenant membership enforced by a trusted server, independent least-privileged login, cross-tenant negative integration tests and security review.

## Historical next steps from 25 Oct (superseded by the 26 Oct protected Preview)

- Add a private server-side adapter on a **preview-only branch**; ensure the caller never supplies an unchecked tenant id; forbid client SQL access. Keep development metadata separate from production Vercel environment variables.
- Establish a strict service-account and tenant-auth design, deploy to preview, and repeat isolation tests through the actual API (not only SQL GUC).
- Import **no real customer** or campaign data until consent, minimum-scope provider credentials, retention, monitoring and approval boundaries are verified.
- Confirm current Free plan usage and suspend/restore behavior before considering operational dependency; resource limits can make Free unsuitable for production SLAs.

## Operational safeguards

- No Supabase migration, resume or ownership changes; no Meta Ads writes or spending; no changes to Buffer schedules/queues; no HitPay actions; no customer entitlements.
- This documentation is evidence of verified schema/testing only, **not** proof of a production integration, customer authentication, provider sync or end-to-end experiment.


## Preview-only access boundary — code added 25 Oct 2026

These files are **policy scaffolding only**, with no deployed API, no Neon database driver/connection string and no authentication backend wired:

- [`lib/bci/private-evidence-boundary.ts`](../lib/bci/private-evidence-boundary.ts): pure fail-closed reader policy. Accepts only `product` and a bounded `limit`; derives tenant from a **server-verified principal and authoritative membership**. Rejects caller-supplied tenant/user identifiers, unauthenticated principals, missing/ambiguous/inactive memberships, cross-tenant/product result rows, nonnumeric metrics, and oversized responses. Preserves `null` as unknown distinct from zero.
- [`lib/bci/private-evidence-server.ts`](../lib/bci/private-evidence-server.ts): server-only composition point, disabled unless both `VERCEL_ENV=preview` and `BCI_NEON_DEV_PRIVATE_READS=enabled`. Neither flag is set by this PR. No HTTP handler imports or exposes this adapter.
- [`tests/private-evidence-boundary.test.mjs`](../tests/private-evidence-boundary.test.mjs): pure offline tests with synthetic data (spoofed scope, cross-tenant rows, cross-product rows, fail-closed access and invalid metrics).

**Required integration before any preview read:** determine and operate an authenticated session authority; implement server-side membership table/checks bound to that principal, per-product entitlement/tenancy and revoke tests. Implement a **separate, LOGIN-enabled, non-BYPASSRLS, least-privileged Postgres role**; the currently provisioned admin `BROS` role bypasses RLS, while `bci_dev_runtime` is NOLOGIN and only a smoke-test role. Review credential lifecycle, connection pooling and RLS identity binding. Query must use parameterized `tenant_id` and `product` restrictions and SQL-level authorization, not rely on a self-settable `bci.tenant_id` GUC alone. Avoid copying a tenant id from incoming HTTP headers, form fields, route params or unverified JWT claims.

Existing Supabase Auth/BCI operator RPC is not available as a verified customer-tenant membership authority while dedicated BCI Supabase is inactive. Do not confuse its internal operator check with user-facing tenant membership. The production Supabase BROS SELL authentication remains unchanged.

**Verification rules:** Passing offline tests or Next.js compilation is *not* a live authenticated API integration test. No reads from the Neon SQL adapter, browser access, production permission changes, customer entitlement or Meta/Buffer provider mutation have been activated.


## SQL-only restricted LOGIN role and transactional reader — 25 October 2026

**Database development proof — deployed only to Neon dev:**

- [Migration 0003](../neon/migrations/0003_dev_private_reader_and_membership.sql) creates PostgreSQL-SQL role `bci_dev_private_reader` with `LOGIN`, `NOBYPASSRLS`, `NOINHERIT`, `NOCREATEROLE`, `NOCREATEDB`, `NOREPLICATION`, and **`PASSWORD NULL`**. That role **cannot authenticate remotely yet**. No Neon/Vercel connection string or application secret was issued or saved. Neon management API role creation was avoided because it would inherit administrator `BYPASSRLS` privileges.
- Grants on that role: database CONNECT, `bci_dev` schema USAGE, **SELECT only** on evidence/cases/proposals/links; no INSERT/UPDATE/DELETE, CREATE or access to `tenant_memberships`.
- Creates empty `bci_dev.tenant_memberships` table (principal id, tenant id, product, active, timestamps), `FORCE RLS`, **no grants** to preview reader, runtime, or PUBLIC. Populating real memberships requires a verified auth provider and separate approval; none were imported.
- Administrative role `BROS` received `GRANT bci_dev_private_reader WITH INHERIT FALSE, SET TRUE` to allow a scoped SQL test without inheriting grants into unrelated sessions. This **does not change** the elevated nature of the Neon admin role and is **not evidence of successful direct password login**.
- Tested with `SET LOCAL ROLE bci_dev_private_reader`: role `BYPASSRLS=false`; no tenant scope = 0 evidence; synthetic A = 2 evidence; synthetic B = 1 evidence. Reading memberships and updating evidence as reader both fail due to permission denial.
- [Transactional query adapter](../lib/bci/neon-dev-read-rows.ts) is pure injectable code with **no Neon driver/secret**, not a public endpoint. It rejects unexpected role names or `BYPASSRLS=true` before any query; uses a single pinned transaction, binds tenant/product/limit values as parameters, sets tenant context transaction-locally and rejects any returned cross-tenant/cross-product/malformed row. It is safe to test offline, but SQL GUC is still self-settable and not an authentication boundary.
- [Adapter negative tests](../tests/neon-dev-read-rows.test.mjs) run in GitHub CI, including admin-role rejection, SQL parameterization, fail-closed malformed scope, cross-tenant leakage rejection and transaction rollback. These do **not** replace integration tests using a real restricted login and a verifiable principal.

**Remaining hard gate:** select/configure free identity provider (e.g., Neon Managed Auth after security/cost review), prove cryptographic session verification and authoritative user-to-tenant-to-product membership, securely provision a separate restricted database password to **Preview only**, test actual login via the deployed server driver and negative API cases. Do not copy Neon admin `BROS` URI or auto-resume Supabase projects. No real customer or provider data; no ad spending; no customer APIs were enabled.


## 25 October — product-scoped RLS hardening (migration 0004)

**Scope:** Neon Free **development only**, `empty-tooth-43040036` / `bros_intelligence_dev`. No production or customer integration.

- Identified an actual cross-product RLS gap: with only synthetic tenant A set, `bci_dev_private_reader` could SELECT **both** one CONTENT and one DEMAND evidence row. This was allowed by tenant-only SQL policies, even though the TypeScript adapter also filters by product.
- Added [migration 0004](../neon/migrations/0004_dev_product_scoped_rls.sql) and applied all 12 `ALTER POLICY` statements in a single successful transaction to Neon dev. The non-bypass `bci_dev_private_reader` and `bci_dev_runtime` now require **both** `bci.tenant_id` and `bci.product` for SELECT, and the runtime role requires both for INSERT. Existing admin `BROS` still bypasses RLS and remains forbidden in apps.
- Updated [transactional read adapter](../lib/bci/neon-dev-read-rows.ts) to set both GUCs transaction-locally with bound SQL parameters on a pinned connection; [test](../tests/neon-dev-read-rows.test.mjs) asserts both parameters. CI run [40172688759](https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40172688759) passed all configured dry-run tests, type-check and production build at commit `e4af1b176d834b1df5896994f75e914abfb86429`.
- Fresh real Neon dev SQL under `SET LOCAL ROLE bci_dev_private_reader` (`BYPASSRLS=false`): no scope=0; tenant A only, no product=0; tenant A + DEMAND=1 demand/0 content; tenant A + CONTENT=1 content; tenant B + CONTENT=0; tenant B + DEMAND=1; invalid product `sell`=0. A runtime INSERT with tenant A and mismatched CONTENT record under DEMAND scope was rejected by RLS; readback verified **0** rejected-test records persisted.
- **Still not authenticated:** both GUCs are client-settable; this hardening is a database policy test, **not** identity or membership proof. SQL tests use admin `SET LOCAL ROLE`, not a direct restricted LOGIN. `bci_dev_private_reader` remains `PASSWORD NULL`; no real principal verification, tenant membership, HTTP endpoint, Preview environment secret, provider ingestion or customer data. Keep Issue #11 OPEN and PR #10 DRAFT until real credential + signed principal + server-side membership + negative authenticated Preview API tests are independently verified.



## 25 October — direct-login assertion in the dev read adapter (CI verified)

**Observed security gap:** The first adapter checked `current_user` and `rolbypassrls` only. A privileged `BROS` database session can execute `SET LOCAL ROLE bci_dev_private_reader`, yielding `current_user=bci_dev_private_reader` and `rolbypassrls=false` even though the actual login remains `session_user=BROS`. This makes a role-impersonation SQL test appear to satisfy the application credential guard.

**Remediation (development branch only):** `lib/bci/neon-dev-read-rows.ts` now requires both `current_user` and `session_user` to equal `bci_dev_private_reader`, plus `rolbypassrls=false`, `rolsuper=false`, and `rolcanlogin=true`. A privileged `SET ROLE` session cannot pass this guard. New offline negative tests cover admin-session impersonation, alternate session owner, superuser, NOLOGIN and missing session identity. This is a **defence-in-depth assertion**, not an identity or tenant membership authority.

**Actual Neon SQL evidence:** In a transaction logged in as `BROS`, after `SET LOCAL ROLE bci_dev_private_reader`, PostgreSQL returned `current_user=bci_dev_private_reader`, `session_user=BROS`, `rolbypassrls=false`, `rolsuper=false`, `rolcanlogin=true`. The new guard would reject that session. No restricted direct password login was attempted or claimed.

**CI:** [GitHub Actions run 40176301427](https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40176301427) completed successfully on commit `575412dc9e2fc5fb40aff2b0e428eeb384958d5e` (dry-run safety, TypeScript and Next.js build). The role guard is still **not wired into an HTTP endpoint**; restricted role has `PASSWORD NULL`, and Issue #11 remains OPEN. Real direct login, cryptographic principal, authoritative revocable membership, Preview API negative tests and production approval remain separate gates.


## 25 October — shared internal growth evidence summary (partial BCI/DEMAND/CONTENT)

Checkpoint: `BCI_GROWTH_EVIDENCE_SUMMARY_20261025`. **Code and offline tests only; not live provider ingestion or authenticated Preview API.**

- Added [`lib/bci/growth-evidence-summary.ts`](../lib/bci/growth-evidence-summary.ts), one reusable deterministic module for product-scoped CONTENT/DEMAND measurement. It validates exact tenant/product/reporting-window scope, provider-kind contracts, safe integer minor units (MYR), and idempotent provider record keys; rejects conflicting replays and cross-tenant/product evidence rather than silently filtering.
- It separates **verified live settled HitPay orders** from **Meta platform-attributed Purchase events**, excludes sandbox/unverified records from verified totals, and preserves `null` (no verified denominator) distinct from zero. Gross settled receipts are not profit or refund-adjusted revenue. A visit-to-order ratio is observational only; `cpaMinor` stays `null` until verified cross-provider reconciliation establishes the appropriate numerator/denominator and campaign scope.
- Added [`tests/growth-evidence-summary.test.mjs`](../tests/growth-evidence-summary.test.mjs) with 7 offline tests: settlement versus attributed events, sandbox exclusion, replay conflicts, missing denominators, tenant/product/window isolation, malformed/unsafe values, and shared code reuse. **Local Node 22 tests 7/7 PASS; strict TypeScript check PASS** before commit. GitHub CI and provider integration must be checked separately.
- `verification: "verified"` is a **trusted adapter assertion**, not proof created by this module. No actual HitPay, Meta, GA4, Buffer or customer records have been ingested; no conversion lift, CPA or sales are claimed. The restricted Neon LOGIN, authoritative principal/membership, and authenticated Preview HTTP gates in Issue #11 remain open. No production, spend, publishing, credential or entitlement changes.


## 25 October — paid charge versus settled payout reconciliation (partial; BCI_HITPAY_PAID_VS_SETTLED_20261025)

**Provider read-only observation (25 Oct 2026):** HitPay online store order listing for 1–25 Oct returned one order marked `completed / paid / fulfilled` for **MYR 50.00**; the linked charge returned `succeeded`, with `payout: null`. HitPay sales summary for the same date range showed one payment, MYR 50 gross, MYR 1.70 fees and MYR 48.30 net collected. No customer name, email, card details, or raw charge identifier is retained in this document. This is **not proof of settlement/payout**, and product identity, live-vs-test attestation and BROS SELL attribution were **not established**; do not count it as a verified BROS SELL sale or settled revenue. This is a point-in-time observation, not an ingestion pipeline.

**Code change on Draft PR #10:** the shared `growth-evidence-summary.ts` now distinguishes `paid_order` / `grossPaidRevenueMinor` from `settled_order` / `grossSettledRevenueMinor`. `settled_order` additionally requires a nonempty `settlementReference` supplied by a **trusted payout-verifying adapter**. This is an input contract, **not cryptographic or provider verification** by itself. No payout reference was available for the observed HitPay charge; therefore it must never be mapped to `settled_order`. The `verification` and `environment` fields still require trustworthy provider-specific server attestation. Provider charge success alone does not establish settlement, test/live, attribution, or the product sold.

**Negative tests:** paid-without-payout must not become settled; a separately evidenced settlement may count independently; missing payout reference is rejected; sandbox/unverified paid orders do not count. No API route, secrets, provider writes, Neon customer migration, paid plan, ad spend or production deployment was added. Real provider-to-BCI ingestion and reconciliation remain **BLOCKED** by #11 and provider provenance/identity requirements. Code/tests are committed; GitHub CI status must be checked on the latest commit before calling them verified.

## 25 October — read-only HitPay charge/order pair reconciliation (BCI_HITPAY_LIST_PAIR_RECONCILIATION_20261025)

**Status: IMPLEMENTED ON DRAFT PR BRANCH, OFFLINE-TESTED ONLY.** This is a pure reconciliation module, not live provider ingestion, payout verification, or an authenticated endpoint.

- Added [HitPay list-row reconciler](../lib/bci/hitpay-readonly-reconciliation.ts) and [six negative/positive tests](../tests/hitpay-readonly-reconciliation.test.mjs). It requires an exact HitPay order UUID in the charge remark, equal positive safe-integer MYR **minor-unit** amounts, succeeded charge and completed/paid order, with an idempotent provider charge key. It rejects mismatch, refunded/failed charge, unpaid/cancelled order and invalid values. The separate HitPay charge **detail** API returns major units; never mix these with list-row amounts.
- The result deliberately marks **environment, product attribution, refund, payout settlement, digital entitlement and acquisition attribution all UNVERIFIED**. HitPay's order fulfilment label is NOT independent proof of BROS SELL entitlement. No actual provider data or personal identifiers are stored in tests or code. This module MUST NOT promote observations into verified live paid/settled BCI GrowthEvidence without further trusted checks.
- Real read-only provider comparison (1–25 Oct 2026): one order and linked succeeded charge, both **MYR 50.00**, with order completed/paid/fulfilled and charge payout=null; the pair's fields match. **Product identity, sandbox/live status, actual settlement and digital entitlement remain unverified.** Do not label this BROS SELL RM100 revenue.
- Local Node 22 strip-types tests: **6/6 PASS**; standalone strict TypeScript compile: **PASS**. GitHub CI for latest commit must be checked separately before calling it passed. No changes to Neon roles, migrations, production, payment/entitlement, pricing, ads or publishing.


## 25 October — private evidence response replay guard (BCI_PRIVATE_EVIDENCE_REPLAY_GUARD_20261025)

**Status: VERIFIED DEV CODE + CI; NOT LIVE AUTHENTICATED PREVIEW.** In Draft PR #10, the private evidence boundary now rejects duplicate evidence UUIDs and duplicate (provider, provider_record_key) pairs in a single scoped response. This mirrors the Neon dev evidence table's unique constraints, preventing a buggy or replaying adapter from returning duplicate facts that downstream reporting could double-count. The entire response fails closed, rather than silently deduplicating or presenting partial data. Synthetic positive/negative tests were added, including a valid two-record response.

- Code commit: `88064231a77098e157b7c33b133a9be4343ffc20`; test commit: `25b32e913de7976b16fff031ca0cf13eeedbc16a`.
- GitHub Actions [40193011871](https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40193011871): **SUCCESS** on test commit; dry-run-safety, TypeScript check and Next.js build completed successfully.
- The private boundary still uses injected mocks. There is **no** authenticated principal provider, revocable authoritative tenant membership, restricted direct Neon LOGIN/password, or protected Preview HTTP integration. Issue #11 remains OPEN, PR #10 remains DRAFT.

### BROS CONTENT provider observation (read-only, 25 October)

- Buffer organisation's BROS SELL Facebook, Instagram and TikTok channels are connected. Provider returned **SENT** status and `sentAt` timestamps for 25 October 18:00 MYT example posts: Facebook `6add5154e4be8a4d8684af9a` (18:00:39 MYT), Instagram `6add51563d5b27036bad1734` (18:01:47 MYT), TikTok `6add51586887a2efc1e0d26a` (18:02:29 MYT). All include image asset metadata and descriptions. This is provider status evidence, **not independent byte-level media QA** or external platform URL verification.
- Buffer aggregate analytics for 20 Oct 00:00 UTC–25 Oct 12:00 UTC: **41 posts, 17 reactions, 0 comments, 0 shares, 0.52% engagement rate**; metrics updated at 2026-10-25T10:01:43Z. These are observed social engagement metrics, **not qualified leads, conversions or sales**.
- Buffer also returned a future Instagram post `6adca7ad0b5343d0708289d1` scheduled 26 Oct 01:00 UTC, with an existing **media specification error** field and `sentAt=null`. It is **NOT SENT** and must not be counted as successful. Existing queue and Full Publisher were not modified.
- CONTENT INTERNAL V1 remains partial: independently decode/validate actual media bytes, resolve publisher media errors via its approved workflow, retain provider SENT references, connect channel measurement to learning, and distinguish BROS SELL internal instance from standalone product readiness.

No provider writes, posting, paid spending, production deployment, customer access or credentials were changed.


### 25 October — real-byte QA of scheduled Instagram media (BCI_BUFFER_MEDIA_MIME_QA_20261025)

**Actual source bytes inspected**, not only Buffer metadata. For scheduled IG post `6adca7ad0b5343d0708289d1` (26 Oct 01:00 UTC / 09:00 MYT), Buffer reports both attached assets as `image/jpeg`, while the two linked Primary Drive files are **PNG** (actual PNG file signature, MIME `image/png`). This format mismatch is a **plausible cause** of the existing Buffer media-specification error, not a proven sole cause.

- Slide 1 Drive file `1ipqCnUALK-QAqO2ytfiv3jbEUidx6IsM`: PNG, 1080x1350 RGB, 1,751,408 bytes, Pillow full decode/verify PASS.
- Slide 2 Drive file `1WZY8YTFz-bOStIixu6uuTgLeCNQ-nJ4d`: PNG, 1080x1350 RGB, 1,790,827 bytes, Pillow full decode/verify PASS.
- Prepared **local repair-ready JPEG copies only**, 1080x1350 RGB, decoded/verified successfully. Slide 1 JPEG: 381,400 bytes, SHA256 `67f93dfa2769f454d2c2086db4075f0a652870dadfea786b44ecce2416c81c8b`. Slide 2 JPEG: 394,402 bytes, SHA256 `a5b94544435ecaa716908ceb0ea34dda1caf46a06f0d5357d05a3eb4956b1295`. These local copies are **not uploaded to Buffer or Primary Drive**.
- **No queue/post mutation** performed. Existing scheduled post is **NOT SENT**, `sentAt=null`; do not count it as success. The approved publisher workflow should revalidate media MIME/bytes before publishing or replacing assets, without changing schedules/approval automatically.

This is actual image decoding and metadata diagnosis for one affected internal post, **not universal CONTENT media QA completion**.

## Growth evidence identity and payment-consistency guard — 25 Oct 2026

**Checkpoint ID:** `BCI_GROWTH_EVIDENCE_IDENTITY_AND_SETTLEMENT_CONSISTENCY_20261025`. **Scope:** Draft PR #10 only; no live ingestion, credentials, provider mutation, public endpoint or production changes.

- The shared `growth-evidence-summary.ts` now rejects reuse of the same `evidenceId` for two different provider facts. Identical provider-fact replay remains idempotent; a conflicting replay still fails closed.
- If independently verified **live** paid and settled HitPay records identify the **same provider order**, contradictory MYR amounts now fail closed. Settled-only evidence remains possible when a trusted adapter independently attests it. This consistency rule does **not** itself verify a payout, refund, product identity or customer entitlement.
- Two offline negative/positive regression tests were added. Code commit `d35b4b6c2fdc1b27e8d79dca89f5aa431c20c3a6`; test commit `1bda116213269c9a46325243d74157f5e585a5fa`. CI must be checked independently before claiming PASS.
- Fresh read-only Neon dev verification: `bci_dev_private_reader` has LOGIN but no password and NOBYPASSRLS; `bci_dev_runtime` is NOLOGIN; `bci_dev.tenant_memberships` contains **0** authoritative memberships. Therefore real restricted direct login and authenticated tenant/product API isolation remain **UNPROVEN**.
- No BROS CONTENT SENT/measurement or BROS DEMAND verified experiment is established by these code tests. No BROS LABS work started.



## BCI_NEON_READ_POSTURE_20261025 — connection-target and least-privilege preflight (25 Oct 2026)

**Status:** development code hardening and read-only Neon catalog verification; **not** authenticated Preview or direct restricted LOGIN proof.

The private evidence SQL adapter now checks, inside the same pinned transaction and **before** setting tenant/product GUCs: (1) direct non-bypass `bci_dev_private_reader` session and current role (existing guard); (2) exact development database `bros_intelligence_dev`; (3) `bci_dev.evidence` has RLS enabled and forced; (4) the effective role has evidence SELECT but not INSERT, membership-table SELECT, schema CREATE, or database CREATE. Missing/unsafe catalog facts fail the whole read closed without falling back to unscoped SQL.

Actual Neon Free **read-only catalog query**, with privileges explicitly evaluated for `bci_dev_private_reader`, returned: database `bros_intelligence_dev`, RLS enabled=true, FORCE=true, evidence SELECT=true, evidence INSERT=false, memberships SELECT=false, schema CREATE=false, database CREATE=false. Role catalog still reports `LOGIN=true`, `BYPASSRLS=false`, **PASSWORD NULL=true**; authoritative tenant membership count remains **0**. These are administrative catalog observations, **not** a direct login or authenticated HTTP test.

Regression tests were added for wrong database, missing RLS/FORCE, absent SELECT and accidental write/schema/membership privileges. GitHub commits: `bd11c4977dfea04477a00e5d72f337765d2bcf47`, `dc915edf63bec98ae079907854c9775867cd0028`. CI status must be verified separately for the final commit. No credentials, API routes, deployments, migrations, publishing, budgets, customer access, or production systems changed.

**Hard blockers unchanged:** trusted signed principal, authoritative revocable per-product membership, secret provisioning for restricted direct login, Preview-only authenticated HTTP negative tests, and actual provider-to-outcome integration. Issue #11 stays OPEN; PR #10 stays DRAFT.


## BCI_INTERNAL_LINEAGE_V1_20261025 — shared structural evidence lineage (25 Oct 2026)

**Status: OFFLINE CODE + LOCAL TESTS; NOT LIVE PROVIDER, AUTHENTICATED API OR VERIFIED GROWTH OUTCOME.** Added `lib/bci/internal-lineage.ts` and `tests/internal-lineage.test.mjs` to Draft PR #10. This is a reusable, product-scoped BCI provenance graph for `evidence → signal → case → diagnosis → decision → action → outcome → learning`. It validates direct predecessor references, timestamp ordering, source-ID idempotency, cross-tenant/product isolation and rejects orphaned/skipped-stage links and conflicting replays. Structural ancestry must **never** be interpreted as actual publication, settled sale, execution evidence or causality.

- Local Node 22 strip-types tests: **6/6 PASS**. Standalone strict TypeScript compile: **PASS**. GitHub source blob SHA verified against the locally tested bytes. GitHub CI on `d328a90601b547cb4826aeeb15a9753e53c09b07` must be checked independently before calling CI successful.
- This module does not ingest real data, authorize users, read Neon, execute marketing actions or establish a completed DEMAND experiment. Verification labels are **trusted-adapter inputs**, not cryptographic attestation.
- Security blockers remain: restricted direct Neon LOGIN still has PASSWORD NULL, authoritative tenant memberships count 0, Neon Auth not enabled, no server-only credential or authenticated Preview HTTP negative tests. Issue #11 OPEN, PR #10 DRAFT.
- No changes to production, Neon role/password, Vercel, provider permissions, Meta spend, Buffer publishing, HitPay, pricing, entitlements or BROS LABS.

## BCI_NEON_PRIVATE_PREVIEW_20261026 — restricted runtime and approved operator

This checkpoint supersedes older statements above about password-disabled readers,
an empty membership table, and the absence of an HTTP adapter. Production and all
commercial/provider workflows remain outside this change.

- Migration 0005 is present on the approved Neon Free development branch. Both
  SQL-created reader roles now have independent passwords and remain LOGIN,
  NOBYPASSRLS, non-superuser, with no schema creation privileges. Secrets were
  generated server-side and saved only as Vercel sensitive variables targeted to
  Preview and `feat/neon-bci-dev-ledger-20261025`; no owner/BROS credential is used.
- Actual direct-password connections verified both `current_user` and
  `session_user`. Each role was denied writes and reads of the other role's table.
  Evidence returned zero rows without scope, one expected synthetic row with a
  synthetic scope, and zero again after its transaction ended.
- The sole approved existing Auth subject has exactly two active memberships,
  CONTENT and DEMAND, in a fresh empty internal tenant. Enrollment SQL is in
  `neon/dev/enroll_approved_internal_operator.sql`; it cannot create another Auth
  user, set email verification, copy evidence, reactivate a revoked grant, or
  change an existing tenant assignment. Membership is authorization, not identity.
- `/api/internal/neon-evidence` composes signed JWT verification, the exact approved
  verified email, fresh product membership, and a separate pinned read-only
  evidence transaction. It requires Preview, the exact branch, and the enable
  flag. Client tenant/user overrides, unsafe connections, data crossing a scope,
  and all failures deny access. Responses are private/no-store and errors generic.
- `/internal/neon-preview` provides official Neon SDK email OTP sign-in for the
  approved account only. The user initiates code delivery and enters the code
  directly in the page. The application never displays or logs JWTs or codes.
  Only these two exact paths bypass the unrelated Supabase session proxy.
- Local Node 24: **116/116 tests PASS** including the concurrent HTTP helper
  commits; strict TypeScript PASS; Next.js build PASS for the runtime changes.
  An independent security review found no material regression. Local Request/
  Response tests with locally signed fixtures and real restricted Neon connections
  returned 200 with zero evidence for each approved product, 403 for unverified
  identity, 400 for a tenant override, and 401 without a token. These fixtures
  **are not real Neon Auth tokens or a hosted authenticated success**.

The provider still reports the approved email as unverified at this checkpoint.
Neon's console explicitly states that restricted provider signup is not currently
available. The protected Preview and signed verified sole-operator gate therefore
remain mandatory; no public signup UI or customer access is enabled. A JWT can
remain valid until its expiry after sign-out, while membership revocation is
checked on every read. No immediate JWT revocation is claimed.

Before closing Issue #11, verify the deployed exact commit and HTTP negative
responses, then have the owner complete OTP sign-in and verify both protected
product reads and session restoration/sign-out. Record current hosted evidence in
Issue #11 and the canonical decision Doc. Keep PR #10 Draft and Issue #11 open
until the provider-authenticated flow is actually proven. No Production, spend,
publishing, other admin, customer, existing automation, or BROS LABS change.


## BCI_DEMAND_REVIEW_AND_CONTENT_SENT_20261026 — 26 October 2026

**Scope:** Draft PR #10, BROS DEMAND offline contract plus read-only BROS SELL internal CONTENT provider observations. **NOT INTERNAL V1 COMPLETE**.

- Added `lib/bci/demand-experiment-review.ts` and `tests/demand-experiment-review.test.mjs`. Deterministic, side-effect-free review of approved acquisition action → evidence-linked observed outcome → next-best-action. Fails closed on cross-tenant/product, invalid windows, invalid IDs, missing approval/action/outcome evidence and unknown metric. Paid experiment requires a spend cap and verified spend; a verified cap breach takes precedence even if outcome evidence is missing. Baseline zero yields NULL change ratio; missing counts remain NULL. All outputs remain observational, with `causalLift=null` and `cpaMinor=null`. Attestation flags are **trusted-adapter contracts**, not independently verified provider claims.
- Local Node 22 strip-types tests **8/8 PASS**; strict standalone TypeScript compile **PASS** using the existing `GrowthSummary` contract shape. GitHub blob SHAs matched locally tested bytes: module `2f0e9bfcd06d7366cbc14d105b80195e6b640f59`, tests `d066b2bba9cb0f5a62fdca3b3f53f4c8bc0e7fa4`. CI on commit `18ead5ed7cec0ddfdb1b4d23083ecb338b954b13`: **SUCCESS**, run [40231087166](https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40231087166). No real acquisition experiment executed or causal improvement claimed.
- Buffer **read-only** check for BROS SELL internal posts scheduled 25 Oct 21:00 MYT: Facebook `6add890e3d5b27036bb7b9c3` SENT 21:00:49, Instagram `6add89138b3d437ddcf0044e` SENT 21:02:15, TikTok `6add8918bd33ce99c3567297` SENT 21:02:33 (all MYT). Provider metrics at inspection: FB 1 impression / 0 clicks (updated 25 Oct 17:43 UTC); IG 5 views / 3 reach / 0 reactions (updated 25 Oct 15:34 UTC); TikTok 53 views / 1 reaction (updated 25 Oct 15:40 UTC). These are provider-reported status and metrics, **not** independent platform verification, byte-level QA of these three posts, qualified leads or sales. No Buffer queue or publishing mutation.
- Fresh Neon read-only inspection: one Auth user, **zero email-verified**, two active product memberships. The protected Preview is still awaiting genuine owner OTP; CI/synthetic tests cannot close authenticated E2E Issue #11. Existing direct restricted-login proof is preserved from prior checkpoint.
- **Open gates:** real provider-authenticated negative HTTP matrix, complete CONTENT per-post media QA/measurement-to-learning, DEMAND one actual approved experiment with verified outcome, BCI provider-backed reuse, and HitPay live/test/product/payout/entitlement attestation. No Production, spend, publishing, price, permissions, secrets, automation or BROS LABS changes.


## BCI_CONTENT_SENT_MEDIA_BYTE_QA_20261026 — BROS SELL internal CONTENT, provider SENT + actual source media QA (26 Oct 2026)

**Evidence level: source bytes VERIFIED, Buffer SENT/metrics PROVIDER-REPORTED, published platform media bytes NOT independently fetched.** Read-only Buffer get_post and Primary Google Drive binary fetch; Pillow full decode/verify/load plus visual contact-sheet review of **all five** source PNGs. No Buffer or publishing writes.

- Facebook Buffer post `6add890e3d5b27036bb7b9c3`: `sent` 2026-10-25T13:00:49.633Z; 1 image 1080x1350; metrics 1 impression, 0 clicks (metricsUpdatedAt 2026-10-25T17:43:10Z).
- Instagram Buffer post `6add89138b3d437ddcf0044e`: `sent` 2026-10-25T13:02:15.296Z; 2 images 1080x1350; metrics 5 views, 3 reach, 0 reactions (metricsUpdatedAt 2026-10-25T15:34:40Z).
- TikTok Buffer post `6add8918bd33ce99c3567297`: `sent` 2026-10-25T13:02:33.103Z; 2 images 1080x1920; metrics 53 views, 1 reaction, average watch time 2.18 seconds (metricsUpdatedAt 2026-10-25T15:40:38Z). TikTok post metadata `isAiGenerated:false` conflicts with caption declaring AI illustrations: metadata-compliance review required; do not mutate historical post without approval.

**Verified source-file manifest (SHA256; no personal data):**

| Platform / source Drive file ID | Actual bytes | Size | Dimensions / mode | SHA256 |
| --- | --- | ---: | --- | --- |
| FB `1A01akLmfNGWdN0Ft_8qMAQafesXLgrnb` | PNG | 1,724,949 | 1080x1350 RGB | `871599d4b1951abbc8bc7a2a69ea3eece55379e9eaa0fe08f3c3150db375d439` |
| IG 1 `1ou8iqBIx6kTNSUE_DqELRr5Cr6D8XUr2` | PNG | 1,677,129 | 1080x1350 RGB | `55cc5553e30efe58ca6266fe7f8c7dbf4794679020a38187c9d0833863572a33` |
| IG 2 `1bK9blcHVOLfy8ShaQuL-crxuu1_GnWM6` | PNG | 1,675,755 | 1080x1350 RGB | `2fa67fca1077f3b3c977d6db83c4c819ae532c97682d8cd6200c5b476cb7709b` |
| TikTok 1 `1FFsTmh6dH56JZPmxjTBrUyPG8d7VrWrb` | PNG | 2,333,727 | 1080x1920 RGB | `ace749b67a75fbfb375ec8af2815fa453bb9814b6cb0329335c0c40e5f1e5217` |
| TikTok 2 `1JK-N0iwO9vLegrE6usx2Yh-BR4pAhcyY` | PNG | 2,312,394 | 1080x1920 RGB | `6df4d052de754f91221ad4ddfd4f2312943ba4c1b6138e86834ee243f9cd20dd` |

All five actual Drive sources: PNG signature, full Pillow verify/decode PASS, expected dimensions, RGB; visual review found consistent seller-facing teaching of delivery-date clarification, correct BROS SELL typographic signature and no unsupported outcome claims. **Metadata mismatch:** Buffer calls FB/IG assets `image/jpeg`, but corresponding Drive source files are PNG. Despite this, Buffer reports SENT. Future publisher QA should derive MIME from actual bytes; do not infer this caused any failure or that Buffer served unmodified Drive bytes.

**Learning (observational):** One approved seller-first teaching concept demonstrably reached Buffer SENT status on three channels with provider metrics. No qualified visits/leads, verified HitPay sale linkage, acquisition effect, or causal improvement is established. This is an INTERNAL BROS SELL instance proof, not general multi-tenant BROS CONTENT SaaS readiness. Media-byte/source QA + provider SENT + measurement are demonstrated for this set; end-to-end provider media identity and reusable approval→publisher→measurement→learning workflow remain gated.

## BCI_HITPAY_PAYOUT_LINKAGE_READONLY_20261026 — HitPay charge/order/product/payout boundary (26 Oct 2026)

Read-only provider list_charges, list_orders, get_charge_details, list_payouts and get_top_products for 1–26 Oct 2026 returned one matching completed/paid store order and succeeded charge, **MYR 50.00** (5,000 minor units); order fulfilment marked completed. Charge detail: fee MYR 1.70, net MYR 48.30, `payout:null`, refunded MYR 0. A separate payout row marked `paid` for **MYR 48.30** exists, and top-products aggregate reports one BROS SELL Closing OS unit at MYR 50.00. These are real provider observations, not necessarily a current-price transaction.

**Do not join by equal amount alone:** payout row lacks a transaction/charge mapping, and product aggregate lacks order-level product mapping. Provider environment (live/test), charge-to-payout settlement linkage, BROS SELL product identity for this exact order, and digital entitlement remain **UNVERIFIED**. The charge may be classified only as provider-reported paid order/charge, not trusted `settled_order`, verified BROS SELL revenue, CPA, or fulfilled Web OS entitlement. No customer PII or raw card data retained. The approved current offer remains RM100 one-off; this historical RM50 observation is not a pricing change.

**Next evidence gates:** explicit charge→payout mapping, order line-item→BROS SELL product mapping, environment attestation, and purchase-email entitlement readback. No HitPay writes, production changes, spend, publishing, credential changes or BROS LABS work.


## BCI_CONTENT_SOURCE_MIME_ATTESTATION_20261026 — CONTENT source-byte MIME contract (26 Oct 2026)

**Implemented in Draft PR #10, not deployed/published:** Added `lib/content/source-image-attestation.ts` and `tests/source-image-attestation.test.mjs` on branch `feat/neon-bci-dev-ledger-20261025` (code commit `8061add32f962898b582f639b72882be2acec466`; tests commit `d1095b3892e61d7db3c591f8f06a089ade7cc8d1`). A server-side deterministic PNG/JPEG container-signature/dimension/SHA256 inspector distinguishes actual SOURCE bytes from declared MIME and Buffer-reported MIME. Explicit warnings `source_mime_mismatch` and `provider_mime_differs_from_source` are surfaced without asserting that provider served the original bytes. Missing provider MIME remains unknown/null, not a PASS. Rejects unsupported, truncated, oversized and invalid-dimension sources. No provider mutation.

**Tests:** 7/7 synthetic offline tests PASS in Node 22; GitHub Actions workflow #40240536285 SUCCESS on exact committed PR head, including dry-run-safety, TypeScript type-check and Next.js build. CI: https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40240536285 . This does NOT prove a live publisher integration or a full decoder. The contract explicitly returns `verification: source_container_only` and `publishedBytesVerified: false`; full image decode/visual QA remains a separate step.

**Observed motivating discrepancy (prior read-only evidence):** Five actual Drive source images were PNG, while Buffer FB/IG metadata reported JPEG. This module can flag the discrepancy when supplied actual bytes; it has NOT been wired into the live publisher or run on Buffer-delivered bytes. Earlier five-file full-decode QA and three Buffer SENT/measurement observations remain separately evidenced.

**Fresh Neon dev read-only checkpoint:** 1 Auth user, 0 verified users, 2 active tenant memberships. Actual owner provider OTP/JWT and hosted authenticated negative matrix still blocked; no change to memberships or access. INTERNAL V1 gate remains OPEN for CONTENT reusable approval→publish→learning, DEMAND real verified experiment, BCI live shared audit, Neon authenticated provider negative tests, and HitPay settlement/entitlement linkage. No Production, Meta spend/write, publishing, pricing, task, or BROS LABS changes.


## BCI_CONTENT_BUFFER_RECONCILIATION_20261026 — CONTENT provider status + media QA + measurement reconciliation (26 Oct 2026)

**Evidence level: Draft PR code and CI VERIFIED; Buffer provider snapshots READ-ONLY; live publisher adapter NOT INTEGRATED.** Implemented `lib/content/buffer-publication-evidence.ts` and `tests/buffer-publication-evidence.test.mjs` on Draft PR #10. Code commit `bd379799b321c626a8d88f072cc1934536460ace`, tests commit `f62d5e43d8e3b5ea867293b5d53ca3c6267c4cdf`. GitHub Actions [40244989517](https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40244989517) SUCCESS on tests commit. Local Node 22 synthetic tests 8/8 PASS and standalone TypeScript contract check PASS; GitHub CI separately validates repository build/typecheck.

The deterministic, **read-only** adapter reconciles expected Buffer post ID/channel, `sent` status with timestamp, separately supplied full-decode/editorial-approval evidence per source SHA256, asset counts/dimensions and source-vs-provider MIME, provider measurement freshness, and explicit TikTok/Instagram AI-label contradictions. Missing measurements remain NULL, not zero; `scheduled` is never `SENT`; reported source/provider MIME mismatch is a warning, **not** proof of failed publication. Output always retains `providerMediaBytesVerified=false` and `attribution=provider_observation_only`; no lead, conversion or revenue inference. Trusted approval/source adapters and live publisher integration are still REQUIRED.

Fresh read-only Buffer `get_post(includeMetrics=true)` reconfirmed 25 Oct 21:00 MYT BROS SELL Facebook/Instagram/TikTok posts `sent`. Facebook: 1 impression, 0 clicks; Instagram: 5 views, 3 reach; TikTok: 53 views, 1 reaction. All provider metric timestamps remained on 25 Oct UTC at inspection; **not new acquisition outcome**. FB/IG provider MIME JPEG versus previously full-decoded PNG source persists, and TikTok caption AI disclosure vs `isAiGenerated=false` persists. No historical post edited.

Neon read-only checkpoint: one Auth user, zero verified, two active memberships. Owner OTP/provider JWT and authenticated hosted negative tests remain blocked; DEMAND real experiment, BCI live shared audit and HitPay live/test/settlement/entitlement gates remain open. **INTERNAL V1 NOT COMPLETE.** No production, provider writes, Meta spend, price, permissions, publishing, hourly automation or BROS LABS changes.


## BCI_CONTENT_OBSERVATIONAL_LEARNING_20261026 — CONTENT scoped observational measurement projection (26 Oct 2026)

**Evidence level: implemented Draft PR code + local tests + GitHub CI; NOT a live publisher adapter, actual lead acquisition, or INTERNAL V1 completion.** Added `lib/content/content-observational-learning.ts` (commit `97cefc6e02a91add0f457539ee80b19b29fd4a09`) and `tests/content-observational-learning.test.mjs` (commit `dd573578050930aeb7a8f6630b3cee62bb6ec6da`) to Draft PR #10. Local Node 22 synthetic tests **10/10 PASS**, standalone strict TypeScript **PASS**; GitHub Actions run [40249789528](https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40249789528) **SUCCESS** on exact tests commit (repository checks). Code/readback verified in GitHub.

Read-only projection consumes independently authorized `reconcileBufferPublication` output and preserves tenant/content scope, Buffer post ID/channel, source SHA256, SENT timestamp, provider metrics timestamp, per-channel raw metric names and decimal values (e.g. `engagementRate: 1.89`), and a stable `tenant:content:buffer:post:metricsUpdatedAt` idempotency key. Rejects conflicting same-key replay, cross-product/invalid tenant, inconsistent channel, non-SENT, absent full decode/approval/metrics, AI disclosure mismatch, malformed/future/preceding timestamps, invalid metric values, and unsupported source hashes. Retains zero distinct from missing and never sums across channels. Emits `verification=provider_reported`, `causalEffect=null`, `qualifiedLeads=null`, `attributedSales=null`, and `nextBestAction=collect_qualified_visit_evidence`. No database/provider writes or publication.

**Actual provider read-only check, 26 Oct ~08:30 MYT:** Buffer organization `My Organization` still reports 25 Oct 21:00 MYT BROS SELL posts as SENT. Facebook 1 impression/0 clicks; Instagram 5 views/3 reach; TikTok 53 views/1 reaction. Provider analytics include fractional engagement/watch-time values, motivating the decimal-preserving contract. FB/IG source PNG vs Buffer JPEG metadata and TikTok AI flag contradiction remain separately flagged; this new projection was NOT executed on a trusted end-to-end source/approval adapter or persisted into Neon. No qualified visit, lead, order or conversion linkage inferred.

**Fresh Neon dev read-only:** Auth 1, verified 0, active memberships CONTENT 1 / DEMAND 1; restricted membership/evidence roles both have credentials. Actual provider JWT and hosted authenticated negative matrix remain unverified. DEMAND real experiment, BCI live shared audit, CONTENT approval→publisher→learning integration and HitPay live/test/settlement/entitlement gate remain open. No Production, Meta spend/write, publishing, pricing, permission, schedule or BROS LABS change.


## BCI_PREVIEW_HTTP_TARGET_GUARD_20261026 — direct-handler Preview target and impersonation guard (26 Oct 2026)

**Evidence level: DRAFT PR CODE + GITHUB CI SUCCESS; NOT HOSTED AUTHENTICATED E2E.** Hardened actual `createNeonPreviewHandler` (not the unused generic HTTP factory) to reject a request target other than `/api/internal/neon-evidence` and explicitly reject spoofed `x-admin`, `x-role`, `x-product`, and `x-operator-id` headers in addition to existing principal/tenant override headers. These checks execute before JWKS, membership or database access. Tests cover direct-handler wrong paths/encoded lookalikes and additional role/identity header injection. No new authorization grant or provider write.

Code commit `962616d4308b6742b3211c91e8d70cddeaadaa41`; test commit `b144a21dfb9ea61139fb23a9f59fe8b56c46ab3b`. Readback confirmed both files; GitHub Actions dry-run-safety [#40253970804](https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40253970804) completed SUCCESS on test commit. This proves repository checks and synthetic negative tests, not a genuine Neon Auth provider JWT or hosted cross-tenant negative matrix.


**Hosted deployment comparison:** Vercel read-only get_deployment for the protected Preview URL returned READY on older commit `2eca48789e688b02acc4b21fc9963c89f36f3169`, not this guard's test commit `b144a21dfb9ea61139fb23a9f59fe8b56c46ab3b`. Thus the new route/header guard is **CI-verified source only, not verified deployed**. No deployment was initiated.

Fresh Neon read-only: `neon_auth.user` 1 user / 0 emailVerified; `bci_dev.tenant_memberships` 1 active CONTENT + 1 active DEMAND; restricted role passwords present. The Neon connector is pinned to role `BROS`, so this run cannot independently log in as restricted roles through that connector; prior direct-login proof recorded in Issue #11 remains separate. Owner email OTP, authenticated hosted tests, CONTENT provider integration, DEMAND verified experiment, shared BCI live reuse, and HitPay settlement/entitlement remain OPEN. No production, spend, publishing, permission, price, task or BROS LABS changes.


## BCI_CONTENT_PROVIDER_ASSET_BINDING_20261026 — Fail closed when approved source is not bound to Buffer asset (26 Oct 2026)

**Evidence level: Draft PR source + regression tests + GitHub CI SUCCESS; Vercel Preview READY on exact commit, but NOT a live publisher integration or authenticated end-to-end test.** The previous CONTENT reconciliation checked approved SHA256/source decode, asset count, dimensions and MIME, but did not prove that the reviewed image was the Buffer asset: an unrelated image of the same dimensions/MIME could pass. Now `SourceReview.providerAssetSource` must be an independently recorded exact HTTPS Buffer asset.source reference for every reviewed asset. Missing binding => `asset_source_unbound`; substituted/changed reference => `asset_source_mismatch`. Both block `readyForObservationalLearning`. Malformed/non-HTTPS/credential-bearing/fragment references fail closed. MIME-only discrepancy remains a non-blocking warning. This URL binding is NOT cryptographic attestation of bytes served by social platforms, and must be populated from a trusted approved publisher/QA record; no invented binding was applied to historic posts.

Source commit `b59a6b7b5d010a8c906876911fb02b2fb56aae8e`; regression tests commit `2d71856da491d68ecc2e521ffdf1604bf9f6f648`. GitHub Actions [40259598931](https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40259598931) **SUCCESS** (test step, TypeScript and Next.js build). Vercel Preview deployment `dpl_5FuWwyu61RuB9waML4RLMGoX141m` **READY** on the exact tests commit, not Production. Neither CI nor READY proves provider-authenticated HTTP access.

**Fresh Buffer read-only:** 26 Oct 2026 09:02 MYT BROS SELL Instagram post `6adca7ad0b5343d0708289d1` is provider-reported SENT with two assets; `metrics=null` despite `metricsUpdatedAt` being present, so no views, leads or learning metrics may be invented. Its `isAiGenerated=true` metadata aligns with the caption. Prior 25 Oct posts remain separate provider observations. HitPay `list_charges` for 25–26 Oct returned no new charges (not a global historical sales statement). Neon dev still 1 Auth user / 0 email verified / 2 active memberships.

**Still open:** approved source-to-provider binding in actual publisher records, trusted live CONTENT ingestion and learning persistence, operator OTP/provider JWT + hosted negative matrix, DEMAND verified experiment, BCI auditable live reuse, HitPay environment/product/settlement/entitlement linkage. No Production, Meta spend, publishing, pricing, new access, schedule or BROS LABS changes.


## BCI_DEMAND_EQUAL_WINDOW_GUARD_20261026 — Reject unequal acquisition observation windows (26 Oct 2026)

**Evidence level: Draft PR code + regression test + GitHub CI SUCCESS; NOT a live DEMAND experiment.** `reviewDemandExperiment` now rejects baseline and outcome windows of unequal elapsed duration before calculating raw lead/order count deltas. Without this guard, a longer observation window could falsely appear to improve acquisition even with unchanged daily performance. No time-normalization or causal attribution is inferred. The previous equal-duration comparison remains observational only, with `causalLift=null` and `cpaMinor=null`.

Source commit `97d07cec83130e947b1a8f1274ef3eaca94ef8f0`; regression test commit `b4de49e3adf51f26fc710d8ae72fccda6f1fe37b`. Readback verified source and test blobs. GitHub Actions [40263779815](https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40263779815) **SUCCESS** on the exact test commit; workflow runs Node 22 `tests/*.test.mjs`, TypeScript type-check and Next.js build. This is not a real provider outcome, live API, or independently attested acquisition effect.

Fresh Neon dev read-only: one Auth user, zero email-verified users, one active CONTENT membership and one active DEMAND membership. Restricted role direct login could not be retested through the Neon connector because it is pinned to `BROS`; prior direct-login proof remains historical. Real operator OTP/JWT, hosted authenticated negative access matrix, live CONTENT provider/approval integration, one DEMAND verified experiment, shared BCI live audit and HitPay environment/product/settlement/entitlement remain OPEN. Protected Preview at latest exact commit was not verified for this new change. No Production, Meta spend/writes, publishing, pricing, new access, automation or BROS LABS change.


## BCI_METRIC_FRESHNESS_AND_WINDOW_DATE_20261026 — CONTENT post-metric freshness and shared BCI calendar validity (26 Oct 2026)

**Evidence level: Draft PR #10 code + GitHub CI SUCCESS + exact-commit protected Vercel Preview READY; NOT live publisher ingestion or authenticated operator end-to-end.** A CONTENT Buffer post may be SENT while `metricsUpdatedAt` still reflects its pre-publication draft timestamp. `reconcileBufferPublication` now emits `metrics_timestamp_before_sent` and blocks observational-learning readiness if numerical metrics are attached to a snapshot older than `sentAt`. Missing metrics remain NULL and already block learning. Separately, the shared BCI `summarizeGrowthEvidence` rejects calendar-invalid UTC scope timestamps (such as 31 February or 24:00 rollover) rather than accepting JavaScript's normalized dates. These changes do not add provider writes, customer access or sales attribution.

**GitHub verification:** atomic four-file commit `116c55afae8569ff368f2cd067aa9c21df529de4` (CONTENT and BCI source plus regression tests); Actions [40269013439](https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40269013439) **SUCCESS** (dry-run safety, Node tests, TypeScript and Next.js build). Protected Vercel Preview deployment `dpl_J7WCUBWiJ8Qs8AYgaKzMLYbfqkJ1` is **READY on exact commit**; this is deployment/build status, NOT proof of authenticated API operation. An attempted Vercel protected Preview fetch returned 401 `deployment_authentication_required` after share-link redirect, so no hosted HTTP negative matrix was claimed.

**Read-only provider checks:** Buffer Instagram BROS SELL post `6adca7ad0b5343d0708289d1` was provider-reported SENT on 26 Oct 09:02 MYT with two image assets and `metrics=null`. Its `metricsUpdatedAt=2026-10-24T12:42:21.316Z` predates `sentAt=2026-10-26T01:02:51.262Z`; this post already fails learning due to missing metrics, not due to the new numerical-metric guard. HitPay `list_charges` for 25–26 Oct returned zero records (not a historical sales conclusion). Neon dev read-only SQL: 1 Auth user, 0 email verified, 1 active CONTENT and 1 active DEMAND membership. No restricted-role direct login was retested through the pinned Neon connector.

**OPEN gates:** genuine operator OTP/JWT and hosted negative cross-tenant/product tests, trusted CONTENT approval→publisher→SENT→measurement→BCI learning integration, one DEMAND verified acquisition experiment, BCI live audit reuse, HitPay live/test product/settlement/entitlement reconciliation. No Production, Meta spend/writes, publishing mutation, price/permissions, automation schedule or BROS LABS change.

## BCI_NEON_SDK_TOKEN_CACHE_FIX_20261026 — verified owner, fresh token retrieval

Neon read-only SQL now confirms the approved owner's email is verified, with
three unexpired provider sessions and two active product memberships. The owner
uses another browser/device; its cookie session is not available in the agent's
Edge tab. The owner reported the older Preview's generic protected-access error.

An actual installed-SDK reproduction found the concrete pre-request defect:
`@neondatabase/auth@0.7.0-beta` maps both `/get-session` and `/token` to the same
session-cache hook. After `getSession()` populates the cache, plain `token()`
returns `{session,user}` without a token or a `/token` network request. The page
then fails before calling the protected API.

The client now uses `requestNeonPreviewToken`, which invokes the SDK's supported
force-fetch hook to obtain a fresh provider token. The SDK strips its local
control header before the provider request. Cross-origin cookies are explicitly
included. Missing/malformed/oversized responses and returned/thrown errors fail
closed without revealing provider details; server signature, verified-operator,
membership, database and redirect checks remain unchanged.

Local verification: **158/158 tests PASS**, including three installed-SDK
regressions after dependency installation; TypeScript PASS and Next.js build
PASS. The regression uses a synthetic transport and synthetic session/token,
not the owner's secrets or a provider-authenticated success. Public provider
health/OpenAPI/JWKS checks passed; unauthenticated `/token` returned 401.

Use the stable protected branch Preview for the owner's next check:
https://bros-commercial-intelligence-git-4a0d3f-bolehejassolutions-8492.vercel.app/internal/neon-preview
Its origin is already trusted by the development Auth service. Exact deployment,
CI and owner test results are recorded in Issue #11 and the canonical decision
Doc after publication of this development commit. Keep Issue #11 OPEN and PR #10
DRAFT until genuine provider JWT → membership → evidence HTTP success and the
remaining authenticated tests are verified. No Production, new spend, publishing,
admin/customer access, credential rotation, automation or BROS LABS changes.

## BCI_HITPAY_CROSS_STATUS_GUARD_20261026 — reject test/unverified paid-order promotion to settled revenue (26 Oct 2026)

**Evidence level: Draft PR #10 code + regression test + GitHub CI SUCCESS; NOT live HitPay settlement/entitlement proof.** Shared BCI `summarizeGrowthEvidence` previously permitted a verified live `settled_order` row to be counted even when the *same provider order ID* was also supplied as a test/unknown/unverified `paid_order`. That contradictory cross-status provenance could overstate settled orders/revenue. Now a verified live settlement is rejected if a matching paid-order record is not also live and verified; paid-live plus settlement-unverified remains paid-only (no settlement). This conservative check does not claim payout linkage from a reference string alone.

Source commit `17a0294cd36f00f8003c123eb3b438dc573386c2`; regression test commit `0b3dbc8765508f11b36bdd239f5f87a14a8bb78d`; source and test blobs read back. [GitHub Actions 40279407128](https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40279407128) **SUCCESS** on the test commit (workflow checks). No live provider ingest, Production deployment or acquisition outcome was established.

Fresh read-only Neon DEV SQL: 1 Auth user, 1 email-verified user, 1 active CONTENT membership, 1 active DEMAND membership. HitPay read-only charges 25–26 Oct: empty page with `has_more=false` (no charges in that date-filtered response, not a historical sales conclusion). Actual Neon provider JWT → authenticated CONTENT/DEMAND reads and hosted negative cross-tenant/product matrix remain OPEN; official Neon examples do not guarantee an `emailVerified` JWT claim, so verifier compatibility requires real signed-provider-token validation without weakening checks. CONTENT approval→SENT→measurement, DEMAND verified experiment, BCI live reuse and HitPay environment/order/payout/entitlement linkage remain OPEN. No Meta spend/write, publishing, Production, price, permissions, automation schedule or BROS LABS changes.

## BCI_PREVIEW_AUTHENTICATED_CONTROLS_20261026 — signed-in positive controls before denial probes (26 Oct 2026)

**Evidence level: Draft PR #10 code + local isolated Node 22 test 5/5 + exact-commit GitHub CI SUCCESS; NOT newly owner-executed hosted probes or cross-tenant DB proof.** Previous 7/7 HTTP denial results could appear successful without checking that the bearer was valid for both products. The browser runner now requires two actual authenticated, no-store private API GET responses (CONTENT and DEMAND, limit=1, HTTP 200, internal-development scope, bounded evidence array) before executing its seven read-only rejection probes. Failure in either control aborts the negative matrix and returns a generic message; tokens, evidence bodies and principal identifiers are never persisted. UI distinguishes authenticated controls from rejection checks. This does not establish revoked membership, independent session logs, RLS tenant isolation or customer readiness.

Source commit `f0cb9795938933c45576f2cc015002782936b071`; regression tests `e3ad913f6a6c1ef4d07ea2b72f378d0843da10fc`; UI commit `510846163fb5659d610cccceff0bb051a25a50ff`. GitHub Actions [40302202013](https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40302202013) **SUCCESS** on exact UI/head commit. Local isolated Node 22 control/denial tests 5/5 PASS. New owner-session 2/2 + 7/7 and authenticated cross-tenant/product denial tests remain UNVERIFIED; historical owner 7/7 display was under the previous implementation and must not be reused as proof of this change.

Read-only Neon DEV admin-catalog inspection: `bros_intelligence_dev`, 2 active memberships, 3 manual development evidence rows. `bci_dev_membership_reader` has SELECT memberships but not evidence; `bci_dev_private_reader` has SELECT evidence but not memberships; both LOGIN, NOBYPASSRLS, non-superuser, no role/database creation or evidence INSERT. Admin inspection is not a new restricted direct-login test. Shared BCI audit reuse, CONTENT media QA→SENT→measurement, DEMAND real experiment and HitPay live/test settlement/entitlement gates remain OPEN. PR stays Draft, Issue #11 OPEN. No Production, Meta spend/write, publishing, new credentials/access, price, schedule, paid Neon or BROS LABS changes.

## BCI_PREVIEW_DENIAL_ENVELOPE_GUARD_20261026 — strict authenticated Preview denial evidence (26 Oct 2026)

**VERIFIED Draft PR code + regression tests + GitHub CI SUCCESS; NOT new owner-authenticated hosted negative results or cross-tenant DB proof.** Existing seven rejection probes could previously mark expected HTTP status plus privacy headers as PASS even when an error body included unrecognized fields or leaked data. The browser-side runner now requires a bounded exact generic denial JSON envelope (including the distinct 405 message); 2/2 positive controls also reject cross-product evidence rows instead of trusting only HTTP 200 and a bounded array. This strengthens the meaning of a future 2/2+7/7 result without changing server access policy, tenant membership or the publisher.

Source commit `0710a0c6578d807e17f96f2441b953df3ee3dff2`; regression test commit `654b70ffe9d706a74d4ce8007af90ea044578958`; GitHub Actions [40309152913](https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40309152913) SUCCESS. Source/test blob readback matched. No claim of a newly run owner-session probe.

Fresh Neon DEV admin catalog: both restricted LOGIN roles are non-superuser, NOBYPASSRLS, NOCREATEROLE, NOCREATEDB, NOREPLICATION, NOINHERIT. Membership role SELECTs memberships only; evidence role SELECTs evidence only. Both lack UPDATE/DELETE/TRUNCATE on either table. **Direct role_name login via current Neon connector was rejected** because connector is pinned to BROS; this catalog inspection does not replace historical direct-login evidence or current hosted negative tests. Neon Auth integration remains Better Auth on the DEV branch.

Still OPEN: owner-session new 2/2+7/7, independent cross-tenant/product/revocation/admin impersonation tests, BCI provider audit reuse, CONTENT and DEMAND gates, and HitPay entitlement/settlement. Issue #11 OPEN; PR #10 DRAFT. No Production, new credentials/permissions, paid plan, spend, publishing, pricing, schedule or BROS LABS change.


## BCI_NEON_EMPTY_TENANT_ISOLATION_SMOKE_20261026 — authenticated empty-tenant negative smoke prepared (26 Oct 2026)

**Status: VERIFIED DEV PROVIDER COUNTS + DRAFT PR CODE/CI + EXACT-COMMIT PROTECTED PREVIEW READY; NOT OWNER-EXECUTED AUTHENTICATED NEGATIVE RESULT.** A read-only Neon DEV aggregate confirmed that the active operator membership tenant has **0 CONTENT and 0 DEMAND evidence rows**, while separate synthetic tenants have **1 CONTENT and 2 DEMAND rows**. No tenant IDs, principal IDs, tokens or provider secrets were copied into this checkpoint.

Draft PR #10 now exposes an opt-in **Check empty-tenant isolation (DEV)** control. Using the owner's existing signed provider token, it makes two read-only private API requests (`product=content` and `product=demand`, `limit=50`); each must return HTTP 200, no-store/Vary Authorization, and exactly the internal-development envelope with an **empty evidence array**. Any returned row, extra field, wrong scope, HTTP failure or network error fails the smoke. The runner returns only pass counts, not response bodies, tenant IDs or credentials. This test is meaningful only while the operator's internal tenant is known empty; it cannot replace populated same-tenant evidence validation, revoked membership, admin impersonation, direct restricted LOGIN, or independent hosted negative E2E proof.

Code/test/UI commits: `2460c7ecf3fc2a2d1bd55751a817c7f04ed4a52b`, `2d2f17ed059f345e481924a619ff8428dbaae4a1`, `438403647f413daf05419606aad266c326417b52`. Three new offline regression tests cover authenticated product scope, foreign-row/extra-field denial, and invalid bearer; [GitHub Actions 40324288662](https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40324288662) **SUCCESS** (Node safety tests, TypeScript, Next.js build). Exact protected Vercel Preview deployment `dpl_7MYPAyfboztN2k49HHaxHRLKmD6K` **READY** on UI commit, stable alias retained. Source/tests/UI and deployment SHA were read back. **No actual owner-session click or authenticated negative result is claimed.**

Issue #11 remains OPEN, PR #10 DRAFT. Full authenticated negative tenant/product/revocation/admin-impersonation matrix, BCI live provider audit reuse, CONTENT/DEMAND outcomes and HitPay entitlement/settlement gates remain OPEN. No Production, database migration, permissions, credentials, paid Neon, Meta spend/write, Buffer publishing, price, schedule or BROS LABS change.


## BCI_NEON_POSITIVE_ENVELOPE_STRICT_20261026 — authenticated positive response fail-closed QA (26 Oct 2026)

**Evidence class: Draft PR #10 source + regression + GitHub CI SUCCESS; NOT a newly executed owner-authenticated Preview test.** The browser-side 2/2 authenticated positive controls previously accepted HTTP 200/no-store with unexpected top-level fields, unreviewed evidence-row fields, malformed UUIDs or nonnumeric metrics. The same exact-envelope validation now guards both 2/2 positive controls and the 2/2 empty-tenant smoke. Valid nonempty product-scoped rows remain supported; no principal, JWT, provider body, tenant UUID or credentials are logged.

Source commit `aa4b0a5a671341553db3f1526de8b44a49b16de1`; regression commit `2d4e8c03a0c7e87143f8a4095950e0c1afa2c5b1`. Source/test blob readback verified. GitHub Actions [40325410765](https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40325410765) **SUCCESS** (dry-run tests, TypeScript and Next.js build). No protected Preview deployment or owner-session negative run is claimed from this CI.

Fresh Neon DEV read-only: 2 active memberships, 3 synthetic/manual evidence rows, 0 evidence rows in active operator tenant. Both restricted LOGIN roles are non-superuser/NOBYPASSRLS and have disjoint SELECT-only table grants; no write privileges observed. This is admin-catalog observation, NOT a direct restricted login or authenticated cross-tenant HTTP result.

Still OPEN: owner-session 2/2+7/7 and 2/2 empty-tenant smoke on exact new Preview, independent negative tenant/product/revocation/admin impersonation matrix, BCI live provider audit reuse, CONTENT/DEMAND actual outcome gates and HitPay settlement/entitlement. Issue #11 OPEN, PR #10 DRAFT; no Production, credentials/permissions, paid Neon, Meta spend/write, Buffer publishing, pricing, task schedule or BROS LABS changes.
