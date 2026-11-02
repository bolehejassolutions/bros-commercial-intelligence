-- BCI_ONE_ACTIVE_MEMBERSHIP_PER_PRODUCT_DRAFT_20261027_V1
-- DESIGN ONLY. NOT a migration. DO NOT EXECUTE without separate owner approval.
-- Neon DEV only: empty-tooth-43040036 / br-broad-math-b3f4d2r4 /
-- bros_intelligence_dev. Never apply to Production or managed neon_auth.
-- The existing (principal_id, tenant_id, product) primary key permits the same
-- principal to hold multiple ACTIVE memberships for one product in different
-- tenants. Application code rejects such ambiguity but DB currently allows it.
-- This index would prevent NEW ambiguities while allowing historical revoked
-- rows and one active tenant for each separately authorized product.
--
-- PROVIDER-BACKED READ-ONLY PRECHECK (2026-10-27, BROS owner role):
--   2 active unrevoked memberships, CONTENT 1, DEMAND 1;
--   0 ambiguous active (principal_id, product) pairs.
--   Primary key is the only currently deployed membership index.
--   This catalog/precheck cannot establish restricted-login or HTTP security.
--
-- REVIEW GATE BEFORE DEV APPLY:
--  1. Obtain explicit owner approval for Neon DEV schema mutation.
--  2. Confirm correct project, branch and database; inspect existing indexes.
--  3. Capture a recoverable DEV backup/restore point; verify recovery procedure.
--  4. Confirm no approved workflow currently relies on >1 active tenant/product.
--  5. Execute in one DEV transaction during a quiet window; bounded locks.
--  6. Independently verify pg_indexes, row counts, expected writer behavior,
--     restricted direct LOGIN and no new permissions.
--  7. Separate owner approval required for rollback (DROP INDEX); do not
--     automatically revert or edit customer data.
--
-- CANDIDATE TRANSACTION (unapplied):
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';
LOCK TABLE bci_dev.tenant_memberships IN SHARE MODE;
DO $bci_membership_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM bci_dev.tenant_memberships
    WHERE active IS TRUE AND revoked_at IS NULL
    GROUP BY principal_id, product
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Ambiguous active BCI product membership; abort'
      USING ERRCODE = '23505';
  END IF;
END;
$bci_membership_preflight$;
CREATE UNIQUE INDEX bci_membership_one_active_tenant_per_product_idx
  ON bci_dev.tenant_memberships (principal_id, product)
  WHERE active IS TRUE AND revoked_at IS NULL;
COMMIT;
--
-- INTENTIONALLY EXCLUDED: REVOKE/GRANT, new roles, changes to managed
-- neon_auth, application bypass of JWT checks, tenant assignment changes,
-- member deletion, Production deployment, and provider writes.
--
-- NOT CLAIMED: applied migration, authenticated restricted-role behavior,
-- Neon Auth session revocation, or verified BCI INTERNAL V1.
