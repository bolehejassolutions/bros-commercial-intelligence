/** Explicit, bounded CONTENT DEV worker invocation. No HTTP endpoint or scheduler.
 * An authorized caller must inject a real task that persists its output and
 * independently verifies readback. An absent task must never complete a job.
 * This module never creates roles, grants, credits, or provider credentials.
 */
import 'server-only';
import {executeRestrictedContentDevJob} from './neon-content-generation-job-worker-connection.ts';
import type {JobRow} from './neon-content-generation-job-lifecycle.ts';

export type ContentDevTaskReceipt=Readonly<{
  jobId:string;
  campaignId:string;
  persisted:true;
  verifiedReadback:true;
}>;
export type ContentDevTask=(job:Readonly<JobRow>)=>Promise<ContentDevTaskReceipt>;

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unavailable=():never=>{throw new Error('CONTENT DEV task unavailable');};

/** One invocation handles one explicit job; no automatic polling or retries.
 * The receipt is a task-level assertion, not independent acceptance evidence.
 * The task implementation must verify actual PostgreSQL readback itself.
 */
export async function invokeContentDevWorker(input:{
  tenantId:string;
  principalId:string;
  jobId:string;
  task:ContentDevTask;
  recoverExpired?:boolean;
  maxAttempts?:number;
  leaseSeconds?:number;
}){
  if(process.env.VERCEL_ENV!=='preview'||
     process.env.CONTENT_DEV_JOB_WORKER_ENABLED!=='true'||
     process.env.CONTENT_DEV_TASK_EXECUTION_ENABLED!=='true')unavailable();
  if(!input||![input.tenantId,input.principalId,input.jobId].every(
    x=>typeof x==='string'&&UUID.test(x))||typeof input.task!=='function')unavailable();
  return executeRestrictedContentDevJob({
    tenantId:input.tenantId,principalId:input.principalId,jobId:input.jobId,
    recoverExpired:input.recoverExpired,maxAttempts:input.maxAttempts,
    leaseSeconds:input.leaseSeconds,
    work:async job=>{
      if(job.id!==input.jobId||job.tenant_id!==input.tenantId||
         job.requested_by!==input.principalId)unavailable();
      const receipt=await input.task(job);
      if(!receipt||receipt.jobId!==job.id||
         receipt.campaignId!==job.campaign_id||
         receipt.persisted!==true||receipt.verifiedReadback!==true)unavailable();
    }
  });
}
