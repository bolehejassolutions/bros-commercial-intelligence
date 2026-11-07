-- BROS CONTENT v3.6.1 -> Neon, additive DEV-only schema baseline.
-- Never import legacy Supabase users/credits without verified source export and identity mapping.
-- Application role MUST NOT be the owner; grant only tenant-scoped access through verified server API.
CREATE SCHEMA IF NOT EXISTS content_dev;
CREATE TABLE IF NOT EXISTS content_dev.workspaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 owner_principal_id uuid NOT NULL,
 name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 180),
 business_dna jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(business_dna)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id,id)
);
CREATE INDEX IF NOT EXISTS content_workspaces_owner_idx ON content_dev.workspaces(tenant_id,owner_principal_id);
CREATE TABLE IF NOT EXISTS content_dev.campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 workspace_id uuid NOT NULL,
 owner_principal_id uuid NOT NULL,
 product_service text NOT NULL CHECK (char_length(product_service) BETWEEN 1 AND 500),
 description text NOT NULL DEFAULT '',
 audience text NOT NULL CHECK (char_length(audience) BETWEEN 1 AND 2000),
 problem text NOT NULL DEFAULT '',
 objective text NOT NULL DEFAULT '',
 duration_days integer NOT NULL DEFAULT 7 CHECK(duration_days BETWEEN 1 AND 90),
 platforms text[] NOT NULL DEFAULT '{}'::text[],
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','running','completed','failed')),
 strategy jsonb, angles jsonb, captions jsonb, publish_plan jsonb,
 legacy_supabase_id uuid UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id,id),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES content_dev.workspaces(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS content_campaigns_owner_idx ON content_dev.campaigns(tenant_id,owner_principal_id,created_at DESC);
CREATE TABLE IF NOT EXISTS content_dev.generation_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 campaign_id uuid NOT NULL,
 requested_by uuid NOT NULL,
 idempotency_key text NOT NULL CHECK(char_length(idempotency_key) BETWEEN 12 AND 180),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 10),
 error_code text,
 claimed_at timestamptz,
 completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,requested_by,idempotency_key),
 FOREIGN KEY(tenant_id,campaign_id) REFERENCES content_dev.campaigns(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS content_generation_jobs_status_idx ON content_dev.generation_jobs(status,created_at);
CREATE TABLE IF NOT EXISTS content_dev.content_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 campaign_id uuid NOT NULL,
 type text NOT NULL CHECK(type IN ('script','video_scenes','visual_prompt','caption','other')),
 title text NOT NULL DEFAULT '',
 body jsonb NOT NULL DEFAULT '{}'::jsonb,
 sort_order integer NOT NULL DEFAULT 0,
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 legacy_supabase_id uuid UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,campaign_id) REFERENCES content_dev.campaigns(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS content_dev.scenes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 content_item_id uuid NOT NULL,
 scene_number integer NOT NULL CHECK(scene_number > 0),
 duration_seconds numeric(8,2) NOT NULL DEFAULT 0 CHECK(duration_seconds >= 0),
 narration text NOT NULL DEFAULT '',
 dialogue text NOT NULL DEFAULT '',
 visual_prompt text NOT NULL DEFAULT '',
 motion_prompt text NOT NULL DEFAULT '',
 continuity_lock jsonb NOT NULL DEFAULT '{}'::jsonb,
 legacy_supabase_id uuid UNIQUE,
 UNIQUE(tenant_id,content_item_id,scene_number),
 FOREIGN KEY(tenant_id,content_item_id) REFERENCES content_dev.content_items(tenant_id,id)
);
-- Financial records are not manufactured: this is a reconciliation destination, not an initial balance grant.
CREATE TABLE IF NOT EXISTS content_dev.credit_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 owner_principal_id uuid NOT NULL,
 source text NOT NULL CHECK(source IN ('verified_supabase_import','verified_hitpay_webhook','manual_reconciliation')),
 source_reference text NOT NULL CHECK(char_length(source_reference) BETWEEN 1 AND 240),
 delta integer NOT NULL CHECK(delta <> 0),
 currency text NOT NULL DEFAULT 'MYR' CHECK(currency='MYR'),
 verified_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source,source_reference)
);
CREATE INDEX IF NOT EXISTS content_credit_ledger_owner_idx ON content_dev.credit_ledger(tenant_id,owner_principal_id);
-- No browser/API anonymous grants; even database owner bypasses RLS, so server must use
-- a restricted DB role plus independently verified Neon Auth principal and membership.
ALTER TABLE content_dev.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_dev.workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE content_dev.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_dev.campaigns FORCE ROW LEVEL SECURITY;
ALTER TABLE content_dev.generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_dev.generation_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE content_dev.content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_dev.content_items FORCE ROW LEVEL SECURITY;
ALTER TABLE content_dev.scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_dev.scenes FORCE ROW LEVEL SECURITY;
ALTER TABLE content_dev.credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_dev.credit_ledger FORCE ROW LEVEL SECURITY;
-- Deliberately no policies or GRANTs yet: deny by default until a verified principal-bound
-- role and explicit policy tests are implemented. Do not use owner credentials for user requests.
