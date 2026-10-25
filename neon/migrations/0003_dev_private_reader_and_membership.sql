-- DEVELOPMENT DATABASE ONLY: Neon project empty-tooth-43040036, db bros_intelligence_dev.
-- DO NOT apply to Supabase, production, paid plans, or any customer-facing instance.
-- Creates a SQL-defined least-privilege LOGIN role with a NULL password, hence
-- it CANNOT authenticate remotely until a secret is securely provisioned later.
-- This deliberately prevents app connections and accidental preview exposure.
-- A Neon management-API-created role would inherit neon_superuser/BYPASSRLS.
-- No credential, shared secret, production env or application endpoint is enabled.
-- RLS uses a self-settable GUC and does NOT authenticate a tenant. SQL row policies
-- are only development tests; trust requires verified server identity first.
-- Membership table is admin-only, unseeded, no public/app read grant.


-- @@STEP
CREATE ROLE bci_dev_private_reader WITH LOGIN NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD NULL;

-- @@STEP
ALTER ROLE bci_dev_private_reader SET search_path TO bci_dev, pg_catalog;

-- @@STEP
GRANT CONNECT ON DATABASE bros_intelligence_dev TO bci_dev_private_reader;

-- @@STEP
GRANT USAGE ON SCHEMA bci_dev TO bci_dev_private_reader;

-- @@STEP
GRANT SELECT ON bci_dev.evidence,bci_dev.cases,bci_dev.case_evidence,bci_dev.proposals TO bci_dev_private_reader;

-- @@STEP
CREATE POLICY dev_private_evidence_select ON bci_dev.evidence FOR SELECT TO bci_dev_private_reader USING (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid);

-- @@STEP
CREATE POLICY dev_private_cases_select ON bci_dev.cases FOR SELECT TO bci_dev_private_reader USING (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid);

-- @@STEP
CREATE POLICY dev_private_case_evidence_select ON bci_dev.case_evidence FOR SELECT TO bci_dev_private_reader USING (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid);

-- @@STEP
CREATE POLICY dev_private_proposals_select ON bci_dev.proposals FOR SELECT TO bci_dev_private_reader USING (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid);

-- @@STEP
CREATE TABLE bci_dev.tenant_memberships (
 principal_id uuid NOT NULL,
 tenant_id uuid NOT NULL,
 product text NOT NULL CHECK (product IN ('content','demand')),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 PRIMARY KEY(principal_id,tenant_id,product),
 CHECK (active OR revoked_at IS NOT NULL),
 CHECK (NOT active OR revoked_at IS NULL)
);

-- @@STEP
ALTER TABLE bci_dev.tenant_memberships ENABLE ROW LEVEL SECURITY;

-- @@STEP
ALTER TABLE bci_dev.tenant_memberships FORCE ROW LEVEL SECURITY;

-- @@STEP
REVOKE ALL ON bci_dev.tenant_memberships FROM PUBLIC,bci_dev_private_reader,bci_dev_runtime;

-- @@STEP
COMMENT ON TABLE bci_dev.tenant_memberships IS 'Server-authoritative membership staging, admin-managed only; no app role read grant. DO NOT derive membership from client-supplied UUID without independently verified authentication.';
