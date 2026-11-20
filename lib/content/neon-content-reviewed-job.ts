import {createHash} from 'node:crypto';
import type {createContentCampaignPlanner} from './neon-content-generation-orchestrator.ts';
import {validateCampaignInput} from './neon-content-generation-contract.ts';
import type {ContentVisualSelection} from './neon-content-generation-contract.ts';
import {compileContentPersistenceBundle} from './neon-content-persistence-bundle.ts';
import {verifyContentGeneratedReplay} from './neon-content-replay-integrity.ts';
import {writeContentBundleChildren} from './neon-content-write-bundle-children.ts';
import {eligibleContentJobDraftSql,finishContentJob} from './neon-content-generation-job-lifecycle.ts';
import type {JobRow} from './neon-content-generation-job-lifecycle.ts';
import {createRestrictedContentJobDb,jobQuery,restrictedContentJobTransaction} from './neon-content-generation-job-restricted-db.ts';
import type {JobPool,JobTransactionQuery} from './neon-content-generation-job-restricted-db.ts';
import {processContentDevJob} from './neon-content-generation-job-worker.ts';
import {ContentReadDenied} from './neon-content-workspace-reader.ts';

const briefColumns = `jsonb_build_object('product_service',c.product_service,'audience',c.audience,
 'description',c.description,'problem',c.problem,'objective',c.objective,'duration_days',c.duration_days,'platforms',c.platforms)`;

async function bindPrincipal(query:JobTransactionQuery,job:Readonly<JobRow>) {
 await query("SELECT set_config('bci.principal_id',$1,true), set_config('content.plan_job_id',$2,true)",
  [job.requested_by,job.id]);
}

async function readSelectedDraft(query:JobTransactionQuery,job:Readonly<JobRow>) {
 await bindPrincipal(query,job);
 const {rows} = await query(`SELECT c.workspace_id,w.business_dna,${briefColumns} AS brief
  FROM content_dev.campaigns c JOIN content_dev.workspaces w ON w.id=c.workspace_id AND w.tenant_id=c.tenant_id
  JOIN bci_dev.tenant_memberships m ON m.tenant_id=c.tenant_id AND m.principal_id=c.owner_principal_id
   AND m.product='content' AND m.active AND m.revoked_at IS NULL
  WHERE c.tenant_id=$1 AND c.id=$2 AND c.owner_principal_id=$3 AND w.owner_principal_id=$3 AND ${eligibleContentJobDraftSql}`,
  [job.tenant_id,job.campaign_id,job.requested_by]);
 if (rows.length !== 1) throw new ContentReadDenied();
 const row = rows[0];
 return {workspaceId:row.workspace_id,brief:row.brief,dna:row.business_dna};
}

/** A bounded internal DEV worker for a reviewed seven-layer plan. Nothing calls
 * this module from the deployed route. The caller supplies the planner explicitly.
 * The planner runs after claim, outside DB transactions. A stale answer cannot write.
 */
export function processReviewedContentJob(input: {
 pool:JobPool; tenantId:string; jobId:string; planCampaign:ReturnType<typeof createContentCampaignPlanner>;
 visual?:ContentVisualSelection; recoverExpired?:boolean; leaseSeconds?:number;
}) {
 const {pool,tenantId,jobId,planCampaign,recoverExpired,leaseSeconds} = input;
 const visual = input.visual && Object.freeze({...input.visual});
 if (typeof planCampaign !== 'function') throw new Error('Missing CONTENT planner');
 const scope = {pool,tenantId,purpose:'planWorker' as const};
 const transaction = restrictedContentJobTransaction(scope);
 return processContentDevJob({
  db:createRestrictedContentJobDb(scope),tenantId,jobId,recoverExpired,leaseSeconds,
  persistAndFinish:async job => {
   const snapshot = await transaction(query => readSelectedDraft(query,job));
   const brief = validateCampaignInput(snapshot.brief);
   // Retain the DB snapshot for comparison even if the injected planner mutates inputs.
   const briefJson = JSON.stringify(snapshot.brief);
   const dnaJson = JSON.stringify(snapshot.dna);
   const {plan,review} = await planCampaign(structuredClone(brief),structuredClone(snapshot.dna),visual);
   const bundle = compileContentPersistenceBundle(brief,structuredClone(plan),structuredClone(review));
   // A complete job must have usable output at every layer. The compiler also
   // supports preview-only plans without a full set of deliverables.
   if (![plan.angles,plan.scripts,plan.scenes,plan.visuals,plan.captions,plan.publish_plan].every(layer => layer.length))
    throw new Error('Incomplete CONTENT job output');
   const provenance = {source:'injected_content_planner',job_id:job.id,attempt:job.attempts,
    content_fingerprint:bundle.fingerprint,quality_score:review.score,
    review_sha256:createHash('sha256').update(JSON.stringify(review)).digest('hex'),
    ...(visual ? {visual_preset:visual.presetId,aspect_ratio:visual.aspectRatio} : {})};
   const output = {...bundle,items:bundle.items.map(item => ({...item,body:{...item.body,provenance}}))};
   return transaction(async query => {
    await bindPrincipal(query,job);
    const completed = await finishContentJob(jobQuery(query),{tenantId,jobId,attempt:job.attempts,outcome:'completed'});
    if (!completed) return null;
    const {campaign_id:campaignId,requested_by:principalId} = completed;
    const campaign = output.campaign;
    // Updating the selected row serializes competing jobs on the same empty
    // draft. The WHERE clause rechecks its brief and workspace DNA after review.
    const updated = await query(`UPDATE content_dev.campaigns c
     SET strategy=$5::jsonb,angles=$6::jsonb,captions=$7::jsonb,publish_plan=$8::jsonb
     FROM content_dev.workspaces w WHERE c.tenant_id=$1 AND c.id=$2 AND c.owner_principal_id=$3
      AND c.workspace_id=$4 AND w.id=c.workspace_id AND w.tenant_id=c.tenant_id AND w.owner_principal_id=$3
      AND ${briefColumns}=$9::jsonb AND w.business_dna=$10::jsonb AND ${eligibleContentJobDraftSql}
     RETURNING c.product_service,c.description,c.audience,c.problem,c.objective,c.duration_days,c.platforms,
      c.status,c.strategy,c.angles,c.captions,c.publish_plan`,
     [tenantId,campaignId,principalId,snapshot.workspaceId,JSON.stringify(campaign.strategy),
      JSON.stringify(campaign.angles),JSON.stringify(campaign.captions),JSON.stringify(campaign.publish_plan),briefJson,dnaJson]);
    if (updated.rows.length !== 1) throw new ContentReadDenied();
    await writeContentBundleChildren(query,tenantId,campaignId,output);
    const items = await query(`SELECT id,type,title,body,sort_order,version FROM content_dev.content_items
     WHERE tenant_id=$1 AND campaign_id=$2 LIMIT 501`, [tenantId,campaignId]);
    const scenes = await query(`SELECT s.content_item_id,s.scene_number,s.duration_seconds,s.narration,s.dialogue,
      s.visual_prompt,s.motion_prompt,s.continuity_lock FROM content_dev.scenes s
      JOIN content_dev.content_items i ON i.tenant_id=s.tenant_id AND i.id=s.content_item_id
      WHERE i.tenant_id=$1 AND i.campaign_id=$2 LIMIT 301`, [tenantId,campaignId]);
    verifyContentGeneratedReplay(output,updated.rows[0],items.rows,scenes.rows);
    return completed;
   });
  },
 });
}
