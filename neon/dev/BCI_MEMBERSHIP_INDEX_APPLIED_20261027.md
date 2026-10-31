# BCI DEV membership one-active-tenant index — applied and verified

**Checkpoint:** `BCI_NEON_DEV_MEMBERSHIP_INDEX_APPLIED_20261027_V1`
**Date:** 2026-10-27 (MYT)
**Authority:** Owner's explicit in-chat approval, “Approve Neon DEV membership index”.
**Environment:** **Neon DEV only** — project `empty-tooth-43040036` (`bros-shared-intelligence-dev`), branch `br-broad-math-b3f4d2r4` (`main`), database `bros_intelligence_dev`. This is NOT Production.

## Purpose and scope

Protect `bci_dev.tenant_memberships` from ambiguous concurrent active grants for the same `principal_id` and `product`, even when distinct `tenant_id` values would be allowed by the existing composite primary key. Historical revoked/inactive memberships remain permitted. No owner/customer membership was reassigned, deleted or created.

Approved reference design: `neon/design/BCI_ONE_ACTIVE_MEMBERSHIP_PER_PRODUCT_DRAFT_20261027.sql`; this remains a **design reference only**, not an auto-applied migration file. The actual transaction additionally checked the current database, connected role, RLS posture and index absence inside the lock.

## Pre-apply verification

Read-only PostgreSQL preflight on the explicitly specified project + branch + database:
- current database `bros_intelligence_dev`, connected role `BROS`;
- 2 membership rows; 2 active and unrevoked; **0 ambiguous active (principal_id, product) pairs**;
- only preexisting index `tenant_memberships_pkey (principal_id, tenant_id, product)`;
- RLS enabled + forced; 1 existing policy; no unexpected product values;
- target partial unique index absent.

## Snapshot before change

Created isolated copy-on-write child branch `backup-before-bci-membership-index-20261027`, ID `br-hidden-darkness-b3qbacga`, parent `br-broad-math-b3f4d2r4`, parent LSN `0/25D0D80`, parent snapshot timestamp `2026-10-27T15:32:13Z`. Independent Neon branch readback returned `ready`. It was created with `no_compute=true`; verified compute time 0. **Do not restore, delete or retarget this branch automatically**; a rollback/restoration decision requires separate owner approval. No restore drill has been performed.

## Execution (applied once)

Neon `run_sql_transaction` on DEV branch with a single atomic transaction:
1. `SET LOCAL lock_timeout = '5s'`
2. `SET LOCAL statement_timeout = '20s'`
3. `LOCK TABLE bci_dev.tenant_memberships IN SHARE MODE`
4. A `DO` preflight that aborts if the database or role differs, table RLS/ FORCE RLS is not enabled, candidate index exists, or multiple active unrevoked memberships exist for the same principal and product.
5. `CREATE UNIQUE INDEX bci_membership_one_active_tenant_per_product_idx ON bci_dev.tenant_memberships (principal_id, product) WHERE active IS TRUE AND revoked_at IS NULL`

Transaction returned success with empty result sets, and subsequent **independent PostgreSQL catalog readback** verified the commit.

## Post-apply verification

- `pg_index.indisunique=true`, `indisvalid=true`, `indisready=true`.
- `pg_get_indexdef`: `CREATE UNIQUE INDEX bci_membership_one_active_tenant_per_product_idx ON bci_dev.tenant_memberships USING btree (principal_id, product) WHERE ((active IS TRUE) AND (revoked_at IS NULL))`.
- Two membership rows remain, both active and unrevoked; 0 ambiguous active pairs.
- `bci_dev.tenant_memberships` RLS and FORCE RLS still true; 1 policy remains.
- Restricted `bci_dev_membership_reader` still has only `SELECT` on `tenant_memberships`; no new role/grant/revoke.
- Existing composite primary-key index remains; exactly one new partial unique index was added.
- Pre-change backup branch still `ready` with original parent LSN; no compute.

## Boundaries and remaining gates

This is a **real DEV database schema change**, not a simulation; it provides PostgreSQL-enforced uniqueness for future active memberships. The catalog verification does not itself constitute a deliberately failing duplicate INSERT under a restricted connection, a live revoked-session test, or fully atomic revocation across the membership and evidence DB transactions. Those acceptance checks remain open.

BCI/Neon INTERNAL V1 remains **OPEN** (authenticated restricted-role tenant/product/revocation/admin denial matrix, durable eight-stage provider-backed lineage), as do CONTENT and DEMAND acceptance gates. No Production/Preview deploy, branch merge, managed `neon_auth` mutation, permissions/customer grant, provider publishing, Meta spend, pricing or task schedule changes.

**Do not re-run the CREATE INDEX as an idempotent background task.** Before any further schema change, re-check actual catalog state and obtain fresh owner approval.
