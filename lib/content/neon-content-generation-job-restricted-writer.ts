/** Isolated CONTENT DEV job-write boundary. Not wired to a route or worker.
 * Requires separately approved, dedicated restricted login and RLS grants.
 * No role creation, grants, migration, provider calls, or credit changes.
 */
import 'server-only';
import {Pool} from 'pg';
import {ContentReadDenied} from './neon-content-workspace-reader.ts';
import type {JobQuery} from './neon-content-generation-job-lifecycle.ts';

type Principal=Readonly<{userId:string;authenticated:true}>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=():never=>{throw new ContentReadDenied();};
const ROLE='content_dev_job_writer_v2';
export async function withRestrictedContentJobWriter<T>(
 principal:Principal,workspaceId:string,campaignId:string,
 action:(db:JobQuery,tenantId:string)=>Promise<T>
):Promise<T>{
 if(principal?.authenticated!==true||!UUID.test(principal.userId)||
    !UUID.test(workspaceId)||!UUID.test(campaignId)||typeof action!=='function')deny();
 const raw=process.env.CONTENT_NEON_JOB_WRITER_DATABASE_URL;
 if(!raw)deny();
 let url:URL;
 try{url=new URL(raw);}catch{return deny();}
 if(!['postgres:','postgresql:'].includes(url.protocol)||
    decodeURIComponent(url.username)!==ROLE||!url.password||
    !url.hostname.endsWith('.neon.tech')||url.hostname.length<='.neon.tech'.length||
    (url.port&&url.port!=='5432')||url.searchParams.getAll('sslmode').length!==1||
    url.searchParams.get('sslmode')!=='require'||url.hash||
    [...url.searchParams.keys()].some(k=>k!=='sslmode'))deny();
 const pool=new Pool({connectionString:raw,max:1,connectionTimeoutMillis:5000,
  idleTimeoutMillis:10000,allowExitOnIdle:true});
 try{
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   try{
    const role=(await client.query(`SELECT current_user AS name,session_user AS login,
     rolcanlogin AS can_login,rolinherit AS inherits,rolbypassrls AS bypass,
     rolsuper AS superuser,rolcreaterole AS create_role,
     (SELECT count(*)::int FROM pg_auth_members WHERE member=pg_roles.oid) AS parents
     FROM pg_roles WHERE rolname=current_user`)).rows[0];
    if(!role||role.name!==ROLE||role.login!==ROLE||role.can_login!==true||
       role.inherits!==false||role.bypass!==false||role.superuser!==false||
       role.create_role!==false||role.parents!==0)deny();
    const posture=(await client.query(`SELECT current_database() AS db,
      has_schema_privilege(current_user,'content_import_dev','USAGE') AS staging,
      has_table_privilege(current_user,'content_dev.credit_ledger','SELECT') AS credits,
      has_table_privilege(current_user,'content_dev.generation_jobs','INSERT') AS jobs,
      has_table_privilege(current_user,'content_dev.campaigns','INSERT') AS campaigns,
      has_table_privilege(current_user,'bci_dev.tenant_memberships','SELECT') AS membership,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='content_dev' AND c.relname IN ('workspaces','campaigns','generation_jobs')
       AND c.relrowsecurity AND c.relforcerowsecurity) AS forced`)).rows[0];
    if(!posture||posture.db!=='bros_intelligence_dev'||posture.staging!==false||
       posture.credits!==false||posture.jobs!==true||posture.campaigns!==false||
       posture.membership!==true||posture.forced!==3)deny();
    await client.query("SELECT set_config('bci.principal_id',$1,true)",[principal.userId]);
    const scope=(await client.query(`SELECT w.tenant_id FROM content_dev.workspaces w
      JOIN content_dev.campaigns c ON c.workspace_id=w.id AND c.tenant_id=w.tenant_id
      JOIN bci_dev.tenant_memberships m ON m.tenant_id=w.tenant_id
       AND m.principal_id=$1::uuid AND m.product='content'
       AND m.active IS TRUE AND m.revoked_at IS NULL
      WHERE w.id=$2::uuid AND c.id=$3::uuid
       AND w.owner_principal_id=$1::uuid AND c.owner_principal_id=$1::uuid LIMIT 2`,
      [principal.userId,workspaceId,campaignId])).rows;
    if(scope.length!==1||!UUID.test(String(scope[0].tenant_id)))deny();
    const db:JobQuery={query:async(sql,params=[])=>{
      const result=await client.query(sql,[...params]);
      return {rows:result.rows,rowCount:result.rowCount};
    }};
    const result=await action(db,String(scope[0].tenant_id));
    await client.query('COMMIT');
    return result;
   }catch(e){await client.query('ROLLBACK');throw e;}
  }finally{client.release();}
 }finally{await pool.end();}
}
