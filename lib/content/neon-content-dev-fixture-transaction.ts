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
type Input=Parameters<typeof executeContentDevFixtureInTransaction>[1];

export async function executeContentDevFixtureAtomically(pool:Pool,input:Input){
 if(!pool||typeof pool.connect!=='function')throw new Error('Restricted CONTENT DEV pool required');
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
  const roles=await client.query(`SELECT r.rolname,r.rolsuper,r.rolbypassrls,
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
    has_table_privilege(current_user,'content_dev.generation_jobs','UPDATE') AS job_update,
    has_table_privilege(current_user,'content_dev.content_items','SELECT') AS item_select,
    has_table_privilege(current_user,'content_dev.content_items','INSERT') AS item_insert,
    has_table_privilege(current_user,'content_dev.campaigns','SELECT') AS campaign_select
    FROM pg_roles r WHERE r.rolname=current_user`);
  const gate=roles.rows[0];
  if(roles.rows.length!==1||gate.rolname!=='content_dev_job_plan_worker_v1'||gate.rolsuper!==false||gate.rolbypassrls!==false||
     gate.forced!==true||Number(gate.tables)!==3||Number(gate.policy_tables)!==3||!gate.job_select||!gate.job_update||!gate.item_select||!gate.item_insert||!gate.campaign_select)
    throw new Error('CONTENT DEV restricted RLS acceptance gate unavailable');
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
