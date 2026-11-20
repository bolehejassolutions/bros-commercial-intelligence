import {ContentReadDenied} from './neon-content-workspace-reader.ts';
import {enqueueContentJob} from './neon-content-generation-job-lifecycle.ts';
import {jobQuery, restrictedContentJobTransaction} from './neon-content-generation-job-restricted-db.ts';
import type {JobPool, JobPrincipal} from './neon-content-generation-job-restricted-db.ts';

export type JobSubmission = Readonly<{workspaceId:string; campaignId:string; idempotencyKey:string}>;

/** Resolve scope and enqueue or replay on the same principal-bound connection. */
export function createPooledContentJobSubmitter(pool: JobPool) {
 return async (principal: JobPrincipal, input: JobSubmission) =>
  restrictedContentJobTransaction({pool, purpose:'submit', principal})(async query => {
   const {rows} = await query(`SELECT w.tenant_id FROM content_dev.workspaces w
    JOIN content_dev.campaigns c ON c.workspace_id=w.id AND c.tenant_id=w.tenant_id
    JOIN bci_dev.tenant_memberships m ON m.tenant_id=w.tenant_id
     AND m.principal_id=$1 AND m.product='content' AND m.active AND m.revoked_at IS NULL
    WHERE w.id=$2 AND c.id=$3 AND w.owner_principal_id=$1 AND c.owner_principal_id=$1`,
    [principal.userId, input.workspaceId, input.campaignId]);
   if (rows.length !== 1 || typeof rows[0].tenant_id !== 'string') throw new ContentReadDenied();
   const tenantId = rows[0].tenant_id;
   await query("SELECT set_config('content.tenant_id',$1,true)", [tenantId]);
   const job = await enqueueContentJob(jobQuery(query), {tenantId, campaignId:input.campaignId,
    principalId:principal.userId, idempotencyKey:input.idempotencyKey});
   if (!job || job.tenant_id !== tenantId || job.requested_by !== principal.userId ||
       job.campaign_id !== input.campaignId) throw new Error('CONTENT job receipt unavailable');
   return {id:job.id, campaignId:job.campaign_id, status:job.status, attempts:job.attempts};
  });
}
