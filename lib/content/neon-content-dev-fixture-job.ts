/** Bounded DEV fixture worker. Each call processes one pre-existing job through
 * the supplied restricted login. All output is labelled, non-publishable test data. */
import {finishContentJob} from './neon-content-generation-job-lifecycle.ts';
import {createRestrictedContentJobDb, jobQuery, restrictedContentJobTransaction} from './neon-content-generation-job-restricted-db.ts';
import type {JobPool} from './neon-content-generation-job-restricted-db.ts';
import {processContentDevJob} from './neon-content-generation-job-worker.ts';

export function processContentFixtureJob(input: {
 pool:JobPool; tenantId:string; jobId:string; recoverExpired?:boolean; leaseSeconds?:number;
}) {
 const {pool,tenantId,jobId,recoverExpired,leaseSeconds} = input;
 const scope = {pool,tenantId,purpose:'worker' as const};
 const transaction = restrictedContentJobTransaction(scope);
 return processContentDevJob({
  db:createRestrictedContentJobDb(scope), tenantId,jobId,recoverExpired,leaseSeconds,
  persistAndFinish:job => transaction(async query => {
   // The conditional UPDATE locks this exact attempt until the output commits.
   // A stale claim returns before writing. Any write/readback failure rolls both changes back.
   const completed = await finishContentJob(jobQuery(query), {
    tenantId,jobId,attempt:job.attempts,outcome:'completed',
   });
   if (!completed) return null;
   await query("SELECT set_config('bci.principal_id',$1,true)", [completed.requested_by]);
   const title = 'DEV verification draft';
   const body = JSON.stringify({
    text:'Deterministic test record only; not AI-generated or publishable.',
    publishable:false, provenance:{source:'deterministic_dev_fixture', job_id:jobId},
   });
   const inserted = await query(`INSERT INTO content_dev.content_items (tenant_id,campaign_id,type,title,body)
     VALUES ($1,$2,'other',$3,$4::jsonb) RETURNING id`, [tenantId,completed.campaign_id,title,body]);
   if (inserted.rows.length !== 1) throw new Error('Missing CONTENT output receipt');
   const stored = await query(`SELECT id FROM content_dev.content_items
     WHERE id=$1 AND campaign_id=$2 AND tenant_id=$3 AND type='other' AND title=$4 AND body=$5::jsonb`,
    [inserted.rows[0].id,completed.campaign_id,tenantId,title,body]);
   if (stored.rows.length !== 1) throw new Error('CONTENT output readback failed');
   return completed;
  }),
 });
}
