-- BCI_CONTENT_SIGNED_APPROVAL_PROOF_STORAGE_DEV_20261031_V1
-- DEV ONLY: empty-tooth-43040036 / br-broad-math-b3f4d2r4 / bros_intelligence_dev.
-- One-time additive hardening of the EXISTING append-only approval ledger.
-- Does NOT issue approval, verify Ed25519, enable dispatch, create a role,
-- grant privileges, deploy Preview, or change Production.
-- BCI server must independently authenticate JWT, recheck reviewer membership
-- and authorization, recompute original media, verify V1+V2 signed receipts,
-- then insert all proof fields in one restricted transaction.
-- Raw signed receipt JSON is stored as TEXT to preserve the exact original
-- serialized bytes; digest fields must be recomputed by the trusted issuer.
-- Signed V2 payload includes nonce and complete dispatch intent.
-- @@STEP
DO $guard$
BEGIN
  IF current_database()<>'bros_intelligence_dev' OR current_user<>'BROS'
    OR (SELECT count(*) FROM bci_dev.content_dispatch_approvals)<>0
    OR (SELECT count(*) FROM bci_dev.content_dispatch_reservations)<>0
    OR (SELECT count(*) FROM bci_dev.content_reviewer_authorizations)<>0
    OR EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='bci_dev' AND table_name='content_dispatch_approvals'
        AND column_name IN ('signed_review_evidence_id','signed_admission_receipt'))
    OR NOT EXISTS (SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='bci_dev' AND c.relname='content_dispatch_approvals'
        AND c.relrowsecurity AND c.relforcerowsecurity)
  THEN RAISE EXCEPTION 'BCI DEV signed approval proof precondition failed; do not replay'; END IF;
END
$guard$;
-- @@STEP
ALTER TABLE bci_dev.content_dispatch_approvals
  ADD COLUMN signed_proof_version smallint NOT NULL
    CONSTRAINT bci_signed_proof_version_check CHECK (signed_proof_version=2),
  ADD COLUMN signed_review_evidence_id text NOT NULL
    CONSTRAINT bci_signed_review_evidence_id_check CHECK
      (length(signed_review_evidence_id) BETWEEN 1 AND 160 AND
       signed_review_evidence_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
  ADD COLUMN original_media_sha256 text NOT NULL
    CONSTRAINT bci_signed_original_media_sha256_check CHECK
      (original_media_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN original_media_count smallint NOT NULL
    CONSTRAINT bci_signed_original_media_count_check CHECK (original_media_count=1),
  ADD COLUMN signed_dispatch_intent_sha256 text NOT NULL
    CONSTRAINT bci_signed_dispatch_intent_sha256_check CHECK
      (signed_dispatch_intent_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN signed_review_receipt text NOT NULL
    CONSTRAINT bci_signed_review_receipt_size_check CHECK
      (octet_length(signed_review_receipt) BETWEEN 80 AND 32768),
  ADD COLUMN signed_admission_receipt text NOT NULL
    CONSTRAINT bci_signed_admission_receipt_size_check CHECK
      (octet_length(signed_admission_receipt) BETWEEN 80 AND 32768),
  ADD COLUMN signed_review_receipt_sha256 text NOT NULL
    CONSTRAINT bci_signed_review_receipt_sha256_check CHECK
      (signed_review_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN signed_admission_receipt_sha256 text NOT NULL
    CONSTRAINT bci_signed_admission_receipt_sha256_check CHECK
      (signed_admission_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN signed_admission_nonce text NOT NULL
    CONSTRAINT bci_signed_admission_nonce_check CHECK
      (signed_admission_nonce ~ '^[0-9a-f]{32,64}$');
-- @@STEP
CREATE UNIQUE INDEX bci_content_approval_signed_nonce_unique
 ON bci_dev.content_dispatch_approvals(tenant_id,product,signed_admission_nonce);
-- @@STEP
CREATE UNIQUE INDEX bci_content_approval_signed_v2_receipt_unique
 ON bci_dev.content_dispatch_approvals(tenant_id,product,signed_admission_receipt_sha256);
-- @@STEP
COMMENT ON COLUMN bci_dev.content_dispatch_approvals.signed_admission_receipt IS
 'Exact serialized V2 signed envelope for future restricted issuer/audit; database shape alone is NOT cryptographic verification.';
-- @@STEP
COMMENT ON COLUMN bci_dev.content_dispatch_approvals.signed_review_receipt IS
 'Exact serialized V1 editorial signed envelope; must be verified by trusted server against approved Ed25519 key and reviewer JWT.';
-- @@STEP
COMMENT ON COLUMN bci_dev.content_dispatch_approvals.signed_admission_nonce IS
 'Signed V2 nonce, unique per tenant/product to reject receipt replay; no publishing authorization.';
-- POSTCONDITIONS: 10 new NOT NULL proof columns, two unique indexes;
-- existing FORCE RLS, reviewer/membership triggers and immutable triggers unchanged;
-- no new role, grant, RLS policy, approval, reservation, or provider action.
-- Migration must be applied ONCE atomically only after verifying zero rows.
-- Rollback only if all consumers and approvals remain zero; review first.
