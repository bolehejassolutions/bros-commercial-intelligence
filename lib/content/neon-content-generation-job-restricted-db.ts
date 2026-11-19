/** DEV-only restricted PostgreSQL adapter for CONTENT job lifecycle.
 * No connection strings, grants, migrations, provider or HTTP activation.
 * A trusted caller supplies a fresh transaction-capable pool per role.
 * Each query executes in its own transaction with transaction-local context.
 */
import type {JobQuery,JobRow} from './neon-content-generation-job-lifecycle.ts';

type Rows = {rows:JobRow[];rowCount?:number|null};
type Client = {query:(sql:string,params?:readonly unknown[])=>Promise<{rows:any[];rowCount?:number|null}>};
type Pool = {connect:()=>Promise<Client & {release:()=>void}>};
type Principal = Readonly<{userId:string;authenticated:true}>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES={submit:'content_dev_job_writer_v2',history:'content_dev_reader_v2',worker:'content_dev_job_worker_v2'} as const;
type Purpose=keyof typeof ROLES;
function valid(value:string){return typeof value==='string'&&UUID.test(value);}
function requireRole(row:any,purpose:Purpose){
 if(!row||row.name!==ROLES[purpose]||row.login!==ROLES[purpose]||
 row.can_login!==true||row.inherits!==false||row.bypass!==false||
 row.superuser!==false||row.createrole!==false||Number(row.parents)!==0)
 throw new Error('Restricted CONTENT role unavailable');
}
export function createRestrictedContentJobDb(input:{
 pool:Pool;purpose:Purpose;tenantId:string;principal?:Principal;
}):JobQuery{
 const {pool,purpose,tenantId,principal}=input;
 if(!pool||typeof pool.connect!=='function'||!valid(tenantId)||
 (purpose!=='worker'&&(!principal||principal.authenticated!==true||!valid(principal.userId)))||
 (purpose==='worker'&&principal!==undefined))throw new Error('Invalid CONTENT job adapter scope');
 return {async query(sql:string,params:readonly unknown[]=[]):Promise<Rows>{
  if(typeof sql!=='string'||!sql.trim()||!Array.isArray(params))
   throw new Error('Invalid CONTENT job query');
  const client=await pool.connect();
  let begun=false;
  try{
   await client.query('BEGIN');begun=true;
   const role=(await client.query(`SELECT current_user AS name,session_user AS login,
    rolcanlogin AS can_login,rolinherit AS inherits,rolbypassrls AS bypass,
    rolsuper AS superuser,rolcreaterole AS createrole,
    (SELECT count(*)::int FROM pg_auth_members WHERE member=pg_roles.oid) AS parents
    FROM pg_roles WHERE rolname=current_user`)).rows;
   if(role.length!==1)throw new Error('Restricted CONTENT role unavailable');
   requireRole(role[0],purpose);
   const posture=(await client.query(`SELECT current_database() AS db,
    has_schema_privilege(current_user,'content_import_dev','USAGE') AS staging,
    has_table_privilege(current_user,'content_dev.credit_ledger','INSERT') AS credits_write,
    (SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='content_dev' AND c.relname='generation_jobs') AS forced`)).rows;
   if(posture.length!==1||posture[0].db!=='bros_intelligence_dev'||
    posture[0].staging!==false||posture[0].credits_write!==false||
    posture[0].forced!==true)throw new Error('CONTENT job database posture denied');
   if(principal){
    const bound=(await client.query("SELECT set_config('bci.principal_id',$1,true) AS principal",[principal.userId])).rows;
    if(bound.length!==1||bound[0].principal!==principal.userId)throw new Error('Principal binding failed');
   }
   const scoped=(await client.query("SELECT set_config('content.tenant_id',$1,true) AS tenant",[tenantId])).rows;
   if(scoped.length!==1||scoped[0].tenant!==tenantId)throw new Error('Tenant binding failed');
   const result=await client.query(sql,params);
   await client.query('COMMIT');begun=false;
   return {rows:result.rows as JobRow[],rowCount:result.rowCount};
  }catch(error){
   if(begun)try{await client.query('ROLLBACK');}catch{}
   throw error;
  }finally{client.release();}
 }};
}
