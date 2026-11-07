-- BCI_DEV_RUNTIME_LINEAGE_EFFECTIVE_ROLE_20261029_V1
-- Execute as ONE transaction on Neon Free DEV with the owner BROS session.
-- Connector run_sql_transaction wraps these @@STEP statements in a transaction.
-- Tests SET LOCAL ROLE, NOT independent password LOGIN or signed JWT.
-- All synthetic writes are rolled back by PL/pgSQL EXCEPTION subtransactions.
-- @@STEP
SET LOCAL ROLE bci_dev_runtime;
-- @@STEP
SET LOCAL bci.tenant_id = '00000000-0000-4000-8000-000000000101';
-- @@STEP
SET LOCAL bci.product = 'content';
-- @@STEP
DO $bci$
DECLARE
  v_id uuid := gen_random_uuid();
  v_cross_tenant boolean := false;
  v_cross_product boolean := false;
  v_member_denied boolean := false;
  v_allowed boolean := false;
BEGIN
  IF current_user <> 'bci_dev_runtime' OR session_user <> 'BROS'
     OR (SELECT rolcanlogin OR rolbypassrls FROM pg_roles WHERE rolname='bci_dev_runtime') THEN
    RAISE EXCEPTION 'Restricted effective role not established' USING ERRCODE='ZX001';
  END IF;
  BEGIN
    INSERT INTO bci_dev.lineage_nodes
      (id,tenant_id,product,stage,source_system,source_record_key,recorded_at,parent_ids)
    VALUES(gen_random_uuid(),'00000000-0000-4000-8000-000000000102','content',
      'evidence','bci_dev_effective_role_probe','cross-tenant',now(),ARRAY[]::uuid[]);
  EXCEPTION WHEN insufficient_privilege THEN
    v_cross_tenant := true;
  END;
  BEGIN
    INSERT INTO bci_dev.lineage_nodes
      (id,tenant_id,product,stage,source_system,source_record_key,recorded_at,parent_ids)
    VALUES(gen_random_uuid(),'00000000-0000-4000-8000-000000000101','demand',
      'evidence','bci_dev_effective_role_probe','cross-product',now(),ARRAY[]::uuid[]);
  EXCEPTION WHEN insufficient_privilege THEN
    v_cross_product := true;
  END;
  BEGIN
    PERFORM 1 FROM bci_dev.tenant_memberships LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN
    v_member_denied := true;
  END;
  BEGIN
    INSERT INTO bci_dev.lineage_nodes
      (id,tenant_id,product,stage,source_system,source_record_key,recorded_at,parent_ids)
    VALUES(v_id,'00000000-0000-4000-8000-000000000101','content',
      'evidence','bci_dev_effective_role_probe','allowed-rollback',now(),ARRAY[]::uuid[]);
    SET CONSTRAINTS ALL IMMEDIATE;
    IF (SELECT count(*) FROM bci_dev.lineage_nodes WHERE id=v_id) <> 1 THEN
      RAISE EXCEPTION 'Scoped insert not visible' USING ERRCODE='ZX002';
    END IF;
    RAISE EXCEPTION 'Intentional scoped insert rollback' USING ERRCODE='ZX998';
  EXCEPTION WHEN SQLSTATE 'ZX998' THEN
    v_allowed := true;
  END;
  IF NOT (v_cross_tenant AND v_cross_product AND v_member_denied AND v_allowed) THEN
    RAISE EXCEPTION 'Effective role matrix incomplete: %,%,%,%',
      v_cross_tenant,v_cross_product,v_member_denied,v_allowed USING ERRCODE='ZX003';
  END IF;
  IF EXISTS(SELECT 1 FROM bci_dev.lineage_nodes WHERE id=v_id) THEN
    RAISE EXCEPTION 'Rollback failed' USING ERRCODE='ZX004';
  END IF;
END $bci$;
