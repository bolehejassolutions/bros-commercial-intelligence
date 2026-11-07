/**
 * Read-only historical campaign preview adapter.
 *
 * Original Supabase generation_jobs contain v3.6.1 outputs whose captions are
 * maps (facebook -> text) and whose publish_plan may use comma-separated
 * platform names. Current strict AI generation expects caption arrays and
 * one platform per publishing entry. This adapter preserves the original
 * meaning for DISPLAY only. It NEVER qualifies historical output for new
 * generation, persistence, scheduling, credit settlement or publishing.
 */
import {
 ContentGenerationRejected,validateCampaignPlan,type CampaignPlan
} from './neon-content-generation-contract.ts';

type HistoricCaption=Readonly<{platform:string;caption:string}>;
export type HistoricalPlanEntry=Readonly<{
 day:number;
 original_platform_label:string;
 platforms:string[];
 content_type:string;
 objective:string;
}>;
export type HistoricalCampaignPreview=Readonly<{
 original_format:'legacy'|'current';
 readOnly:true;
 readyForGeneration:false;
 warnings:readonly string[];
 plan:Omit<CampaignPlan,'captions'|'publish_plan'>&Readonly<{
  captions:HistoricCaption[];
  publish_plan:HistoricalPlanEntry[];
 }>;
}>;
const allowed=new Set(['facebook','instagram','tiktok','youtube','linkedin','whatsapp','threads','x']);
const own=(obj:object,key:string)=>Object.prototype.hasOwnProperty.call(obj,key);
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fail=():never=>{throw new ContentGenerationRejected('Invalid historical CONTENT plan');};
const platform=(value:unknown):string=>{
 if(typeof value!=='string')return fail();
 const lowered=value.trim().toLowerCase();
 if(!allowed.has(lowered))return fail();
 return lowered;
};
function extractPlatforms(value:unknown):string[]{
 if(typeof value!=='string'||value.length>200)return fail();
 const pieces=value.split(',').map(part=>platform(part));
 if(!pieces.length||pieces.length>8||new Set(pieces).size!==pieces.length)return fail();
 return pieces;
}
function validateCaptions(value:unknown):{captions:HistoricCaption[];legacy:boolean}{
 if(Array.isArray(value)){
  if(value.length>100||value.some(row=>!object(row)||!own(row,'platform')||
   !own(row,'caption')||Object.keys(row).length!==2||typeof row.caption!=='string'||
   !row.caption.trim()||row.caption.length>10000))return fail();
  return {captions:value.map(row=>({platform:platform(row.platform),caption:String(row.caption)})),legacy:false};
 }
 if(!object(value)||Object.keys(value).length>8)return fail();
 const captions:HistoricCaption[]=[];
 for(const [label,caption] of Object.entries(value)){
  if(typeof caption!=='string'||!caption.trim()||caption.length>10000)return fail();
  captions.push({platform:platform(label),caption});
 }
 return {captions,legacy:true};
}
export function previewHistoricalCampaignPlan(raw:unknown):HistoricalCampaignPreview{
 if(!object(raw))return fail();
 let json:string;
 try{json=JSON.stringify(raw);}catch{return fail();}
 if(json.length>120000||Object.keys(raw).length!==7||
  !['strategy','angles','scripts','scenes','visuals','captions','publish_plan'].every(k=>own(raw,k)))
  return fail();

 const captionResult=validateCaptions(raw.captions);
 if(!Array.isArray(raw.publish_plan)||raw.publish_plan.length>300)return fail();
 const warnings:string[]=[];
 const planEntries:HistoricalPlanEntry[]=raw.publish_plan.map((entry:unknown)=>{
  if(!object(entry)||Object.keys(entry).length!==4||
     !['day','platform','content_type','objective'].every(k=>own(entry,k))||
     !Number.isInteger(entry.day)||Number(entry.day)<1||Number(entry.day)>90||
     typeof entry.content_type!=='string'||!entry.content_type.trim()||entry.content_type.length>200||
     typeof entry.objective!=='string'||!entry.objective.trim()||entry.objective.length>2000)
   return fail();
  const platforms=extractPlatforms(entry.platform);
  if(platforms.length>1&&!warnings.includes('combined_platform_label'))
   warnings.push('combined_platform_label');
  return Object.freeze({
   day:entry.day as number,original_platform_label:entry.platform as string,
   platforms,content_type:entry.content_type as string,objective:entry.objective as string
  });
 });
 if(captionResult.legacy)warnings.unshift('legacy_caption_map');
 // Validate the other six layers through the strict current contract. The
 // single-platform stand-in is for STRUCTURAL validation only: the returned
 // preview preserves the original combined label and all platform values.
 const structural=validateCampaignPlan({
  ...raw,
  captions:captionResult.captions,
  publish_plan:planEntries.map(item=>({
   day:item.day,platform:item.platforms[0],content_type:item.content_type,objective:item.objective
  }))
 });
 const previewPlan={
  strategy:structural.strategy,angles:structural.angles,scripts:structural.scripts,
  scenes:structural.scenes,visuals:structural.visuals,
  captions:captionResult.captions,
  publish_plan:planEntries
 };
 return Object.freeze({
  original_format:warnings.length?'legacy':'current' as 'legacy'|'current',
  readOnly:true as const,
  readyForGeneration:false as const,
  warnings:Object.freeze(warnings),
  plan:Object.freeze(previewPlan)
 });
}
