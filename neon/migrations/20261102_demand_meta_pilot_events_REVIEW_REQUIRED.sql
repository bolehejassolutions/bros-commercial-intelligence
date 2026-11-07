-- Owner approved and applied to existing Neon DEV on 2 November 2026.
-- Do not apply to Production or another database/role under this approval.
-- Existing Neon DEV database and existing restricted evidence LOGIN only.
-- No worker, backend, LOGIN, token, production table or scheduler is created.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'bros_intelligence_dev' THEN RAISE EXCEPTION 'DEV database required'; END IF;
END $$;
CREATE TABLE bci_dev.demand_meta_pilot_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  product text NOT NULL CHECK(product='demand'),
  principal_id uuid NOT NULL,
  policy_key text NOT NULL CHECK(policy_key='bros-sell-v5-140myr-7d-20261102-v1'),
  step text NOT NULL CHECK(step IN ('image_a','image_b','adset','creative_a','ad_a','creative_b','ad_b',
    'refresh_flight','activate_ad_a','activate_ad_b','activate_adset','activate_campaign','stop')),
  kind text NOT NULL CHECK(kind IN ('intent','confirmed','revoked')),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=2048),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((kind='revoked')=(step='stop')),
  UNIQUE(tenant_id,product,policy_key,step,kind)
);
ALTER TABLE bci_dev.demand_meta_pilot_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE bci_dev.demand_meta_pilot_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON bci_dev.demand_meta_pilot_events FROM PUBLIC;
CREATE POLICY demand_meta_pilot_select ON bci_dev.demand_meta_pilot_events FOR SELECT
  TO bci_dev_evidence_writer_restricted USING (
    tenant_id=nullif(current_setting('bci.tenant_id',true),'')::uuid AND
    product='demand' AND current_setting('bci.product',true)='demand' AND
    EXISTS(SELECT 1 FROM bci_dev.tenant_memberships m WHERE m.tenant_id=demand_meta_pilot_events.tenant_id
      AND m.principal_id=nullif(current_setting('bci.principal_id',true),'')::uuid
      AND m.product='demand' AND m.active AND m.revoked_at IS NULL)
  );
CREATE POLICY demand_meta_pilot_append ON bci_dev.demand_meta_pilot_events FOR INSERT
  TO bci_dev_evidence_writer_restricted WITH CHECK (
    tenant_id=nullif(current_setting('bci.tenant_id',true),'')::uuid AND
    principal_id=nullif(current_setting('bci.principal_id',true),'')::uuid AND
    product='demand' AND current_setting('bci.product',true)='demand' AND
    EXISTS(SELECT 1 FROM bci_dev.tenant_memberships m WHERE m.tenant_id=demand_meta_pilot_events.tenant_id
      AND m.principal_id=demand_meta_pilot_events.principal_id AND m.product='demand' AND m.active AND m.revoked_at IS NULL)
  );
GRANT SELECT,INSERT ON bci_dev.demand_meta_pilot_events TO bci_dev_evidence_writer_restricted;
COMMIT;
