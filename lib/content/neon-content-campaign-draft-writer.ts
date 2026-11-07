/** DEV-only Neon draft persistence. No role creation, grants, generation or credit changes.
 * Inject a transaction backed by a separately authorized restricted DB login.
 * Caller must verify the authenticated principal server-side.
 */
import { ContentReadDenied } from './neon-content-workspace-reader.ts';
type Row=Record<string,unknown>;
type Query=(sql:string,params:readonly unknown[])=>Promise<{rows:readonly Row[]}>;
type Transaction=<T>(fn:(query:Query)=>Promise<T>)=>Promise<T>;
type Principal=Readonly<{userId:string;authenticated:true}>;
type Draft=Readonly<{product_service:string;audience:string;description:string;problem:string;objective:string;duration_days:number;platforms:string[]}>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=():never=>{throw new ContentReadDenied();};
export function createContentCampaignDraftWriter(transaction:Transaction){
 if(typeof transaction!=='function')deny();
 return async(principal:Principal,workspaceId:string,draft:Draft,key:string)=>{
  if(principal?.authenticated!==true||!UUID.test(principal.userId)||!UUID.test(workspaceId)||
     !/^[a-zA-Z0-9_-]{12,180}$/.test(key))deny();
  return transaction(async query=>{
   const role=(await query(`SELECT current_user AS name,session_user AS login,rolcanlogin AS can_login,
     rolinherit AS inherits,rolbypassrls AS bypass,rolsuper AS superuser,
     (SELECT count(*)::int FROM pg_auth_members WHERE member=pg_roles.oid) AS parents
     FROM pg_roles WHERE rolname=current_user`,[])).rows[0];
   if(!role||role.name!=='content_dev_draft_writer'||role.login!==role.name||
      role.can_login!==true||role.inherits!==false||role.bypass!==false||
      role.superuser!==false||role.parents!==0)deny();
   const posture=(await query(`SELECT current_database() AS db,
     (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='content_dev' AND c.relname IN ('workspaces','campaigns')
      AND c.relrowsecurity AND c.relforcerowsecurity) AS forced,
     has_schema_privilege(current_user,'content_import_dev','USAGE') AS staging,
     has_table_privilege(current_user,'content_dev.credit_ledger','SELECT') AS credits,
     has_table_privilege(current_user,'content_dev.generation_jobs','INSERT') AS jobs,
     has_table_privilege(current_user,'content_dev.campaigns','INSERT') AS writes,
     has_table_privilege(current_user,'bci_dev.tenant_memberships','SELECT') AS membership`,[])).rows[0];
   if(!posture||posture.db!=='bros_intelligence_dev'||posture.forced!==2||
      posture.staging!==false||posture.credits!==false||posture.jobs!==false||
      posture.writes!==true||posture.membership!==true)deny();
   const workspaces=(await query(`SELECT w.tenant_id FROM content_dev.workspaces w
      JOIN bci_dev.tenant_memberships m ON m.tenant_id=w.tenant_id
      AND m.principal_id=$1::uuid AND m.product='content' AND m.active IS TRUE
      AND m.revoked_at IS NULL
      WHERE w.id=$2::uuid AND w.owner_principal_id=$1::uuid LIMIT 1`,
      [principal.userId,workspaceId])).rows;
   if(workspaces.length!==1||!UUID.test(String(workspaces[0].tenant_id)))deny();
   const tenant=String(workspaces[0].tenant_id);
   // Idempotency is persisted in a dedicated table with a unique tenant/principal/key.
   // Without its verified presence, never attempt a campaign INSERT.
   const gate=(await query(`SELECT to_regclass('content_dev.campaign_draft_requests')::text AS table_name,
      has_table_privilege(current_user,'content_dev.campaign_draft_requests','INSERT') AS can_insert`,[])).rows[0];
   if(gate?.table_name!=='content_dev.campaign_draft_requests'||gate.can_insert!==true)deny();
   const payload=JSON.stringify(draft);
   const rows=(await query(`WITH reservation AS (
      INSERT INTO content_dev.campaign_draft_requests
       (tenant_id,owner_principal_id,idempotency_key,workspace_id,payload)
      VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5::jsonb)
      ON CONFLICT (tenant_id,owner_principal_id,idempotency_key) DO NOTHING
      RETURNING tenant_id,owner_principal_id,idempotency_key,workspace_id,payload
     ), created AS (
      INSERT INTO content_dev.campaigns
       (tenant_id,workspace_id,owner_principal_id,product_service,audience,description,
        problem,objective,duration_days,platforms,status)
      SELECT tenant_id,workspace_id,owner_principal_id,payload->>'product_service',
        payload->>'audience',payload->>'description',payload->>'problem',
        payload->>'objective',(payload->>'duration_days')::integer,
        ARRAY(SELECT jsonb_array_elements_text(payload->'platforms')),'draft'
      FROM reservation RETURNING id,tenant_id
     ), linked AS (
      UPDATE content_dev.campaign_draft_requests r SET campaign_id=c.id
      FROM created c WHERE r.tenant_id=$1::uuid AND r.owner_principal_id=$2::uuid
      AND r.idempotency_key=$3 RETURNING r.campaign_id
     )
     SELECT campaign_id AS id FROM linked`,[tenant,principal.userId,key,workspaceId,payload])).rows;
   if(rows.length===1&&UUID.test(String(rows[0].id)))return {id:rows[0].id,status:'draft'};
   // Conflict must match original payload and workspace. Never reuse a key for another request.
   const existing=(await query(`SELECT r.campaign_id, (r.workspace_id=$4::uuid AND r.payload=$5::jsonb) AS same_request,
      (c.id IS NOT NULL AND c.tenant_id=r.tenant_id AND c.owner_principal_id=r.owner_principal_id
       AND c.workspace_id=r.workspace_id AND c.status='draft') AS valid_campaign
      FROM content_dev.campaign_draft_requests r
      LEFT JOIN content_dev.campaigns c ON c.id=r.campaign_id AND c.tenant_id=r.tenant_id
      WHERE r.tenant_id=$1::uuid AND r.owner_principal_id=$2::uuid AND r.idempotency_key=$3`,
      [tenant,principal.userId,key,workspaceId,payload])).rows;
   if(existing.length!==1||existing[0].same_request!==true||
      existing[0].valid_campaign!==true||!UUID.test(String(existing[0].campaign_id)))deny();
   return {id:existing[0].campaign_id,status:'draft',replayed:true};
  });
 };
}
