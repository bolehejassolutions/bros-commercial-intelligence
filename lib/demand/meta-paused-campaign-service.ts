import {inspectMetaConnection} from '../marketing-operator/meta-connection.ts';
import {pilotMetaConfiguration} from './meta-pilot-environment.ts';
import {createPausedCampaignProvider} from './meta-paused-campaign-provider.ts';
import {preparePausedCampaignPlan,restorePausedCampaignPlan,type PausedCampaignPlan} from './meta-paused-campaign-plan.ts';
import type {PilotScope} from './meta-pilot-ledger.ts';
import {createPilotLedger} from './meta-pilot-ledger.ts';
import {creativeRetryNamespace,sealCreativeRecovery,verifyCreativeRecovery} from './meta-paused-recovery-receipt.ts';
import type {createDemandCreativeAdmission} from './creative-admission.ts';
import {bindDemandCreativeForReview} from './creative-plan-binding.ts';
const steps=['campaign','adset','creative_a','ad_a'] as const;
type CreativeIntake=Awaited<ReturnType<ReturnType<typeof createDemandCreativeAdmission>>>;
type VerifiedCreativePlan=Readonly<{intake:CreativeIntake;reviewDigest:string;
  planSha256:string;accountId:string;imageHash:string}>;
type Deps={environment:NodeJS.ProcessEnv;ledger:(scope:PilotScope,sha:string)=>ReturnType<typeof createPilotLedger>;
  reauthorize:()=>Promise<void>;now:()=>number;transport?:typeof fetch;verifyLedger?:(scope:PilotScope)=>Promise<unknown>;
  /** Trusted server adapter: perform fresh immutable CONTENT admission and verify authoritative
   * evidence binding the approved copy and original media to this exact plan and Meta account image.
   * An image-library hash, caller assertion, or unsigned review digest alone is insufficient.
   */
  verifyCreativeForPlan?:(scope:PilotScope,plan:PausedCampaignPlan)=>Promise<VerifiedCreativePlan|null>};
export function createPausedCampaignService(deps:Deps){
  const config=pilotMetaConfiguration(deps.environment),env=config.environment;
  const cap=()=>{const x=Number(env.BROS_DEMAND_META_CREATOR_BUDGET_CAP_MINOR??14000);
    if(!Number.isSafeInteger(x)||x<1||x>14000)throw Error('CREATOR_CAP_INVALID');return x;};
  const flags=()=>({enabled:env.BROS_DEMAND_META_PAUSED_CREATE==='operator-approved-v1',
    ledger:env.BROS_DEMAND_META_CREATOR_LEDGER==='reviewed-v1'});
  // The operator's submitted digest confirms the reviewed inputs. New provider
  // POSTs also require that exact tenant-bound digest in server configuration.
  const ownerApproved = (planSha256: string) =>
    env.BROS_DEMAND_META_PAUSED_APPROVED_PLAN_SHA256 === planSha256;
  const creativeBlocker='PAUSED_CREATIVE_EVIDENCE_REQUIRED';
  async function creativeApproved(scope:PilotScope,plan:PausedCampaignPlan){
    try{
      const proof=await deps.verifyCreativeForPlan?.(scope,plan);
      return !!proof&&proof.planSha256===plan.planSha256&&proof.accountId===plan.accountId&&
        proof.imageHash===plan.imageHash&&proof.reviewDigest===bindDemandCreativeForReview(proof.intake,{
          tenantId:scope.tenantId,accountId:plan.accountId,campaignPlanDigest:plan.planSha256,
        }).digest;
    }catch{return false;}
  }
  async function requireCreativeApproval(scope:PilotScope,plan:PausedCampaignPlan){
    if(!await creativeApproved(scope,plan))throw Error(creativeBlocker);
  }
  async function planFor(scope:PilotScope,draft:unknown){
    const at=deps.now();
    try{return preparePausedCampaignPlan(scope,draft,cap(),at);}catch{
      const plan=restorePausedCampaignPlan(scope,draft,cap(),at);
      if(!flags().ledger)throw Error('STARTED_PLAN_PARENTS_UNVERIFIED');
      await deps.reauthorize();
      const state=await deps.ledger(scope,plan.planSha256).recoveryState();
      if(!state.confirmed.campaign?.id||!state.confirmed.adset?.id||
         state.pending.some(k=>!['creative_a','ad_a'].includes(k)))throw Error('STARTED_PLAN_PARENTS_UNVERIFIED');
      return plan;
    }
  }
  async function provider(){
    if(config.managementCredentialConflict)throw Error('MANAGEMENT_CREDENTIAL_CONFLICT');
    const status=await inspectMetaConnection('write',env,deps.transport,deps.now());
    if(status.status!=='READY'||!env.META_ADS_MANAGEMENT_TOKEN||!env.META_APP_SECRET)throw Error('META_MANAGEMENT_CONNECTION_NOT_VERIFIED');
    return createPausedCampaignProvider(env.META_ADS_MANAGEMENT_TOKEN,env.META_APP_SECRET,deps.transport);
  }
  return {
    reconcile:async(scope:PilotScope,draft:unknown,expectedHash:string,authorization:string)=>{
      const f=flags();if(!f.enabled||!f.ledger||authorization!=='RECONCILE_PAUSED_ONLY')throw Error('PAUSED_RECOVERY_NOT_AUTHORIZED');
      const plan=await planFor(scope,draft);
      if(plan.planSha256!==expectedHash)throw Error('PLAN_CHANGED_REVIEW_AGAIN');
      await deps.reauthorize();const p=await provider(),identities=await p.inputReadback(plan);
      const ledger=deps.ledger(scope,plan.planSha256),state=await ledger.recoveryState();
      await p.verify(plan,state.confirmed,identities);
      let discovery:Awaited<ReturnType<typeof p.discoverPending>>|undefined;
      if(state.pending.length){
        const step=state.pending[0];
        if(state.pending.length!==1||!['creative_a','ad_a'].includes(step)||
          steps.find(k=>!state.confirmed[k]?.id)!==step)throw Error('PAUSED_RECOVERY_ORDER_INVALID');
        discovery=await p.discoverPending(plan,state.confirmed,step as 'creative_a'|'ad_a');
        if(discovery.status!=='EXACT_MATCH'){
          let validation;
          if(step==='creative_a'&&discovery.status==='NO_MATCH'&&ownerApproved(plan.planSha256)&&
             await creativeApproved(scope,plan)){
            await deps.reauthorize();
            validation=await p.validateCreative(plan,identities);
          }
          const recoveryReceipt=validation?.accepted===true?
            sealCreativeRecovery(scope,plan.planSha256,env.META_APP_SECRET||'',deps.now(),'ABSENT_AND_META_VALIDATION_PASSED'):
            validation?.accepted===false&&validation.code===100&&validation.subcode===1885183?
              sealCreativeRecovery(scope,plan.planSha256,env.META_APP_SECRET||'',deps.now()):undefined;
          return {source:'BROS_DEMAND_PAUSED_CREATOR',status:'RECOVERY_HELD',
            planSha256:plan.planSha256,discovery:{...discovery,...(validation?{validation}:{})},recoveryReceipt,
            canContinue:false,activationAvailable:false,spendAuthorized:false};
        }
        const objectId=discovery.candidates[0].objectId;
        if(step==='creative_a'){
          const retry=deps.ledger(scope,creativeRetryNamespace(plan.planSha256)),retryState=await retry.recoveryState();
          if(retryState.pending.length===1&&retryState.pending[0]==='creative_a')await retry.confirmRecovered('creative_a',objectId,
            async()=>{await deps.reauthorize();await p.verify(plan,{...state.confirmed,creative_a:{id:objectId}},identities);});
          else if(retryState.pending.length||retryState.confirmed.creative_a&&retryState.confirmed.creative_a.id!==objectId)throw Error('RETRY_RECONCILIATION_REQUIRED');
        }
        await ledger.confirmRecovered(step,objectId,async()=>{
          await deps.reauthorize();await p.verify(plan,{...state.confirmed,[step]:{id:objectId}},identities);
        });
      }
      await deps.reauthorize();const confirmed=await ledger.snapshot();await p.verify(plan,confirmed,identities);
      const complete=steps.every(k=>!!confirmed[k]?.id);
      return {source:'BROS_DEMAND_PAUSED_CREATOR',status:complete?'CREATED_PAUSED_VERIFIED':'RECOVERED_PAUSED',
        planSha256:plan.planSha256,objects:Object.fromEntries(steps.filter(k=>confirmed[k]?.id).map(k=>[k,confirmed[k]!.id])),
        providerReadbackVerified:true,committedReadback:true,canContinue:!complete&&ownerApproved(plan.planSha256)&&
          await creativeApproved(scope,plan),
        activationAvailable:false,spendAuthorized:false};
    },
    retryCreative:async(scope:PilotScope,draft:unknown,expectedHash:string,receipt:string,authorization:string)=>{
      const f=flags();if(!f.enabled||!f.ledger||authorization!=='RETRY_RECONCILED_PAUSED_CREATIVE')throw Error('PAUSED_RETRY_NOT_AUTHORIZED');
      const plan=await planFor(scope,draft);if(plan.planSha256!==expectedHash)throw Error('PLAN_CHANGED_REVIEW_AGAIN');
      if(!ownerApproved(plan.planSha256))throw Error('PAUSED_PLAN_OWNER_APPROVAL_REQUIRED');
      verifyCreativeRecovery(scope,plan.planSha256,receipt,env.META_APP_SECRET||'',deps.now());
      await deps.reauthorize();await requireCreativeApproval(scope,plan);
      const p=await provider(),identities=await p.inputReadback(plan),ledger=deps.ledger(scope,plan.planSha256);
      const state=await ledger.recoveryState();await p.verify(plan,state.confirmed,identities);
      if(!state.pending.length&&!state.confirmed.creative_a?.id)throw Error('PAUSED_RETRY_STATE_INVALID');
      if(state.pending.length){
        if(state.pending.length!==1||state.pending[0]!=='creative_a'||!state.confirmed.campaign?.id||!state.confirmed.adset?.id||state.confirmed.ad_a)throw Error('PAUSED_RETRY_STATE_INVALID');
        const retry=deps.ledger(scope,creativeRetryNamespace(plan.planSha256)),prior=await retry.snapshot();
        let objectId=prior.creative_a?.id;
        if(!objectId){
          const discovery=await p.discoverPending(plan,state.confirmed,'creative_a');
          let validation;
          if(discovery.status==='NO_MATCH'&&await creativeApproved(scope,plan)){
            await deps.reauthorize();
            validation=await p.validateCreative(plan,identities);
          }
          if(discovery.status!=='NO_MATCH'||validation?.accepted!==true)return {source:'BROS_DEMAND_PAUSED_CREATOR',status:'RECOVERY_HELD',
            planSha256:plan.planSha256,discovery:{...discovery,...(validation?{validation}:{})},canContinue:false,activationAvailable:false,spendAuthorized:false};
          // A separate deterministic namespace in the SAME existing journal commits
          // the single recovery-attempt intent before POST. Unknown outcome blocks
          // all further retries. The original intent/history is never changed.
          await requireCreativeApproval(scope,plan);
          objectId=(await retry.perform('creative_a',async()=>{await deps.reauthorize();return p.create('creative_a',plan,state.confirmed,identities);})).id;
        }
        if(!objectId)throw Error('PAUSED_RETRY_RESULT_INVALID');
        const recovered=objectId;await ledger.confirmRecovered('creative_a',recovered,async()=>{
          await deps.reauthorize();await p.verify(plan,{...state.confirmed,creative_a:{id:recovered}},identities);});
      }
      await deps.reauthorize();const confirmed=await ledger.snapshot();await p.verify(plan,confirmed,identities);
      return {source:'BROS_DEMAND_PAUSED_CREATOR',status:'RECOVERED_PAUSED',planSha256:plan.planSha256,
        objects:Object.fromEntries(steps.filter(k=>confirmed[k]?.id).map(k=>[k,confirmed[k]!.id])),
        providerReadbackVerified:true,committedReadback:true,canContinue:!confirmed.ad_a?.id,activationAvailable:false,spendAuthorized:false};
    },
    verifyLedger:async(scope:PilotScope)=>{
      if(!deps.verifyLedger)throw Error('CREATOR_LEDGER_VERIFICATION_UNAVAILABLE');
      await deps.reauthorize();const result=await deps.verifyLedger(scope);await deps.reauthorize();return result;
    },
    readiness:async()=>{
      const f=flags(),missing=[...(!f.enabled?['PAUSED_CREATION_NOT_ENABLED']:[]),...(!f.ledger?['CREATOR_LEDGER_NOT_REVIEWED']:[])];
      if(!deps.verifyCreativeForPlan)missing.push(creativeBlocker);
      let images:{items:{hash:string;name:string}[];partial:boolean}|null=null,connectionVerified=false;
      try{images=await(await provider()).images();connectionVerified=true;}catch{missing.push('META_MANAGEMENT_OR_IMAGE_LIBRARY_UNVERIFIED');}
      return {source:'BROS_DEMAND_PAUSED_CREATOR',maximumBudgetMinor:cap(),currency:'MYR',missing,
        images,connectionVerified,activationAvailable:false};
    },
    preview:async(scope:PilotScope,draft:unknown)=>{
      const plan=await planFor(scope,draft),f=flags();
      const blockers=[...(!f.enabled?['PAUSED_CREATION_NOT_ENABLED']:[]),...(!f.ledger?['CREATOR_LEDGER_NOT_REVIEWED']:[])];
      if(!ownerApproved(plan.planSha256))blockers.push('PAUSED_PLAN_OWNER_APPROVAL_REQUIRED');
      if(!await creativeApproved(scope,plan))blockers.push(creativeBlocker);
      let snapshot={},providerVerified=false;
      try{const p=await provider();await p.inputReadback(plan);providerVerified=true;}catch{blockers.push('META_ACCOUNT_IMAGE_OR_IDENTITIES_UNVERIFIED');}
      if(f.ledger)try{snapshot=await deps.ledger(scope,plan.planSha256).snapshot();}catch{blockers.push('LEDGER_UNAVAILABLE_OR_RECONCILIATION_REQUIRED');}
      return {source:'BROS_DEMAND_PAUSED_CREATOR',plan,blockers,providerVerified,existingSteps:Object.keys(snapshot).length,
        canCreate:blockers.length===0,activationAvailable:false};
    },
    stage:async(scope:PilotScope,draft:unknown,expectedHash:string,authorization:string)=>{
      const f=flags();if(!f.enabled||!f.ledger||authorization!=='CREATE_PAUSED_ONLY')throw Error('PAUSED_CREATION_NOT_AUTHORIZED');
      const plan=await planFor(scope,draft);
      if(plan.planSha256!==expectedHash)throw Error('PLAN_CHANGED_REVIEW_AGAIN');
      if(!ownerApproved(plan.planSha256))throw Error('PAUSED_PLAN_OWNER_APPROVAL_REQUIRED');
      if(!deps.verifyCreativeForPlan)throw Error(creativeBlocker);
      await deps.reauthorize();const p=await provider(),identities=await p.inputReadback(plan);
      const ledger=deps.ledger(scope,plan.planSha256),snapshot=await ledger.snapshot();
      await p.verify(plan,snapshot,identities);
      const next=steps.find(k=>!snapshot[k]?.id);
      if(next){
        await requireCreativeApproval(scope,plan);
        await ledger.perform(next,async()=>{await deps.reauthorize();return p.create(next,plan,snapshot,identities);});
        await deps.reauthorize();
      }
      const committed=await ledger.snapshot();await p.verify(plan,committed,identities);
      const complete=steps.every(k=>!!committed[k]?.id);
      return {source:'BROS_DEMAND_PAUSED_CREATOR',planSha256:plan.planSha256,
        status:complete?'CREATED_PAUSED_VERIFIED':'CREATING_PAUSED',completedSteps:steps.filter(k=>!!committed[k]?.id).length,
        totalSteps:4,objects:Object.fromEntries(steps.filter(k=>!!committed[k]?.id).map(k=>[k,committed[k]!.id])),
        committedReadback:true,providerReadbackVerified:true,activationAvailable:false,spendAuthorized:false};
    }
  };
}
