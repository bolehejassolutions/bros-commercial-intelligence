-- Internal Neon development only. NEVER connect browser/public customers with BROS admin role.
-- Discovered via synthetic data tests: Neon-created BROS has rolbypassrls=true (admin),
-- so FORCE RLS alone does NOT constrain BROS. RLS must be tested as non-bypass runtime.
-- Create NOLOGIN/NOINHERIT/NOBYPASSRLS runtime role, with read+insert only.
-- BROS can SET LOCAL ROLE for synthetic security tests. Never expose BROS/admin credential.
-- bci.tenant_id GUC can be client-set and is NOT a secure authenticated tenant proof.
-- This is a development isolation harness; customer-facing access remains prohibited
-- until server-attested identity and tenant authorization are implemented and tested.

-- @@STEP
CREATE ROLE bci_dev_runtime NOLOGIN NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE;

-- @@STEP
GRANT bci_dev_runtime TO "BROS";

-- @@STEP
GRANT USAGE ON SCHEMA bci_dev TO bci_dev_runtime;

-- @@STEP
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA bci_dev TO bci_dev_runtime;

-- @@STEP
CREATE POLICY dev_runtime_evidence_select ON bci_dev.evidence
 FOR SELECT TO bci_dev_runtime USING (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid);

-- @@STEP
CREATE POLICY dev_runtime_evidence_insert ON bci_dev.evidence
 FOR INSERT TO bci_dev_runtime WITH CHECK (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid);

-- @@STEP
CREATE POLICY dev_runtime_cases_select ON bci_dev.cases
 FOR SELECT TO bci_dev_runtime USING (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid);

-- @@STEP
CREATE POLICY dev_runtime_cases_insert ON bci_dev.cases
 FOR INSERT TO bci_dev_runtime WITH CHECK (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid);

-- @@STEP
CREATE POLICY dev_runtime_case_evidence_select ON bci_dev.case_evidence
 FOR SELECT TO bci_dev_runtime USING (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid);

-- @@STEP
CREATE POLICY dev_runtime_case_evidence_insert ON bci_dev.case_evidence
 FOR INSERT TO bci_dev_runtime WITH CHECK (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid);

-- @@STEP
CREATE POLICY dev_runtime_proposals_select ON bci_dev.proposals
 FOR SELECT TO bci_dev_runtime USING (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid);

-- @@STEP
CREATE POLICY dev_runtime_proposals_insert ON bci_dev.proposals
 FOR INSERT TO bci_dev_runtime WITH CHECK (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid);
