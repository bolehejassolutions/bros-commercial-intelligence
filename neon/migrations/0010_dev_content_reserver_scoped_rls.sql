-- BCI_CONTENT_RESERVER_SCOPED_RLS_DEV_20261030_V1
-- DEV ONLY: empty-tooth-43040036 / br-broad-math-b3f4d2r4 / bros_intelligence_dev.
-- Run ONCE after migrations 0008 and 0009. Do not replay existing lineage DDL.
-- Restricted bci_dev_content_reserver must already exist as NOLOGIN NOINHERIT
-- NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION, no parent memberships.
-- NO PASSWORD or LOGIN change; no HTTP route, Buffer publish or production apply.
-- GUCs are tenant/product filters, NOT authentication. Only a verified server
-- principal and independent restricted direct LOGIN may set these values.
-- PRECONDITIONS: three content_dispatch_* tables FORCE RLS, 0 policies,
-- role has no table grants, revocation composite tenant FK is deployed.
-- @@STEP
GRANT CONNECT ON DATABASE bros_intelligence_dev TO bci_dev_content_reserver;
-- @@STEP
GRANT USAGE ON SCHEMA bci_dev TO bci_dev_content_reserver;
-- @@STEP
GRANT SELECT ON bci_dev.tenant_memberships TO bci_dev_content_reserver;
-- @@STEP
GRANT SELECT ON bci_dev.content_dispatch_approvals TO bci_dev_content_reserver;
-- @@STEP
GRANT SELECT ON bci_dev.content_dispatch_revocations TO bci_dev_content_reserver;
-- @@STEP
GRANT SELECT, INSERT ON bci_dev.content_dispatch_reservations TO bci_dev_content_reserver;
-- @@STEP
CREATE POLICY dev_content_reserver_membership_select
  ON bci_dev.tenant_memberships FOR SELECT TO bci_dev_content_reserver
  USING (principal_id = nullif(current_setting('bci.principal_id', true), '')::uuid
    AND product = 'content' AND active IS TRUE AND revoked_at IS NULL);
-- @@STEP
CREATE POLICY dev_content_reserver_approval_select
  ON bci_dev.content_dispatch_approvals FOR SELECT TO bci_dev_content_reserver
  USING (tenant_id = nullif(current_setting('bci.tenant_id', true), '')::uuid
    AND product = 'content'
    AND nullif(current_setting('bci.product', true), '') = 'content');
-- @@STEP
CREATE POLICY dev_content_reserver_revocation_select
  ON bci_dev.content_dispatch_revocations FOR SELECT TO bci_dev_content_reserver
  USING (tenant_id = nullif(current_setting('bci.tenant_id', true), '')::uuid
    AND product = 'content'
    AND nullif(current_setting('bci.product', true), '') = 'content');
-- @@STEP
CREATE POLICY dev_content_reserver_reservation_select
  ON bci_dev.content_dispatch_reservations FOR SELECT TO bci_dev_content_reserver
  USING (tenant_id = nullif(current_setting('bci.tenant_id', true), '')::uuid
    AND product = 'content'
    AND nullif(current_setting('bci.product', true), '') = 'content');
-- @@STEP
CREATE POLICY dev_content_reserver_reservation_insert
  ON bci_dev.content_dispatch_reservations FOR INSERT TO bci_dev_content_reserver
  WITH CHECK (
    tenant_id = nullif(current_setting('bci.tenant_id', true), '')::uuid
    AND product = 'content'
    AND nullif(current_setting('bci.product', true), '') = 'content'
    AND principal_id = nullif(current_setting('bci.principal_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM bci_dev.tenant_memberships m
      WHERE m.principal_id = principal_id AND m.tenant_id = tenant_id
        AND m.product = 'content' AND m.active IS TRUE AND m.revoked_at IS NULL
    )
  );
-- POSTCONDITIONS: exactly five new policies, four table SELECT grants,
-- one reservation INSERT grant, no other BCI grants; NOLOGIN unchanged.
-- No role can issue/revoke approval, UPDATE/DELETE/TRUNCATE or access
-- evidence/cases/lineage. No synthetic approval counts as human approval.
-- ROLLBACK (DEV only, separately reviewed; do not remove if consumers exist):
-- DROP POLICY dev_content_reserver_reservation_insert ON bci_dev.content_dispatch_reservations;
-- DROP POLICY dev_content_reserver_reservation_select ON bci_dev.content_dispatch_reservations;
-- DROP POLICY dev_content_reserver_revocation_select ON bci_dev.content_dispatch_revocations;
-- DROP POLICY dev_content_reserver_approval_select ON bci_dev.content_dispatch_approvals;
-- DROP POLICY dev_content_reserver_membership_select ON bci_dev.tenant_memberships;
-- REVOKE SELECT, INSERT ON bci_dev.content_dispatch_reservations FROM bci_dev_content_reserver;
-- REVOKE SELECT ON bci_dev.content_dispatch_revocations FROM bci_dev_content_reserver;
-- REVOKE SELECT ON bci_dev.content_dispatch_approvals FROM bci_dev_content_reserver;
-- REVOKE SELECT ON bci_dev.tenant_memberships FROM bci_dev_content_reserver;
-- REVOKE USAGE ON SCHEMA bci_dev FROM bci_dev_content_reserver;
-- REVOKE CONNECT ON DATABASE bros_intelligence_dev FROM bci_dev_content_reserver;
