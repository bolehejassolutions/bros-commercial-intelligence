-- Neon-only INTERNAL DEVELOPMENT schema, branch main of bros-shared-intelligence-dev.
-- Separate from existing Supabase public.* migrations and production deployments.
-- Execute using authenticated Neon role BROS only, no customer-facing API or GRANT to PUBLIC.
-- RLS tenant context is self-settable, suitable ONLY as an internal smoke-test boundary.
-- Never interpret tenant GUC policy as safe tenant authentication in a deployed multi-tenant application.
-- Synthetic data only. No HitPay/customer PII, payment commands, ad spending, or app credentials.
-- Each -- @@STEP marker begins one statement for guarded application via run_sql_transaction.

-- @@STEP
CREATE SCHEMA IF NOT EXISTS bci_dev AUTHORIZATION "BROS";

-- @@STEP
REVOKE ALL ON SCHEMA bci_dev FROM PUBLIC;

-- @@STEP
COMMENT ON SCHEMA bci_dev IS 'INTERNAL DEV ONLY. No public grants; self-set tenant GUC is test context, not production authentication. Never expose BROS credentials to clients.';

-- @@STEP
CREATE TABLE IF NOT EXISTS bci_dev.evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  product text NOT NULL CHECK (product IN ('content','demand')),
  provider text NOT NULL CHECK (provider IN ('meta_ads','ga4','buffer','manual','other')),
  provider_record_key text NOT NULL CHECK (length(provider_record_key) BETWEEN 1 AND 250),
  source_reference text NOT NULL CHECK (length(source_reference) BETWEEN 1 AND 1500),
  observed_at timestamptz NOT NULL,
  period_start timestamptz,
  period_end timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now(),
  completeness text NOT NULL CHECK (completeness IN ('complete','partial','unverified')),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metrics)='object'),
  facts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(facts)='array'),
  unknowns jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(unknowns)='array'),
  CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end),
  UNIQUE (tenant_id,product,provider,provider_record_key),
  UNIQUE (id,tenant_id,product)
);

-- @@STEP
CREATE INDEX IF NOT EXISTS bci_evidence_recency_idx ON bci_dev.evidence(tenant_id,product,observed_at DESC);

-- @@STEP
CREATE TABLE IF NOT EXISTS bci_dev.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  product text NOT NULL CHECK (product IN ('content','demand')),
  case_key text NOT NULL CHECK (length(case_key) BETWEEN 3 AND 120),
  title text NOT NULL CHECK (length(title) BETWEEN 3 AND 250),
  question text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','REVIEW','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,product,case_key),
  UNIQUE(id,tenant_id,product)
);

-- @@STEP
CREATE TABLE IF NOT EXISTS bci_dev.case_evidence (
  case_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  product text NOT NULL CHECK (product IN ('content','demand')),
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id,evidence_id),
  FOREIGN KEY(case_id,tenant_id,product) REFERENCES bci_dev.cases(id,tenant_id,product) ON DELETE RESTRICT,
  FOREIGN KEY(evidence_id,tenant_id,product) REFERENCES bci_dev.evidence(id,tenant_id,product) ON DELETE RESTRICT
);

-- @@STEP
CREATE INDEX IF NOT EXISTS bci_case_evidence_tenant_idx ON bci_dev.case_evidence(tenant_id,product,case_id);

-- @@STEP
CREATE TABLE IF NOT EXISTS bci_dev.proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  product text NOT NULL CHECK (product IN ('content','demand')),
  hypothesis text NOT NULL,
  proposed_action text NOT NULL,
  proposed_success_metric text NOT NULL,
  status text NOT NULL DEFAULT 'PROPOSED' CHECK (status = 'PROPOSED'),
  confidence text NOT NULL DEFAULT 'low' CHECK (confidence IN ('low','medium','high')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(case_id,tenant_id,product) REFERENCES bci_dev.cases(id,tenant_id,product) ON DELETE RESTRICT
);

-- @@STEP
CREATE INDEX IF NOT EXISTS bci_proposals_case_idx ON bci_dev.proposals(tenant_id,product,case_id,created_at DESC);

-- @@STEP
ALTER TABLE bci_dev.evidence ENABLE ROW LEVEL SECURITY;

-- @@STEP
ALTER TABLE bci_dev.evidence FORCE ROW LEVEL SECURITY;

-- @@STEP
ALTER TABLE bci_dev.cases ENABLE ROW LEVEL SECURITY;

-- @@STEP
ALTER TABLE bci_dev.cases FORCE ROW LEVEL SECURITY;

-- @@STEP
ALTER TABLE bci_dev.case_evidence ENABLE ROW LEVEL SECURITY;

-- @@STEP
ALTER TABLE bci_dev.case_evidence FORCE ROW LEVEL SECURITY;

-- @@STEP
ALTER TABLE bci_dev.proposals ENABLE ROW LEVEL SECURITY;

-- @@STEP
ALTER TABLE bci_dev.proposals FORCE ROW LEVEL SECURITY;

-- @@STEP
CREATE POLICY dev_evidence_tenant_scope ON bci_dev.evidence FOR ALL TO "BROS"
  USING (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid);

-- @@STEP
CREATE POLICY dev_cases_tenant_scope ON bci_dev.cases FOR ALL TO "BROS"
  USING (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid);

-- @@STEP
CREATE POLICY dev_case_evidence_tenant_scope ON bci_dev.case_evidence FOR ALL TO "BROS"
  USING (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid);

-- @@STEP
CREATE POLICY dev_proposals_tenant_scope ON bci_dev.proposals FOR ALL TO "BROS"
  USING (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('bci.tenant_id',true),'')::uuid);
