/** CONTENT DEV bounded worker orchestration.
 * No scheduler, provider, credentials, grants, or production route is installed.
 * The caller supplies a separately authorized tenant-scoped worker connection.
 * Completion means the injected task succeeded, NOT that media was generated.
 */
import {claimContentJob, finishContentJob, reclaimExpiredContentJob} from './neon-content-generation-job-lifecycle.ts';
import type {JobQuery,JobRow} from './neon-content-generation-job-lifecycle.ts';

type Work = (job:Readonly<JobRow>)=>Promise<void>;
type Result = {state:'unavailable'|'completed'|'failed'|'lost_lease';job:JobRow|null};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function valid(value:string){if(typeof value!=='string'||!UUID.test(value))throw new Error('Invalid job scope');}
function assertScoped(job:JobRow,tenantId:string,jobId:string){
 if(job.tenant_id!==tenantId||job.id!==jobId)throw new Error('Worker scope mismatch');
}
export async function processContentDevJob(input:{
 db:JobQuery;tenantId:string;jobId:string;work:Work;
 recoverExpired?:boolean;maxAttempts?:number;leaseSeconds?:number;
}):Promise<Result>{
 const {db,tenantId,jobId,work}=input;
 valid(tenantId);valid(jobId);
 if(!db||typeof db.query!=='function'||typeof work!=='function')throw new Error('Missing worker dependencies');
 const job=input.recoverExpired
  ?await reclaimExpiredContentJob(db,{tenantId,jobId,maxAttempts:input.maxAttempts,leaseSeconds:input.leaseSeconds})
  :await claimContentJob(db,{tenantId,jobId,maxAttempts:input.maxAttempts});
 if(!job)return {state:'unavailable',job:null};
 assertScoped(job,tenantId,jobId);
 if(job.status!=='running')return {state:'unavailable',job};
 if(!Number.isInteger(job.attempts)||job.attempts<1)throw new Error('Invalid claimed attempt');
 let outcome:'completed'|'failed'='completed';
 try{await work(Object.freeze({...job}));}
 catch{outcome='failed';}
 const final=await finishContentJob(db,{tenantId,jobId,attempt:job.attempts,outcome,
  ...(outcome==='failed'?{errorCode:'WORKER_FAILED'}:{})});
 if(!final)return {state:'lost_lease',job:null};
 assertScoped(final,tenantId,jobId);
 if(final.status!==outcome)throw new Error('Worker completion mismatch');
 return {state:outcome,job:final};
}
