-- BCI_DEV_DUAL_PRODUCT_LINEAGE_POSITIVE_ROLLBACK_20261028_2340_V1
-- Neon DEV ONLY; execute through an authorized administrator connection.
-- Verifies the deployed eight-stage CONTENT and DEMAND graph on ONE tenant.
-- Every inserted row is intentionally rolled back in a PL/pgSQL subtransaction.
-- Success proves live SQL integrity acceptance, NOT durable persistence,
-- independent restricted LOGIN, signed JWT authorization or provider attestation.
-- DO NOT interpret synthetic unverified nodes as real actions or outcomes.
DO $bci$
DECLARE
  v_tenant uuid := gen_random_uuid();
  v_id uuid;
  v_ids uuid[];
  v_product text;
  v_stages text[] := ARRAY['evidence','signal','case','diagnosis','decision','action','outcome','learning'];
  v_parents uuid[];
  v_nodes integer;
  v_edges integer;
  v_total_nodes integer;
  v_total_edges integer;
  v_expected boolean := false;
BEGIN
  IF current_database() <> 'bros_intelligence_dev' OR current_user <> 'BROS' THEN
    RAISE EXCEPTION 'BCI DEV admin-only positive probe refused' USING ERRCODE='ZX000';
  END IF;
  SELECT count(*) INTO v_total_nodes FROM bci_dev.lineage_nodes;
  SELECT count(*) INTO v_total_edges FROM bci_dev.lineage_edges;
  BEGIN
    FOREACH v_product IN ARRAY ARRAY['content','demand']::text[] LOOP
      v_ids := ARRAY[]::uuid[];
      FOR i IN 1..8 LOOP
        v_id := gen_random_uuid();
        IF i = 1 THEN
          v_parents := ARRAY[]::uuid[];
        ELSE
          v_parents := ARRAY[v_ids[i-1]];
        END IF;
        INSERT INTO bci_dev.lineage_nodes
          (id, tenant_id, product, stage, source_system, source_record_key, recorded_at, parent_ids, assertion_status)
        VALUES
          (v_id, v_tenant, v_product, v_stages[i], 'bci_dev_positive_probe',
           'synthetic-rollback-' || v_product || '-' || i::text || '-' || v_id::text,
           now() + (i * interval '1 second'), v_parents, 'unverified');
        IF i > 1 THEN
          INSERT INTO bci_dev.lineage_edges(tenant_id,product,parent_id,child_id)
          VALUES(v_tenant,v_product,v_ids[i-1],v_id);
        END IF;
        v_ids := array_append(v_ids,v_id);
      END LOOP;
    END LOOP;
    -- Forces deferred parent-set, stage-order and timestamp checks now.
    SET CONSTRAINTS ALL IMMEDIATE;
    SELECT count(*) INTO v_nodes FROM bci_dev.lineage_nodes WHERE tenant_id=v_tenant;
    SELECT count(*) INTO v_edges FROM bci_dev.lineage_edges WHERE tenant_id=v_tenant;
    IF v_nodes <> 16 OR v_edges <> 14 THEN
      RAISE EXCEPTION 'BCI positive probe unexpected counts' USING ERRCODE='ZX001';
    END IF;
    IF (SELECT count(DISTINCT product) FROM bci_dev.lineage_nodes WHERE tenant_id=v_tenant) <> 2 OR
       (SELECT count(*) FROM bci_dev.lineage_nodes WHERE tenant_id=v_tenant AND assertion_status <> 'unverified') <> 0 THEN
      RAISE EXCEPTION 'BCI positive probe unexpected product/verification' USING ERRCODE='ZX002';
    END IF;
    -- Catching this error rolls back every write in this nested block.
    RAISE EXCEPTION 'BCI intentional subtransaction rollback' USING ERRCODE='ZX998';
  EXCEPTION WHEN SQLSTATE 'ZX998' THEN
    v_expected := true;
  END;
  IF NOT v_expected THEN
    RAISE EXCEPTION 'BCI rollback marker absent' USING ERRCODE='ZX003';
  END IF;
  IF (SELECT count(*) FROM bci_dev.lineage_nodes) <> v_total_nodes OR
     (SELECT count(*) FROM bci_dev.lineage_edges) <> v_total_edges THEN
    RAISE EXCEPTION 'BCI positive probe rollback incomplete' USING ERRCODE='ZX004';
  END IF;
END $bci$;
