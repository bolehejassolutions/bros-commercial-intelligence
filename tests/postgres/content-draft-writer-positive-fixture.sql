-- Disposable PostgreSQL 16 CI only. NEVER run against live Neon.
\set ON_ERROR_STOP on
CREATE ROLE content_dev_draft_writer_v2 LOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEROLE PASSWORD :'draft_password';
CREATE TABLE content_dev.campaign_draft_requests (
 tenant_id uuid NOT NULL, owner_principal_id uuid NOT NULL,
 idempotency_key text NOT NULL, workspace_id uuid NOT NULL,
 payload jsonb NOT NULL, campaign_id uuid,
 PRIMARY KEY (tenant_id,owner_principal_id,idempotency_key)
);
ALTER TABLE content_dev.campaign_draft_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_dev.campaign_draft_requests FORCE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA content_dev,bci_dev TO content_dev_draft_writer_v2;
GRANT SELECT ON bci_dev.tenant_memberships,content_dev.workspaces TO content_dev_draft_writer_v2;
GRANT SELECT,INSERT ON content_dev.campaigns TO content_dev_draft_writer_v2;
GRANT SELECT,INSERT,UPDATE ON content_dev.campaign_draft_requests TO content_dev_draft_writer_v2;
CREATE POLICY draft_member ON bci_dev.tenant_memberships FOR SELECT TO content_dev_draft_writer_v2
 USING(principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid AND product='content' AND active AND revoked_at IS NULL);
CREATE POLICY draft_workspace ON content_dev.workspaces FOR SELECT TO content_dev_draft_writer_v2
 USING(owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid AND EXISTS
 (SELECT 1 FROM bci_dev.tenant_memberships m WHERE m.tenant_id=workspaces.tenant_id
 AND m.principal_id=workspaces.owner_principal_id AND m.product='content' AND m.active AND m.revoked_at IS NULL));
CREATE POLICY draft_campaign_insert ON content_dev.campaigns FOR INSERT TO content_dev_draft_writer_v2
 WITH CHECK(owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid);
CREATE POLICY draft_campaign_select ON content_dev.campaigns FOR SELECT TO content_dev_draft_writer_v2
 USING(owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid);
CREATE POLICY draft_request_insert ON content_dev.campaign_draft_requests FOR INSERT TO content_dev_draft_writer_v2
 WITH CHECK(owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid);
CREATE POLICY draft_request_select ON content_dev.campaign_draft_requests FOR SELECT TO content_dev_draft_writer_v2
 USING(owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid);
CREATE POLICY draft_request_update ON content_dev.campaign_draft_requests FOR UPDATE TO content_dev_draft_writer_v2
 USING(owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid)
 WITH CHECK(owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid);
