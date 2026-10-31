-- BCI_CONTENT_SIGNED_RECEIPT_HASH_INTEGRITY_DEV_20261031_V1
-- DEV ONLY: existing BCI shared core, no new backend, role, grants or provider dispatch.
-- 0016 stored exact serialized signed receipts and their SHA-256 digests but
-- did not enforce that the supplied digests equal the stored bytes.
-- This prevents false receipt-digest indexes / replay keys; it does NOT
-- authenticate a reviewer or verify Ed25519 signatures.
-- Apply ONCE as a single transaction after 0016, on empty DEV approvals.
-- PostgreSQL built-in sha256(bytea): no pgcrypto extension or new cost.
-- @@STEP
DO $guard$
BEGIN
  IF current_database()<>'bros_intelligence_dev' OR current_user<>'BROS'
    OR (SELECT count(*) FROM bci_dev.content_dispatch_approvals)<>0
    OR (SELECT count(*) FROM bci_dev.content_dispatch_reservations)<>0
    OR to_regprocedure('pg_catalog.sha256(bytea)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='bci_dev' AND table_name='content_dispatch_approvals'
        AND column_name='signed_admission_receipt_sha256')
    OR EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid='bci_dev.content_dispatch_approvals'::regclass
        AND conname IN ('bci_signed_review_receipt_hash_integrity',
                        'bci_signed_admission_receipt_hash_integrity'))
    OR NOT EXISTS (SELECT 1 FROM pg_class c
      WHERE c.oid='bci_dev.content_dispatch_approvals'::regclass
        AND c.relrowsecurity AND c.relforcerowsecurity)
  THEN RAISE EXCEPTION 'BCI DEV 0017 precondition failed; do not replay'; END IF;
END $guard$;
-- @@STEP
ALTER TABLE bci_dev.content_dispatch_approvals
  ADD CONSTRAINT bci_signed_review_receipt_hash_integrity
  CHECK (signed_review_receipt_sha256 =
    encode(pg_catalog.sha256(pg_catalog.convert_to(signed_review_receipt,'UTF8')),'hex'));
-- @@STEP
ALTER TABLE bci_dev.content_dispatch_approvals
  ADD CONSTRAINT bci_signed_admission_receipt_hash_integrity
  CHECK (signed_admission_receipt_sha256 =
    encode(pg_catalog.sha256(pg_catalog.convert_to(signed_admission_receipt,'UTF8')),'hex'));
-- @@STEP
DO $probe$
DECLARE
  p uuid:=gen_random_uuid();
  t uuid:=gen_random_uuid();
  v1 text:='{"version":1,"signedEditorialReceipt":"'||repeat('a',100)||'"}';
  v2 text:='{"version":2,"signedAdmissionReceipt":"'||repeat('b',100)||'"}';
  v1hash text; v2hash text;
  rejected boolean; violated text; marker text;
BEGIN
  v1hash:=encode(pg_catalog.sha256(pg_catalog.convert_to(v1,'UTF8')),'hex');
  v2hash:=encode(pg_catalog.sha256(pg_catalog.convert_to(v2,'UTF8')),'hex');
  BEGIN
    INSERT INTO bci_dev.tenant_memberships(principal_id,tenant_id,product,active)
      VALUES(p,t,'content',true);
    INSERT INTO bci_dev.content_reviewer_authorizations(principal_id,tenant_id,product)
      VALUES(p,t,'content');
    rejected:=false;
    BEGIN
      INSERT INTO bci_dev.content_dispatch_approvals
        (approval_id,tenant_id,product,dispatch_intent_id,approved_by,
         binding_sha256,approved_at,expires_at,signed_proof_version,
         signed_review_evidence_id,original_media_sha256,original_media_count,
         signed_dispatch_intent_sha256,signed_review_receipt,
         signed_admission_receipt,signed_review_receipt_sha256,
         signed_admission_receipt_sha256,signed_admission_nonce)
      VALUES ('bci-0017-bad-v1',t,'content','bci-0017-intent-v1',p,
        repeat('c',64),clock_timestamp(),clock_timestamp()+interval '1 hour',2,
        'bci-0017-evidence',repeat('d',64),1,repeat('e',64),
        v1,v2,repeat('0',64),v2hash,repeat('1',32));
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;
      IF violated<>'bci_signed_review_receipt_hash_integrity' THEN RAISE; END IF;
      rejected:=true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'BCI 0017 wrong V1 digest accepted'; END IF;
    rejected:=false;
    BEGIN
      INSERT INTO bci_dev.content_dispatch_approvals
        (approval_id,tenant_id,product,dispatch_intent_id,approved_by,
         binding_sha256,approved_at,expires_at,signed_proof_version,
         signed_review_evidence_id,original_media_sha256,original_media_count,
         signed_dispatch_intent_sha256,signed_review_receipt,
         signed_admission_receipt,signed_review_receipt_sha256,
         signed_admission_receipt_sha256,signed_admission_nonce)
      VALUES ('bci-0017-bad-v2',t,'content','bci-0017-intent-v2',p,
        repeat('c',64),clock_timestamp(),clock_timestamp()+interval '1 hour',2,
        'bci-0017-evidence',repeat('d',64),1,repeat('e',64),
        v1,v2,v1hash,repeat('0',64),repeat('2',32));
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;
      IF violated<>'bci_signed_admission_receipt_hash_integrity' THEN RAISE; END IF;
      rejected:=true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'BCI 0017 wrong V2 digest accepted'; END IF;
    INSERT INTO bci_dev.content_dispatch_approvals
      (approval_id,tenant_id,product,dispatch_intent_id,approved_by,
       binding_sha256,approved_at,expires_at,signed_proof_version,
       signed_review_evidence_id,original_media_sha256,original_media_count,
       signed_dispatch_intent_sha256,signed_review_receipt,
       signed_admission_receipt,signed_review_receipt_sha256,
       signed_admission_receipt_sha256,signed_admission_nonce)
    VALUES ('bci-0017-valid',t,'content','bci-0017-intent-valid',p,
      repeat('c',64),clock_timestamp(),clock_timestamp()+interval '1 hour',2,
      'bci-0017-evidence',repeat('d',64),1,repeat('e',64),
      v1,v2,v1hash,v2hash,repeat('3',32));
    RAISE EXCEPTION 'BCI_0017_TEST_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS marker=MESSAGE_TEXT;
    IF marker<>'BCI_0017_TEST_ROLLBACK' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM bci_dev.tenant_memberships
      WHERE principal_id=p AND tenant_id=t)
    OR EXISTS (SELECT 1 FROM bci_dev.content_reviewer_authorizations
      WHERE principal_id=p AND tenant_id=t)
    OR EXISTS (SELECT 1 FROM bci_dev.content_dispatch_approvals
      WHERE approval_id LIKE 'bci-0017-%')
  THEN RAISE EXCEPTION 'BCI 0017 rollback residue'; END IF;
  RAISE NOTICE 'BCI 0017 V1/V2 digest negatives, valid positive and rollback PASS';
END $probe$;
-- POSTCONDITIONS: two validated CHECK constraints; existing forced RLS,
-- reviewer triggers, append-only semantics, grants and indexes unchanged.
-- No claim of Ed25519 verification, JWT auth, restricted LOGIN or E2E approval.
