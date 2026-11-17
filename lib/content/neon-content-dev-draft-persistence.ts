/** CONTENT DEV persisted output boundary. Caller supplies an already-authorized,
 * tenant-scoped transaction with RLS principal set. No credentials or grants here.
 * This is a deterministic, no-provider task, NOT an AI generation implementation.
 * A transaction-level advisory lock serializes retries for the same job.
 */
import 'server-only';
import type {JobRow} from './neon-content-generation-job-lifecycle.ts';
import type {ContentDevTaskReceipt} from './neon-content-generation-job-invocation.ts';

type Result={rows:Record<string,unknown>[];rowCount?:number|null};
export type ContentOutputDb={query:(sql:string,params?:readonly unknown[])=>Promise<Result>};
type Draft={type:string;title:string;body:Record<string,unknown>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safe=(v:string,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const fail=():never=>{throw new Error('CONTENT DEV output not verified');};

/** The caller must BEGIN before invocation and COMMIT only after verification.
 * Roll back on any error. Never use this with an unrestricted database role.
 * The persisted JSON provenance prevents fixture content being represented as AI.
 */
export async function persistAndReadbackContentDevDraft(
 db:ContentOutputDb,job:Readonly<JobRow>,draft:Draft
):Promise<ContentDevTaskReceipt>{
 if(!job||![job.id,job.tenant_id,job.campaign_id,job.requested_by].every(x=>uuid.test(x))||
    !draft||!safe(draft.type,64)||!safe(draft.title,200)||
    !draft.body||Array.isArray(draft.body)||typeof draft.body!=='object')fail();
 const body=JSON.stringify({...draft.body,provenance:{source:'deterministic_dev_fixture',job_id:job.id}});
 if(body.length>20000)fail();
 // Must be called inside the same transaction as the write.
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[job.id]);
 const campaign=await db.query(`SELECT id FROM content_dev.campaigns
  WHERE id=$1::uuid AND tenant_id=$2::uuid AND owner_principal_id=$3::uuid`,
  [job.campaign_id,job.tenant_id,job.requested_by]);
 if(campaign.rows.length!==1)fail();
 const existing=await db.query(`SELECT id,body FROM content_dev.content_items
  WHERE tenant_id=$1::uuid AND campaign_id=$2::uuid
  AND body->'provenance'->>'job_id'=$3 LIMIT 2`,
  [job.tenant_id,job.campaign_id,job.id]);
 if(existing.rows.length>1)fail();
 if(existing.rows.length===0){
  const inserted=await db.query(`INSERT INTO content_dev.content_items
   (tenant_id,campaign_id,type,title,body)
   VALUES ($1::uuid,$2::uuid,$3,$4,$5::jsonb) RETURNING id`,
   [job.tenant_id,job.campaign_id,draft.type,draft.title,body]);
  if(inserted.rows.length!==1)fail();
 }
 const read=await db.query(`SELECT id,type,title,body FROM content_dev.content_items
  WHERE tenant_id=$1::uuid AND campaign_id=$2::uuid
  AND body->'provenance'->>'job_id'=$3 LIMIT 2`,
  [job.tenant_id,job.campaign_id,job.id]);
 if(read.rows.length!==1||read.rows[0].type!==draft.type||
    read.rows[0].title!==draft.title)fail();
 const value=read.rows[0].body;
 const decoded=typeof value==='string'?JSON.parse(value):value;
 if(!decoded||typeof decoded!=='object'||
    (decoded as Record<string,any>).provenance?.job_id!==job.id||
    (decoded as Record<string,any>).provenance?.source!=='deterministic_dev_fixture')fail();
 return {jobId:job.id,campaignId:job.campaign_id,persisted:true,verifiedReadback:true};
}
