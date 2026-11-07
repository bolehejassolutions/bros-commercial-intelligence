-- DEV-only additive idempotency reservation for CONTENT campaign drafts.
-- No GRANT or RLS policy: deny-by-default until restricted role and session tests pass.
CREATE TABLE IF NOT EXISTS content_dev.campaign_draft_requests (
 tenant_id uuid NOT NULL,
 owner_principal_id uuid NOT NULL,
 idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 12 AND 180),
 workspace_id uuid NOT NULL,
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
 campaign_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,owner_principal_id,idempotency_key),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES content_dev.workspaces(tenant_id,id),
 FOREIGN KEY(tenant_id,campaign_id) REFERENCES content_dev.campaigns(tenant_id,id)
);
ALTER TABLE content_dev.campaign_draft_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_dev.campaign_draft_requests FORCE ROW LEVEL SECURITY;
-- Deliberately NO policies or grants; migration does not activate writes.
