-- BCI_CONTENT_APPROVAL_INTENT_UNIQUENESS_PROVIDER_NEGATIVE_20261030_V1
-- Run against DEV only AFTER migration 0011. Self-contained rollback-only probe.
-- Never uses real principal, tenant or approved human evidence.
DO $$
DECLARE
  probe_tenant uuid := gen_random_uuid();
  probe_user uuid := gen_random_uuid();
  probe_intent text := 'bci-probe-' || replace(gen_random_uuid()::text,'-','');
  found_constraint text;
BEGIN
  IF current_database() <> 'bros_intelligence_dev' THEN
    RAISE EXCEPTION 'Wrong database for BCI DEV probe';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index x JOIN pg_class c ON c.oid=x.indexrelid
    WHERE c.oid='bci_dev.bci_content_approval_one_intent_idx'::regclass
      AND x.indisunique AND x.indisvalid AND x.indisready
  ) THEN
    RAISE EXCEPTION 'BCI unique index not valid/ready';
  END IF;
  BEGIN
    INSERT INTO bci_dev.content_dispatch_approvals
      (approval_id,tenant_id,product,dispatch_intent_id,approved_by,binding_sha256,approved_at,expires_at)
    VALUES ('probe-one-'||replace(gen_random_uuid()::text,'-',''),probe_tenant,'content',
      probe_intent,probe_user,repeat('a',64),now(),now()+interval '1 hour');
    BEGIN
      INSERT INTO bci_dev.content_dispatch_approvals
        (approval_id,tenant_id,product,dispatch_intent_id,approved_by,binding_sha256,approved_at,expires_at)
      VALUES ('probe-two-'||replace(gen_random_uuid()::text,'-',''),probe_tenant,'content',
        probe_intent,probe_user,repeat('b',64),now(),now()+interval '1 hour');
      RAISE EXCEPTION 'Duplicate approval was accepted' USING ERRCODE='ZX991';
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS found_constraint = CONSTRAINT_NAME;
      IF found_constraint <> 'bci_content_approval_one_intent_idx' THEN
        RAISE EXCEPTION 'Unexpected unique constraint: %',found_constraint;
      END IF;
    END;
    RAISE EXCEPTION 'Rollback disposable approval probe' USING ERRCODE='ZX992';
  EXCEPTION WHEN SQLSTATE 'ZX992' THEN
    NULL; -- rolls back first insert inside this subtransaction
  END;
  IF EXISTS (SELECT 1 FROM bci_dev.content_dispatch_approvals
    WHERE tenant_id=probe_tenant OR dispatch_intent_id=probe_intent) THEN
    RAISE EXCEPTION 'Probe data persisted';
  END IF;
END;
$$;
