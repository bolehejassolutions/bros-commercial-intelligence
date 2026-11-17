/** DEV-only worker execution boundary. No scheduler, provider, grants or production activation.
 * Every lifecycle statement receives its own transaction-local RLS principal.
 * Never hold a PostgreSQL transaction open while a provider performs work.
 * Requires a separately approved restricted worker login and tenant policy.
 */
import 'server-only';
import {Pool} from 'pg';
import {processContentDevJob} from './neon-content-generation-job-worker.ts';
import type {JobQuery,JobRow} from './neon-content-generation-job-lifecycle.ts';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE='content_dev_job_worker_v2';
const fail=():never=>{throw new Error('CONTENT DEV worker unavailable');};
type Work=(job:Readonly<JobRow>)=>Promise<void>;

export async function executeRestrictedContentDevJob(input:{
 tenantId:string;jobId:string;principalId:string;work:Work;
 recoverExpired?:boolean;maxAttempts?:number;leaseSeconds?:number;
}){
 if(process.env.VERCEL_ENV!=='preview'||
    process.env.CONTENT_DEV_JOB_WORKER_ENABLED!=='true')fail();
 if(!input||![input.tenantId,input.jobId,input.principalId].every(
    value=>typeof value==='string'&&UUID.test(value))||typeof input.work!=='function')fail();
 const raw=process.env.CONTENT_NEON_JOB_WORKER_DATABASE_URL;
 if(!raw)fail();
 let url:URL;
 try{url=new URL(raw);}catch{return fail();}
 if(!['postgres:','postgresql:'].includes(url.protocol)||
    decodeURIComponent(url.username)!==ROLE||!url.password||
    !url.hostname.endsWith('.neon.tech')||
    url.hostname.length<='.neon.tech'.length||
    (url.port&&url.port!=='5432')||
    url.searchParams.getAll('sslmode').length!==1||
    url.searchParams.get('sslmode')!=='require'||url.hash||
    [...url.searchParams.keys()].some(k=>k!=='sslmode'))fail();
 const pool=new Pool({connectionString:raw,max:1,connectionTimeoutMillis:5000,
  idleTimeoutMillis:10000,allowExitOnIdle:true});
 try{
  const db:JobQuery={query:async(sql,params=[])=>{
   // The lifecycle contract uses only tenant-scoped parameterized statements.
   // No arbitrary SQL is exposed to an HTTP request or a generation provider.
   if(!sql.trimStart().toUpperCase().startsWith('UPDATE CONTENT_DEV.GENERATION_JOBS'))fail();
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    try{
     const posture=await client.query(`SELECT current_user AS login,
      current_database() AS db,
      (SELECT rolcanlogin AND NOT rolinherit AND NOT rolbypassrls
       AND NOT rolsuper AND NOT rolcreaterole FROM pg_roles
       WHERE rolname=current_user) AS restricted,
      has_schema_privilege(current_user,'content_import_dev','USAGE') AS staging,
      has_table_privilege(current_user,'content_dev.credit_ledger','SELECT') AS credits,
      has_table_privilege(current_user,'content_dev.generation_jobs','UPDATE') AS job_update,
      has_table_privilege(current_user,'content_dev.generation_jobs','INSERT') AS job_insert,
      (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
       WHERE oid='content_dev.generation_jobs'::regclass) AS forced`);
     const r=posture.rows[0];
     if(!r||r.login!==ROLE||r.db!=='bros_intelligence_dev'||r.restricted!==true||
        r.staging!==false||r.credits!==false||r.job_update!==true||
        r.job_insert!==false||r.forced!==true)fail();
     await client.query("SELECT set_config('bci.principal_id',$1,true)",[input.principalId]);
     // Verify existing CONTENT membership independently of the job row.
     const membership=await client.query(`SELECT 1 FROM bci_dev.tenant_memberships
      WHERE tenant_id=$1::uuid AND principal_id=$2::uuid AND product='content'
      AND active IS TRUE AND revoked_at IS NULL LIMIT 2`,
      [input.tenantId,input.principalId]);
     if(membership.rows.length!==1)fail();
     const result=await client.query(sql,[...params]);
     await client.query('COMMIT');
     return {rows:result.rows,rowCount:result.rowCount};
    }catch(e){await client.query('ROLLBACK');throw e;}
   }finally{client.release();}
  }};
  return await processContentDevJob({db,tenantId:input.tenantId,jobId:input.jobId,
   work:input.work,recoverExpired:input.recoverExpired,maxAttempts:input.maxAttempts,
   leaseSeconds:input.leaseSeconds});
 }finally{await pool.end();}
}
