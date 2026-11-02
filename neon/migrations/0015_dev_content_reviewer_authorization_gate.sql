-- BCI_CONTENT_REVIEWER_AUTHORIZATION_GATE_DEV_20261031_V1
-- DEV only: empty-tooth-43040036 / br-broad-math-b3f4d2r4 / bros_intelligence_dev.
-- Separate reviewer authorization from ordinary tenant membership.
-- This is defense in depth, NOT trusted human approval issuance or signed media proof.
-- NO role grants, customer data, production or dispatch enablement. Apply ONCE atomically.
-- @@STEP
DO $$
BEGIN
  IF current_database()<>'bros_intelligence_dev' OR current_user<>'BROS'
    OR to_regclass('bci_dev.content_reviewer_authorizations') IS NOT NULL
    OR to_regprocedure('bci_dev.require_content_reviewer_authorization()') IS NOT NULL
    OR (SELECT count(*) FROM bci_dev.content_dispatch_approvals)<>0
    OR (SELECT count(*) FROM bci_dev.content_dispatch_reservations)<>0
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='bci_dev.content_dispatch_approvals'::regclass
       AND tgname='content_approval_reviewer_active_insert' AND tgenabled='O')
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='bci_dev.content_dispatch_reservations'::regclass
       AND tgname='content_reservation_active_reviewer_insert' AND tgenabled='O')
  THEN RAISE EXCEPTION 'BCI DEV 0015 precondition failed; do not replay'; END IF;
END $$;
-- @@STEP
CREATE TABLE bci_dev.content_reviewer_authorizations (
  authorization_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  product text NOT NULL CHECK (product='content'),
  authorized_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(authorized_at)),
  revoked_at timestamptz CHECK (revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at>=authorized_at)),
  CONSTRAINT bci_content_reviewer_authorization_membership_fk
    FOREIGN KEY (principal_id,tenant_id,product)
    REFERENCES bci_dev.tenant_memberships(principal_id,tenant_id,product)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);
-- @@STEP
CREATE UNIQUE INDEX bci_content_one_active_reviewer_authorization_idx
 ON bci_dev.content_reviewer_authorizations(principal_id,tenant_id,product)
 WHERE revoked_at IS NULL;
-- @@STEP
ALTER TABLE bci_dev.content_reviewer_authorizations ENABLE ROW LEVEL SECURITY;
-- @@STEP
ALTER TABLE bci_dev.content_reviewer_authorizations FORCE ROW LEVEL SECURITY;
-- @@STEP
CREATE FUNCTION bci_dev.require_content_reviewer_authorization()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE reviewer uuid;
BEGIN
  IF TG_OP<>'INSERT' OR TG_TABLE_SCHEMA<>'bci_dev'
    OR current_database()<>'bros_intelligence_dev' OR NEW.product<>'content' THEN
    RAISE EXCEPTION 'BCI CONTENT reviewer authorization denied'
      USING ERRCODE='23514', CONSTRAINT='bci_content_reviewer_authorization_required';
  END IF;
  IF TG_TABLE_NAME='content_dispatch_approvals' THEN
    reviewer:=NEW.approved_by;
  ELSIF TG_TABLE_NAME='content_dispatch_reservations' THEN
    SELECT a.approved_by INTO reviewer FROM bci_dev.content_dispatch_approvals a
      WHERE a.approval_id=NEW.approval_id AND a.tenant_id=NEW.tenant_id
        AND a.product=NEW.product AND a.dispatch_intent_id=NEW.dispatch_intent_id
        AND a.binding_sha256=NEW.binding_sha256;
  ELSE
    RAISE EXCEPTION 'BCI CONTENT reviewer authorization denied'
      USING ERRCODE='23514', CONSTRAINT='bci_content_reviewer_authorization_required';
  END IF;
  IF reviewer IS NULL OR NOT EXISTS (
    SELECT 1 FROM bci_dev.content_reviewer_authorizations a
    JOIN bci_dev.tenant_memberships m
      ON m.principal_id=a.principal_id AND m.tenant_id=a.tenant_id AND m.product=a.product
    WHERE a.principal_id=reviewer AND a.tenant_id=NEW.tenant_id AND a.product='content'
      AND a.revoked_at IS NULL AND a.authorized_at<=clock_timestamp()
      AND m.active IS TRUE AND m.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'BCI CONTENT reviewer authorization denied'
      USING ERRCODE='23514', CONSTRAINT='bci_content_reviewer_authorization_required';
  END IF;
  RETURN NEW;
END;
$fn$;
-- @@STEP
REVOKE ALL ON FUNCTION bci_dev.require_content_reviewer_authorization() FROM PUBLIC;
-- @@STEP
CREATE TRIGGER content_approval_reviewer_authorization_insert
 BEFORE INSERT ON bci_dev.content_dispatch_approvals
 FOR EACH ROW EXECUTE FUNCTION bci_dev.require_content_reviewer_authorization();
-- @@STEP
CREATE TRIGGER content_reservation_reviewer_authorization_insert
 BEFORE INSERT ON bci_dev.content_dispatch_reservations
 FOR EACH ROW EXECUTE FUNCTION bci_dev.require_content_reviewer_authorization();
-- @@STEP
COMMENT ON TABLE bci_dev.content_reviewer_authorizations IS
 'DEV-only explicit reviewer role; no consumer grants. A row is NOT a signed human decision.';
-- @@STEP
DO $$
DECLARE
 p uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); auth uuid;
 marker text; violated text; caught boolean:=false;
BEGIN
 IF current_database()<>'bros_intelligence_dev'
   OR (SELECT count(*) FROM bci_dev.content_dispatch_approvals)<>0
   OR (SELECT count(*) FROM bci_dev.content_dispatch_reservations)<>0
 THEN RAISE EXCEPTION 'BCI DEV 0015 test precondition failed'; END IF;
 BEGIN
   INSERT INTO bci_dev.tenant_memberships(principal_id,tenant_id,product,active)
     VALUES(p,t,'content',true);
   BEGIN
     INSERT INTO bci_dev.content_dispatch_approvals
       (approval_id,tenant_id,product,dispatch_intent_id,approved_by,binding_sha256,approved_at,expires_at)
     VALUES('bci-0015-no-role',t,'content','bci-0015-intent-no-role',p,repeat('a',64),
       clock_timestamp(),clock_timestamp()+interval '1 hour');
   EXCEPTION WHEN check_violation THEN
     GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;
     IF violated<>'bci_content_reviewer_authorization_required' THEN RAISE; END IF;
     caught:=true;
   END;
   IF NOT caught THEN RAISE EXCEPTION 'BCI 0015 no-role approval accepted'; END IF;
   INSERT INTO bci_dev.content_reviewer_authorizations(principal_id,tenant_id,product)
     VALUES(p,t,'content') RETURNING authorization_id INTO auth;
   INSERT INTO bci_dev.content_dispatch_approvals
     (approval_id,tenant_id,product,dispatch_intent_id,approved_by,binding_sha256,approved_at,expires_at)
   VALUES('bci-0015-valid-role',t,'content','bci-0015-intent-valid-role',p,repeat('b',64),
     clock_timestamp(),clock_timestamp()+interval '1 hour');
   INSERT INTO bci_dev.content_dispatch_reservations
     (approval_id,tenant_id,product,dispatch_intent_id,principal_id,binding_sha256)
   VALUES('bci-0015-valid-role',t,'content','bci-0015-intent-valid-role',p,repeat('b',64));
   UPDATE bci_dev.content_reviewer_authorizations
     SET revoked_at=clock_timestamp() WHERE authorization_id=auth;
   caught:=false;
   BEGIN
     INSERT INTO bci_dev.content_dispatch_reservations
       (approval_id,tenant_id,product,dispatch_intent_id,principal_id,binding_sha256)
     VALUES('bci-0015-valid-role',t,'content','bci-0015-intent-valid-role',p,repeat('b',64))
     ON CONFLICT (tenant_id,product,dispatch_intent_id) DO NOTHING;
   EXCEPTION WHEN check_violation THEN
     GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;
     IF violated<>'bci_content_reviewer_authorization_required' THEN RAISE; END IF;
     caught:=true;
   END;
   IF NOT caught THEN RAISE EXCEPTION 'BCI 0015 revoked reviewer reservation replay accepted'; END IF;
   RAISE EXCEPTION 'BCI_0015_TEST_ROLLBACK';
 EXCEPTION WHEN raise_exception THEN
   GET STACKED DIAGNOSTICS marker=MESSAGE_TEXT;
   IF marker<>'BCI_0015_TEST_ROLLBACK' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM bci_dev.tenant_memberships WHERE principal_id=p AND tenant_id=t)
   OR EXISTS(SELECT 1 FROM bci_dev.content_reviewer_authorizations WHERE principal_id=p AND tenant_id=t)
   OR EXISTS(SELECT 1 FROM bci_dev.content_dispatch_approvals WHERE approval_id='bci-0015-valid-role')
   OR EXISTS(SELECT 1 FROM bci_dev.content_dispatch_reservations WHERE approval_id='bci-0015-valid-role')
 THEN RAISE EXCEPTION 'BCI 0015 probe residue'; END IF;
 RAISE NOTICE 'BCI 0015 no-role negative, explicit-role positive, post-revocation replay negative, rollback PASS';
END $$;
-- Rollback only after confirming zero consumer records and dependencies:
-- DROP TRIGGER content_reservation_reviewer_authorization_insert ON bci_dev.content_dispatch_reservations;
-- DROP TRIGGER content_approval_reviewer_authorization_insert ON bci_dev.content_dispatch_approvals;
-- DROP FUNCTION bci_dev.require_content_reviewer_authorization();
-- DROP TABLE bci_dev.content_reviewer_authorizations;
