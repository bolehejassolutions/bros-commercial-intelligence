-- BCI_CONTENT_APPROVAL_RECEIPT_LEAST_PRIVILEGE_DEV_20261031_V1
-- DEV-only additive ACL narrowing for existing restricted reservation LOGIN.
-- One-time guarded change, no table/row deletion, no password, no new role,
-- no publisher/HTTP/Production changes. Must accompany the exact runtime
-- posture guard that expects column-only approval reads.
-- Original migration 0010 granted broad SELECT before 0016 added signed
-- receipt fields; that grant unintentionally includes cryptographic proofs.
-- DO NOT rerun 0008-0017 or apply this to Production.
-- @@STEP
DO $guard$
BEGIN
 IF current_database()<>'bros_intelligence_dev' OR current_user<>'BROS'
   OR (SELECT count(*) FROM bci_dev.content_dispatch_approvals)<>0
   OR (SELECT count(*) FROM bci_dev.content_dispatch_reservations)<>0
   OR NOT has_table_privilege('bci_dev_content_reserver',
        'bci_dev.content_dispatch_approvals','SELECT')
   OR NOT EXISTS (SELECT 1 FROM pg_class c
       WHERE c.oid='bci_dev.content_dispatch_approvals'::regclass
         AND c.relrowsecurity AND c.relforcerowsecurity)
   OR NOT EXISTS (SELECT 1 FROM pg_constraint
       WHERE conrelid='bci_dev.content_dispatch_approvals'::regclass
         AND conname='bci_signed_admission_receipt_hash_integrity'
         AND convalidated)
   OR NOT EXISTS (SELECT 1 FROM pg_roles
       WHERE rolname='bci_dev_content_reserver' AND rolcanlogin
         AND NOT rolbypassrls AND NOT rolsuper AND NOT rolinherit)
 THEN RAISE EXCEPTION 'BCI 0018 DEV precondition failed; do not replay'; END IF;
END $guard$;
-- @@STEP
REVOKE SELECT ON bci_dev.content_dispatch_approvals FROM bci_dev_content_reserver;
-- @@STEP
GRANT SELECT (approval_id,tenant_id,product,dispatch_intent_id,
              binding_sha256,approved_at,expires_at)
 ON bci_dev.content_dispatch_approvals TO bci_dev_content_reserver;
-- @@STEP
DO $check$
DECLARE good boolean; sensitive boolean; broad boolean;
BEGIN
 SELECT bool_and(has_column_privilege('bci_dev_content_reserver',
        'bci_dev.content_dispatch_approvals',c.col,'SELECT')) INTO good
 FROM (VALUES ('approval_id'),('tenant_id'),('product'),('dispatch_intent_id'),
              ('binding_sha256'),('approved_at'),('expires_at')) c(col);
 SELECT bool_or(has_column_privilege('bci_dev_content_reserver',
        'bci_dev.content_dispatch_approvals',c.col,'SELECT')) INTO sensitive
 FROM (VALUES ('signed_review_receipt'),('signed_admission_receipt'),
              ('signed_admission_nonce'),('signed_review_receipt_sha256'),
              ('signed_admission_receipt_sha256'),('signed_review_evidence_id'),
              ('original_media_sha256'),('signed_dispatch_intent_sha256')) c(col);
 SELECT EXISTS (
   SELECT 1 FROM pg_class t
   CROSS JOIN LATERAL aclexplode(COALESCE(t.relacl,
     acldefault('r',t.relowner))) acl
   WHERE t.oid='bci_dev.content_dispatch_approvals'::regclass
     AND acl.privilege_type='SELECT'
     AND acl.grantee IN (0,(SELECT oid FROM pg_roles
                            WHERE rolname='bci_dev_content_reserver'))
 ) INTO broad;
 IF good IS DISTINCT FROM true OR sensitive IS DISTINCT FROM false
    OR broad IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'BCI 0018 DEV column ACL postcondition failed'; END IF;
END $check$;
-- Rollback ONLY after scope/consumer review:
-- REVOKE SELECT (approval_id,tenant_id,product,dispatch_intent_id,
--                binding_sha256,approved_at,expires_at)
--   ON bci_dev.content_dispatch_approvals FROM bci_dev_content_reserver;
-- GRANT SELECT ON bci_dev.content_dispatch_approvals TO bci_dev_content_reserver;
-- This rollback restores prior overly broad visibility; prefer fixing runtime.
