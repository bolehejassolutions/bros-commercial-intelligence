-- DEV only: extend existing restricted DEMAND evidence writer for REVIEW cases.
-- No new role, backend, schema or production grants. No UPDATE/DELETE.
DO $$
BEGIN
 IF current_database()<>'bros_intelligence_dev' OR
   NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='bci_dev_evidence_writer_restricted'
     AND rolcanlogin AND NOT rolbypassrls AND NOT rolsuper) OR
   NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='bci_dev.cases'::regclass
     AND relrowsecurity AND relforcerowsecurity) OR
   NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='bci_dev.case_evidence'::regclass
     AND relrowsecurity AND relforcerowsecurity)
 THEN RAISE EXCEPTION 'BCI restricted DEV case-link preflight denied'; END IF;
END $$;
GRANT SELECT, INSERT ON bci_dev.cases,bci_dev.case_evidence TO bci_dev_evidence_writer_restricted;
CREATE POLICY bci_evidence_writer_demand_cases_select_v1 ON bci_dev.cases
 FOR SELECT TO bci_dev_evidence_writer_restricted USING (
 tenant_id=NULLIF(current_setting('bci.tenant_id',true),'')::uuid AND
 product='demand' AND product=NULLIF(current_setting('bci.product',true),'') AND
 EXISTS(SELECT 1 FROM bci_dev.tenant_memberships m WHERE
  m.tenant_id=cases.tenant_id AND m.product='demand' AND
  m.principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid AND
  m.active IS TRUE AND m.revoked_at IS NULL));
CREATE POLICY bci_evidence_writer_demand_cases_insert_v1 ON bci_dev.cases
 FOR INSERT TO bci_dev_evidence_writer_restricted WITH CHECK (
 tenant_id=NULLIF(current_setting('bci.tenant_id',true),'')::uuid AND
 product='demand' AND product=NULLIF(current_setting('bci.product',true),'') AND status='REVIEW' AND
 EXISTS(SELECT 1 FROM bci_dev.tenant_memberships m WHERE
  m.tenant_id=cases.tenant_id AND m.product='demand' AND
  m.principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid AND
  m.active IS TRUE AND m.revoked_at IS NULL));
CREATE POLICY bci_evidence_writer_demand_link_select_v1 ON bci_dev.case_evidence
 FOR SELECT TO bci_dev_evidence_writer_restricted USING (
 tenant_id=NULLIF(current_setting('bci.tenant_id',true),'')::uuid AND
 product='demand' AND product=NULLIF(current_setting('bci.product',true),'') AND
 EXISTS(SELECT 1 FROM bci_dev.tenant_memberships m WHERE
  m.tenant_id=case_evidence.tenant_id AND m.product='demand' AND
  m.principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid AND
  m.active IS TRUE AND m.revoked_at IS NULL));
CREATE POLICY bci_evidence_writer_demand_link_insert_v1 ON bci_dev.case_evidence
 FOR INSERT TO bci_dev_evidence_writer_restricted WITH CHECK (
 tenant_id=NULLIF(current_setting('bci.tenant_id',true),'')::uuid AND
 product='demand' AND product=NULLIF(current_setting('bci.product',true),'') AND
 EXISTS(SELECT 1 FROM bci_dev.tenant_memberships m WHERE
  m.tenant_id=case_evidence.tenant_id AND m.product='demand' AND
  m.principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid AND
  m.active IS TRUE AND m.revoked_at IS NULL));
