-- BCI_APPEND_ONLY_LINEAGE_SCHEMA_DESIGN_20261027_V1
-- DESIGN ONLY. NOT a migration. DO NOT EXECUTE without separate owner approval.
-- Proposed for Neon Free DEV bci_dev; never apply to Production.
-- No new role, GRANT, credential, provider integration, or customer access.
-- This schema deliberately stores UNVERIFIED claims only. A future server-owned
-- attestation writer must be separately designed, authorized, tested and audited.
-- RLS/GUC, these DDL constraints, and a passing CI run are NOT authenticated E2E.
--
-- An immutable node records its complete parent set; edges have scoped FKs.
-- Deferred checks require exact parent-set equality and predecessor stages
-- at COMMIT, so appending edges later cannot rewrite an old node's ancestry.
-- Restricted app roles receive NO access from this proposal.
--
-- REVIEW BEFORE ANY DEV APPLY: transactional migration, rollback/backup plan,
-- finite timestamps, canonical source labels and trigger-function EXECUTE ACLs,
-- direct restricted LOGIN negative tests, concurrent inserts, and trusted writer.

CREATE TABLE bci_dev.lineage_nodes (
  id uuid NOT NULL PRIMARY KEY,
  tenant_id uuid NOT NULL,
  product text NOT NULL CHECK (product IN ('content', 'demand')),
  stage text NOT NULL CHECK (stage IN (
    'evidence', 'signal', 'case', 'diagnosis',
    'decision', 'action', 'outcome', 'learning'
  )),
  source_system text NOT NULL CHECK (
    length(source_system) BETWEEN 1 AND 160
    AND source_system = btrim(source_system)
  ),
  source_record_key text NOT NULL CHECK (
    length(source_record_key) BETWEEN 1 AND 160
    AND source_record_key = btrim(source_record_key)
  ),
  recorded_at timestamptz NOT NULL CHECK (isfinite(recorded_at)),
  parent_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  -- Caller data can NEVER upgrade itself to provider-reported or verified.
  assertion_status text NOT NULL DEFAULT 'unverified'
    CHECK (assertion_status = 'unverified'),
  CHECK (cardinality(parent_ids) <= 100),
  CHECK (array_position(parent_ids, NULL) IS NULL),
  CHECK ((stage = 'evidence') = (cardinality(parent_ids) = 0)),
  UNIQUE (id, tenant_id, product),
  UNIQUE (tenant_id, product, stage, source_system, source_record_key)
);

CREATE TABLE bci_dev.lineage_edges (
  tenant_id uuid NOT NULL,
  product text NOT NULL CHECK (product IN ('content', 'demand')),
  parent_id uuid NOT NULL,
  child_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, product, parent_id, child_id),
  CHECK (parent_id <> child_id),
  FOREIGN KEY (parent_id, tenant_id, product)
    REFERENCES bci_dev.lineage_nodes (id, tenant_id, product)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (child_id, tenant_id, product)
    REFERENCES bci_dev.lineage_nodes (id, tenant_id, product)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX lineage_edges_child_idx
  ON bci_dev.lineage_edges (tenant_id, product, child_id);

CREATE FUNCTION bci_dev.reject_lineage_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'BCI lineage is append-only'
    USING ERRCODE = '55000';
END;
$$;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Keep
-- both trigger functions inaccessible as callable application entry points.
REVOKE ALL ON FUNCTION bci_dev.reject_lineage_mutation() FROM PUBLIC;

-- Statement triggers also reject TRUNCATE (row triggers do not).
CREATE TRIGGER lineage_nodes_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON bci_dev.lineage_nodes
  FOR EACH STATEMENT EXECUTE FUNCTION bci_dev.reject_lineage_mutation();
CREATE TRIGGER lineage_edges_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON bci_dev.lineage_edges
  FOR EACH STATEMENT EXECUTE FUNCTION bci_dev.reject_lineage_mutation();

CREATE FUNCTION bci_dev.check_lineage_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  target_node bci_dev.lineage_nodes%ROWTYPE;
  edge_count bigint;
  bad_count bigint;
BEGIN
  IF TG_TABLE_NAME = 'lineage_nodes' THEN
    target_node := NEW;
  ELSE
    SELECT * INTO target_node FROM bci_dev.lineage_nodes
      WHERE id = NEW.child_id AND tenant_id = NEW.tenant_id
        AND product = NEW.product;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Missing BCI lineage child' USING ERRCODE = '23503';
    END IF;
  END IF;

  SELECT count(*),
         count(*) FILTER (
           WHERE NOT (e.parent_id = ANY(target_node.parent_ids))
         )
    INTO edge_count, bad_count
    FROM bci_dev.lineage_edges e
    WHERE e.tenant_id = target_node.tenant_id
      AND e.product = target_node.product
      AND e.child_id = target_node.id;

  -- This also rejects duplicate parent IDs in the immutable array because
  -- the edge primary key cannot represent duplicates.
  IF edge_count <> cardinality(target_node.parent_ids) OR bad_count <> 0 THEN
    RAISE EXCEPTION 'BCI lineage parent set mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO bad_count
    FROM bci_dev.lineage_edges e
    JOIN bci_dev.lineage_nodes p
      ON p.id = e.parent_id AND p.tenant_id = e.tenant_id
     AND p.product = e.product
    WHERE e.tenant_id = target_node.tenant_id
      AND e.product = target_node.product
      AND e.child_id = target_node.id
      AND (
        array_position(ARRAY[
          'evidence','signal','case','diagnosis',
          'decision','action','outcome','learning'
        ]::text[], p.stage) + 1
        <> array_position(ARRAY[
          'evidence','signal','case','diagnosis',
          'decision','action','outcome','learning'
        ]::text[], target_node.stage)
        OR p.recorded_at > target_node.recorded_at
      );
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'Invalid BCI lineage predecessor or timestamp'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION bci_dev.check_lineage_integrity() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER lineage_nodes_parent_set
  AFTER INSERT ON bci_dev.lineage_nodes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bci_dev.check_lineage_integrity();
CREATE CONSTRAINT TRIGGER lineage_edges_parent_set
  AFTER INSERT ON bci_dev.lineage_edges
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bci_dev.check_lineage_integrity();

ALTER TABLE bci_dev.lineage_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE bci_dev.lineage_nodes FORCE ROW LEVEL SECURITY;
ALTER TABLE bci_dev.lineage_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE bci_dev.lineage_edges FORCE ROW LEVEL SECURITY;
REVOKE ALL ON bci_dev.lineage_nodes FROM PUBLIC;
REVOKE ALL ON bci_dev.lineage_edges FROM PUBLIC;

COMMENT ON TABLE bci_dev.lineage_nodes IS
  'DRAFT INTERNAL DEV ONLY: append-only unverified eight-stage BCI lineage; no provider attestation or customer access.';
COMMENT ON TABLE bci_dev.lineage_edges IS
  'DRAFT INTERNAL DEV ONLY: scoped, immutable, deferred-checked ancestry; no app role grants.';

-- UNIMPLEMENTED / NOT CLAIMED:
-- 1. Server-owned verified identity, tenant membership and direct restricted LOGIN.
-- 2. Authenticated append writer, provider signatures, append-only attestations.
-- 3. Concurrency, real DB constraint/negative tests, recovery and retention.
-- 4. CONTENT approved SENT -> measured learning; DEMAND controlled outcome.
-- 5. A migration or permission approval. This file is intentionally NOT
--    under neon/migrations and must never be auto-applied.
