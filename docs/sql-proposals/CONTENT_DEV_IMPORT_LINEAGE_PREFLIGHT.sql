-- Read-only lineage check for the private Supabase snapshot and current Neon DEV
-- identities. Use a role with existing full read visibility. Output contains counts only.
-- "eligible" means the row is absent and its parent is already materialized.
-- "already_materialized" checks identity and parentage, not creative payload parity.
-- The source identity is verified as of snapshot capture; refresh evidence separately
-- before considering a later import. No migration or permission change is performed.
WITH RECURSIVE
source_auth AS (
 SELECT source_user_id,lower(nullif(payload->>'email','')) AS email,
  nullif(payload->>'email_confirmed_at','') IS NOT NULL
   AND lower(source_pk)=source_user_id::text AS verified
 FROM content_import_dev.legacy_rows WHERE source_table='auth_user_identity'
),
source_emails AS (
 SELECT email,count(DISTINCT source_user_id) AS owners FROM source_auth GROUP BY email
),
source_accounts AS (
 SELECT source_user_id,min(email) AS email,count(*) AS records,bool_and(verified) AS verified
 FROM source_auth GROUP BY source_user_id
),
neon_accounts AS (
 SELECT lower(u.email) AS email,count(*) AS accounts,min(u.id::text) AS principal,
  bool_and(u."emailVerified" IS TRUE AND u.banned IS NOT TRUE) AS verified
 FROM neon_auth."user" u JOIN source_emails e ON e.email=lower(u.email) GROUP BY lower(u.email)
),
members AS (
 SELECT principal_id,count(*) FILTER (WHERE active AND revoked_at IS NULL) AS active_count,
  min(tenant_id::text) FILTER (WHERE active AND revoked_at IS NULL) AS tenant
 FROM bci_dev.tenant_memberships WHERE product='content' GROUP BY principal_id
),
owners AS (
 SELECT source_user_id FROM source_auth
 UNION SELECT source_user_id FROM content_import_dev.identity_links
 UNION SELECT source_user_id FROM content_import_dev.legacy_rows
  WHERE source_table IN ('business_dna','campaigns')
),
identities AS (
 SELECT o.source_user_id,n.principal,m.tenant,CASE
  WHEN a.records IS NULL THEN 'missing_source_identity'
  WHEN a.records<>1 OR e.owners>1 OR n.accounts>1 THEN 'ambiguous_identity'
  WHEN a.verified IS NOT TRUE OR a.email IS NULL THEN 'unverified_source_identity'
  WHEN n.accounts IS NULL THEN 'missing_neon_identity'
  WHEN n.verified IS NOT TRUE THEN 'unverified_neon_identity'
  WHEN m.active_count IS NULL THEN 'missing_membership'
  WHEN m.active_count=0 THEN 'revoked_membership'
  WHEN m.active_count<>1 THEN 'ambiguous_membership'
  WHEN l.source_user_id IS NULL THEN 'missing_identity_link'
  WHEN l.neon_principal_id::text<>n.principal OR l.tenant_id::text<>m.tenant OR
       l.evidence<>'verified_email_both_and_active_content_membership' THEN 'stale_identity_link'
  ELSE 'verified' END AS state
 FROM owners o LEFT JOIN source_accounts a USING(source_user_id)
 LEFT JOIN source_emails e ON e.email=a.email LEFT JOIN neon_accounts n ON n.email=a.email
 LEFT JOIN members m ON m.principal_id::text=n.principal
 LEFT JOIN content_import_dev.identity_links l ON l.source_user_id=o.source_user_id
 WHERE o.source_user_id IS NOT NULL
),
staged AS (
 SELECT source_table AS kind,source_pk,lower(source_pk) AS key,source_user_id,
  lower(payload->>'id') AS payload_id,lower(payload->>'user_id') AS payload_owner,
  lower(payload->>'campaign_id') AS campaign,lower(payload->>'content_item_id') AS item,
  lower(payload->>'project_id') AS project,lower(payload->>'workspace_id') AS workspace,lower(payload->>'business_dna_id') AS dna,
  count(*) OVER(PARTITION BY source_table,lower(source_pk)) AS key_count
 FROM content_import_dev.legacy_rows WHERE source_table IN ('business_dna','campaigns','content_items','scenes')
),
dna_by_owner AS (
 SELECT source_user_id,count(*) AS choices,min(key) AS only_key FROM staged
 WHERE kind='business_dna' GROUP BY source_user_id
),
edges AS (
 SELECT s.*,CASE s.kind WHEN 'campaigns' THEN 'business_dna' WHEN 'content_items' THEN 'campaigns'
  WHEN 'scenes' THEN 'content_items' END AS parent_kind,
  CASE s.kind WHEN 'campaigns' THEN coalesce(workspace,dna,CASE WHEN d.choices=1 THEN d.only_key END)
   WHEN 'content_items' THEN campaign WHEN 'scenes' THEN item END AS parent_key,
  CASE WHEN key !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
         OR (payload_id IS NOT NULL AND payload_id<>key) THEN 'invalid_source_key'
   WHEN key_count<>1 THEN 'ambiguous_source_key'
   WHEN s.kind IN ('campaigns','business_dna') AND s.source_user_id IS NULL THEN 'missing_source_owner'
   WHEN s.kind='campaigns' AND project IS NOT NULL THEN 'unverified_project'
   WHEN s.kind='campaigns' AND workspace IS NOT NULL AND dna IS NOT NULL AND workspace<>dna THEN 'source_parent_mismatch'
   WHEN s.kind='campaigns' AND workspace IS NULL AND dna IS NULL AND d.choices>1 THEN 'ambiguous_workspace'
  END AS issue
 FROM staged s LEFT JOIN dna_by_owner d ON s.source_user_id=d.source_user_id
),
targets(kind,key,id,parent_id,tenant_id,principal_id) AS (
 SELECT 'business_dna',id::text,id,NULL::uuid,tenant_id,owner_principal_id FROM content_dev.workspaces
 UNION ALL SELECT 'campaigns',legacy_supabase_id::text,id,workspace_id,tenant_id,owner_principal_id FROM content_dev.campaigns WHERE legacy_supabase_id IS NOT NULL
 UNION ALL SELECT 'content_items',legacy_supabase_id::text,id,campaign_id,tenant_id,NULL FROM content_dev.content_items WHERE legacy_supabase_id IS NOT NULL
 UNION ALL SELECT 'scenes',legacy_supabase_id::text,id,content_item_id,tenant_id,NULL FROM content_dev.scenes WHERE legacy_supabase_id IS NOT NULL
),
nodes AS (
 SELECT e.*,t.id AS target_id,t.parent_id,t.tenant_id,t.principal_id,
  p.source_pk AS parent_source_pk,pt.id AS expected_parent_id
 FROM edges e LEFT JOIN targets t USING(kind,key)
 LEFT JOIN edges p ON p.kind=e.parent_kind AND p.key=e.parent_key AND p.key_count=1
 LEFT JOIN targets pt ON pt.kind=p.kind AND pt.key=p.key
),
-- Walk each staged row to its source workspace. A nullable child owner is valid
-- only when the complete unique parent chain supplies the verified source owner.
paths(leaf_kind,leaf_pk,kind,source_pk) AS (
 SELECT n.kind,n.source_pk,n.kind,n.source_pk FROM nodes n
 UNION ALL
 SELECT path.leaf_kind,path.leaf_pk,n.parent_kind,n.parent_source_pk
 FROM paths path JOIN nodes n USING(kind,source_pk) WHERE n.parent_source_pk IS NOT NULL
),
roots AS (
 SELECT p.leaf_kind,p.leaf_pk,n.source_user_id FROM paths p JOIN nodes n USING(kind,source_pk)
 WHERE n.kind='business_dna'
),
checks AS (
 SELECT p.leaf_kind,p.leaf_pk,
  bool_or(n.issue='invalid_source_key') AS invalid_key,
  bool_or(n.issue='unverified_project') AS unverified_project,
  bool_or(n.issue='missing_source_owner') AS missing_owner,
  bool_or(n.issue='ambiguous_workspace') AS ambiguous_workspace,
  bool_or(n.issue='ambiguous_source_key' OR
   EXISTS(SELECT 1 FROM edges e WHERE e.kind=n.parent_kind AND e.key=n.parent_key AND e.key_count>1)) AS ambiguous_key,
  bool_or(n.issue='source_parent_mismatch' OR
   (r.source_user_id IS NOT NULL AND
    ((n.source_user_id IS NOT NULL AND n.source_user_id<>r.source_user_id) OR
     (n.payload_owner IS NOT NULL AND n.payload_owner<>r.source_user_id::text)))) AS source_mismatch,
  bool_or(n.parent_kind IS NOT NULL AND n.parent_source_pk IS NULL) AS missing_parent,
  max(i.state) AS identity_state,
  bool_or(n.target_id IS NOT NULL AND
   (n.tenant_id::text IS DISTINCT FROM i.tenant OR
    (n.principal_id IS NOT NULL AND n.principal_id::text IS DISTINCT FROM i.principal) OR
    (n.parent_kind IS NOT NULL AND n.parent_id IS DISTINCT FROM n.expected_parent_id))) AS target_mismatch,
  bool_or(n.target_id IS NULL AND n.kind<>p.leaf_kind) AS missing_materialized_parent,
  bool_or(n.target_id IS NOT NULL AND n.kind=p.leaf_kind) AS exists_in_target
 FROM paths p JOIN nodes n USING(kind,source_pk)
 LEFT JOIN roots r ON r.leaf_kind=p.leaf_kind AND r.leaf_pk=p.leaf_pk
 LEFT JOIN identities i ON i.source_user_id=r.source_user_id GROUP BY p.leaf_kind,p.leaf_pk
),
classifications AS (
 SELECT 'identity' AS entity,state FROM identities
 UNION ALL SELECT leaf_kind,CASE
  WHEN invalid_key THEN 'invalid_source_key' WHEN ambiguous_key THEN 'ambiguous_source_key'
  WHEN ambiguous_workspace THEN 'ambiguous_workspace' WHEN source_mismatch THEN 'source_parent_mismatch'
  WHEN unverified_project THEN 'unverified_project' WHEN missing_owner THEN 'missing_source_owner' WHEN missing_parent THEN 'missing_source_parent'
  WHEN identity_state IS DISTINCT FROM 'verified' THEN coalesce(identity_state,'missing_source_identity')
  WHEN target_mismatch THEN 'target_parent_or_owner_mismatch'
  WHEN missing_materialized_parent THEN 'missing_materialized_parent'
  WHEN exists_in_target THEN 'already_materialized' ELSE 'eligible' END FROM checks
),
visibility AS (
 SELECT bool_or(row_security_active(name::regclass)) AS limited FROM unnest(ARRAY[
  'content_import_dev.legacy_rows','content_import_dev.identity_links','neon_auth."user"',
  'bci_dev.tenant_memberships','content_dev.workspaces','content_dev.campaigns',
  'content_dev.content_items','content_dev.scenes']) AS t(name)
)
SELECT entity,state,count(*)::bigint AS rows FROM classifications,visibility WHERE NOT limited GROUP BY entity,state
UNION ALL SELECT 'preflight','unverified_visibility',0::bigint FROM visibility WHERE limited
ORDER BY entity,state;
