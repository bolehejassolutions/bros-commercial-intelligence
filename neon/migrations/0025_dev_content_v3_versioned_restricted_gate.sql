-- BCI_CONTENT_V3_VERSIONED_RESTRICTED_GATE_20261104
-- DEV-only, one-time transactional migration. Stage until trusted V3 ledger
-- and independent review of exact branch; never apply to Production.
-- Requires empty approval/reservation ledgers and no active reviewer grants.
-- @@STEP
DO $guard$
BEGIN
 IF current_database()<>'bros_intelligence_dev' OR current_user<>'BROS'
 OR (SELECT count(*) FROM bci_dev.content_dispatch_approvals)<>0
 OR (SELECT count(*) FROM bci_dev.content_dispatch_reservations)<>0
 OR (SELECT count(*) FROM bci_dev.content_reviewer_authorizations)<>0
 OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='bci_dev_content_approval_issuer' AND NOT rolcanlogin AND NOT rolbypassrls)
 OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='bci_dev.content_dispatch_approvals'::regclass AND relrowsecurity AND relforcerowsecurity)
 OR (SELECT count(*) FROM pg_constraint WHERE conrelid='bci_dev.content_dispatch_approvals'::regclass
     AND conname IN ('bci_signed_proof_version_check','bci_signed_original_media_count_check','bci_content_v3_script_shape_check'))<>3
 OR (SELECT count(*) FROM information_schema.columns WHERE table_schema='bci_dev'
     AND table_name='content_dispatch_approvals' AND column_name IN
     ('script_proof_envelope_id','signed_script_media_evidence_id','ordered_media_manifest_sha256',
      'signed_script_review_receipt','signed_script_review_receipt_sha256','script_dispatch_binding_sha256'))<>6
 OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='bci_dev'
     AND tablename='content_dispatch_approvals' AND policyname='dev_content_issuer_approval_insert')
 THEN RAISE EXCEPTION 'BCI 0025 precondition failed; do not replay'; END IF;
END $guard$;
-- @@STEP
ALTER TABLE bci_dev.content_dispatch_approvals
 DROP CONSTRAINT bci_signed_proof_version_check,
 ADD CONSTRAINT bci_signed_proof_version_check CHECK (signed_proof_version IN (2,3)),
 DROP CONSTRAINT bci_signed_original_media_count_check,
 ADD CONSTRAINT bci_signed_original_media_count_check CHECK
 ( (signed_proof_version=2 AND original_media_count=1)
   OR (signed_proof_version=3 AND original_media_count BETWEEN 2 AND 6) );
-- @@STEP
DROP POLICY dev_content_issuer_approval_insert ON bci_dev.content_dispatch_approvals;
-- @@STEP
CREATE POLICY dev_content_issuer_approval_insert ON bci_dev.content_dispatch_approvals
 FOR INSERT TO bci_dev_content_approval_issuer
 WITH CHECK (
 tenant_id=nullif(current_setting('bci.tenant_id',true),'')::uuid
 AND approved_by=nullif(current_setting('bci.principal_id',true),'')::uuid
 AND product='content'
 AND ((signed_proof_version=2 AND original_media_count=1
       AND script_proof_envelope_id IS NULL)
   OR (signed_proof_version=3 AND original_media_count BETWEEN 2 AND 6
       AND script_proof_envelope_id IS NOT NULL
       AND signed_script_media_evidence_id IS NOT NULL
       AND ordered_media_manifest_sha256 IS NOT NULL
       AND signed_script_review_receipt IS NOT NULL
       AND signed_script_review_receipt_sha256 IS NOT NULL
       AND script_dispatch_binding_sha256 IS NOT NULL))
 AND approved_at<=clock_timestamp() AND expires_at>clock_timestamp()
 AND expires_at<=clock_timestamp()+interval '24 hours'
 AND EXISTS(SELECT 1 FROM bci_dev.tenant_memberships m
  WHERE m.principal_id=approved_by AND m.tenant_id=bci_dev.content_dispatch_approvals.tenant_id
    AND m.product='content' AND m.active IS TRUE AND m.revoked_at IS NULL)
 AND EXISTS(SELECT 1 FROM bci_dev.content_reviewer_authorizations a
  WHERE a.principal_id=approved_by AND a.tenant_id=bci_dev.content_dispatch_approvals.tenant_id
    AND a.product='content' AND a.revoked_at IS NULL
    AND a.authorized_at<=approved_at)
 );
-- @@STEP
GRANT SELECT (script_proof_envelope_id,signed_script_media_evidence_id,
 ordered_media_manifest_sha256,signed_script_review_receipt_sha256,
 script_dispatch_binding_sha256)
 ON bci_dev.content_dispatch_approvals TO bci_dev_content_approval_issuer;
-- @@STEP
DO $post$
BEGIN
 IF (SELECT count(*) FROM bci_dev.content_dispatch_approvals)<>0
 OR (SELECT count(*) FROM bci_dev.content_dispatch_reservations)<>0
 OR (SELECT rolcanlogin OR rolbypassrls FROM pg_roles
      WHERE rolname='bci_dev_content_approval_issuer') IS DISTINCT FROM FALSE
 OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='bci_dev.content_dispatch_approvals'::regclass
    AND relrowsecurity AND relforcerowsecurity)
 OR has_column_privilege('bci_dev_content_approval_issuer',
    'bci_dev.content_dispatch_approvals','signed_script_review_receipt','SELECT')
 OR (SELECT count(*) FROM pg_policies WHERE schemaname='bci_dev'
     AND tablename='content_dispatch_approvals' AND policyname='dev_content_issuer_approval_insert')<>1
 THEN RAISE EXCEPTION 'BCI 0025 postcondition failed'; END IF;
END $post$;
-- Atomic rollback on any error. Reversal requires explicit review and zero rows;
-- never silently remove V3 columns or alter V2 historical proofs.
