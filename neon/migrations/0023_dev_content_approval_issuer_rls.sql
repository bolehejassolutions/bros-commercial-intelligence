-- BCI_CONTENT_RESTRICTED_APPROVAL_ISSUER_DEV_20261103_V1
-- ONE-TIME DEV-only least-privilege foundation. Not human approval, login,
-- signing-key provisioning, publishing permission or production deployment.
-- Apply as one transaction AFTER exact-source CI and an empty-ledger readback.
DO $guard$
BEGIN
 IF current_database()<>'bros_intelligence_dev' OR current_user<>'BROS'
    OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='bci_dev_content_approval_issuer')
    OR (SELECT count(*) FROM bci_dev.content_dispatch_approvals)<>0
    OR (SELECT count(*) FROM bci_dev.content_dispatch_reservations)<>0
    OR (SELECT count(*) FROM bci_dev.content_reviewer_authorizations)<>0
    OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='bci_dev.content_dispatch_approvals'::regclass
      AND relrowsecurity AND relforcerowsecurity)
    OR NOT EXISTS(SELECT 1 FROM pg_constraint
      WHERE conrelid='bci_dev.content_dispatch_approvals'::regclass
        AND conname='bci_signed_admission_receipt_hash_integrity' AND convalidated)
 THEN RAISE EXCEPTION 'BCI DEV 0023 precondition failed; do not replay'; END IF;
END $guard$;
CREATE ROLE bci_dev_content_approval_issuer NOLOGIN NOINHERIT NOBYPASSRLS
 NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT CONNECT ON DATABASE bros_intelligence_dev TO bci_dev_content_approval_issuer;
GRANT USAGE ON SCHEMA bci_dev TO bci_dev_content_approval_issuer;
GRANT SELECT ON bci_dev.tenant_memberships TO bci_dev_content_approval_issuer;
GRANT SELECT ON bci_dev.content_reviewer_authorizations TO bci_dev_content_approval_issuer;
GRANT INSERT ON bci_dev.content_dispatch_approvals TO bci_dev_content_approval_issuer;
GRANT SELECT (approval_id,tenant_id,product,dispatch_intent_id,approved_by,
 binding_sha256,approved_at,expires_at,signed_proof_version,
 signed_review_evidence_id,original_media_sha256,original_media_count,
 signed_dispatch_intent_sha256,signed_review_receipt_sha256,
 signed_admission_receipt_sha256,signed_admission_nonce)
 ON bci_dev.content_dispatch_approvals TO bci_dev_content_approval_issuer;
CREATE POLICY dev_content_issuer_membership_read ON bci_dev.tenant_memberships
 FOR SELECT TO bci_dev_content_approval_issuer
 USING (principal_id=nullif(current_setting('bci.principal_id',true),'')::uuid
  AND tenant_id=nullif(current_setting('bci.tenant_id',true),'')::uuid
  AND product='content' AND active IS TRUE AND revoked_at IS NULL);
CREATE POLICY dev_content_issuer_reviewer_read ON bci_dev.content_reviewer_authorizations
 FOR SELECT TO bci_dev_content_approval_issuer
 USING (principal_id=nullif(current_setting('bci.principal_id',true),'')::uuid
  AND tenant_id=nullif(current_setting('bci.tenant_id',true),'')::uuid
  AND product='content' AND revoked_at IS NULL
  AND authorized_at<=clock_timestamp());
CREATE POLICY dev_content_issuer_approval_read ON bci_dev.content_dispatch_approvals
 FOR SELECT TO bci_dev_content_approval_issuer
 USING (tenant_id=nullif(current_setting('bci.tenant_id',true),'')::uuid
  AND approved_by=nullif(current_setting('bci.principal_id',true),'')::uuid
  AND product='content');
CREATE POLICY dev_content_issuer_approval_insert ON bci_dev.content_dispatch_approvals
 FOR INSERT TO bci_dev_content_approval_issuer
 WITH CHECK (
  tenant_id=nullif(current_setting('bci.tenant_id',true),'')::uuid
  AND approved_by=nullif(current_setting('bci.principal_id',true),'')::uuid
  AND product='content' AND signed_proof_version=2 AND original_media_count=1
  AND approved_at<=clock_timestamp() AND expires_at>clock_timestamp()
  AND expires_at<=clock_timestamp()+interval '24 hours'
  AND EXISTS(SELECT 1 FROM bci_dev.tenant_memberships m
    WHERE m.principal_id=approved_by AND m.tenant_id=nullif(current_setting('bci.tenant_id',true),'')::uuid
      AND m.product='content' AND m.active IS TRUE AND m.revoked_at IS NULL)
  AND EXISTS(SELECT 1 FROM bci_dev.content_reviewer_authorizations a
    WHERE a.principal_id=approved_by AND a.tenant_id=nullif(current_setting('bci.tenant_id',true),'')::uuid
      AND a.product='content' AND a.revoked_at IS NULL
      AND a.authorized_at<=approved_at)
 );
DO $post$
BEGIN
 IF (SELECT rolcanlogin OR rolinherit OR rolbypassrls OR rolcreaterole OR rolcreatedb
     FROM pg_roles WHERE rolname='bci_dev_content_approval_issuer')
    OR has_table_privilege('bci_dev_content_approval_issuer',
      'bci_dev.content_dispatch_reservations','INSERT')
    OR has_table_privilege('bci_dev_content_approval_issuer',
      'bci_dev.content_reviewer_authorizations','INSERT')
    OR has_column_privilege('bci_dev_content_approval_issuer',
      'bci_dev.content_dispatch_approvals','signed_review_receipt','SELECT')
    OR has_column_privilege('bci_dev_content_approval_issuer',
      'bci_dev.content_dispatch_approvals','signed_admission_receipt','SELECT')
    OR (SELECT count(*) FROM pg_policies WHERE schemaname='bci_dev'
      AND policyname LIKE 'dev_content_issuer_%')<>4
 THEN RAISE EXCEPTION 'BCI DEV 0023 least-privilege postcondition failed'; END IF;
END $post$;
-- NOLOGIN remains until separately verified provider-managed credential and
-- server-only cryptographic verifier/source-byte binding are operational.
-- Do not issue human reviewer authorization or insert approvals from BROS admin.
