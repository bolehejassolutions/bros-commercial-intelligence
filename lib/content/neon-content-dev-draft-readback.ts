/** DEV-only deterministic draft persistence. Caller owns a tenant-scoped, RLS-enforced
 * transaction and must roll back on failure. Does not call providers or charge credits.
 * This module is intentionally not wired to an HTTP endpoint or live worker.
 */
import 'server-only';
import type {JobRow} from './neon-content-generation-job-lifecycle.ts';

type Db={query:(sql:string,params?:readonly unknown[])=>Promise<{rows:Record<string,unknown>[]}>};
type Draft={type:string;title:string;body:Record<string,unknown>};
export type DraftReadback={jobId:string;campaignId:string;itemId:string;verifiedReadback:true;source:'deterministic_dev_fixture'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reject=():never=>{throw new Error('CONTENT DEV draft readback unavailable');};

/** The caller must BEGIN and set its authenticated RLS principal before invocation.
 * Commit only after this function returns. An existing item must match the
 * requested draft exactly; a conflicting retry fails rather than silently succeeding.
 */
export async function persistDeterministicContentDraft(db:Db,job:Readonly<JobRow>,draft:Draft):Promise<DraftReadback>{
 if(!db||typeof db.query!=='function'||!job||
   ![job.id,job.tenant_id,job.campaign_id,job.requested_by].every(v=>typeof v==='string'&&UUID.test(v))||
   !draft||typeof draft.type!=='string'||!draft.type.trim()||draft.type.length>64||
   typeof draft.title!=='string'||!draft.title.trim()||draft.title.length>200||
   !draft.body||typeof draft.body!=='object'||Array.isArray(draft.body))reject();
 const body={...draft.body,provenance:{source:'deterministic_dev_fixture',job_id:job.id}};
 const serialized=JSON.stringify(body);
 if(serialized.length>20000)reject();
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[job.id]);
 const campaign=await db.query(`SELECT id FROM content_dev.campaigns
  WHERE id=$1::uuid AND tenant_id=$2::uuid AND owner_principal_id=$3::uuid`,
  [job.campaign_id,job.tenant_id,job.requested_by]);
 if(campaign.rows.length!==1)reject();
 const lookup=`SELECT id,type,title,body FROM content_dev.content_items
  WHERE tenant_id=$1::uuid AND campaign_id=$2::uuid
  AND body->'provenance'->>'job_id'=$3 LIMIT 2`;
 const params=[job.tenant_id,job.campaign_id,job.id];
 let found=await db.query(lookup,params);
 if(found.rows.length>1)reject();
 if(found.rows.length===0){
  const inserted=await db.query(`INSERT INTO content_dev.content_items
   (tenant_id,campaign_id,type,title,body) VALUES ($1::uuid,$2::uuid,$3,$4,$5::jsonb)
   RETURNING id`,[job.tenant_id,job.campaign_id,draft.type,draft.title,serialized]);
  if(inserted.rows.length!==1)reject();
  found=await db.query(lookup,params);
 }
 if(found.rows.length!==1||found.rows[0].type!==draft.type||found.rows[0].title!==draft.title||
    typeof found.rows[0].id!=='string'||!UUID.test(found.rows[0].id))reject();
 const actual=typeof found.rows[0].body==='string'?JSON.parse(found.rows[0].body):found.rows[0].body;
 if(!actual||typeof actual!=='object'||JSON.stringify(actual)!==JSON.stringify(body)){
  // PostgreSQL jsonb normalizes object key order; compare canonicalized structures.
  const normalize=(v:unknown):string=>JSON.stringify(v,(_k,value)=>
   value&&typeof value==='object'&&!Array.isArray(value)
    ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
  if(normalize(actual)!==normalize(body))reject();
 }
 return {jobId:job.id,campaignId:job.campaign_id,itemId:found.rows[0].id,verifiedReadback:true,source:'deterministic_dev_fixture'};
}
