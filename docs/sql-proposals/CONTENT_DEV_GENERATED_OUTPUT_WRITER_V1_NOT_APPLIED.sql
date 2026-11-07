-- BROS CONTENT — REVIEW-ONLY PostgreSQL permission proposal.
-- NEVER AUTO-APPLY. NOT IN THE MIGRATION RUNNER.
-- Requires explicit owner permission for role, grants, policies and new table.
-- Target: Neon DEV project empty-tooth-43040036 / bros_intelligence_dev ONLY.
-- Does NOT target original Supabase, BCI production, credit or billing tables.
--
-- Precondition: provision a fresh restricted, direct-login role through Neon
-- with exact name content_dev_generated_writer_v1, an independently generated
-- credential, LOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEROLE.
-- Do not embed or commit any password or connection string.
--
-- Required after approval: use a disposable DEV database branch to test
-- grants, RLS, cross-tenant denial and rollback. Only then consider DEV main.
-- No HTTP route, generation engine or production cutover is authorized here.

BEGIN;

DO $verify$
BEGIN
  IF current_database() <> 'bros_intelligence_dev'
    OR NOT EXISTS (
      SELECT 1 FROM pg_roles
      WHERE rolname='content_dev_generated_writer_v1'
        AND rolcanlogin AND NOT rolinherit AND NOT rolbypassrls
        AND NOT rolsuper AND NOT rolcreaterole
    )
    OR EXISTS (
      SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
      WHERE r.rolname='content_dev_generated_writer_v1'
    )
  THEN RAISE EXCEPTION 'CONTENT generated writer role/preconditions not approved or invalid';
  END IF;
END $verify$;

CREATE TABLE content_dev.generated_output_requests (
 tenant_id uuid NOT NULL,
 owner_principal_id uuid NOT NULL,
 workspace_id uuid NOT NULL,
 idempotency_key text NOT NULL
  CHECK (char_length(idempotency_key) BETWEEN 12 AND 180),
 fingerprint text NOT NULL
  CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
 expected_items integer NOT NULL CHECK (expected_items BETWEEN 1 AND 500),
 expected_scenes integer NOT NULL CHECK (expected_scenes BETWEEN 0 AND 300),
 quality_score double precision NOT NULL
  CHECK (quality_score BETWEEN 60 AND 100),
 campaign_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,owner_principal_id,idempotency_key),
 FOREIGN KEY(tenant_id,workspace_id)
   REFERENCES content_dev.workspaces(tenant_id,id),
 FOREIGN KEY(tenant_id,campaign_id)
   REFERENCES content_dev.campaigns(tenant_id,id)
);
ALTER TABLE content_dev.generated_output_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_dev.generated_output_requests FORCE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA content_dev,bci_dev
 TO content_dev_generated_writer_v1;
GRANT SELECT ON bci_dev.tenant_memberships,
 content_dev.workspaces,
 content_dev.campaigns,
 content_dev.content_items,
 content_dev.scenes,
 content_dev.generated_output_requests TO content_dev_generated_writer_v1;
GRANT INSERT ON content_dev.campaigns,
 content_dev.content_items,
 content_dev.scenes,
 content_dev.generated_output_requests TO content_dev_generated_writer_v1;
GRANT UPDATE(campaign_id) ON content_dev.generated_output_requests
 TO content_dev_generated_writer_v1;
-- Intentionally NO: UPDATE/DELETE on campaigns/items/scenes,
-- credit_ledger, generation_jobs, content_import_dev, or role inheritance.

-- Membership is principal-bound, CONTENT-only, active and unrevoked.
CREATE POLICY generated_writer_membership_select_v1
 ON bci_dev.tenant_memberships FOR SELECT
 TO content_dev_generated_writer_v1
 USING (
  principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
  AND product='content' AND active IS TRUE AND revoked_at IS NULL
 );

CREATE POLICY generated_writer_workspace_select_v1
 ON content_dev.workspaces FOR SELECT
 TO content_dev_generated_writer_v1
 USING (
  owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
  AND EXISTS (
   SELECT 1 FROM bci_dev.tenant_memberships m
   WHERE m.tenant_id=workspaces.tenant_id
    AND m.principal_id=owner_principal_id
    AND m.product='content' AND m.active IS TRUE AND m.revoked_at IS NULL
  )
 );

CREATE POLICY generated_writer_campaign_select_v1
 ON content_dev.campaigns FOR SELECT TO content_dev_generated_writer_v1
 USING (
  owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
  AND EXISTS (
   SELECT 1 FROM content_dev.workspaces w
   WHERE w.id=campaigns.workspace_id AND w.tenant_id=campaigns.tenant_id
    AND w.owner_principal_id=campaigns.owner_principal_id
  )
  AND EXISTS (
   SELECT 1 FROM bci_dev.tenant_memberships m
   WHERE m.tenant_id=campaigns.tenant_id
    AND m.principal_id=campaigns.owner_principal_id
    AND m.product='content' AND m.active IS TRUE AND m.revoked_at IS NULL
  )
 );
CREATE POLICY generated_writer_campaign_insert_v1
 ON content_dev.campaigns FOR INSERT TO content_dev_generated_writer_v1
 WITH CHECK (
  status='draft'
  AND owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
  AND EXISTS (
   SELECT 1 FROM content_dev.workspaces w
   WHERE w.id=campaigns.workspace_id AND w.tenant_id=campaigns.tenant_id
    AND w.owner_principal_id=campaigns.owner_principal_id
  )
  AND EXISTS (
   SELECT 1 FROM bci_dev.tenant_memberships m
   WHERE m.tenant_id=campaigns.tenant_id
    AND m.principal_id=campaigns.owner_principal_id
    AND m.product='content' AND m.active IS TRUE AND m.revoked_at IS NULL
  )
 );

CREATE POLICY generated_writer_item_select_v1
 ON content_dev.content_items FOR SELECT TO content_dev_generated_writer_v1
 USING (
  EXISTS (
   SELECT 1 FROM content_dev.campaigns c
   WHERE c.id=content_items.campaign_id AND c.tenant_id=content_items.tenant_id
    AND c.owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
  )
 );
CREATE POLICY generated_writer_item_insert_v1
 ON content_dev.content_items FOR INSERT TO content_dev_generated_writer_v1
 WITH CHECK (
  legacy_supabase_id IS NULL
  AND EXISTS (
   SELECT 1 FROM content_dev.campaigns c
   WHERE c.id=content_items.campaign_id AND c.tenant_id=content_items.tenant_id
    AND c.owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
    AND c.status='draft'
  )
 );

CREATE POLICY generated_writer_scene_select_v1
 ON content_dev.scenes FOR SELECT TO content_dev_generated_writer_v1
 USING (
  EXISTS (
   SELECT 1 FROM content_dev.content_items i
   JOIN content_dev.campaigns c
    ON c.id=i.campaign_id AND c.tenant_id=i.tenant_id
   WHERE i.id=scenes.content_item_id AND i.tenant_id=scenes.tenant_id
    AND c.owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
  )
 );
CREATE POLICY generated_writer_scene_insert_v1
 ON content_dev.scenes FOR INSERT TO content_dev_generated_writer_v1
 WITH CHECK (
  legacy_supabase_id IS NULL
  AND EXISTS (
   SELECT 1 FROM content_dev.content_items i
   JOIN content_dev.campaigns c
    ON c.id=i.campaign_id AND c.tenant_id=i.tenant_id
   WHERE i.id=scenes.content_item_id AND i.tenant_id=scenes.tenant_id
    AND i.type='video_scenes'
    AND c.owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
    AND c.status='draft'
  )
 );

CREATE POLICY generated_writer_request_select_v1
 ON content_dev.generated_output_requests FOR SELECT
 TO content_dev_generated_writer_v1
 USING (
  owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
  AND EXISTS (
   SELECT 1 FROM content_dev.workspaces w
   WHERE w.id=generated_output_requests.workspace_id
    AND w.tenant_id=generated_output_requests.tenant_id
    AND w.owner_principal_id=generated_output_requests.owner_principal_id
  )
 );
CREATE POLICY generated_writer_request_insert_v1
 ON content_dev.generated_output_requests FOR INSERT
 TO content_dev_generated_writer_v1
 WITH CHECK (
  owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
  AND campaign_id IS NULL
  AND EXISTS (
   SELECT 1 FROM content_dev.workspaces w
   WHERE w.id=generated_output_requests.workspace_id
    AND w.tenant_id=generated_output_requests.tenant_id
    AND w.owner_principal_id=generated_output_requests.owner_principal_id
  )
 );
CREATE POLICY generated_writer_request_update_v1
 ON content_dev.generated_output_requests FOR UPDATE
 TO content_dev_generated_writer_v1
 USING (
  owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
  AND campaign_id IS NULL
  AND EXISTS (
   SELECT 1 FROM content_dev.workspaces w
   WHERE w.id=generated_output_requests.workspace_id
    AND w.tenant_id=generated_output_requests.tenant_id
    AND w.owner_principal_id=generated_output_requests.owner_principal_id
  )
 )
 WITH CHECK (
  owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
  AND campaign_id IS NOT NULL
  AND EXISTS (
   SELECT 1 FROM content_dev.campaigns c
   WHERE c.id=generated_output_requests.campaign_id
    AND c.tenant_id=generated_output_requests.tenant_id
    AND c.workspace_id=generated_output_requests.workspace_id
    AND c.owner_principal_id=generated_output_requests.owner_principal_id
    AND c.status='draft'
  )
 );

COMMIT;

-- CRITICAL: not applied. Only grant this role a distinct short-lived DEV-only
-- connection secret after an explicit owner permission decision. Validate the
-- policy/posture against a cloned branch BEFORE invoking the application writer.
