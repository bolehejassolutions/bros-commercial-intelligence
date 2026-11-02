-- BCI_CONTENT_DURABLE_APPROVAL_RESERVATION_DEV_20261030_V1
-- DEV ONLY: empty-tooth-43040036 / br-broad-math-b3f4d2r4 / bros_intelligence_dev.
-- BCI shared private core; CONTENT consumes this contract, DEMAND never duplicates it.
-- Structural foundation ONLY: no app role grants, no API route, no trusted
-- approval issuance, no authenticated reservation adapter, no Buffer dispatch.
-- Approval must originate from a separately verified human editorial decision;
-- a row inserted by BROS admin in a test is NOT evidence of that decision.
-- Existing lineage DDL must NOT be replayed. Transactional and non-destructive
-- against the seven existing tables. Do not apply to Production.
-- Preconditions: the three content_dispatch_* tables and reject function absent.
-- @@STEP
CREATE TABLE bci_dev.content_dispatch_approvals (
  approval_id text NOT NULL CHECK (length(approval_id) BETWEEN 1 AND 160 AND approval_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
  tenant_id uuid NOT NULL,
  product text NOT NULL DEFAULT 'content' CHECK (product = 'content'),
  dispatch_intent_id text NOT NULL CHECK (length(dispatch_intent_id) BETWEEN 1 AND 160 AND dispatch_intent_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
  approved_by uuid NOT NULL,
  binding_sha256 text NOT NULL CHECK (binding_sha256 ~ '^[0-9a-f]{64}$'),
  approved_at timestamptz NOT NULL CHECK (isfinite(approved_at)),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
  CHECK (expires_at > approved_at),
  PRIMARY KEY (approval_id),
  UNIQUE (approval_id, tenant_id, product, dispatch_intent_id, binding_sha256)
);
-- @@STEP
CREATE INDEX bci_content_approval_intent_idx ON bci_dev.content_dispatch_approvals (tenant_id, product, dispatch_intent_id, expires_at DESC);
-- @@STEP
CREATE TABLE bci_dev.content_dispatch_revocations (
  approval_id text NOT NULL,
  tenant_id uuid NOT NULL,
  product text NOT NULL DEFAULT 'content' CHECK (product = 'content'),
  revoked_by uuid NOT NULL,
  revoked_at timestamptz NOT NULL CHECK (isfinite(revoked_at)),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
  PRIMARY KEY (approval_id),
  FOREIGN KEY (approval_id) REFERENCES bci_dev.content_dispatch_approvals (approval_id) ON DELETE RESTRICT
);
-- @@STEP
CREATE TABLE bci_dev.content_dispatch_reservations (
  reservation_id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  approval_id text NOT NULL,
  tenant_id uuid NOT NULL,
  product text NOT NULL DEFAULT 'content' CHECK (product = 'content'),
  dispatch_intent_id text NOT NULL,
  principal_id uuid NOT NULL,
  binding_sha256 text NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT now() CHECK (isfinite(reserved_at)),
  UNIQUE (tenant_id, product, dispatch_intent_id),
  FOREIGN KEY (approval_id, tenant_id, product, dispatch_intent_id, binding_sha256)
    REFERENCES bci_dev.content_dispatch_approvals (approval_id, tenant_id, product, dispatch_intent_id, binding_sha256)
    ON DELETE RESTRICT
);
-- @@STEP
CREATE FUNCTION bci_dev.reject_content_dispatch_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'BCI dispatch ledger is append-only' USING ERRCODE = '55000';
END;
$$;
-- @@STEP
REVOKE ALL ON FUNCTION bci_dev.reject_content_dispatch_mutation() FROM PUBLIC;
-- @@STEP
CREATE TRIGGER content_approvals_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON bci_dev.content_dispatch_approvals
  FOR EACH STATEMENT EXECUTE FUNCTION bci_dev.reject_content_dispatch_mutation();
-- @@STEP
CREATE TRIGGER content_revocations_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON bci_dev.content_dispatch_revocations
  FOR EACH STATEMENT EXECUTE FUNCTION bci_dev.reject_content_dispatch_mutation();
-- @@STEP
CREATE TRIGGER content_reservations_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON bci_dev.content_dispatch_reservations
  FOR EACH STATEMENT EXECUTE FUNCTION bci_dev.reject_content_dispatch_mutation();
-- @@STEP
ALTER TABLE bci_dev.content_dispatch_approvals ENABLE ROW LEVEL SECURITY;
-- @@STEP
ALTER TABLE bci_dev.content_dispatch_approvals FORCE ROW LEVEL SECURITY;
-- @@STEP
ALTER TABLE bci_dev.content_dispatch_revocations ENABLE ROW LEVEL SECURITY;
-- @@STEP
ALTER TABLE bci_dev.content_dispatch_revocations FORCE ROW LEVEL SECURITY;
-- @@STEP
ALTER TABLE bci_dev.content_dispatch_reservations ENABLE ROW LEVEL SECURITY;
-- @@STEP
ALTER TABLE bci_dev.content_dispatch_reservations FORCE ROW LEVEL SECURITY;
-- @@STEP
REVOKE ALL ON bci_dev.content_dispatch_approvals FROM PUBLIC;
-- @@STEP
REVOKE ALL ON bci_dev.content_dispatch_revocations FROM PUBLIC;
-- @@STEP
REVOKE ALL ON bci_dev.content_dispatch_reservations FROM PUBLIC;
-- @@STEP
COMMENT ON TABLE bci_dev.content_dispatch_approvals IS 'BCI DEV ONLY: durable immutable approval claims; no trusted human issuance or app grant yet.';
-- @@STEP
COMMENT ON TABLE bci_dev.content_dispatch_revocations IS 'BCI DEV ONLY: append-only revocation claims; no app grant yet.';
-- @@STEP
COMMENT ON TABLE bci_dev.content_dispatch_reservations IS 'BCI DEV ONLY: unique intent reservations; NOT provider SENT, attestation or permission to publish.';
-- Postconditions: exactly three new FORCE RLS tables; zero RLS policies and
-- zero app role/PUBLIC grants on all three; immutable statement triggers.
-- No SECURITY DEFINER. No credentials. No data created.
-- Rollback only after confirming ALL three new tables empty and no consumers:
-- DROP TABLE bci_dev.content_dispatch_reservations;
-- DROP TABLE bci_dev.content_dispatch_revocations;
-- DROP TABLE bci_dev.content_dispatch_approvals;
-- DROP FUNCTION bci_dev.reject_content_dispatch_mutation();
-- Next: BCI-owned trusted human approval issuance + atomic transaction adapter
-- with authoritative membership, approval expiry/revocation and replay tests.
