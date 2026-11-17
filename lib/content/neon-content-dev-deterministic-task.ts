/** DEV-only deterministic draft task adapter. No provider, payment, or scheduler.
 * The transaction runner must supply a restricted, tenant-scoped PostgreSQL
 * client with bci.principal_id set locally and RLS enforced. It must COMMIT
 * only after the persistence function has completed its independent readback.
 * Do not expose this adapter through an unauthenticated HTTP endpoint.
 */
import 'server-only';
import type {JobRow} from './neon-content-generation-job-lifecycle.ts';
import type {ContentDevTask,ContentDevTaskReceipt} from './neon-content-generation-job-invocation.ts';
import {persistAndReadbackContentDevDraft} from './neon-content-dev-draft-persistence.ts';
import type {ContentOutputDb} from './neon-content-dev-draft-persistence.ts';

type TransactionRunner=<T>(job:Readonly<JobRow>,run:(db:ContentOutputDb)=>Promise<T>)=>Promise<T>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Explicit fixture, not AI content. No synthetic success without a DB write.
 * The injected runner is responsible for BEGIN/COMMIT/ROLLBACK and restricted
 * connection posture. This factory cannot itself activate Neon permissions.
 */
export function createDeterministicContentDevTask(transaction:TransactionRunner):ContentDevTask {
 if(typeof transaction!=='function')throw new Error('CONTENT DEV transaction unavailable');
 return async(job):Promise<ContentDevTaskReceipt>=>{
  if(process.env.VERCEL_ENV!=='preview'||
     process.env.CONTENT_DEV_TASK_EXECUTION_ENABLED!=='true'||
     !job||![job.id,job.tenant_id,job.campaign_id,job.requested_by].every(
      value=>typeof value==='string'&&UUID.test(value)))
   throw new Error('CONTENT DEV fixture disabled');
  return transaction(job,async db=>{
   const draft={
    type:'dev_fixture',
    title:'DEV verification draft',
    body:{text:'Deterministic test record only; not AI-generated or publishable.',
          provenance_label:'fixture_only',publishable:false}
   };
   return persistAndReadbackContentDevDraft(db,job,draft);
  });
 };
}
