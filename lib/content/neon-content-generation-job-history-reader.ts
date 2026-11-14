/** Authenticated, tenant-bound CONTENT job history. A dedicated restricted reader
 * and an existing RLS SELECT policy are mandatory; the absent live gate fails closed.
 * Never return idempotency tokens or provider/credit metadata to the browser.
 */
import {ContentReadDenied} from './neon-content-workspace-reader.ts';

type Principal=Readonly<{userId:string;authenticated:true}>;
type Row=Record<string,unknown>;
type Query=(sql:string,params:readonly unknown[])=>Promise<{rows:readonly Row[]}>;
type Transaction=<T>(fn:(query:Query)=>Promise<T>)=>Promise<T>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function deny():never{throw new ContentReadDenied();}
function iso(v:unknown):string|null{
 if(v===null||v===undefined)return null;
 const d=v instanceof Date?v:new Date(String(v));
 return Number.isFinite(d.getTime())?d.toISOString():deny();
}
export function createContentJobHistoryReader(transaction:Transaction){
 if(typeof transaction!=='function')deny();
 return async(principal:Principal,workspaceId:string,campaignId:string,limit=25)=>{
  if(principal?.authenticated!==true||!UUID.test(principal.userId)||
    !UUID.test(workspaceId)||!UUID.test(campaignId)||
    !Number.isInteger(limit)||limit<1||limit>50)deny();
  return transaction(async query=>{
   const role=(await query(`SELECT current_user AS name,session_user AS login,
    rolcanlogin AS can_login,rolinherit AS inherits,rolbypassrls AS bypass,
    rolsuper AS superuser,rolcreaterole AS can_create_role,
    (SELECT count(*)::int FROM pg_auth_members WHERE member=pg_roles.oid) AS parents
    FROM pg_roles WHERE rolname=current_user`,[])).rows;
   if(role.length!==1||role[0].name!=='content_dev_reader_v2'||
     role[0].login!==role[0].name||role[0].can_login!==true||
     role[0].inherits!==false||role[0].bypass!==false||
     role[0].superuser!==false||role[0].can_create_role!==false||role[0].parents!==0)deny();
   const posture=(await query(`SELECT current_database() AS db,
     (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='content_dev' AND c.relname IN ('workspaces','campaigns','generation_jobs')
      AND c.relrowsecurity AND c.relforcerowsecurity) AS forced,
     has_table_privilege(current_user,'content_dev.generation_jobs','SELECT') AS jobs,
     has_table_privilege(current_user,'content_dev.credit_ledger','SELECT') AS credits,
     has_table_privilege(current_user,'content_dev.campaigns','INSERT') AS writes,
     has_schema_privilege(current_user,'content_import_dev','USAGE') AS staging,
     has_table_privilege(current_user,'bci_dev.tenant_memberships','SELECT') AS membership,
     (SELECT count(*)::int FROM pg_policies WHERE schemaname='content_dev'
      AND tablename='generation_jobs') AS job_policies`,[])).rows;
   if(posture.length!==1||posture[0].db!=='bros_intelligence_dev'||
     posture[0].forced!==3||posture[0].jobs!==true||
     posture[0].credits!==false||posture[0].writes!==false||
     posture[0].staging!==false||posture[0].membership!==true||
     typeof posture[0].job_policies!=='number'||posture[0].job_policies<1)deny();
   const bound=(await query("SELECT set_config('bci.principal_id',$1,true) AS principal_id",
     [principal.userId])).rows;
   if(bound.length!==1||bound[0].principal_id!==principal.userId)deny();
   const scope=(await query(`SELECT w.tenant_id
     FROM content_dev.workspaces w
     JOIN bci_dev.tenant_memberships m ON m.tenant_id=w.tenant_id
      AND m.principal_id=$1::uuid AND m.product='content'
      AND m.active IS TRUE AND m.revoked_at IS NULL
     JOIN content_dev.campaigns c ON c.workspace_id=w.id
      AND c.tenant_id=w.tenant_id AND c.owner_principal_id=$1::uuid
     WHERE w.id=$2::uuid AND w.owner_principal_id=$1::uuid AND c.id=$3::uuid LIMIT 1`,
     [principal.userId,workspaceId,campaignId])).rows;
   if(scope.length!==1||!UUID.test(String(scope[0].tenant_id)))deny();
   const jobs=(await query(`SELECT j.id,j.campaign_id,j.status,j.attempts,j.error_code,
     j.created_at,j.claimed_at,j.completed_at
     FROM content_dev.generation_jobs j WHERE
     j.tenant_id=$1::uuid AND j.campaign_id=$2::uuid AND j.requested_by=$3::uuid
     ORDER BY j.created_at DESC,j.id DESC LIMIT $4`,
     [String(scope[0].tenant_id),campaignId,principal.userId,limit])).rows;
   if(jobs.length>limit||new Set(jobs.map(j=>j.id)).size!==jobs.length)deny();
   return Object.freeze(jobs.map(j=>{
    if(!UUID.test(String(j.id))||j.campaign_id!==campaignId||
      !['queued','running','completed','failed'].includes(String(j.status))||
      !Number.isInteger(j.attempts)||Number(j.attempts)<0||
      (j.error_code!==null&&j.error_code!==undefined&&
       (typeof j.error_code!=='string'||!/^[A-Z][A-Z0-9_]{1,63}$/.test(j.error_code))))deny();
    return Object.freeze({id:String(j.id),status:String(j.status),
     attempts:Number(j.attempts),errorCode:j.error_code??null,
     createdAt:iso(j.created_at),claimedAt:iso(j.claimed_at),
     completedAt:iso(j.completed_at)});
   }));
  });
 };
}
