-- Existing DEV only: extend the existing append-only pilot journal to separate
-- immutable paused campaign plans. No new role, table, grants or RLS changes.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'bros_intelligence_dev' THEN RAISE EXCEPTION 'DEV database required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='bci_dev.demand_meta_pilot_events'::regclass
    AND conname='demand_meta_pilot_events_policy_key_check'
    AND pg_get_constraintdef(oid) LIKE '%bros-sell-v5-140myr-7d-20261102-v1%')
  THEN RAISE EXCEPTION 'Original pilot policy constraint required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='bci_dev.demand_meta_pilot_events'::regclass
    AND relrowsecurity AND relforcerowsecurity) THEN RAISE EXCEPTION 'Forced RLS required'; END IF;
END $$;
LOCK TABLE bci_dev.demand_meta_pilot_events IN ACCESS EXCLUSIVE MODE;
ALTER TABLE bci_dev.demand_meta_pilot_events DROP CONSTRAINT demand_meta_pilot_events_policy_key_check;
ALTER TABLE bci_dev.demand_meta_pilot_events ADD CONSTRAINT demand_meta_pilot_events_policy_key_check
  CHECK(policy_key='bros-sell-v5-140myr-7d-20261102-v1' OR policy_key~'^bros-demand-paused-v1:[a-f0-9]{64}$');
ALTER TABLE bci_dev.demand_meta_pilot_events DROP CONSTRAINT demand_meta_pilot_events_step_check;
ALTER TABLE bci_dev.demand_meta_pilot_events ADD CONSTRAINT demand_meta_pilot_events_step_check
  CHECK(step IN ('image_a','image_b','campaign','adset','creative_a','ad_a','creative_b','ad_b',
    'refresh_flight','activate_ad_a','activate_ad_b','activate_adset','activate_campaign','stop'));
ALTER TABLE bci_dev.demand_meta_pilot_events ADD CONSTRAINT demand_meta_paused_namespace_steps
  CHECK(policy_key='bros-sell-v5-140myr-7d-20261102-v1' AND step<>'campaign'
    OR policy_key~'^bros-demand-paused-v1:[a-f0-9]{64}$' AND step IN ('campaign','adset','creative_a','ad_a')
      AND kind IN ('intent','confirmed'));
COMMIT;
