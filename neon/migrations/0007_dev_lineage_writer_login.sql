-- BCI_DEV_DEDICATED_LINEAGE_LOGIN_20261029_V1
-- DEV ONLY: Neon empty-tooth-43040036 / br-broad-math-b3f4d2r4 / bros_intelligence_dev.
-- Dedicated direct LOGIN for a FUTURE server-owned audit writer. No credential
-- is issued by this migration: PASSWORD NULL deliberately prevents password login.
-- Do not connect browser/public clients, do not grant bci_dev_runtime or BROS,
-- do not enable an HTTP write route, and do not apply to Production.
-- PRECONDITION: zero lineage rows, both tables FORCE RLS, four runtime policies,
-- no existing bci_dev_lineage_writer role, reviewed SQL and rollback plan.
-- This is NOT independent password LOGIN, JWT authorization or durable app audit.
-- @@STEP
CREATE ROLE bci_dev_lineage_writer
  LOGIN NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD NULL;
-- @@STEP
GRANT CONNECT ON DATABASE bros_intelligence_dev TO bci_dev_lineage_writer;
-- @@STEP
GRANT USAGE ON SCHEMA bci_dev TO bci_dev_lineage_writer;
-- @@STEP
GRANT SELECT, INSERT ON bci_dev.lineage_nodes TO bci_dev_lineage_writer;
-- @@STEP
GRANT SELECT, INSERT ON bci_dev.lineage_edges TO bci_dev_lineage_writer;
-- @@STEP
CREATE POLICY dev_writer_lineage_nodes_select ON bci_dev.lineage_nodes
  FOR SELECT TO bci_dev_lineage_writer
  USING (tenant_id = nullif(current_setting('bci.tenant_id', true), '')::uuid
    AND product = nullif(current_setting('bci.product', true), ''));
-- @@STEP
CREATE POLICY dev_writer_lineage_edges_select ON bci_dev.lineage_edges
  FOR SELECT TO bci_dev_lineage_writer
  USING (tenant_id = nullif(current_setting('bci.tenant_id', true), '')::uuid
    AND product = nullif(current_setting('bci.product', true), ''));
-- @@STEP
CREATE POLICY dev_writer_lineage_nodes_insert ON bci_dev.lineage_nodes
  FOR INSERT TO bci_dev_lineage_writer
  WITH CHECK (tenant_id = nullif(current_setting('bci.tenant_id', true), '')::uuid
    AND product = nullif(current_setting('bci.product', true), ''));
-- @@STEP
CREATE POLICY dev_writer_lineage_edges_insert ON bci_dev.lineage_edges
  FOR INSERT TO bci_dev_lineage_writer
  WITH CHECK (tenant_id = nullif(current_setting('bci.tenant_id', true), '')::uuid
    AND product = nullif(current_setting('bci.product', true), ''));
-- POSTCONDITION: LOGIN=true but password NULL, NOINHERIT, NOBYPASSRLS,
-- no role memberships; only lineage SELECT+INSERT, no tenant membership,
-- evidence, cases, proposals, mutation or schema/database CREATE.
-- The GUCs are NOT identity: server must verify signed JWT + live membership
-- and set transaction-local scope using a pinned direct LOGIN connection.
-- ROLLBACK (DEV ONLY, after confirming no writer client or rows exist):
-- DROP POLICY IF EXISTS dev_writer_lineage_edges_insert ON bci_dev.lineage_edges;
-- DROP POLICY IF EXISTS dev_writer_lineage_nodes_insert ON bci_dev.lineage_nodes;
-- DROP POLICY IF EXISTS dev_writer_lineage_edges_select ON bci_dev.lineage_edges;
-- DROP POLICY IF EXISTS dev_writer_lineage_nodes_select ON bci_dev.lineage_nodes;
-- REVOKE SELECT, INSERT ON bci_dev.lineage_edges FROM bci_dev_lineage_writer;
-- REVOKE SELECT, INSERT ON bci_dev.lineage_nodes FROM bci_dev_lineage_writer;
-- REVOKE USAGE ON SCHEMA bci_dev FROM bci_dev_lineage_writer;
-- REVOKE CONNECT ON DATABASE bros_intelligence_dev FROM bci_dev_lineage_writer;
-- DROP ROLE bci_dev_lineage_writer;
