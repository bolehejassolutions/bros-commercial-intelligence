import {createHmac} from 'node:crypto';
import {metaCreatePaused} from '../marketing-operator/meta-write.ts';
import {metaProviderRequest,metaProviderJson} from '../marketing-operator/meta-provider.ts';
import {PILOT} from './meta-pilot-policy.ts';
import {pausedCampaignBodies,type PausedCampaignPlan} from './meta-paused-campaign-plan.ts';
import type {Snapshot} from './meta-pilot-policy.ts';
const GRAPH='https://graph.facebook.com/v24.0';
const object=(v:unknown):Record<string,unknown>=>{
  if(!v||typeof v!=='object'||Array.isArray(v))throw Error('META_CREATOR_READBACK_INVALID');return v as Record<string,unknown>;};
const id=(v:unknown)=>{if(typeof v!=='string'||!/^\d{6,30}$/.test(v))throw Error('META_CREATOR_ID_INVALID');return v;};
export type CreatorIdentities={universal_beneficiary:string;universal_payer:string};
function creativeChecks(plan:PausedCampaignPlan,c:Record<string,unknown>){
  const s=c.object_story_spec as Record<string,unknown>|undefined,l=s?.link_data as Record<string,unknown>|undefined;
  const cta=l?.call_to_action as Record<string,unknown>|undefined,v=cta?.value as Record<string,unknown>|undefined;
  return {account:c.account_id===PILOT.account.slice(4),page:s?.page_id===plan.pageId,
    destination:l?.link===plan.landingUrl,image:l?.image_hash===plan.imageHash,message:l?.message===plan.primaryText,
    headline:l?.name===plan.headline,description:(l?.description??'')===plan.description,
    action:cta?.type==='LEARN_MORE',actionDestination:v?.link===plan.landingUrl};
}
export function createPausedCampaignProvider(token:string,secret:string,rawTransport:typeof fetch=fetch){
  const transport:typeof fetch=(input,init)=>{
    const url=new URL(String(input));if(url.origin!=='https://graph.facebook.com')throw Error('META_DESTINATION_DENIED');
    url.searchParams.set('appsecret_proof',createHmac('sha256',secret).update(token).digest('hex'));
    return metaProviderRequest(url.href,init??{},rawTransport);
  };
  async function get(path:string,fields:string,params:Record<string,string>={}){
    const url=new URL(GRAPH+'/'+path);url.searchParams.set('fields',fields);
    for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
    const r=await transport(url.href,{method:'GET',headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(12000)});
    const data=await metaProviderJson(r);if(!r.ok||data.error)throw Error('META_CREATOR_READBACK_UNAVAILABLE');return data;
  }
  async function identityMapping():Promise<CreatorIdentities>{
    // Reuse the provider-reported identity mapping of the existing owner-run
    // V5 ad set. No IDs are guessed from Page/business IDs or verification UI.
    const set=await get('120251321765170697','id,account_id,campaign_id,regional_regulated_categories,regional_regulation_identities');
    if(set.id!=='120251321765170697'||set.account_id!==PILOT.account.slice(4)||set.campaign_id!==PILOT.campaign||
       !Array.isArray(set.regional_regulated_categories)||!set.regional_regulated_categories.includes('MALAYSIA_UNIVERSAL'))throw Error('META_IDENTITY_SOURCE_UNVERIFIED');
    const mapping=object(set.regional_regulation_identities);
    return {universal_beneficiary:id(mapping.universal_beneficiary),universal_payer:id(mapping.universal_payer)};
  }
  async function images(){
    const data=await get(PILOT.account+'/adimages','hash,name,url',{limit:'25'});
    if(!Array.isArray(data.data)||data.data.length>25)throw Error('META_IMAGE_LIBRARY_UNVERIFIED');
    return {items:data.data.map(x=>{const p=object(x);
      if(typeof p.hash!=='string'||!/^[a-f0-9]{32}$/i.test(p.hash)||typeof p.name!=='string')throw Error('META_IMAGE_LIBRARY_UNVERIFIED');
      return {hash:p.hash.toLowerCase(),name:p.name.slice(0,200)};}),
      partial:!!(data.paging&&object(data.paging).next)};
  }
  async function inputReadback(plan:PausedCampaignPlan){
    const [account,images,identities]=await Promise.all([
      get(PILOT.account,'id,account_id,account_status,currency,timezone_name'),
      get(PILOT.account+'/adimages','hash',{hashes:JSON.stringify([plan.imageHash])}),identityMapping()]);
    if(account.id!==PILOT.account||account.account_id!==PILOT.account.slice(4)||account.account_status!==1||
       account.currency!=='MYR'||account.timezone_name!=='Asia/Kuala_Lumpur'||
       !Array.isArray(images.data)||images.data.length!==1||object(images.data[0]).hash!==plan.imageHash||
       images.paging&&object(images.paging).next)throw Error('META_CREATOR_INPUTS_UNVERIFIED');
    return identities;
  }
  async function verify(plan:PausedCampaignPlan,snapshot:Snapshot,identities:CreatorIdentities){
    if(snapshot.campaign?.id){
      if(snapshot.campaign.id===PILOT.campaign)throw Error('EXISTING_V5_CAMPAIGN_IS_READ_ONLY');
      const c=await get(id(snapshot.campaign.id),'id,account_id,name,status,objective,lifetime_budget,daily_budget');
      if(c.id!==snapshot.campaign.id||c.account_id!==PILOT.account.slice(4)||c.name!==plan.name||c.status!=='PAUSED'||
         c.objective!=='OUTCOME_SALES'||Number(c.lifetime_budget)!==plan.budgetMinor||
         c.daily_budget!==undefined&&Number(c.daily_budget)!==0)throw Error('CREATED_CAMPAIGN_READBACK_MISMATCH');
    }
    if(snapshot.adset?.id){
      const s=await get(id(snapshot.adset.id),'id,account_id,campaign_id,status,start_time,end_time,optimization_goal,destination_type,promoted_object,targeting,regional_regulated_categories,regional_regulation_identities');
      const t=object(s.targeting),geo=object(t.geo_locations),promoted=object(s.promoted_object),mapping=object(s.regional_regulation_identities);
      if(s.id!==snapshot.adset.id||s.account_id!==PILOT.account.slice(4)||s.campaign_id!==snapshot.campaign?.id||s.status!=='PAUSED'||
         Date.parse(String(s.start_time))!==Date.parse(plan.startTime)||Date.parse(String(s.end_time))!==Date.parse(plan.endTime)||
         s.optimization_goal!=='OFFSITE_CONVERSIONS'||s.destination_type!=='WEBSITE'||promoted.pixel_id!==plan.pixelId||promoted.custom_event_type!=='PURCHASE'||
         !Array.isArray(geo.countries)||geo.countries.length!==1||geo.countries[0]!=='MY'||t.age_min!==21||t.age_max!==45||
         JSON.stringify([...(t.publisher_platforms as string[])].sort())!==JSON.stringify(['facebook','instagram'])||
         !Array.isArray(t.facebook_positions)||t.facebook_positions.length!==1||t.facebook_positions[0]!=='feed'||
         !Array.isArray(t.instagram_positions)||t.instagram_positions.length!==1||t.instagram_positions[0]!=='stream'||
         mapping.universal_beneficiary!==identities.universal_beneficiary||mapping.universal_payer!==identities.universal_payer)throw Error('CREATED_ADSET_READBACK_MISMATCH');
    }
    if(snapshot.creative_a?.id){
      const c=await get(id(snapshot.creative_a.id),'id,account_id,object_story_spec');
      if(c.id!==snapshot.creative_a.id||!Object.values(creativeChecks(plan,c)).every(Boolean))throw Error('CREATED_CREATIVE_READBACK_MISMATCH');
    }
    if(snapshot.ad_a?.id){
      const a=await get(id(snapshot.ad_a.id),'id,account_id,campaign_id,adset_id,status,creative');
      if(a.id!==snapshot.ad_a.id||a.account_id!==PILOT.account.slice(4)||a.campaign_id!==snapshot.campaign?.id||
         a.adset_id!==snapshot.adset?.id||a.status!=='PAUSED'||object(a.creative).id!==snapshot.creative_a?.id)throw Error('CREATED_AD_READBACK_MISMATCH');
    }
  }
  async function discoverPending(plan:PausedCampaignPlan,snapshot:Snapshot,step:'creative_a'|'ad_a'){
    const path=step==='creative_a'?PILOT.account+'/adcreatives':id(snapshot.adset?.id)+'/ads';
    const fields=step==='creative_a'?'id,name,account_id,object_story_spec':'id,name,account_id,campaign_id,adset_id,status,creative';
    const expectedName=plan.name+(step==='creative_a'?' | Creative':' | Ad');
    const candidates:{objectId:string;checks:Record<string,boolean>}[]=[];
    let after:string|undefined;
    for(let page=0;page<3;page++){
      const data=await get(path,fields,{limit:'50',...(after?{after}:{})});
      if(!Array.isArray(data.data)||data.data.length>50)throw Error('META_RECOVERY_INVENTORY_INVALID');
      for(const value of data.data){const c=object(value);if(c.name!==expectedName)continue;
        const objectId=id(c.id);if([PILOT.campaign,'120251321765170697','120251321765180697','120251323975550697'].includes(objectId))throw Error('EXISTING_V5_OBJECT_IS_READ_ONLY');
        const checks=step==='creative_a'?creativeChecks(plan,c):{account:c.account_id===PILOT.account.slice(4),
          campaign:c.campaign_id===snapshot.campaign?.id,adset:c.adset_id===snapshot.adset?.id,
          paused:c.status==='PAUSED',creative:object(c.creative).id===snapshot.creative_a?.id};
        candidates.push({objectId,checks});if(candidates.length>8)return {status:'AMBIGUOUS',candidates:candidates.slice(0,8)};
      }
      if(!data.paging||!object(data.paging).next){
        if(candidates.length===0)return {status:'NO_MATCH',candidates};
        if(candidates.length!==1)return {status:'AMBIGUOUS',candidates};
        return {status:Object.values(candidates[0].checks).every(Boolean)?'EXACT_MATCH':'READBACK_MISMATCH',candidates};
      }
      const cursor=object(object(data.paging).cursors).after;
      if(typeof cursor!=='string'||cursor.length<1||cursor.length>2048)throw Error('META_RECOVERY_CURSOR_INVALID');
      after=cursor;
    }
    return {status:'INCOMPLETE_INVENTORY',candidates};
  }
  async function validateCreative(plan:PausedCampaignPlan,identities:CreatorIdentities){
    // Meta's official Business SDK exposes AdCreative.ExecutionOptions.validate_only.
    // This diagnostic never asks Meta to create an object or returns a credential.
    const fields={...pausedCampaignBodies(plan,identities).creative,
      execution_options:['validate_only']};
    const form=new URLSearchParams();for(const [k,v]of Object.entries(fields))form.set(k,typeof v==='string'?v:JSON.stringify(v));
    const r=await transport(GRAPH+'/'+PILOT.account+'/adcreatives',{method:'POST',headers:{Authorization:'Bearer '+token,
      'Content-Type':'application/x-www-form-urlencoded'},body:form.toString(),cache:'no-store',signal:AbortSignal.timeout(16000)});
    const data=await metaProviderJson(r),e=data.error?object(data.error):undefined;
    const message=typeof e?.message==='string'?e.message.split(token).join('[redacted]').split(secret).join('[redacted]')
      .replace(/https?:\/\/[^\s]+/g,'[url]').replace(/EA[A-Za-z0-9_-]{24,}/g,'[redacted]').slice(0,600):null;
    return {mode:'VALIDATE_ONLY',accepted:r.ok&&!e,code:typeof e?.code==='number'?e.code:null,
      subcode:typeof e?.error_subcode==='number'?e.error_subcode:null,message};
  }
  async function create(kind:'campaign'|'adset'|'creative_a'|'ad_a',plan:PausedCampaignPlan,snapshot:Snapshot,identities:CreatorIdentities){
    const b=pausedCampaignBodies(plan,identities);
    const operation=kind==='campaign'?'campaigns':kind==='adset'?'adsets':kind==='creative_a'?'adcreatives':'ads';
    const body=kind==='campaign'?b.campaign:kind==='adset'?b.adset(id(snapshot.campaign?.id)):
      kind==='creative_a'?b.creative:b.ad(id(snapshot.adset?.id),id(snapshot.creative_a?.id));
    const created=await metaCreatePaused(PILOT.account,operation,body,token,transport);
    if(created===PILOT.campaign||['120251321765170697','120251321765180697','120251323975550697'].includes(created))throw Error('EXISTING_V5_OBJECT_IS_READ_ONLY');
    await verify(plan,{...snapshot,[kind]:{id:created}},identities);
    return {id:created};
  }
  return {images,inputReadback,verify,create,discoverPending,validateCreative};
}
