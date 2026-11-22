/** DEV-only, no-cost fixture execution. Not a hosted worker or provider invocation.
 * Caller MUST provide a BEGIN'd transaction with authenticated tenant-scoped RLS,
 * on a connection authorized for both generation_jobs and content_items.
 * The caller MUST COMMIT only after success, and ROLLBACK on any error.
 * Never expose this function through a public HTTP route.
 */
import 'server-only';
import {claimContentJob, finishContentJob, type JobRow} from './neon-content-generation-job-lifecycle.ts';
import {persistDeterministicContentDraft} from './neon-content-dev-draft-readback.ts';

type Db = {query:(sql:string,params?:readonly unknown[])=>Promise<{rows:any[];rowCount?:number|null}>};
type Fixture = {type:string;title:string;body:Record<string,unknown>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unavailable=():never=>{throw new Error('CONTENT DEV fixture execution unavailable');};

/** One atomic claim -> persisted draft -> verified readback -> completion slice.
 * The caller is responsible for transaction/RLS setup and rollback. No paid AI,
 * credits, publishing or media generation occurs. A failed step must not commit.
 */
export async function executeContentDevFixtureInTransaction(
 db:Db, input:{tenantId:string;jobId:string;fixture:Fixture;maxAttempts?:number}
):Promise<{jobId:string;itemId:string;attempt:number;source:'deterministic_dev_fixture'}>{
 if(!db||typeof db.query!=='function'||!uuid.test(input?.tenantId??'')||!uuid.test(input?.jobId??''))unavailable();
 const claimed=await claimContentJob(db,{tenantId:input.tenantId,jobId:input.jobId,maxAttempts:input.maxAttempts});
 if(!claimed||claimed.status!=='running'||claimed.tenant_id!==input.tenantId||claimed.id!==input.jobId||
    !Number.isInteger(claimed.attempts)||claimed.attempts<1)unavailable();
 // All operations use the SAME transaction, so a failure rolls back the claim,
 // insertion and completion together. The attempt token fences late workers.
 const persisted=await persistDeterministicContentDraft(db,claimed as JobRow,input.fixture);
 const finished=await finishContentJob(db,{
  tenantId:input.tenantId,jobId:input.jobId,attempt:claimed.attempts,outcome:'completed'
 });
 if(!finished||finished.status!=='completed'||finished.attempts!==claimed.attempts||
    finished.id!==claimed.id)unavailable();
 return {jobId:claimed.id,itemId:persisted.itemId,attempt:claimed.attempts,source:'deterministic_dev_fixture'};
}
