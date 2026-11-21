-- Only for disposable PostgreSQL. The application never installs this role or policy.
\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE content_dev_job_plan_worker_v1 LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'plan_worker_password';
GRANT USAGE ON SCHEMA bci_dev,content_dev TO content_dev_job_plan_worker_v1;
GRANT SELECT ON bci_dev.tenant_memberships,content_dev.workspaces,content_dev.campaigns,content_dev.generation_jobs,content_dev.content_items,content_dev.scenes TO content_dev_job_plan_worker_v1;
GRANT UPDATE(status,attempts,claimed_at,completed_at,error_code) ON content_dev.generation_jobs TO content_dev_job_plan_worker_v1;
GRANT UPDATE(strategy,angles,captions,publish_plan) ON content_dev.campaigns TO content_dev_job_plan_worker_v1;
GRANT INSERT ON content_dev.content_items,content_dev.scenes TO content_dev_job_plan_worker_v1;

ALTER POLICY ci_job_worker_member ON bci_dev.tenant_memberships TO content_dev_job_worker_v2,content_dev_job_plan_worker_v1;
ALTER POLICY ci_job_workspace ON content_dev.workspaces TO content_dev_job_writer_v2,content_dev_job_worker_v2,content_dev_job_plan_worker_v1;
ALTER POLICY ci_job_campaign ON content_dev.campaigns TO content_dev_job_writer_v2,content_dev_job_worker_v2,content_dev_job_plan_worker_v1;
ALTER POLICY ci_job_read ON content_dev.generation_jobs TO content_dev_job_writer_v2,content_dev_job_worker_v2,content_dev_job_plan_worker_v1;
ALTER POLICY ci_job_advance ON content_dev.generation_jobs TO content_dev_job_worker_v2,content_dev_job_plan_worker_v1;
ALTER POLICY ci_job_output_read ON content_dev.content_items TO content_dev_job_worker_v2,content_dev_job_plan_worker_v1;
ALTER POLICY ci_job_output_write ON content_dev.content_items TO content_dev_job_worker_v2,content_dev_job_plan_worker_v1;

CREATE POLICY ci_plan_campaign_write ON content_dev.campaigns FOR UPDATE TO content_dev_job_plan_worker_v1
 USING (tenant_id=NULLIF(current_setting('content.tenant_id',true),'')::uuid
  AND owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid AND status='draft'
  AND EXISTS(SELECT 1 FROM content_dev.workspaces w WHERE w.id=campaigns.workspace_id AND w.tenant_id=campaigns.tenant_id AND w.owner_principal_id=campaigns.owner_principal_id));
CREATE POLICY ci_plan_scene_read ON content_dev.scenes FOR SELECT TO content_dev_job_plan_worker_v1
 USING (EXISTS(SELECT 1 FROM content_dev.content_items i WHERE i.id=scenes.content_item_id AND i.tenant_id=scenes.tenant_id AND i.type='video_scenes'));
CREATE POLICY ci_plan_scene_insert ON content_dev.scenes FOR INSERT TO content_dev_job_plan_worker_v1
 WITH CHECK (EXISTS(SELECT 1 FROM content_dev.content_items i WHERE i.id=scenes.content_item_id AND i.tenant_id=scenes.tenant_id AND i.type='video_scenes'
  AND i.body->'provenance'->>'job_id'=current_setting('content.plan_job_id',true)));
COMMIT;
