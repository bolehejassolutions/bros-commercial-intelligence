/** Atomic, tenant-scoped CONTENT DEV job submission. No HTTP route, provider,
 * scheduler, payment operation, permission grant or production activation.
 * The dedicated restricted writer owns BEGIN/COMMIT/ROLLBACK and verifies the
 * caller's workspace, campaign and CONTENT tenant membership before any SQL.
 */
import 'server-only';
import {withRestrictedContentJobWriter} from './neon-content-generation-job-restricted-writer.ts';
import {enqueueContentJob} from './neon-content-generation-job-lifecycle.ts';

type Principal=Readonly<{userId:string;authenticated:true}>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY=/^[A-Za-z0-9_-]{12,128}$/;

export async function submitRestrictedContentJob(
 principal:Principal,
 input:Readonly<{workspaceId:string;campaignId:string;idempotencyKey:string}>
){
 if(!input||!UUID.test(input.workspaceId)||!UUID.test(input.campaignId)||
    !KEY.test(input.idempotencyKey))throw new Error('Invalid CONTENT job submission');
 return withRestrictedContentJobWriter(principal,input.workspaceId,input.campaignId,
  async(db,tenantId)=>{
   const job=await enqueueContentJob(db,{
    tenantId,campaignId:input.campaignId,principalId:principal.userId,
    idempotencyKey:input.idempotencyKey
   });
   if(!job||job.tenant_id!==tenantId||job.campaign_id!==input.campaignId||
      job.requested_by!==principal.userId)
    throw new Error('CONTENT job scope mismatch');
   return Object.freeze({id:job.id,campaignId:job.campaign_id,
    status:job.status,attempts:job.attempts});
  });
}
