-- BROS CONTENT DEV: reproducible grants for existing Neon-managed v2 logins.
-- Applied and read back on 2026-11-07; DEV only. No credentials or role creation.
-- Requires BROS ownership of the CONTENT and membership tables.
-- Do not apply to production or automatically run during deployment.
BEGIN;
GRANT CONNECT ON DATABASE bros_intelligence_dev TO content_dev_reader_v2,content_dev_draft_writer_v2;
GRANT USAGE ON SCHEMA content_dev,bci_dev TO content_dev_reader_v2,content_dev_draft_writer_v2;
GRANT SELECT ON bci_dev.tenant_memberships TO content_dev_reader_v2,content_dev_draft_writer_v2;
GRANT SELECT ON content_dev.workspaces,content_dev.campaigns,content_dev.content_items,content_dev.scenes TO content_dev_reader_v2;
GRANT SELECT ON content_dev.workspaces,content_dev.campaigns,content_dev.campaign_draft_requests TO content_dev_draft_writer_v2;
GRANT INSERT ON content_dev.campaigns,content_dev.campaign_draft_requests TO content_dev_draft_writer_v2;
GRANT UPDATE (campaign_id) ON content_dev.campaign_draft_requests TO content_dev_draft_writer_v2;
ALTER POLICY content_reader_membership ON bci_dev.tenant_memberships TO content_dev_reader,content_dev_reader_v2;
ALTER POLICY content_writer_membership ON bci_dev.tenant_memberships TO content_dev_draft_writer,content_dev_draft_writer_v2;
ALTER POLICY content_reader_workspace ON content_dev.workspaces TO content_dev_reader,content_dev_reader_v2;
ALTER POLICY content_reader_campaign ON content_dev.campaigns TO content_dev_reader,content_dev_reader_v2;
ALTER POLICY content_reader_items ON content_dev.content_items TO content_dev_reader,content_dev_reader_v2;
ALTER POLICY content_reader_scenes ON content_dev.scenes TO content_dev_reader,content_dev_reader_v2;
ALTER POLICY content_writer_workspace ON content_dev.workspaces TO content_dev_draft_writer,content_dev_draft_writer_v2;
ALTER POLICY content_writer_campaign_select ON content_dev.campaigns TO content_dev_draft_writer,content_dev_draft_writer_v2;
ALTER POLICY content_writer_campaign_insert ON content_dev.campaigns TO content_dev_draft_writer,content_dev_draft_writer_v2;
ALTER POLICY content_writer_reservation_select ON content_dev.campaign_draft_requests TO content_dev_draft_writer,content_dev_draft_writer_v2;
ALTER POLICY content_writer_reservation_insert ON content_dev.campaign_draft_requests TO content_dev_draft_writer,content_dev_draft_writer_v2;
ALTER POLICY content_writer_reservation_update ON content_dev.campaign_draft_requests TO content_dev_draft_writer,content_dev_draft_writer_v2;
COMMIT;
-- After application: verify direct logins, RLS isolation, denied credit/job
-- operations, no role memberships, and no inherited/admin privileges.
