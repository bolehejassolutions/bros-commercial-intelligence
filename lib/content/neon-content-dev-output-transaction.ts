/** DEV-only restricted transaction runner for deterministic CONTENT fixture drafts.
 * No role creation, grant changes, provider calls, scheduler or production use.
 */
import 'server-only';
import {Pool} from 'pg';
import type {JobRow} from './neon-content-generation-job-lifecycle.ts';
import type {ContentOutputDb} from './neon-content-dev-draft-persistence.ts';

const ROLE='content_dev_job_worker_v2';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=():never=>{throw new Error('CONTENT DEV output transaction unavailable');};
const valid=(x:unknown):x is string=>typeof x==='string'&&UUID.test(x);

/** Caller must supply an approved worker role with explicitly scoped grants.
 * The connected Neon role is not provisioned by this module.
 */
export async function withRestrictedContentDevOutputTransaction<T>(
 job:Readonly<JobRow>,run:(db:ContentOutputDb)=>Promise<T>
):Promise<T>{
 if(process.env.VERCEL_ENV!=='preview'||
    process.env.CONTENT_DEV_TASK_EXECUTION_ENABLED!=='true'||
    process.env.CONTENT_DEV_JOB_WORKER_ENABLED!=='true'||
    !job||![job.id,job.tenant_id,job.campaign_id,job.requested_by].every(valid)||
    typeof run!=='function')deny();
 const raw=process.env.CONTENT_NEON_JOB_WORKER_DATABASE_URL;
 if(!raw)deny();
 let url:URL;
 try{url=new URL(raw);}catch{return deny();}
 if(!['postgres:','postgresql:'].includes(url.protocol)||
    decodeURIComponent(url.username)!==ROLE||!url.password||
    !url.hostname.endsWith('.neon.tech')||url.hostname.length<='.neon.tech'.length||
    (url.port&&url.port!=='5432')||url.hash||
    url.searchParams.getAll('sslmode').length!==1||
    url.searchParams.get('sslmode')!=='require'||
    [...url.searchParams.keys()].some(k=>k!=='sslmode'))deny();
 const pool=new Pool({connectionString:raw,max:1,connectionTimeoutMillis:5000,
  idleTimeoutMillis:10000,allowExitOnIdle:true});
 try{
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   try{
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    const check=await client.query(`SELECT current_user AS login,current_database() AS db,
      (SELECT rolcanlogin AND NOT rolinherit AND NOT rolbypassrls AND NOT rolsuper
       AND NOT rolcreaterole FROM pg_roles WHERE rolname=current_user) AS restricted,
      has_schema_privilege(current_user,'content_import_dev','USAGE') AS staging,
      has_table_privilege(current_user,'content_dev.credit_ledger','SELECT') AS credits,
      has_table_privilege(current_user,'content_dev.content_items','INSERT') AS can_insert,
      has_table_privilege(current_user,'content_dev.content_items','SELECT') AS can_read,
      (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
       WHERE oid='content_dev.content_items'::regclass) AS items_rls,
      (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
       WHERE oid='content_dev.campaigns'::regclass) AS campaigns_rls`);
    const p=check.rows[0];
    if(!p||p.login!==ROLE||p.db!=='bros_intelligence_dev'||p.restricted!==true||
       p.staging!==false||p.credits!==false||p.can_insert!==true||
       p.can_read!==true||p.items_rls!==true||p.campaigns_rls!==true)deny();
    await client.query("SELECT set_config('bci.principal_id',$1,true)",[job.requested_by]);
    const member=await client.query(`SELECT 1 FROM bci_dev.tenant_memberships
      WHERE tenant_id=$1::uuid AND principal_id=$2::uuid AND product='content'
      AND active IS TRUE AND revoked_at IS NULL LIMIT 2`,
      [job.tenant_id,job.requested_by]);
    if(member.rows.length!==1)deny();
    const db:ContentOutputDb={query:async(sql,params=[])=>{
      if(typeof sql!=='string'||!/^\s*(SELECT|INSERT)\b/i.test(sql))deny();
      const result=await client.query(sql,[...params]);
      return {rows:result.rows,rowCount:result.rowCount};
    }};
    const result=await run(db);
    await client.query('COMMIT');
    return result;
   }catch(e){await client.query('ROLLBACK');throw e;}
  }finally{client.release();}
 }finally{await pool.end();}
}
