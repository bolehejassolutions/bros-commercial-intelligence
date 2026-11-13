-- BCI_CONTENT_REVOKED_REVIEWER_ISSUANCE_FAILCLOSE_DEV_20261030_V1
-- DEV ONLY: empty-tooth-43040036 / br-broad-math-b3f4d2r4 / bros_intelligence_dev.
-- Versioned defense in depth after 0012. Prevent a durable approval claim
-- referencing an existing but revoked CONTENT reviewer membership.
-- This does NOT authenticate the human, attest a signed review, or authorize publication.
-- SECURITY INVOKER, no new roles/grants; a future restricted issuer must have
-- explicit membership read rights or fail closed. No Production.
-- @@STEP
DO $$
BEGIN
  IF current_database() <> 'bros_intelligence_dev'
    OR (SELECT count(*) FROM bci_dev.content_dispatch_approvals) <> 0
    OR NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid='bci_dev.content_dispatch_approvals'::regclass
        AND conname='bci_content_approval_reviewer_membership_fk'
        AND contype='f' AND convalidated
    )
    OR to_regprocedure('bci_dev.require_active_content_approval_reviewer()') IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid='bci_dev.content_dispatch_approvals'::regclass
        AND tgname='content_approval_reviewer_active_insert'
    ) THEN
    RAISE EXCEPTION 'BCI DEV reviewer active gate precondition failed; do not replay';
  END IF;
END $$;
-- @@STEP
CREATE FUNCTION bci_dev.require_active_content_approval_reviewer()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog
AS $fn$
BEGIN
  -- Existing revoked reviewer: deny; unknown/cross-tenant reviewer remains
  -- governed by the validated 0012 composite foreign key.
  IF EXISTS (
    SELECT 1 FROM bci_dev.tenant_memberships m
    WHERE m.principal_id=NEW.approved_by
      AND m.tenant_id=NEW.tenant_id
      AND m.product=NEW.product
      AND (m.active IS DISTINCT FROM TRUE OR m.revoked_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'BCI CONTENT approval reviewer is revoked'
      USING ERRCODE='23514', CONSTRAINT='bci_content_approval_active_reviewer';
  END IF;
  RETURN NEW;
END;
$fn$;
-- @@STEP
REVOKE ALL ON FUNCTION bci_dev.require_active_content_approval_reviewer() FROM PUBLIC;
-- @@STEP
CREATE TRIGGER content_approval_reviewer_active_insert
BEFORE INSERT ON bci_dev.content_dispatch_approvals
FOR EACH ROW EXECUTE FUNCTION bci_dev.require_active_content_approval_reviewer();
-- @@STEP
COMMENT ON TRIGGER content_approval_reviewer_active_insert
ON bci_dev.content_dispatch_approvals IS
'DEV-only revoked reviewer rejection; does not attest verified human approval or signed CONTENT media.';
-- @@STEP
DO $$
DECLARE
  p uuid := gen_random_uuid();
  t uuid := gen_random_uuid();
  marker text;
  violated text;
  caught boolean := false;
BEGIN
  IF current_database()<>'bros_intelligence_dev' OR
    (SELECT count(*) FROM bci_dev.content_dispatch_approvals)<>0 THEN
    RAISE EXCEPTION 'BCI DEV probe precondition failed';
  END IF;
  -- Revoked reviewer must be rejected by the new trigger.
  BEGIN
    INSERT INTO bci_dev.tenant_memberships(principal_id,tenant_id,product,active,revoked_at)
    VALUES(p,t,'content',false,clock_timestamp());
    BEGIN
      INSERT INTO bci_dev.content_dispatch_approvals
      (approval_id,tenant_id,product,dispatch_intent_id,approved_by,binding_sha256,approved_at,expires_at)
      VALUES('bci-revoked-reviewer-probe',t,'content','bci-revoked-intent-probe',p,
             repeat('a',64),clock_timestamp(),clock_timestamp()+interval '1 hour');
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;
      IF violated <> 'bci_content_approval_active_reviewer' THEN RAISE; END IF;
      caught := true;
    END;
    IF NOT caught THEN RAISE EXCEPTION 'BCI revoked reviewer accepted'; END IF;
    RAISE EXCEPTION 'BCI_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS marker=MESSAGE_TEXT;
    IF marker <> 'BCI_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM bci_dev.tenant_memberships WHERE principal_id=p)
    OR EXISTS (SELECT 1 FROM bci_dev.content_dispatch_approvals WHERE approval_id='bci-revoked-reviewer-probe')
  THEN RAISE EXCEPTION 'BCI revoked reviewer probe residue'; END IF;
  -- Active reviewer remains eligible for an INSERT (not human-attested).
  p:=gen_random_uuid(); t:=gen_random_uuid();
  BEGIN
    INSERT INTO bci_dev.tenant_memberships(principal_id,tenant_id,product,active)
    VALUES(p,t,'content',true);
    INSERT INTO bci_dev.content_dispatch_approvals
    (approval_id,tenant_id,product,dispatch_intent_id,approved_by,binding_sha256,approved_at,expires_at)
    VALUES('bci-active-reviewer-probe',t,'content','bci-active-intent-probe',p,
           repeat('b',64),clock_timestamp(),clock_timestamp()+interval '1 hour');
    IF NOT EXISTS(SELECT 1 FROM bci_dev.content_dispatch_approvals WHERE approval_id='bci-active-reviewer-probe')
      THEN RAISE EXCEPTION 'BCI active reviewer positive failed'; END IF;
    RAISE EXCEPTION 'BCI_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS marker=MESSAGE_TEXT;
    IF marker <> 'BCI_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM bci_dev.tenant_memberships WHERE principal_id=p)
    OR EXISTS (SELECT 1 FROM bci_dev.content_dispatch_approvals WHERE approval_id='bci-active-reviewer-probe')
  THEN RAISE EXCEPTION 'BCI active reviewer probe residue'; END IF;
  RAISE NOTICE 'BCI DEV revoked negative PASS; active positive PASS; rollback PASS';
END $$;
-- Postcondition: trigger enabled, SECURITY INVOKER, no PUBLIC function EXECUTE.
-- Rollback DEV only after verifying no consumers:
-- DROP TRIGGER content_approval_reviewer_active_insert ON bci_dev.content_dispatch_approvals;
-- DROP FUNCTION bci_dev.require_active_content_approval_reviewer();
