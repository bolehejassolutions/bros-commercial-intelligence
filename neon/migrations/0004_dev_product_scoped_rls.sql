-- DEVELOPMENT-ONLY hardening of synthetic RLS policy tests.
-- This adds per-product isolation alongside per-tenant isolation for non-bypass roles.
-- Both bci.tenant_id and bci.product remain client-settable GUCs: these are
-- NOT authenticated tenant/product claims. Do NOT deploy a public API based on
-- this migration alone; require verified principal and server-side membership.
-- Never use the BYPASSRLS admin BROS role as application credentials.
-- Apply only to Neon project empty-tooth-43040036, bros_intelligence_dev.
-- @@STEP markers delimit individual reversible policy changes.

-- @@STEP
ALTER POLICY dev_private_evidence_select ON bci_dev.evidence
  USING (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid AND product = nullif(current_setting('bci.product',true),''));

-- @@STEP
ALTER POLICY dev_private_cases_select ON bci_dev.cases
  USING (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid AND product = nullif(current_setting('bci.product',true),''));

-- @@STEP
ALTER POLICY dev_private_case_evidence_select ON bci_dev.case_evidence
  USING (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid AND product = nullif(current_setting('bci.product',true),''));

-- @@STEP
ALTER POLICY dev_private_proposals_select ON bci_dev.proposals
  USING (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid AND product = nullif(current_setting('bci.product',true),''));

-- @@STEP
ALTER POLICY dev_runtime_evidence_select ON bci_dev.evidence
  USING (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid AND product = nullif(current_setting('bci.product',true),''));

-- @@STEP
ALTER POLICY dev_runtime_cases_select ON bci_dev.cases
  USING (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid AND product = nullif(current_setting('bci.product',true),''));

-- @@STEP
ALTER POLICY dev_runtime_case_evidence_select ON bci_dev.case_evidence
  USING (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid AND product = nullif(current_setting('bci.product',true),''));

-- @@STEP
ALTER POLICY dev_runtime_proposals_select ON bci_dev.proposals
  USING (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid AND product = nullif(current_setting('bci.product',true),''));

-- @@STEP
ALTER POLICY dev_runtime_evidence_insert ON bci_dev.evidence
  WITH CHECK (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid AND product = nullif(current_setting('bci.product',true),''));

-- @@STEP
ALTER POLICY dev_runtime_cases_insert ON bci_dev.cases
  WITH CHECK (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid AND product = nullif(current_setting('bci.product',true),''));

-- @@STEP
ALTER POLICY dev_runtime_case_evidence_insert ON bci_dev.case_evidence
  WITH CHECK (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid AND product = nullif(current_setting('bci.product',true),''));

-- @@STEP
ALTER POLICY dev_runtime_proposals_insert ON bci_dev.proposals
  WITH CHECK (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid AND product = nullif(current_setting('bci.product',true),''));
