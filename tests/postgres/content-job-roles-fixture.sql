-- Disposable-only CI roles. This file is outside the application and migration paths.
\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE content_dev_job_writer_v2 LOGIN NOINHERIT PASSWORD :'writer_password';
CREATE ROLE content_dev_job_worker_v2 LOGIN NOINHERIT PASSWORD :'worker_password';
GRANT USAGE ON SCHEMA bci_dev,content_dev TO content_dev_job_writer_v2,content_dev_job_worker_v2;
GRANT SELECT ON bci_dev.tenant_memberships,content_dev.workspaces,content_dev.campaigns,content_dev.generation_jobs
 TO content_dev_job_writer_v2,content_dev_job_worker_v2;
GRANT INSERT ON content_dev.generation_jobs TO content_dev_job_writer_v2;
GRANT UPDATE(status,attempts,claimed_at,completed_at,error_code) ON content_dev.generation_jobs TO content_dev_job_worker_v2;
-- A submitter only needs scoped child existence to protect an existing draft.
GRANT SELECT(tenant_id,campaign_id) ON content_dev.content_items TO content_dev_job_writer_v2;
CREATE POLICY ci_job_submit_existing_output ON content_dev.content_items FOR SELECT TO content_dev_job_writer_v2
 USING (tenant_id=NULLIF(current_setting('content.tenant_id',true),'')::uuid AND EXISTS (
  SELECT 1 FROM content_dev.campaigns c WHERE c.id=content_items.campaign_id AND c.tenant_id=content_items.tenant_id
   AND c.owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid));
GRANT SELECT,INSERT ON content_dev.content_items TO content_dev_job_worker_v2;

CREATE POLICY ci_job_writer_member ON bci_dev.tenant_memberships FOR SELECT TO content_dev_job_writer_v2
 USING (principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid AND product='content' AND active AND revoked_at IS NULL);
CREATE POLICY ci_job_worker_member ON bci_dev.tenant_memberships FOR SELECT TO content_dev_job_worker_v2
 USING (tenant_id=NULLIF(current_setting('content.tenant_id',true),'')::uuid AND product='content' AND active AND revoked_at IS NULL);
CREATE POLICY ci_job_workspace ON content_dev.workspaces FOR SELECT TO content_dev_job_writer_v2,content_dev_job_worker_v2
 USING (EXISTS(SELECT 1 FROM bci_dev.tenant_memberships m WHERE m.tenant_id=workspaces.tenant_id AND m.principal_id=workspaces.owner_principal_id));
CREATE POLICY ci_job_campaign ON content_dev.campaigns FOR SELECT TO content_dev_job_writer_v2,content_dev_job_worker_v2
 USING (EXISTS(SELECT 1 FROM content_dev.workspaces w WHERE w.id=campaigns.workspace_id AND w.tenant_id=campaigns.tenant_id AND w.owner_principal_id=campaigns.owner_principal_id));
CREATE POLICY ci_job_read ON content_dev.generation_jobs FOR SELECT TO content_dev_job_worker_v2,content_dev_job_writer_v2
 USING (tenant_id=NULLIF(current_setting('content.tenant_id',true),'')::uuid AND EXISTS(
  SELECT 1 FROM content_dev.campaigns c WHERE c.tenant_id=generation_jobs.tenant_id AND c.id=generation_jobs.campaign_id AND c.owner_principal_id=generation_jobs.requested_by));
CREATE POLICY ci_job_submit ON content_dev.generation_jobs FOR INSERT TO content_dev_job_writer_v2
 WITH CHECK (requested_by=NULLIF(current_setting('bci.principal_id',true),'')::uuid AND tenant_id=NULLIF(current_setting('content.tenant_id',true),'')::uuid
 AND status='queued' AND attempts=0 AND EXISTS(SELECT 1 FROM content_dev.campaigns c WHERE c.tenant_id=generation_jobs.tenant_id AND c.id=generation_jobs.campaign_id AND c.owner_principal_id=generation_jobs.requested_by));
CREATE POLICY ci_job_advance ON content_dev.generation_jobs FOR UPDATE TO content_dev_job_worker_v2
 USING (tenant_id=NULLIF(current_setting('content.tenant_id',true),'')::uuid AND EXISTS(
  SELECT 1 FROM content_dev.campaigns c WHERE c.tenant_id=generation_jobs.tenant_id AND c.id=generation_jobs.campaign_id AND c.owner_principal_id=generation_jobs.requested_by));
CREATE POLICY ci_job_output_read ON content_dev.content_items FOR SELECT TO content_dev_job_worker_v2
 USING (tenant_id=NULLIF(current_setting('content.tenant_id',true),'')::uuid AND EXISTS(
  SELECT 1 FROM content_dev.campaigns c WHERE c.id=content_items.campaign_id AND c.tenant_id=content_items.tenant_id AND c.owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid));
CREATE POLICY ci_job_output_write ON content_dev.content_items FOR INSERT TO content_dev_job_worker_v2
 WITH CHECK (tenant_id=NULLIF(current_setting('content.tenant_id',true),'')::uuid AND EXISTS(
  SELECT 1 FROM content_dev.generation_jobs j WHERE j.id=(content_items.body->'provenance'->>'job_id')::uuid
  AND j.campaign_id=content_items.campaign_id AND j.tenant_id=content_items.tenant_id AND j.status='completed' AND j.requested_by=NULLIF(current_setting('bci.principal_id',true),'')::uuid));
COMMIT;
