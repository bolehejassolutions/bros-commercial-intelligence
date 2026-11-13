import {createHash} from 'node:crypto';
import {PILOT} from './meta-pilot-policy.ts';
import type {PilotScope} from './meta-pilot-ledger.ts';
export type PausedCampaignDraft=Readonly<{name:string;budgetMinor:number;durationDays:number;startTime:string;
  landingUrl:string;primaryText:string;headline:string;description:string;imageHash:string}>;
export type PausedCampaignPlan=PausedCampaignDraft&Readonly<{schemaVersion:1;planSha256:string;
  accountId:string;pageId:string;pixelId:string;endTime:string;status:'PAUSED'}>;
const fields=['name','budgetMinor','durationDays','startTime','landingUrl','primaryText','headline','description','imageHash'];
const fail=():never=>{throw Error('PAUSED_CAMPAIGN_PLAN_INVALID');};
export function demandCampaignBudgetCap(environment: NodeJS.ProcessEnv): number {
  const cap = Number(environment.BROS_DEMAND_META_CREATOR_BUDGET_CAP_MINOR ?? 14000);
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > 14000) throw Error('CREATOR_CAP_INVALID');
  return cap;
}
const clean=(v:unknown,min:number,max:number)=>typeof v==='string'&&v===v.trim()&&v.length>=min&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v);
/** Internal V1 retains the existing account, Page, pixel and MY 21–45 feeds.
 * A new immutable plan gets its own ledger namespace, never the live V5 one.
 */
function checkedPausedCampaignPlan(scope:PilotScope,draft:unknown,maximumBudgetMinor:number,at:number,resuming:boolean):PausedCampaignPlan {
  if(!draft||typeof draft!=='object'||Array.isArray(draft)||Reflect.ownKeys(draft).length!==fields.length||
     !fields.every(k=>Object.hasOwn(draft,k))||!Number.isFinite(at)||!Number.isSafeInteger(maximumBudgetMinor)||maximumBudgetMinor<1||maximumBudgetMinor>14000)fail();
  const p=structuredClone(draft) as PausedCampaignDraft;
  if(!clean(p.name,3,100)||!clean(p.primaryText,3,4000)||!clean(p.headline,3,120)||!clean(p.description,0,200)||
     !Number.isSafeInteger(p.budgetMinor)||p.budgetMinor<1||p.budgetMinor>maximumBudgetMinor||
     !Number.isInteger(p.durationDays)||p.durationDays<1||p.durationDays>7||
     typeof p.imageHash!=='string'||!/^[a-f0-9]{32}$/.test(p.imageHash)||typeof p.startTime!=='string'||
     !Number.isFinite(Date.parse(p.startTime))||new Date(p.startTime).toISOString()!==p.startTime||
     (!resuming&&Date.parse(p.startTime)<at+15*60000)||Date.parse(p.startTime)>at+30*86400000)fail();
  let url:URL;try{url=new URL(p.landingUrl);}catch{return fail();}
  if(url.protocol!=='https:'||url.origin!=='https://bros.bolehejas.com'||url.username||url.password||url.hash||url.href.length>2048)fail();
  const endTime=new Date(Date.parse(p.startTime)+p.durationDays*86400000).toISOString();
  if(resuming&&Date.parse(endTime)<=at)fail();
  const normalized={name:p.name,budgetMinor:p.budgetMinor,durationDays:p.durationDays,startTime:p.startTime,
    landingUrl:url.href,primaryText:p.primaryText,headline:p.headline,description:p.description,imageHash:p.imageHash};
  const planSha256=createHash('sha256').update(JSON.stringify([1,scope.tenantId,scope.principalId,
    PILOT.account,PILOT.page,PILOT.pixel,...fields.map(k=>normalized[k as keyof typeof normalized])])).digest('hex');
  return Object.freeze({...normalized,schemaVersion:1,planSha256,accountId:PILOT.account,pageId:PILOT.page,
    pixelId:PILOT.pixel,endTime,status:'PAUSED'});
}
export function preparePausedCampaignPlan(scope:PilotScope,draft:unknown,maximumBudgetMinor:number,at=Date.now()):PausedCampaignPlan {
  return checkedPausedCampaignPlan(scope,draft,maximumBudgetMinor,at,false);
}
/** Rebuild an unchanged, unexpired plan. The service must additionally require
 * its already-confirmed journal parents before using a started plan.
 */
export function restorePausedCampaignPlan(scope:PilotScope,draft:unknown,maximumBudgetMinor:number,at=Date.now()):PausedCampaignPlan {
  return checkedPausedCampaignPlan(scope,draft,maximumBudgetMinor,at,true);
}
export function pausedCampaignBodies(plan:PausedCampaignPlan,identities:{universal_beneficiary:string;universal_payer:string}){
  return {
    campaign:{name:plan.name,objective:'OUTCOME_SALES',buying_type:'AUCTION',special_ad_categories:[],
      lifetime_budget:plan.budgetMinor,bid_strategy:'LOWEST_COST_WITHOUT_CAP',status:'PAUSED'},
    adset:(campaignId:string)=>({name:plan.name+' | MY 21–45 | Feeds',campaign_id:campaignId,
      start_time:plan.startTime,end_time:plan.endTime,status:'PAUSED',billing_event:'IMPRESSIONS',
      optimization_goal:'OFFSITE_CONVERSIONS',destination_type:'WEBSITE',
      promoted_object:{pixel_id:plan.pixelId,custom_event_type:'PURCHASE'},
      targeting:{geo_locations:{countries:['MY']},age_min:21,age_max:45,publisher_platforms:['facebook','instagram'],
        facebook_positions:['feed'],instagram_positions:['stream'],targeting_automation:{advantage_audience:0}},
      regional_regulated_categories:['MALAYSIA_UNIVERSAL'],regional_regulation_identities:identities}),
    creative:{name:plan.name+' | Creative',object_story_spec:{page_id:plan.pageId,link_data:{link:plan.landingUrl,
      image_hash:plan.imageHash,message:plan.primaryText,name:plan.headline,description:plan.description,
      call_to_action:{type:'LEARN_MORE',value:{link:plan.landingUrl}}}}},
    ad:(adsetId:string,creativeId:string)=>({name:plan.name+' | Ad',adset_id:adsetId,
      creative:{creative_id:creativeId},status:'PAUSED'})};
}
