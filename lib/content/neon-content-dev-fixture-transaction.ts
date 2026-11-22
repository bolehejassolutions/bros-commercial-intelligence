/** DEV-only transaction boundary for deterministic CONTENT fixture jobs.
 * A caller supplies an already authenticated, restricted PostgreSQL pool.
 * Never use an owner, superuser, BYPASSRLS, or HTTP-exposed connection.
 * No role grants, migrations, paid providers, credits, or publishing.
 */
import 'server-only';
import {executeContentDevFixtureInTransaction} from './neon-content-dev-fixture-worker.ts';

type QueryResult={rows:Record<string,unknown>[];rowCount?:number|null};
type Client={query:(sql:string,params?:readonly unknown[])=>Promise<QueryResult>;release:(error?:Error)=>void};
type Pool={connect:()=>Promise<Client>};
type Input=Parameters<typeof executeContentDevFixtureInTransaction>[1]&{principalId:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function executeContentDevFixtureAtomically(pool:Pool,input:Input){
 if(!pool||typeof pool.connect!=='function'||!input||
    !uuid.test(input.tenantId)||!uuid.test(input.jobId)||!uuid.test(input.principalId)||
    process.env.VERCEL_ENV==='production')
   throw new Error('Restricted CONTENT DEV pool and verified fixture identity required');
 const client=await pool.connect();
 let begun=false;
 let discard=false;
 let committing=false;
 try{
  await client.query('BEGIN');
  begun=true;
  await client.query('SET LOCAL row_security = on');
  // Explicit fail-closed acceptance gate: a database owner or BYPASSRLS
  // principal is never an acceptable substitute for tenant RLS.
  const roles=await client.query(`SELECT r.rolname,r.rolsuper,r.rolbypassrls,r.rolcanlogin,
    (SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity)
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='content_dev' AND c.relname IN ('generation_jobs','content_items','campaigns')) AS forced,
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='content_dev' AND c.relname IN ('generation_jobs','content_items','campaigns')) AS tables,
    (SELECT count(DISTINCT c.relname) FROM pg_policy p
     JOIN pg_class c ON c.oid=p.polrelid
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='content_dev'
       AND c.relname IN ('generation_jobs','content_items','campaigns')
       AND (p.polroles @> ARRAY[r.oid]::oid[] OR p.polroles @> ARRAY[0::oid])) AS policy_tables,
    has_table_privilege(current_user,'content_dev.generation_jobs','SELECT') AS job_select,
    has_column_privilege(current_user,'content_dev.generation_jobs','status','UPDATE') AND
    has_column_privilege(current_user,'content_dev.generation_jobs','attempts','UPDATE') AND
    has_column_privilege(current_user,'content_dev.generation_jobs','claimed_at','UPDATE') AND
    has_column_privilege(current_user,'content_dev.generation_jobs','error_code','UPDATE') AND
    has_column_privilege(current_user,'content_dev.generation_jobs','completed_at','UPDATE') AS job_update,
    has_table_privilege(current_user,'content_dev.content_items','SELECT') AS item_select,
    has_column_privilege(current_user,'content_dev.content_items','tenant_id','INSERT') AND
    has_column_privilege(current_user,'content_dev.content_items','campaign_id','INSERT') AND
    has_column_privilege(current_user,'content_dev.content_items','type','INSERT') AND
    has_column_privilege(current_user,'content_dev.content_items','title','INSERT') AND
    has_column_privilege(current_user,'content_dev.content_items','body','INSERT') AS item_insert,
    has_table_privilege(current_user,'content_dev.campaigns','SELECT') AS campaign_select
    FROM pg_roles r WHERE r.rolname=current_user`);
  const gate=roles.rows[0];
  if(roles.rows.length!==1||gate.rolname!=='content_dev_fixture_executor_v1'||
     gate.rolcanlogin!==true||gate.rolsuper!==false||gate.rolbypassrls!==false||
     gate.forced!==true||Number(gate.tables)!==3||Number(gate.policy_tables)!==3||!gate.job_select||!gate.job_update||!gate.item_select||!gate.item_insert||!gate.campaign_select)
    throw new Error('CONTENT DEV restricted RLS acceptance gate unavailable');
  // The caller must provide a previously verified principal. A transaction-local
  // value cannot leak across pooled connections, and membership is checked again
  // under the restricted role's actual tenant-scoped RLS policy.
  await client.query("SELECT set_config('bci.principal_id',$1,true)",[input.principalId]);
  const memberships=await client.query(`SELECT tenant_id FROM bci_dev.tenant_memberships
    WHERE principal_id=$1::uuid AND tenant_id=$2::uuid AND product='content'
      AND active IS TRUE AND revoked_at IS NULL`,[input.principalId,input.tenantId]);
  if(memberships.rows.length!==1||memberships.rows[0].tenant_id!==input.tenantId)
    throw new Error('CONTENT DEV fixture tenant membership unavailable');
  const result=await executeContentDevFixtureInTransaction(client,input);
  // A failed COMMIT has an uncertain outcome; never reuse this session.
  committing=true;
  await client.query('COMMIT');
  committing=false;
  begun=false;
  return result;
 }catch(_error){
  if(committing)discard=true;
  if(begun){try{await client.query('ROLLBACK');}catch{discard=true;}}
  throw new Error('CONTENT DEV fixture transaction failed');
 }finally{client.release(discard?new Error('CONTENT DEV transaction outcome uncertain; discard connection'):undefined);}
}
