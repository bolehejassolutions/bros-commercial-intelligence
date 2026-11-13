-- BCI_CONTENT_APPROVAL_REVIEWER_MEMBERSHIP_FK_DEV_20261030_V1
-- DEV ONLY: empty-tooth-43040036 / br-broad-math-b3f4d2r4 / bros_intelligence_dev.
-- Preserve the existing single-active-tenant and approval-per-intent constraints.
-- This FK proves a recorded reviewer has a membership row in the exact tenant
-- and CONTENT product. It does NOT prove active membership, human presence,
-- Neon Auth email verification, a signed editorial review or original media QA.
-- Those remain server-side trusted-issuance and authenticated E2E gates.
-- No new roles, grants, secrets, triggers, app routes, provider writes or Production.
-- Apply once, only with an empty approvals table and absent constraint.
-- @@STEP
DO $$
BEGIN
  IF current_database() <> 'bros_intelligence_dev' THEN
    RAISE EXCEPTION 'BCI DEV-only reviewer membership migration refused';
  END IF;
  IF (SELECT count(*) FROM bci_dev.content_dispatch_approvals) <> 0 THEN
    RAISE EXCEPTION 'BCI reviewer FK requires empty approval table';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='bci_dev.content_dispatch_approvals'::regclass
      AND conname='bci_content_approval_reviewer_membership_fk'
  ) THEN
    RAISE EXCEPTION 'BCI reviewer FK already exists; do not replay';
  END IF;
END;
$$;
-- @@STEP
ALTER TABLE bci_dev.content_dispatch_approvals
  ADD CONSTRAINT bci_content_approval_reviewer_membership_fk
  FOREIGN KEY (approved_by, tenant_id, product)
  REFERENCES bci_dev.tenant_memberships (principal_id, tenant_id, product)
  ON UPDATE RESTRICT ON DELETE RESTRICT;
-- @@STEP
COMMENT ON CONSTRAINT bci_content_approval_reviewer_membership_fk
  ON bci_dev.content_dispatch_approvals IS
  'BCI DEV: reviewer identity must have same-tenant CONTENT membership row; does NOT attest active membership, verified human decision or signed review.';
-- Postconditions: FK validated; wrong reviewer/tenant rejected with SQLSTATE 23503.
-- Rollback DEV only, after verifying no approval consumers:
-- ALTER TABLE bci_dev.content_dispatch_approvals
--   DROP CONSTRAINT bci_content_approval_reviewer_membership_fk;
