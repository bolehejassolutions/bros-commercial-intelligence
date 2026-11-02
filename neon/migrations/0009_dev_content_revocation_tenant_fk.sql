-- BCI_CONTENT_REVOCATION_TENANT_FK_DEV_20261030_V1
-- DEV ONLY: empty-tooth-43040036 / br-broad-math-b3f4d2r4 / bros_intelligence_dev.
-- Apply AFTER migration 0008, ONCE, in one bounded transaction.
-- Existing lineage DDL must NOT be replayed; no Production apply.
-- The old revocations FK on approval_id alone does not enforce tenant/product.
-- Do not DROP old constraints, grant roles, create policies or mutate rows.
-- Preconditions: three dispatch tables exist; new constraints absent; approvals,
-- revocations and reservations have no rows at first DEV application.
-- @@STEP
ALTER TABLE bci_dev.content_dispatch_approvals
  ADD CONSTRAINT content_dispatch_approvals_id_tenant_product_key
  UNIQUE (approval_id, tenant_id, product);
-- @@STEP
ALTER TABLE bci_dev.content_dispatch_revocations
  ADD CONSTRAINT content_dispatch_revocations_approval_tenant_product_fkey
  FOREIGN KEY (approval_id, tenant_id, product)
  REFERENCES bci_dev.content_dispatch_approvals (approval_id, tenant_id, product)
  ON DELETE RESTRICT;
-- Postcondition: mismatched tenant/product revocation is rejected by PostgreSQL
-- (23503), not merely by a future application-level query.
-- Existing approval_id FK, FORCE RLS, append-only triggers, privileges unchanged.
-- This is schema integrity only; not trusted approval issuance or authorization.
-- Rollback if independently verified safe: DROP only these two new constraints,
-- reverse order, in a separate reviewed DEV transaction; never delete data.
