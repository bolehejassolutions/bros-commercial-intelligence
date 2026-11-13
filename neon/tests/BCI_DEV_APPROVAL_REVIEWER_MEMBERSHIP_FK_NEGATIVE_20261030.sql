-- BCI_CONTENT_APPROVAL_REVIEWER_FK_PROVIDER_NEGATIVE_20261030_V1
-- DEV ONLY. Run after migration 0012 with BROS database owner.
-- All INSERT probes execute in PL/pgSQL exception subtransactions; no rows persist.
-- This tests FK identity/tenant integrity, NOT a real signed human approval.
DO $$
DECLARE
  reviewer uuid;
  tenant uuid;
  unknown_reviewer uuid := gen_random_uuid();
  wrong_tenant uuid := gen_random_uuid();
  caught boolean;
  violated text;
  failure_message text;
BEGIN
  IF current_database() <> 'bros_intelligence_dev' THEN
    RAISE EXCEPTION 'BCI DEV-only probe refused';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='bci_dev.content_dispatch_approvals'::regclass
      AND conname='bci_content_approval_reviewer_membership_fk'
      AND contype='f' AND convalidated
  ) THEN
    RAISE EXCEPTION 'BCI reviewer membership FK missing or not validated';
  END IF;
  IF (SELECT count(*) FROM bci_dev.content_dispatch_approvals) <> 0 THEN
    RAISE EXCEPTION 'BCI probe requires empty approval table';
  END IF;
  SELECT principal_id, tenant_id INTO reviewer, tenant
    FROM bci_dev.tenant_memberships
    WHERE product='content' AND active IS TRUE AND revoked_at IS NULL
    ORDER BY principal_id, tenant_id LIMIT 1;
  IF reviewer IS NULL OR tenant IS NULL THEN
    RAISE EXCEPTION 'BCI probe requires one active CONTENT reviewer membership';
  END IF;
  WHILE EXISTS (SELECT 1 FROM bci_dev.tenant_memberships
                WHERE principal_id=unknown_reviewer) LOOP
    unknown_reviewer := gen_random_uuid();
  END LOOP;
  WHILE EXISTS (SELECT 1 FROM bci_dev.tenant_memberships
                WHERE principal_id=reviewer AND tenant_id=wrong_tenant) LOOP
    wrong_tenant := gen_random_uuid();
  END LOOP;

  caught := false;
  BEGIN
    INSERT INTO bci_dev.content_dispatch_approvals
      (approval_id,tenant_id,product,dispatch_intent_id,approved_by,
       binding_sha256,approved_at,expires_at)
    VALUES ('bci-probe-unknown-reviewer',tenant,'content',
      'bci-probe-unknown-intent',unknown_reviewer,repeat('a',64),
      clock_timestamp(),clock_timestamp()+interval '1 hour');
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
    IF violated <> 'bci_content_approval_reviewer_membership_fk' THEN
      RAISE EXCEPTION 'Wrong FK rejected unknown reviewer';
    END IF;
    caught := true;
  END;
  IF NOT caught THEN RAISE EXCEPTION 'Unknown reviewer was accepted'; END IF;

  caught := false;
  BEGIN
    INSERT INTO bci_dev.content_dispatch_approvals
      (approval_id,tenant_id,product,dispatch_intent_id,approved_by,
       binding_sha256,approved_at,expires_at)
    VALUES ('bci-probe-cross-tenant',wrong_tenant,'content',
      'bci-probe-cross-tenant-intent',reviewer,repeat('b',64),
      clock_timestamp(),clock_timestamp()+interval '1 hour');
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
    IF violated <> 'bci_content_approval_reviewer_membership_fk' THEN
      RAISE EXCEPTION 'Wrong FK rejected cross-tenant reviewer';
    END IF;
    caught := true;
  END;
  IF NOT caught THEN RAISE EXCEPTION 'Cross-tenant reviewer was accepted'; END IF;

  -- Positive FK check is rolled back by a deliberate caught exception.
  BEGIN
    INSERT INTO bci_dev.content_dispatch_approvals
      (approval_id,tenant_id,product,dispatch_intent_id,approved_by,
       binding_sha256,approved_at,expires_at)
    VALUES ('bci-probe-matching-reviewer',tenant,'content',
      'bci-probe-matching-intent',reviewer,repeat('c',64),
      clock_timestamp(),clock_timestamp()+interval '1 hour');
    IF NOT EXISTS (SELECT 1 FROM bci_dev.content_dispatch_approvals
                   WHERE approval_id='bci-probe-matching-reviewer') THEN
      RAISE EXCEPTION 'Positive FK insert not visible';
    END IF;
    RAISE EXCEPTION 'BCI_POSITIVE_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS failure_message = MESSAGE_TEXT;
    IF failure_message <> 'BCI_POSITIVE_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF (SELECT count(*) FROM bci_dev.content_dispatch_approvals) <> 0 THEN
    RAISE EXCEPTION 'BCI probe left approval records';
  END IF;
  RAISE NOTICE 'BCI reviewer membership FK: matching PASS, unknown PASS, cross-tenant PASS, zero residue PASS';
END;
$$;
