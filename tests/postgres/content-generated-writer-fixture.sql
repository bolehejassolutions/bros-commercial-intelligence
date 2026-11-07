-- Ephemeral GitHub Actions PostgreSQL 16 fixture. NOT a production migration.
-- Run only in the disposable CI container database bros_intelligence_dev.
\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA bci_dev;
CREATE SCHEMA content_dev;
CREATE SCHEMA content_import_dev;

CREATE TABLE bci_dev.tenant_memberships (
  tenant_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  product text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id,principal_id,product)
);
ALTER TABLE bci_dev.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE bci_dev.tenant_memberships FORCE ROW LEVEL SECURITY;

CREATE TABLE content_dev.workspaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 owner_principal_id uuid NOT NULL,
 name text NOT NULL,
 business_dna jsonb NOT NULL DEFAULT '{}'::jsonb,
 UNIQUE(tenant_id,id)
);
CREATE TABLE content_dev.campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 workspace_id uuid NOT NULL,
 owner_principal_id uuid NOT NULL,
 product_service text NOT NULL,
 description text NOT NULL DEFAULT '',
 audience text NOT NULL,
 problem text NOT NULL DEFAULT '',
 objective text NOT NULL DEFAULT '',
 duration_days integer NOT NULL CHECK (duration_days BETWEEN 1 AND 90),
 platforms text[] NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','running','completed','failed')),
 strategy jsonb,angles jsonb,captions jsonb,publish_plan jsonb,
 legacy_supabase_id uuid UNIQUE,
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES content_dev.workspaces(tenant_id,id)
);
CREATE TABLE content_dev.content_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 campaign_id uuid NOT NULL,
 type text NOT NULL CHECK(type IN ('script','video_scenes','visual_prompt','caption','other')),
 title text NOT NULL DEFAULT '',
 body jsonb NOT NULL DEFAULT '{}'::jsonb,
 sort_order integer NOT NULL DEFAULT 0,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 legacy_supabase_id uuid UNIQUE,
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,campaign_id) REFERENCES content_dev.campaigns(tenant_id,id)
);
CREATE TABLE content_dev.scenes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 content_item_id uuid NOT NULL,
 scene_number integer NOT NULL CHECK (scene_number>0),
 duration_seconds numeric(8,2) NOT NULL DEFAULT 0 CHECK (duration_seconds>=0),
 narration text NOT NULL DEFAULT '',
 dialogue text NOT NULL DEFAULT '',
 visual_prompt text NOT NULL DEFAULT '' CHECK (visual_prompt <> '__CI_FORCE_ROLLBACK__'),
 motion_prompt text NOT NULL DEFAULT '',
 continuity_lock jsonb NOT NULL DEFAULT '{}'::jsonb,
 legacy_supabase_id uuid UNIQUE,
 UNIQUE(tenant_id,content_item_id,scene_number),
 FOREIGN KEY(tenant_id,content_item_id) REFERENCES content_dev.content_items(tenant_id,id)
);
CREATE TABLE content_dev.generation_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE content_dev.credit_ledger (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
\echo Base fixture created

DO $fixture$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['workspaces','campaigns','content_items','scenes','generation_jobs','credit_ledger'] LOOP
  EXECUTE format('ALTER TABLE content_dev.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE content_dev.%I FORCE ROW LEVEL SECURITY',tab);
 END LOOP;
END $fixture$;

-- Two tenants: an eligible CONTENT owner and a different eligible CONTENT owner.
INSERT INTO bci_dev.tenant_memberships(tenant_id,principal_id,product,active)
VALUES
 ('33333333-3333-4333-8333-333333333333','8ae086ff-3f10-4863-b5e7-4b67e062024d','content',true),
 ('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111','content',true);
INSERT INTO content_dev.workspaces(id,tenant_id,owner_principal_id,name)
VALUES
 ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','8ae086ff-3f10-4863-b5e7-4b67e062024d','Owner workspace'),
 ('77777777-7777-4777-8777-777777777777','66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111','Other workspace');
-- An already-existing campaign owned by the OTHER tenant for cross-tenant probes.
INSERT INTO content_dev.campaigns(id,tenant_id,workspace_id,owner_principal_id,
 product_service,audience,duration_days,status)
VALUES ('88888888-8888-4888-8888-888888888888',
 '66666666-6666-4666-8666-666666666666',
 '77777777-7777-4777-8777-777777777777',
 '11111111-1111-4111-8111-111111111111',
 'Other tenant campaign','Other tenant',7,'draft');
\echo Seeded two isolated tenants
