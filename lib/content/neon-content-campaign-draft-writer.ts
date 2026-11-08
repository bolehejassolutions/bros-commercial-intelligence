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
const validText=(value:unknown,max:number,required=true)=>typeof value==='string'&&(!required||value.trim().length>0)&&value.length<=max;
const allowedPlatforms=new Set(['facebook','instagram','tiktok','youtube','linkedin','whatsapp','threads','x']);
function validDraft(value:unknown):value is Draft {
 if(value===null||typeof value!=='object'||Array.isArray(value))return false;
 const d=value as Partial<Draft>;
 const fields:[unknown,number,boolean][]=[
  [d.product_service,200,true],[d.audience,2000,true],
  [d.description,4000,false],[d.problem,2000,false],[d.objective,2000,false]
 ];
 if(!fields.every(([v,max,required])=>validText(v,max,required)))return false;
 if(!Number.isInteger(d.duration_days)||(d.duration_days as number)<1||(d.duration_days as number)>90)return false;
 if(!Array.isArray(d.platforms)||d.platforms.length<1||d.platforms.length>8)return false;
 const normalized=d.platforms.map(p=>typeof p==='string'?p.toLowerCase():'');
 return normalized.every(p=>allowedPlatforms.has(p))&&new Set(normalized).size===normalized.length;
}

export function createContentCampaignDraftWriter(transaction:Transaction){
 if(typeof transaction!=='function')deny();
 return async(principal:Principal,workspaceId:string,draft:Draft,key:string)=>{
  if(principal?.authenticated!==true||!UUID.test(principal.userId)||!UUID.test(workspaceId)||
     !/^[a-zA-Z0-9_-]{12,180}$/.test(key)||!validDraft(draft))deny();
  return transaction(async query=>{
   const role=(await query(`SELECT current_user AS name,session_user AS login,rolcanlogin AS can_login,
     rolinherit AS inherits,rolbypassrls AS bypass,rolsuper AS superuser,rolcreaterole AS can_create_role,
     (SELECT count(*)::int FROM pg_auth_members WHERE member=pg_roles.oid) AS parents
     FROM pg_roles WHERE rolname=current_user`,[])).rows[0];
   if(!role||role.name!=='content_dev_draft_writer_v2'||role.login!==role.name||
      role.can_login!==true||role.inherits!==false||role.bypass!==false||
      role.superuser!==false||role.can_create_role!==false||role.parents!==0)deny();
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
   // Existing BCI membership RLS reads this transaction-local verified identity.
   const context=(await query(`SELECT set_config('bci.principal_id',$1,true) AS principal_id`,[principal.userId])).rows;
   if(context.length!==1||context[0].principal_id!==principal.userId)deny();
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
   // Serialize same-key requests within this database transaction. PostgreSQL's
   // transaction-level advisory lock is released automatically on commit/rollback.
   // Never use session locks (unsafe with pooled connections).
   // A void-returning PostgreSQL function must not be interpreted as a
   // boolean. A successful SELECT returns one row; errors reject the transaction.
   const lockRows=(await query(`SELECT pg_advisory_xact_lock(
      hashtextextended($1::text, 0)) AS lock_result`,
      [tenant+':'+principal.userId+':'+key])).rows;
   if(lockRows.length!==1)deny();
   const payload=JSON.stringify(draft);
   // Separate statements inside ONE database transaction. PostgreSQL data-modifying
   // CTEs share a snapshot: UPDATE cannot reliably see a row inserted by a sibling
   // INSERT CTE. Reservation, campaign and link must therefore execute sequentially.
   const reserved=(await query(`INSERT INTO content_dev.campaign_draft_requests
     (tenant_id,owner_principal_id,idempotency_key,workspace_id,payload)
     VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5::jsonb)
     ON CONFLICT (tenant_id,owner_principal_id,idempotency_key) DO NOTHING
     RETURNING idempotency_key`,
     [tenant,principal.userId,key,workspaceId,payload])).rows;
   if(reserved.length>1)deny();
   if(reserved.length===1){
     const created=(await query(`INSERT INTO content_dev.campaigns
       (tenant_id,workspace_id,owner_principal_id,product_service,audience,description,
        problem,objective,duration_days,platforms,status)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10::text[],'draft')
       RETURNING id`,[tenant,workspaceId,principal.userId,draft.product_service,
       draft.audience,draft.description,draft.problem,draft.objective,
       draft.duration_days,draft.platforms])).rows;
     if(created.length!==1||!UUID.test(String(created[0].id)))deny();
     const linked=(await query(`UPDATE content_dev.campaign_draft_requests
       SET campaign_id=$4::uuid
       WHERE tenant_id=$1::uuid AND owner_principal_id=$2::uuid
       AND idempotency_key=$3 AND campaign_id IS NULL
       RETURNING campaign_id`,[tenant,principal.userId,key,created[0].id])).rows;
     if(linked.length!==1||linked[0].campaign_id!==created[0].id)deny();
     return {id:created[0].id,status:'draft'};
   }
   // Conflict must match original payload and workspace. Never reuse a key for another request.
   const existing=(await query(`SELECT r.campaign_id, (r.workspace_id=$4::uuid AND r.payload=$5::jsonb) AS same_request,
      (c.id IS NOT NULL AND c.tenant_id=r.tenant_id AND c.owner_principal_id=r.owner_principal_id
       AND c.workspace_id=r.workspace_id AND c.status='draft'
       AND c.product_service=$6 AND c.audience=$7 AND c.description=$8
       AND c.problem=$9 AND c.objective=$10 AND c.duration_days=$11
       AND c.platforms=$12::text[]) AS valid_campaign
      FROM content_dev.campaign_draft_requests r
      LEFT JOIN content_dev.campaigns c ON c.id=r.campaign_id AND c.tenant_id=r.tenant_id
      WHERE r.tenant_id=$1::uuid AND r.owner_principal_id=$2::uuid AND r.idempotency_key=$3`,
      [tenant,principal.userId,key,workspaceId,payload,draft.product_service,
       draft.audience,draft.description,draft.problem,draft.objective,
       draft.duration_days,draft.platforms])).rows;
   if(existing.length!==1||existing[0].same_request!==true||
      existing[0].valid_campaign!==true||!UUID.test(String(existing[0].campaign_id)))deny();
   return {id:existing[0].campaign_id,status:'draft',replayed:true};
  });
 };
}
