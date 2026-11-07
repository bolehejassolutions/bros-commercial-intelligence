-- DEV-only: existing restricted evidence writer gains scoped PROPOSED append/read.
-- Existing proposals table, existing LOGIN role, no new backend/role, no approval/execution.
-- @@STEP
DO $$
BEGIN
 IF current_database() <> 'bros_intelligence_dev'
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='bci_dev_evidence_writer_restricted'
       AND rolcanlogin AND NOT rolbypassrls AND NOT rolsuper)
    OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='bci_dev.proposals'::regclass
       AND relrowsecurity AND relforcerowsecurity)
    OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='bci_dev.cases'::regclass
       AND relrowsecurity AND relforcerowsecurity)
 THEN RAISE EXCEPTION 'BCI DEV proposal append preflight denied'; END IF;
END $$;
-- @@STEP
GRANT SELECT, INSERT ON bci_dev.proposals TO bci_dev_evidence_writer_restricted;
-- @@STEP
CREATE POLICY bci_evidence_writer_demand_proposals_select_v1 ON bci_dev.proposals
 FOR SELECT TO bci_dev_evidence_writer_restricted USING (
 tenant_id=NULLIF(current_setting('bci.tenant_id',true),'')::uuid
 AND product='demand' AND product=NULLIF(current_setting('bci.product',true),'')
 AND EXISTS (SELECT 1 FROM bci_dev.tenant_memberships m
  WHERE m.tenant_id=proposals.tenant_id AND m.product='demand'
    AND m.principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
    AND m.active IS TRUE AND m.revoked_at IS NULL));
-- @@STEP
CREATE POLICY bci_evidence_writer_demand_proposals_insert_v1 ON bci_dev.proposals
 FOR INSERT TO bci_dev_evidence_writer_restricted WITH CHECK (
 tenant_id=NULLIF(current_setting('bci.tenant_id',true),'')::uuid
 AND product='demand' AND product=NULLIF(current_setting('bci.product',true),'')
 AND status='PROPOSED'
 AND EXISTS (SELECT 1 FROM bci_dev.tenant_memberships m
  WHERE m.tenant_id=proposals.tenant_id AND m.product='demand'
    AND m.principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
    AND m.active IS TRUE AND m.revoked_at IS NULL)
 AND EXISTS (SELECT 1 FROM bci_dev.cases c
  WHERE c.id=proposals.case_id AND c.tenant_id=proposals.tenant_id
    AND c.product='demand' AND c.status='REVIEW'));
