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
