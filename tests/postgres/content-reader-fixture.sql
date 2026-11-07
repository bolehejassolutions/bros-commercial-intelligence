-- Reproduce the CURRENT (2026-11-07) restricted reader's RLS policies in
-- the ephemeral PostgreSQL 16 GitHub Actions container ONLY.
-- Never apply to Neon, production or any persistent database.
\set ON_ERROR_STOP on

GRANT USAGE ON SCHEMA bci_dev,content_dev TO content_dev_reader_v2;
GRANT SELECT ON bci_dev.tenant_memberships,
 content_dev.workspaces,content_dev.campaigns,
 content_dev.content_items,content_dev.scenes TO content_dev_reader_v2;

CREATE POLICY content_reader_membership
 ON bci_dev.tenant_memberships FOR SELECT TO content_dev_reader_v2
 USING (
  principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
  AND product='content' AND active IS TRUE AND revoked_at IS NULL
 );

CREATE POLICY content_reader_workspace
 ON content_dev.workspaces FOR SELECT TO content_dev_reader_v2
 USING (
  owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
  AND EXISTS (
   SELECT 1 FROM bci_dev.tenant_memberships m
   WHERE m.tenant_id=workspaces.tenant_id
    AND m.principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
    AND m.product='content' AND m.active IS TRUE AND m.revoked_at IS NULL
  )
 );

CREATE POLICY content_reader_campaign
 ON content_dev.campaigns FOR SELECT TO content_dev_reader_v2
 USING (
  owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
  AND EXISTS (
   SELECT 1 FROM bci_dev.tenant_memberships m
   WHERE m.tenant_id=campaigns.tenant_id
    AND m.principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
    AND m.product='content' AND m.active IS TRUE AND m.revoked_at IS NULL
  )
  AND EXISTS (
   SELECT 1 FROM content_dev.workspaces w
   WHERE w.id=campaigns.workspace_id AND w.tenant_id=campaigns.tenant_id
    AND w.owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
  )
 );

CREATE POLICY content_reader_items
 ON content_dev.content_items FOR SELECT TO content_dev_reader_v2
 USING (
  EXISTS (
   SELECT 1 FROM bci_dev.tenant_memberships m
   WHERE m.tenant_id=content_items.tenant_id
    AND m.principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
    AND m.product='content' AND m.active IS TRUE AND m.revoked_at IS NULL
  )
  AND EXISTS (
   SELECT 1 FROM content_dev.campaigns c
   WHERE c.id=content_items.campaign_id AND c.tenant_id=content_items.tenant_id
    AND c.owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
  )
 );

CREATE POLICY content_reader_scenes
 ON content_dev.scenes FOR SELECT TO content_dev_reader_v2
 USING (
  EXISTS (
   SELECT 1 FROM bci_dev.tenant_memberships m
   WHERE m.tenant_id=scenes.tenant_id
    AND m.principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
    AND m.product='content' AND m.active IS TRUE AND m.revoked_at IS NULL
  )
  AND EXISTS (
   SELECT 1 FROM content_dev.content_items i
   JOIN content_dev.campaigns c
    ON c.id=i.campaign_id AND c.tenant_id=i.tenant_id
   WHERE i.id=scenes.content_item_id AND i.tenant_id=scenes.tenant_id
    AND c.owner_principal_id=NULLIF(current_setting('bci.principal_id',true),'')::uuid
  )
 );
