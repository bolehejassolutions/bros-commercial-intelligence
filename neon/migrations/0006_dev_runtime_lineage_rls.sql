-- BCI_DEV_RUNTIME_LINEAGE_RLS_20261029_V1
-- DEV ONLY: empty-tooth-43040036 / br-broad-math-b3f4d2r4 / bros_intelligence_dev.
-- Add scoped lineage access ONLY to existing NOLOGIN bci_dev_runtime role.
-- This is NOT a password LOGIN, JWT authorization, provider attestation, or E2E proof.
-- The role is not a public entry point; GUCs are client-settable and must ONLY
-- be populated after server-side verified identity + current tenant membership.
-- Do not apply to Production, do not grant this role to any LOGIN principal.
-- PRECONDITION: deployed lineage tables with forced RLS, no existing lineage
-- policies, zero rows, bci_dev_runtime NOLOGIN/NOBYPASSRLS, no existing lineage
-- privileges; verify against pg_catalog immediately before executing.
-- @@STEP
GRANT SELECT, INSERT ON bci_dev.lineage_nodes TO bci_dev_runtime;
-- @@STEP
GRANT SELECT, INSERT ON bci_dev.lineage_edges TO bci_dev_runtime;
-- @@STEP
CREATE POLICY dev_runtime_lineage_nodes_select ON bci_dev.lineage_nodes
  FOR SELECT TO bci_dev_runtime
  USING (tenant_id = nullif(current_setting('bci.tenant_id', true), '')::uuid
    AND product = nullif(current_setting('bci.product', true), ''));
-- @@STEP
CREATE POLICY dev_runtime_lineage_edges_select ON bci_dev.lineage_edges
  FOR SELECT TO bci_dev_runtime
  USING (tenant_id = nullif(current_setting('bci.tenant_id', true), '')::uuid
    AND product = nullif(current_setting('bci.product', true), ''));
-- @@STEP
CREATE POLICY dev_runtime_lineage_nodes_insert ON bci_dev.lineage_nodes
  FOR INSERT TO bci_dev_runtime
  WITH CHECK (tenant_id = nullif(current_setting('bci.tenant_id', true), '')::uuid
    AND product = nullif(current_setting('bci.product', true), ''));
-- @@STEP
CREATE POLICY dev_runtime_lineage_edges_insert ON bci_dev.lineage_edges
  FOR INSERT TO bci_dev_runtime
  WITH CHECK (tenant_id = nullif(current_setting('bci.tenant_id', true), '')::uuid
    AND product = nullif(current_setting('bci.product', true), ''));
-- ROLLBACK (DEV only, after checking no application uses this role):
-- DROP POLICY IF EXISTS dev_runtime_lineage_edges_insert ON bci_dev.lineage_edges;
-- DROP POLICY IF EXISTS dev_runtime_lineage_nodes_insert ON bci_dev.lineage_nodes;
-- DROP POLICY IF EXISTS dev_runtime_lineage_edges_select ON bci_dev.lineage_edges;
-- DROP POLICY IF EXISTS dev_runtime_lineage_nodes_select ON bci_dev.lineage_nodes;
-- REVOKE SELECT, INSERT ON bci_dev.lineage_edges FROM bci_dev_runtime;
-- REVOKE SELECT, INSERT ON bci_dev.lineage_nodes FROM bci_dev_runtime;
-- Existing immutable triggers, deferred constraints and FORCE RLS are unchanged.
-- No UPDATE, DELETE, TRUNCATE, membership access or PUBLIC grants.
