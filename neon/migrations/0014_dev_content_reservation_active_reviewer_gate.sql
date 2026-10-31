-- BCI_CONTENT_REVIEWER_REVOCATION_RESERVATION_GATE_DEV_20261031_V1
-- DEV ONLY: empty-tooth-43040036 / br-broad-math-b3f4d2r4 / bros_intelligence_dev.
-- After 0013, revalidate the CURRENT reviewer membership for every INSERT
-- attempt, including ON CONFLICT DO NOTHING replay. The requester may differ
-- from the reviewer. No extra grants, new roles, public function entrypoint,
-- client authority, or changes to existing immutable approvals/reservations.
-- SECURITY DEFINER is narrowly limited to a trigger on the reservation table;
-- its owner BROS can see the otherwise RLS-hidden delegated reviewer. This
-- does not prove authenticated issuance, JWT/LOGIN, or pre-dispatch validity.
-- @@STEP
DO $$
BEGIN
  IF current_database() <> 'bros_intelligence_dev'
    OR current_user <> 'BROS'
    OR (SELECT count(*) FROM bci_dev.content_dispatch_approvals) <> 0
    OR (SELECT count(*) FROM bci_dev.content_dispatch_reservations) <> 0
    OR (SELECT count(*) FROM bci_dev.content_dispatch_revocations) <> 0
    OR to_regprocedure('bci_dev.require_active_content_reservation_reviewer()') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_trigger
       WHERE tgrelid='bci_dev.content_dispatch_reservations'::regclass
         AND tgname='content_reservation_active_reviewer_insert')
    OR NOT EXISTS (SELECT 1 FROM pg_trigger
       WHERE tgrelid='bci_dev.content_dispatch_approvals'::regclass
         AND tgname='content_approval_reviewer_active_insert' AND tgenabled='O')
    OR NOT EXISTS (SELECT 1 FROM pg_constraint
       WHERE conrelid='bci_dev.content_dispatch_approvals'::regclass
         AND conname='bci_content_approval_reviewer_membership_fk' AND convalidated)
  THEN RAISE EXCEPTION 'BCI DEV 0014 precondition failed; do not replay'; END IF;
END $$;
-- @@STEP
CREATE FUNCTION bci_dev.require_active_content_reservation_reviewer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE reviewer uuid;
BEGIN
  IF TG_OP <> 'INSERT' OR TG_TABLE_SCHEMA <> 'bci_dev'
    OR TG_TABLE_NAME <> 'content_dispatch_reservations'
    OR current_database() <> 'bros_intelligence_dev'
    OR NEW.product <> 'content' THEN
    RAISE EXCEPTION 'BCI CONTENT reservation denied'
      USING ERRCODE='23514', CONSTRAINT='bci_content_reservation_active_reviewer';
  END IF;
  SELECT a.approved_by INTO reviewer
  FROM bci_dev.content_dispatch_approvals a
  WHERE a.approval_id=NEW.approval_id AND a.tenant_id=NEW.tenant_id
    AND a.product=NEW.product AND a.dispatch_intent_id=NEW.dispatch_intent_id
    AND a.binding_sha256=NEW.binding_sha256
    AND a.approved_at <= clock_timestamp() AND a.expires_at > clock_timestamp()
    AND NOT EXISTS (SELECT 1 FROM bci_dev.content_dispatch_revocations v
      WHERE v.approval_id=a.approval_id AND v.tenant_id=a.tenant_id AND v.product=a.product);
  IF reviewer IS NULL
    OR NOT EXISTS (SELECT 1 FROM bci_dev.tenant_memberships m
       WHERE m.principal_id=reviewer AND m.tenant_id=NEW.tenant_id
         AND m.product='content' AND m.active IS TRUE AND m.revoked_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM bci_dev.tenant_memberships m
       WHERE m.principal_id=NEW.principal_id AND m.tenant_id=NEW.tenant_id
         AND m.product='content' AND m.active IS TRUE AND m.revoked_at IS NULL)
  THEN
    RAISE EXCEPTION 'BCI CONTENT reservation denied'
      USING ERRCODE='23514', CONSTRAINT='bci_content_reservation_active_reviewer';
  END IF;
  RETURN NEW;
END;
$fn$;
-- @@STEP
REVOKE ALL ON FUNCTION bci_dev.require_active_content_reservation_reviewer() FROM PUBLIC;
-- @@STEP
CREATE TRIGGER content_reservation_active_reviewer_insert
BEFORE INSERT ON bci_dev.content_dispatch_reservations
FOR EACH ROW EXECUTE FUNCTION bci_dev.require_active_content_reservation_reviewer();
-- @@STEP
COMMENT ON TRIGGER content_reservation_active_reviewer_insert
ON bci_dev.content_dispatch_reservations IS
'DEV-only active reviewer/requester and unrevoked approval check at every INSERT attempt; delegated reviewer permitted; recheck again before dispatch.';
-- @@STEP
DO $$
DECLARE
  reviewer uuid:=gen_random_uuid();
  requester uuid:=gen_random_uuid();
  tenant uuid:=gen_random_uuid();
  approval text:='bci-0014-'||replace(gen_random_uuid()::text,'-','');
  intent text:='bci-0014-intent-'||replace(gen_random_uuid()::text,'-','');
  digest text:=repeat('a',64);
  caught boolean:=false;
  constraint_name text;
  marker text;
BEGIN
  IF (SELECT count(*) FROM bci_dev.content_dispatch_approvals)<>0
    OR (SELECT count(*) FROM bci_dev.content_dispatch_reservations)<>0
  THEN RAISE EXCEPTION 'BCI DEV 0014 probe precondition failed'; END IF;
  BEGIN
    INSERT INTO bci_dev.tenant_memberships(principal_id,tenant_id,product,active)
      VALUES (reviewer,tenant,'content',true),(requester,tenant,'content',true);
    INSERT INTO bci_dev.content_dispatch_approvals
      (approval_id,tenant_id,product,dispatch_intent_id,approved_by,binding_sha256,approved_at,expires_at)
      VALUES (approval,tenant,'content',intent,reviewer,digest,clock_timestamp(),clock_timestamp()+interval '1 hour');
    -- A delegated requester may reserve while a DIFFERENT reviewer is active.
    INSERT INTO bci_dev.content_dispatch_reservations
      (approval_id,tenant_id,product,dispatch_intent_id,principal_id,binding_sha256)
      VALUES (approval,tenant,'content',intent,requester,digest);
    IF (SELECT count(*) FROM bci_dev.content_dispatch_reservations WHERE approval_id=approval)<>1
      THEN RAISE EXCEPTION 'BCI DEV 0014 delegated positive failed'; END IF;
    UPDATE bci_dev.tenant_memberships SET active=false,revoked_at=clock_timestamp()
      WHERE principal_id=reviewer AND tenant_id=tenant AND product='content';
    -- PostgreSQL BEFORE INSERT triggers must run even for a conflicting
    -- ON CONFLICT DO NOTHING. A stale reserved intent must fail closed.
    BEGIN
      INSERT INTO bci_dev.content_dispatch_reservations
        (approval_id,tenant_id,product,dispatch_intent_id,principal_id,binding_sha256)
        VALUES (approval,tenant,'content',intent,requester,digest)
        ON CONFLICT (tenant_id,product,dispatch_intent_id) DO NOTHING;
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
      IF constraint_name <> 'bci_content_reservation_active_reviewer' THEN RAISE; END IF;
      caught:=true;
    END;
    IF NOT caught THEN RAISE EXCEPTION 'BCI DEV 0014 revoked reviewer replay accepted'; END IF;
    RAISE EXCEPTION 'BCI_0014_TEST_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS marker=MESSAGE_TEXT;
    IF marker <> 'BCI_0014_TEST_ROLLBACK' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM bci_dev.content_dispatch_approvals WHERE approval_id=approval)
    OR EXISTS (SELECT 1 FROM bci_dev.content_dispatch_reservations WHERE approval_id=approval)
    OR EXISTS (SELECT 1 FROM bci_dev.tenant_memberships WHERE principal_id IN (reviewer,requester))
  THEN RAISE EXCEPTION 'BCI DEV 0014 probe residue'; END IF;
  RAISE NOTICE 'BCI 0014 delegated positive PASS; post-revocation conflict negative PASS; rollback PASS';
END $$;
-- DEV rollback only after verifying no consumers:
-- DROP TRIGGER content_reservation_active_reviewer_insert ON bci_dev.content_dispatch_reservations;
-- DROP FUNCTION bci_dev.require_active_content_reservation_reviewer();
