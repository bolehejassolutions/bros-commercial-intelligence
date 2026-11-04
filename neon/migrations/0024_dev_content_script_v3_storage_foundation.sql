-- BCI_DEV_SCRIPT_V3_STORAGE_FOUNDATION_20261104
-- Additive schema storage only. No data, role, credentials, auth, approval,
-- reservation, RLS policy, existing constraint or Production changes.
-- Existing V2-only proof-version/media-count constraints deliberately remain
-- in force: V3 issuance stays blocked until separately verified trusted issuer,
-- domain-separated signed dispatch intent and provider-backed authenticated acceptance.
-- Run once in existing Neon DEV, atomic transaction, after zero-row provider readback.
-- @@STEP
DO $guard$
BEGIN
 IF current_database()<>'bros_intelligence_dev' OR current_user<>'BROS'
 OR (SELECT count(*) FROM bci_dev.content_dispatch_approvals)<>0
 OR (SELECT count(*) FROM bci_dev.content_dispatch_reservations)<>0
 OR (SELECT count(*) FROM bci_dev.content_reviewer_authorizations)<>0
 OR NOT EXISTS(SELECT 1 FROM pg_roles
  WHERE rolname='bci_dev_content_approval_issuer' AND rolcanlogin=false)
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE
  conrelid='bci_dev.content_dispatch_approvals'::regclass
  AND conname='bci_signed_proof_version_check'
  AND pg_get_constraintdef(oid) LIKE '%signed_proof_version = 2%')
 OR EXISTS(SELECT 1 FROM information_schema.columns WHERE
  table_schema='bci_dev' AND table_name='content_dispatch_approvals'
  AND column_name='script_proof_envelope_id')
 THEN RAISE EXCEPTION 'BCI 0024 precondition failed; no replay'; END IF;
END $guard$;

-- @@STEP
ALTER TABLE bci_dev.content_dispatch_approvals
 ADD COLUMN script_proof_envelope_id text,
 ADD COLUMN signed_script_media_evidence_id text,
 ADD COLUMN ordered_media_manifest_sha256 text,
 ADD COLUMN signed_script_review_receipt text,
 ADD COLUMN signed_script_review_receipt_sha256 text,
 ADD COLUMN script_dispatch_binding_sha256 text;

-- @@STEP
ALTER TABLE bci_dev.content_dispatch_approvals
 ADD CONSTRAINT bci_content_v3_script_shape_check CHECK (
  (signed_proof_version=2
   AND script_proof_envelope_id IS NULL
   AND signed_script_media_evidence_id IS NULL
   AND ordered_media_manifest_sha256 IS NULL
   AND signed_script_review_receipt IS NULL
   AND signed_script_review_receipt_sha256 IS NULL
   AND script_dispatch_binding_sha256 IS NULL)
  OR
  (signed_proof_version=3
   AND original_media_count BETWEEN 2 AND 6
   AND script_proof_envelope_id ~ '^content-instance-script-proof-[0-9a-f]{64}$'
   AND signed_script_media_evidence_id ~ '^content-instance-script-signed-[0-9a-f]{64}$'
   AND ordered_media_manifest_sha256 ~ '^[0-9a-f]{64}$'
   AND octet_length(signed_script_review_receipt) BETWEEN 80 AND 32768
   AND signed_script_review_receipt_sha256 ~ '^[0-9a-f]{64}$'
   AND script_dispatch_binding_sha256 ~ '^[0-9a-f]{64}$'
   AND script_proof_envelope_id IS NOT NULL
   AND signed_script_media_evidence_id IS NOT NULL
   AND ordered_media_manifest_sha256 IS NOT NULL
   AND signed_script_review_receipt IS NOT NULL
   AND signed_script_review_receipt_sha256 IS NOT NULL
   AND script_dispatch_binding_sha256 IS NOT NULL)
 );

-- @@STEP
CREATE UNIQUE INDEX bci_content_v3_script_receipt_replay_unique
 ON bci_dev.content_dispatch_approvals
 (tenant_id,product,signed_script_review_receipt_sha256)
 WHERE signed_script_review_receipt_sha256 IS NOT NULL;

-- @@STEP
DO $post$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_class
  WHERE oid='bci_dev.content_dispatch_approvals'::regclass
    AND relrowsecurity AND relforcerowsecurity)
 OR (SELECT rolcanlogin FROM pg_roles
  WHERE rolname='bci_dev_content_approval_issuer') IS DISTINCT FROM FALSE
 OR (SELECT count(*) FROM pg_constraint
  WHERE conrelid='bci_dev.content_dispatch_approvals'::regclass
    AND conname IN ('bci_signed_proof_version_check',
     'bci_signed_original_media_count_check','bci_content_v3_script_shape_check'))<>3
 OR (SELECT count(*) FROM bci_dev.content_dispatch_approvals)<>0
 OR has_column_privilege('bci_dev_content_approval_issuer',
  'bci_dev.content_dispatch_approvals','signed_script_review_receipt','SELECT')
 THEN RAISE EXCEPTION 'BCI 0024 postcondition failed'; END IF;
END $post$;
