-- BROS CONTENT original data -> Neon DEV non-financial materialization.
-- Only historical Supabase identities with verified email on BOTH providers AND active Neon CONTENT membership are linked.
-- No new user, password, wallet balance, credit grant, job execution, payment or publishing side effects.
-- Other legacy identities remain in private snapshot until individually matched.
-- PRIVATE DEFAULT-DENY access remains; this is not customer-ready API permission.
CREATE TABLE IF NOT EXISTS content_import_dev.identity_links (
 source_user_id uuid PRIMARY KEY,
 neon_principal_id uuid NOT NULL UNIQUE,
 tenant_id uuid NOT NULL,
 evidence text NOT NULL CHECK(evidence='verified_email_both_and_active_content_membership'),
 verified_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE content_import_dev.identity_links ENABLE ROW LEVEL SECURITY;

ALTER TABLE content_import_dev.identity_links FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE content_import_dev.identity_links FROM PUBLIC;

WITH candidate AS (
 SELECT l.source_user_id,u.id AS neon_principal_id,m.tenant_id
 FROM content_import_dev.legacy_rows l
 JOIN neon_auth."user" u ON lower(u.email)=lower(l.payload->>'email') AND u."emailVerified" IS TRUE AND u.banned IS NOT TRUE
 JOIN bci_dev.tenant_memberships m ON m.principal_id=u.id AND m.product='content' AND m.active IS TRUE AND m.revoked_at IS NULL
 WHERE l.source_table='auth_user_identity' AND l.payload->>'email_confirmed_at' IS NOT NULL
)
INSERT INTO content_import_dev.identity_links(source_user_id,neon_principal_id,tenant_id,evidence)
SELECT source_user_id,neon_principal_id,tenant_id,'verified_email_both_and_active_content_membership'
FROM candidate ON CONFLICT (source_user_id) DO NOTHING;

INSERT INTO content_dev.workspaces(id,tenant_id,owner_principal_id,name,business_dna,created_at,updated_at)
 SELECT d.source_pk::uuid,l.tenant_id,l.neon_principal_id,
 LEFT(COALESCE(NULLIF(d.payload->>'brand_name',''),NULLIF(p.payload->>'business_name',''),'Imported CONTENT workspace'),180),
 d.payload,
 COALESCE((d.payload->>'created_at')::timestamptz,now()),
 COALESCE((d.payload->>'updated_at')::timestamptz,now())
 FROM content_import_dev.legacy_rows d
 JOIN content_import_dev.identity_links l ON l.source_user_id=d.source_user_id
 LEFT JOIN content_import_dev.legacy_rows p ON p.source_table='profiles' AND p.source_pk=d.source_user_id::text
 WHERE d.source_table='business_dna'
 ON CONFLICT (id) DO NOTHING;

INSERT INTO content_dev.campaigns
 (tenant_id,workspace_id,owner_principal_id,product_service,description,audience,problem,objective,duration_days,platforms,status,strategy,angles,captions,publish_plan,legacy_supabase_id,created_at,updated_at)
 SELECT l.tenant_id,w.id,l.neon_principal_id,
 c.payload->>'product_service',
 COALESCE(c.payload->>'description',''),
 c.payload->>'audience',
 COALESCE(c.payload->>'problem',''),
 COALESCE(c.payload->>'objective',''),
 COALESCE((c.payload->>'duration_days')::int,7),
 CASE WHEN jsonb_typeof(c.payload->'platforms')='array' THEN ARRAY(SELECT jsonb_array_elements_text(c.payload->'platforms')) ELSE ARRAY[]::text[] END,
 CASE WHEN EXISTS(SELECT 1 FROM content_import_dev.legacy_rows j WHERE j.source_table='generation_jobs' AND j.payload->>'campaign_id'=c.source_pk AND j.payload->>'status'='completed') THEN 'completed' ELSE 'draft' END,
 c.payload->'strategy',c.payload->'angles',c.payload->'captions',c.payload->'publish_plan',
 c.source_pk::uuid,
 COALESCE((c.payload->>'created_at')::timestamptz,now()),
 COALESCE((c.payload->>'updated_at')::timestamptz,now())
 FROM content_import_dev.legacy_rows c
 JOIN content_import_dev.identity_links l ON l.source_user_id=c.source_user_id
 JOIN content_import_dev.legacy_rows d ON d.source_table='business_dna' AND d.source_user_id=c.source_user_id
 JOIN content_dev.workspaces w ON w.tenant_id=l.tenant_id AND w.id=d.source_pk::uuid AND w.owner_principal_id=l.neon_principal_id
 WHERE c.source_table='campaigns'
 ON CONFLICT (legacy_supabase_id) DO NOTHING;

INSERT INTO content_dev.content_items
 (tenant_id,campaign_id,type,title,body,sort_order,version,legacy_supabase_id,created_at)
 SELECT c.tenant_id,c.id,
 i.payload->>'type',COALESCE(i.payload->>'title',''),
 COALESCE(i.payload->'body','{}'::jsonb),
 COALESCE((i.payload->>'sort_order')::integer,0),
 COALESCE((i.payload->>'version')::integer,1),
 i.source_pk::uuid,
 COALESCE((i.payload->>'created_at')::timestamptz,now())
 FROM content_import_dev.legacy_rows i
 JOIN content_dev.campaigns c ON c.legacy_supabase_id=(i.payload->>'campaign_id')::uuid
 WHERE i.source_table='content_items'
 ON CONFLICT (legacy_supabase_id) DO NOTHING;

INSERT INTO content_dev.scenes
 (tenant_id,content_item_id,scene_number,duration_seconds,narration,dialogue,visual_prompt,motion_prompt,continuity_lock,legacy_supabase_id)
 SELECT i.tenant_id,i.id,
 (s.payload->>'scene_number')::integer,
 COALESCE((s.payload->>'duration_seconds')::numeric,0),
 COALESCE(s.payload->>'narration',''),
 COALESCE(s.payload->>'dialogue',''),
 COALESCE(s.payload->>'visual_prompt',''),
 COALESCE(s.payload->>'motion_prompt',''),
 COALESCE(s.payload->'continuity_lock','{}'::jsonb),
 s.source_pk::uuid
 FROM content_import_dev.legacy_rows s
 JOIN content_dev.content_items i ON i.legacy_supabase_id=(s.payload->>'content_item_id')::uuid
 WHERE s.source_table='scenes'
 ON CONFLICT (legacy_supabase_id) DO NOTHING;
