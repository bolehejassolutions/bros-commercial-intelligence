-- BCI_CONTENT_APPROVAL_SINGLE_INTENT_DEV_20261030_V1
-- DEV only: empty-tooth-43040036 / br-broad-math-b3f4d2r4 / bros_intelligence_dev.
-- Approval issuance is not yet authenticated; this prevents multiple immutable
-- approvals from claiming the same tenant/product/dispatch intent.
-- This is NOT proof of a human approval, JWT auth, or provider publication.
-- Apply once only after verifying table empty and index absent; no Production.
-- @@STEP
DO $$
BEGIN
  IF current_database() <> 'bros_intelligence_dev' THEN
    RAISE EXCEPTION 'BCI DEV-only migration refused';
  END IF;
  IF (SELECT count(*) FROM bci_dev.content_dispatch_approvals) <> 0 THEN
    RAISE EXCEPTION 'BCI approval table must be empty for this migration';
  END IF;
  IF to_regclass('bci_dev.bci_content_approval_one_intent_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'BCI approval intent index already exists; do not replay';
  END IF;
END;
$$;
-- @@STEP
CREATE UNIQUE INDEX bci_content_approval_one_intent_idx
  ON bci_dev.content_dispatch_approvals (tenant_id, product, dispatch_intent_id);
-- @@STEP
COMMENT ON INDEX bci_dev.bci_content_approval_one_intent_idx IS
  'BCI DEV only: at most one immutable approval claim per tenant/product/dispatch intent; does not attest human issuance.';
-- Postconditions: UNIQUE/VALID/READY; duplicate intent INSERT rejected with
-- exact index name; no approval rows remain after rollback-only probe.
-- Rollback (DEV only, after verifying no consumers): DROP INDEX bci_dev.bci_content_approval_one_intent_idx;
