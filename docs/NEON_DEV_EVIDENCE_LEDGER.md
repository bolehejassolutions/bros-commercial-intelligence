# Neon BCI development ledger — internal-only prototype

**Status:** schema deployed to **development Neon only**, not connected to Vercel or customer applications. **No live providers, public APIs, spending permissions or customer records.**  
**Date:** 2026-10-25 (MYT).  
**Authoritative product boundary:** [BROS shared intelligence contract](./PORTFOLIO_SHARED_INTELLIGENCE_CONTRACT.md) and [Primary Google Drive portfolio decision](https://docs.google.com/document/d/1AmnN8agBGkMNCVMzQ6esJ1neWtKVuvqBa-F_j3U7rGM/edit).

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

## Next safe steps (not executed)

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
