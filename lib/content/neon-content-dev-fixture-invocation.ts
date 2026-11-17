/** Explicit DEV-only composition of the restricted job lifecycle and durable fixture draft.
 * No route, scheduler, provider call, payment, or automatic invocation.
 * The caller must be independently authenticated and authorized for this tenant/job.
 * Both worker and output transaction enforce their own database role/RLS posture.
 */
import 'server-only';
import {invokeContentDevWorker} from './neon-content-generation-job-invocation.ts';
import {createDeterministicContentDevTask} from './neon-content-dev-deterministic-task.ts';
import {withRestrictedContentDevOutputTransaction} from './neon-content-dev-output-transaction.ts';

export type ContentDevFixtureInvocation = Readonly<{
  tenantId:string;
  principalId:string;
  jobId:string;
  recoverExpired?:boolean;
  maxAttempts?:number;
  leaseSeconds?:number;
}>;

/** Executes only an existing submitted job. Never submits or publishes a job.
 * A successful result still requires independently observed connected-DEV readback.
 */
export async function invokePersistedContentDevFixture(input:ContentDevFixtureInvocation){
  if(!input || typeof input!=='object') throw new Error('CONTENT DEV fixture unavailable');
  return invokeContentDevWorker({
    tenantId:input.tenantId,
    principalId:input.principalId,
    jobId:input.jobId,
    recoverExpired:input.recoverExpired,
    maxAttempts:input.maxAttempts,
    leaseSeconds:input.leaseSeconds,
    task:createDeterministicContentDevTask(withRestrictedContentDevOutputTransaction),
  });
}
