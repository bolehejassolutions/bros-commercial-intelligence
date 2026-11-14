/**
 * CONTENT DEV generation-job persistence contract. This is deliberately NOT
 * exposed by an HTTP route and does not invoke AI, credits or publishing.
 * The caller must supply an explicitly authorized, tenant-restricted DB client.
 * SQL statements are parameterized and fail closed when RLS denies access.
 */
export type JobStatus = 'queued'|'running'|'completed'|'failed';
export type JobRow = {id:string;tenant_id:string;campaign_id:string;requested_by:string;idempotency_key:string;status:JobStatus;attempts:number;error_code:string|null};
export type JobQuery = {query:(sql:string,params?:readonly unknown[])=>Promise<{rows:JobRow[];rowCount?:number|null}>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function id(value:string){if(!uuid.test(value))throw new Error('Invalid job identity');return value;}
function key(value:string){if(typeof value!=='string'||value.length<12||value.length>128||!/^[A-Za-z0-9_-]+$/.test(value))throw new Error('Invalid idempotency key');return value;}
function single(rows:JobRow[]){if(rows.length>1)throw new Error('Ambiguous job identity');return rows[0]??null;}
export async function enqueueContentJob(db:JobQuery,input:{tenantId:string;campaignId:string;principalId:string;idempotencyKey:string}){
 const {tenantId,campaignId,principalId}=input;
 // No implicit upsert: an existing key for a different campaign is a conflict.
 const result=await db.query(`INSERT INTO content_dev.generation_jobs
 (tenant_id,campaign_id,requested_by,idempotency_key,status,attempts)
 SELECT $1,$2,$3,$4,'queued',0
 WHERE EXISTS (SELECT 1 FROM content_dev.campaigns c
 WHERE c.id=$2 AND c.tenant_id=$1 AND c.owner_principal_id=$3)
 ON CONFLICT (tenant_id,requested_by,idempotency_key) DO NOTHING
 RETURNING id,tenant_id,campaign_id,requested_by,idempotency_key,status,attempts,error_code`,
 [id(tenantId),id(campaignId),id(principalId),key(input.idempotencyKey)]);
 if(result.rows.length)return single(result.rows);
 const replay=await db.query(`SELECT id,tenant_id,campaign_id,requested_by,idempotency_key,status,attempts,error_code
 FROM content_dev.generation_jobs WHERE tenant_id=$1 AND requested_by=$2 AND idempotency_key=$3`,[tenantId,principalId,input.idempotencyKey]);
 const row=single(replay.rows);
 if(!row||row.campaign_id!==campaignId||row.requested_by!==principalId)throw new Error('Job not authorized or idempotency conflict');
 return row;
}
export async function claimContentJob(db:JobQuery,input:{tenantId:string;jobId:string;maxAttempts?:number}){
 const max=input.maxAttempts??3;
 if(!Number.isInteger(max)||max<1||max>10)throw new Error('Invalid retry limit');
 const result=await db.query(`UPDATE content_dev.generation_jobs
 SET status='running', attempts=attempts+1,claimed_at=now(),error_code=NULL
 WHERE id=$1 AND tenant_id=$2 AND status IN ('queued','failed') AND attempts<$3
 RETURNING id,tenant_id,campaign_id,requested_by,idempotency_key,status,attempts,error_code`,
 [id(input.jobId),id(input.tenantId),max]);
 return single(result.rows);
}
/**
 * Recover a worker that disappeared after claiming a job. The database clock
 * determines expiry; no provider is invoked here. Attempt fencing ensures a
 * late result from the abandoned worker cannot overwrite the recovered job.
 * Only the explicitly authorized worker's tenant-scoped DB client may call it.
 */
export async function reclaimExpiredContentJob(db:JobQuery,input:{tenantId:string;jobId:string;maxAttempts?:number;leaseSeconds?:number}){
 const max=input.maxAttempts??3;
 const lease=input.leaseSeconds??300;
 if(!Number.isInteger(max)||max<1||max>10)throw new Error('Invalid retry limit');
 if(!Number.isInteger(lease)||lease<30||lease>86400)throw new Error('Invalid lease duration');
 const result=await db.query(`UPDATE content_dev.generation_jobs
 SET status=CASE WHEN attempts >= $3 THEN 'failed' ELSE 'running' END,
 attempts=CASE WHEN attempts >= $3 THEN attempts ELSE attempts+1 END,
 claimed_at=CASE WHEN attempts >= $3 THEN NULL ELSE now() END,
 error_code=CASE WHEN attempts >= $3 THEN 'RETRY_EXHAUSTED' ELSE NULL END
 WHERE id=$1 AND tenant_id=$2 AND status='running'
 AND claimed_at IS NOT NULL
 AND claimed_at < now() - ($4::integer * interval '1 second')
 RETURNING id,tenant_id,campaign_id,requested_by,idempotency_key,status,attempts,error_code`,
 [id(input.jobId),id(input.tenantId),max,lease]);
 return single(result.rows);
}
export async function finishContentJob(db:JobQuery,input:{tenantId:string;jobId:string;attempt:number;outcome:'completed'|'failed';errorCode?:string}){
 if(!Number.isInteger(input.attempt)||input.attempt<1)throw new Error('Invalid attempt');
 if(input.outcome==='failed'&&(!input.errorCode||!/^[A-Z][A-Z0-9_]{1,63}$/.test(input.errorCode)))throw new Error('Safe error code required');
 const result=await db.query(`UPDATE content_dev.generation_jobs
 SET status=$4,error_code=$5,completed_at=CASE WHEN $4='completed' THEN now() ELSE NULL END
 WHERE id=$1 AND tenant_id=$2 AND status='running' AND attempts=$3
 RETURNING id,tenant_id,campaign_id,requested_by,idempotency_key,status,attempts,error_code`,
 [id(input.jobId),id(input.tenantId),input.attempt,input.outcome,input.outcome==='failed'?input.errorCode:null]);
 return single(result.rows);
}

/** Readback is limited to a single principal and campaign. A restricted DB
 * connection and existing RLS remain mandatory; this does not grant access. */
export async function listContentCampaignJobs(db:JobQuery,input:{tenantId:string;campaignId:string;principalId:string;limit?:number}){
 const limit=input.limit??25;
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Invalid job history limit');
 const result=await db.query(`SELECT j.id,j.tenant_id,j.campaign_id,j.requested_by,j.idempotency_key,
 j.status,j.attempts,j.error_code
 FROM content_dev.generation_jobs j
 WHERE j.tenant_id=$1 AND j.campaign_id=$2 AND j.requested_by=$3
 AND EXISTS (SELECT 1 FROM content_dev.campaigns c
 WHERE c.id=j.campaign_id AND c.tenant_id=j.tenant_id AND c.owner_principal_id=$3)
 ORDER BY j.id DESC LIMIT $4`,
 [id(input.tenantId),id(input.campaignId),id(input.principalId),limit]);
 return result.rows;
}
