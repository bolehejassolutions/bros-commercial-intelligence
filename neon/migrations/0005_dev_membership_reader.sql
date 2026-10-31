-- DEVELOPMENT-ONLY proposed migration; do NOT auto-apply.
-- Separate membership authority from evidence data: this role can read only
-- active membership records, not evidence. Password remains NULL, so this
-- migration alone does NOT enable direct login or authenticated Preview.
-- A verified Neon Auth JWT is required upstream. bci.principal_id is a
-- self-settable filter and is NOT a database-enforced identity attestation.
-- Requires owner review before applying any schema/role permission change.

-- @@STEP
CREATE ROLE bci_dev_membership_reader WITH LOGIN NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD NULL;

-- @@STEP
ALTER ROLE bci_dev_membership_reader SET search_path TO bci_dev, pg_catalog;

-- @@STEP
GRANT CONNECT ON DATABASE bros_intelligence_dev TO bci_dev_membership_reader;

-- @@STEP
GRANT USAGE ON SCHEMA bci_dev TO bci_dev_membership_reader;

-- @@STEP
GRANT SELECT ON bci_dev.tenant_memberships TO bci_dev_membership_reader;

-- @@STEP
CREATE POLICY dev_membership_reader_select ON bci_dev.tenant_memberships
FOR SELECT TO bci_dev_membership_reader
USING (principal_id = nullif(current_setting('bci.principal_id', true),'')::uuid
       AND active IS TRUE AND revoked_at IS NULL);
