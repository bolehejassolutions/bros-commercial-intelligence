-- BCI DEV ONLY: staging migration for owner review; NOT APPLIED.
-- Fixes BCI_LINEAGE_WRITER_MEMBERSHIP_RLS_GAP_PROVIDER_20261101_0640_V1.
-- Separate tenant+product session variables are NOT authorization.
-- A real signed JWT, fresh server membership, restricted direct LOGIN,
-- and transaction-local principal/tenant/product scope are mandatory upstream.
-- Never grant FULL TABLE SELECT on tenant_memberships to lineage writer.
-- No new credentials, paid services, production route or provider writes.
-- @@STEP
GRANT SELECT (principal_id,tenant_id,product,active,revoked_at)
 ON bci_dev.tenant_memberships TO bci_dev_lineage_writer;
-- @@STEP
CREATE POLICY dev_writer_lineage_membership_select ON bci_dev.tenant_memberships
 FOR SELECT TO bci_dev_lineage_writer
 USING (
  principal_id = NULLIF(current_setting('bci.principal_id',true),'')::uuid
  AND tenant_id = NULLIF(current_setting('bci.tenant_id',true),'')::uuid
  AND product = NULLIF(current_setting('bci.product',true),'')
  AND product IN ('content','demand')
  AND active IS TRUE AND revoked_at IS NULL
 );
-- Runtime role policies remain unchanged. ONLY writer policies tighten.
-- @@STEP
ALTER POLICY dev_writer_lineage_nodes_select ON bci_dev.lineage_nodes
 USING (
  tenant_id = NULLIF(current_setting('bci.tenant_id',true),'')::uuid
  AND product = NULLIF(current_setting('bci.product',true),'')
  AND EXISTS (SELECT 1 FROM bci_dev.tenant_memberships m
   WHERE m.tenant_id=lineage_nodes.tenant_id AND m.product=lineage_nodes.product
     AND m.principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
     AND m.active IS TRUE AND m.revoked_at IS NULL)
 );
-- @@STEP
ALTER POLICY dev_writer_lineage_nodes_insert ON bci_dev.lineage_nodes
 WITH CHECK (
  tenant_id = NULLIF(current_setting('bci.tenant_id',true),'')::uuid
  AND product = NULLIF(current_setting('bci.product',true),'')
  AND EXISTS (SELECT 1 FROM bci_dev.tenant_memberships m
   WHERE m.tenant_id=lineage_nodes.tenant_id AND m.product=lineage_nodes.product
     AND m.principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
     AND m.active IS TRUE AND m.revoked_at IS NULL)
 );
-- @@STEP
ALTER POLICY dev_writer_lineage_edges_select ON bci_dev.lineage_edges
 USING (
  tenant_id = NULLIF(current_setting('bci.tenant_id',true),'')::uuid
  AND product = NULLIF(current_setting('bci.product',true),'')
  AND EXISTS (SELECT 1 FROM bci_dev.tenant_memberships m
   WHERE m.tenant_id=lineage_edges.tenant_id AND m.product=lineage_edges.product
     AND m.principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
     AND m.active IS TRUE AND m.revoked_at IS NULL)
 );
-- @@STEP
ALTER POLICY dev_writer_lineage_edges_insert ON bci_dev.lineage_edges
 WITH CHECK (
  tenant_id = NULLIF(current_setting('bci.tenant_id',true),'')::uuid
  AND product = NULLIF(current_setting('bci.product',true),'')
  AND EXISTS (SELECT 1 FROM bci_dev.tenant_memberships m
   WHERE m.tenant_id=lineage_edges.tenant_id AND m.product=lineage_edges.product
     AND m.principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
     AND m.active IS TRUE AND m.revoked_at IS NULL)
 );
-- APPLY GATE: separately authorized DEV ACL change, maintenance window,
-- SQL rollback and independent direct LOGIN + active/revoked/foreign product
-- and foreign tenant checks with nonempty positive fixture. Do NOT claim PASS
-- from static tests or a BROS admin SET ROLE simulation.
