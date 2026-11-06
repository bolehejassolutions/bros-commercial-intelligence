import {inspectMetaConnection} from '../marketing-operator/meta-connection.ts';
import {pilotMetaConfiguration} from './meta-pilot-environment.ts';
import {createPausedCampaignProvider} from './meta-paused-campaign-provider.ts';
import {preparePausedCampaignPlan} from './meta-paused-campaign-plan.ts';
import type {PilotScope} from './meta-pilot-ledger.ts';
import {createPilotLedger} from './meta-pilot-ledger.ts';
const steps=['campaign','adset','creative_a','ad_a'] as const;
type Deps={environment:NodeJS.ProcessEnv;ledger:(scope:PilotScope,sha:string)=>ReturnType<typeof createPilotLedger>;
  reauthorize:()=>Promise<void>;now:()=>number;transport?:typeof fetch;verifyLedger?:(scope:PilotScope)=>Promise<unknown>};
export function createPausedCampaignService(deps:Deps){
  const config=pilotMetaConfiguration(deps.environment),env=config.environment;
  const cap=()=>{const x=Number(env.BROS_DEMAND_META_CREATOR_BUDGET_CAP_MINOR??14000);
    if(!Number.isSafeInteger(x)||x<1||x>14000)throw Error('CREATOR_CAP_INVALID');return x;};
  const flags=()=>({enabled:env.BROS_DEMAND_META_PAUSED_CREATE==='operator-approved-v1',
    ledger:env.BROS_DEMAND_META_CREATOR_LEDGER==='reviewed-v1'});
  async function provider(){
    if(config.managementCredentialConflict)throw Error('MANAGEMENT_CREDENTIAL_CONFLICT');
    const status=await inspectMetaConnection('write',env,deps.transport,deps.now());
    if(status.status!=='READY'||!env.META_ADS_MANAGEMENT_TOKEN||!env.META_APP_SECRET)throw Error('META_MANAGEMENT_CONNECTION_NOT_VERIFIED');
    return createPausedCampaignProvider(env.META_ADS_MANAGEMENT_TOKEN,env.META_APP_SECRET,deps.transport);
  }
  return {
    reconcile:async(scope:PilotScope,draft:unknown,expectedHash:string,authorization:string)=>{
      const f=flags();if(!f.enabled||!f.ledger||authorization!=='RECONCILE_PAUSED_ONLY')throw Error('PAUSED_RECOVERY_NOT_AUTHORIZED');
      const plan=preparePausedCampaignPlan(scope,draft,cap(),deps.now());
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
        if(discovery.status!=='EXACT_MATCH')return {source:'BROS_DEMAND_PAUSED_CREATOR',status:'RECOVERY_HELD',
          planSha256:plan.planSha256,discovery,canContinue:false,activationAvailable:false,spendAuthorized:false};
        const objectId=discovery.candidates[0].objectId;
        await ledger.confirmRecovered(step,objectId,async()=>{
          await deps.reauthorize();await p.verify(plan,{...state.confirmed,[step]:{id:objectId}},identities);
        });
      }
      await deps.reauthorize();const confirmed=await ledger.snapshot();await p.verify(plan,confirmed,identities);
      const complete=steps.every(k=>!!confirmed[k]?.id);
      return {source:'BROS_DEMAND_PAUSED_CREATOR',status:complete?'CREATED_PAUSED_VERIFIED':'RECOVERED_PAUSED',
        planSha256:plan.planSha256,objects:Object.fromEntries(steps.filter(k=>confirmed[k]?.id).map(k=>[k,confirmed[k]!.id])),
        providerReadbackVerified:true,committedReadback:true,canContinue:!complete,activationAvailable:false,spendAuthorized:false};
    },
    verifyLedger:async(scope:PilotScope)=>{
      if(!deps.verifyLedger)throw Error('CREATOR_LEDGER_VERIFICATION_UNAVAILABLE');
      await deps.reauthorize();const result=await deps.verifyLedger(scope);await deps.reauthorize();return result;
    },
    readiness:async()=>{
      const f=flags(),missing=[...(!f.enabled?['PAUSED_CREATION_NOT_ENABLED']:[]),...(!f.ledger?['CREATOR_LEDGER_NOT_REVIEWED']:[])];
      let images:{items:{hash:string;name:string}[];partial:boolean}|null=null,connectionVerified=false;
      try{images=await(await provider()).images();connectionVerified=true;}catch{missing.push('META_MANAGEMENT_OR_IMAGE_LIBRARY_UNVERIFIED');}
      return {source:'BROS_DEMAND_PAUSED_CREATOR',maximumBudgetMinor:cap(),currency:'MYR',missing,
        images,connectionVerified,activationAvailable:false};
    },
    preview:async(scope:PilotScope,draft:unknown)=>{
      const plan=preparePausedCampaignPlan(scope,draft,cap(),deps.now()),f=flags();
      const blockers=[...(!f.enabled?['PAUSED_CREATION_NOT_ENABLED']:[]),...(!f.ledger?['CREATOR_LEDGER_NOT_REVIEWED']:[])];
      let snapshot={},providerVerified=false;
      try{const p=await provider();await p.inputReadback(plan);providerVerified=true;}catch{blockers.push('META_ACCOUNT_IMAGE_OR_IDENTITIES_UNVERIFIED');}
      if(f.ledger)try{snapshot=await deps.ledger(scope,plan.planSha256).snapshot();}catch{blockers.push('LEDGER_UNAVAILABLE_OR_RECONCILIATION_REQUIRED');}
      return {source:'BROS_DEMAND_PAUSED_CREATOR',plan,blockers,providerVerified,existingSteps:Object.keys(snapshot).length,
        canCreate:blockers.length===0,activationAvailable:false};
    },
    stage:async(scope:PilotScope,draft:unknown,expectedHash:string,authorization:string)=>{
      const f=flags();if(!f.enabled||!f.ledger||authorization!=='CREATE_PAUSED_ONLY')throw Error('PAUSED_CREATION_NOT_AUTHORIZED');
      const plan=preparePausedCampaignPlan(scope,draft,cap(),deps.now());
      if(plan.planSha256!==expectedHash)throw Error('PLAN_CHANGED_REVIEW_AGAIN');
      await deps.reauthorize();const p=await provider(),identities=await p.inputReadback(plan);
      const ledger=deps.ledger(scope,plan.planSha256),snapshot=await ledger.snapshot();
      await p.verify(plan,snapshot,identities);
      const next=steps.find(k=>!snapshot[k]?.id);
      if(next){
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
